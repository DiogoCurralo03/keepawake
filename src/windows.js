import koffi from 'koffi';

let native;
function api() {
  if (native) return native;
  if (process.platform !== 'win32') throw new Error('KeepAwake requires Windows.');
  const kernel = koffi.load('kernel32.dll');
  const user = koffi.load('user32.dll');
  const advapi = koffi.load('advapi32.dll');
  const lastInput = koffi.struct('KA_LASTINPUTINFO', { cbSize: 'uint32', dwTime: 'uint32' });
  const power = koffi.struct('KA_SYSTEM_POWER_STATUS', {
    ACLineStatus: 'uint8', BatteryFlag: 'uint8', BatteryLifePercent: 'uint8', Reserved1: 'uint8',
    BatteryLifeTime: 'uint32', BatteryFullLifeTime: 'uint32'
  });
  const mouse = koffi.struct('KA_MOUSEINPUT', {
    dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t'
  });
  // MOUSEINPUT is the largest INPUT union member on x64 and ARM64.
  const input = koffi.struct('KA_INPUT', { type: 'uint32', mi: mouse });
  native = {
    input, lastInput,
    executionState: kernel.func('uint32 __stdcall SetThreadExecutionState(uint32)'),
    getLastError: kernel.func('uint32 __stdcall GetLastError()'),
    setLastError: kernel.func('void __stdcall SetLastError(uint32)'),
    getTickCount: kernel.func('uint32 __stdcall GetTickCount()'),
    getLastInput: user.func('int __stdcall GetLastInputInfo(_Inout_ KA_LASTINPUTINFO*)'),
    getPower: kernel.func('int __stdcall GetSystemPowerStatus(_Out_ KA_SYSTEM_POWER_STATUS*)'),
    sendInput: user.func('uint32 __stdcall SendInput(uint32, const KA_INPUT*, int)'),
    openInputDesktop: user.func('void* __stdcall OpenInputDesktop(uint32, int, uint32)'),
    getObjectInfo: user.func('int __stdcall GetUserObjectInformationW(void*, int, _Out_ void*, uint32, _Out_ uint32*)'),
    closeDesktop: user.func('int __stdcall CloseDesktop(void*)'),
    createMutex: kernel.func('void* __stdcall CreateMutexW(void*, int, const char16_t*)'),
    closeHandle: kernel.func('int __stdcall CloseHandle(void*)'),
    currentProcess: kernel.func('void* __stdcall GetCurrentProcess()'),
    openToken: advapi.func('int __stdcall OpenProcessToken(void*, uint32, _Out_ void**)'),
    getTokenInfo: advapi.func('int __stdcall GetTokenInformation(void*, int, _Out_ void*, uint32, _Out_ uint32*)')
  };
  return native;
}

export function isWindowsElevated() {
  const n = api(), token = [null];
  if (!n.openToken(n.currentProcess(), 8, token)) throw new Error('Could not query the process token.');
  try {
    const elevation = Buffer.alloc(4);
    if (!n.getTokenInfo(token[0], 20, elevation, elevation.length, [0])) throw new Error('Could not query process elevation.');
    return Boolean(elevation.readUInt32LE());
  } finally { n.closeHandle(token[0]); }
}

export function acquireLock(name) {
  const n = api();
  n.setLastError(0);
  const handle = n.createMutex(null, 0, name), error = n.getLastError();
  if (!handle) throw new Error(`CreateMutex failed (${error}).`);
  if (error === 183) { n.closeHandle(handle); const e = new Error('KeepAwake is already running.'); e.code = 'ALREADY_RUNNING'; throw e; }
  let closed = false;
  return () => { if (!closed) { closed = true; n.closeHandle(handle); } };
}

export class WindowsAwake {
  constructor() { this.native = api(); this.active = false; }
  set(active, display = true) {
    // Synchronous calls always execute on this Node thread. Windows releases
    // the thread's requests automatically even after an abrupt process exit.
    const flags = (0x80000000 | (active ? 1 : 0) | (active && display ? 2 : 0)) >>> 0;
    if (!this.native.executionState(flags)) throw new Error(`SetThreadExecutionState failed (${this.native.getLastError()}).`);
    this.active = active;
  }
  idleSeconds() {
    const info = { cbSize: koffi.sizeof(this.native.lastInput), dwTime: 0 };
    if (!this.native.getLastInput(info)) return null;
    return ((this.native.getTickCount() - info.dwTime) >>> 0) / 1000;
  }
  powerStatus() {
    const power = {};
    if (!this.native.getPower(power)) return { source: 'unknown', battery: null };
    return { source: power.ACLineStatus === 1 ? 'ac' : power.ACLineStatus === 0 ? 'battery' : 'unknown',
      battery: power.BatteryLifePercent <= 100 ? power.BatteryLifePercent : null };
  }
  interactive() {
    const n = this.native, desktop = n.openInputDesktop(0, 0, 1);
    if (!desktop) return false;
    try {
      const name = Buffer.alloc(512);
      return Boolean(n.getObjectInfo(desktop, 2, name, name.length, [0]) && name.toString('utf16le').replace(/\0.*$/s, '').toLowerCase() === 'default');
    } finally { n.closeDesktop(desktop); }
  }
  pulse() {
    if (!this.interactive()) return false;
    const sent = this.native.sendInput(1, [{ type: 0, mi: { dx: 0, dy: 0, mouseData: 0, dwFlags: 1, time: 0, dwExtraInfo: 0 } }], koffi.sizeof(this.native.input));
    if (sent !== 1) throw new Error('Windows rejected the activity event.');
    return true;
  }
  close() { this.set(false); }
}

export function cancelTrayMenu(hwnd) {
  koffi.load('user32.dll').func('int __stdcall PostMessageW(void*, uint32, uintptr_t, intptr_t)')(hwnd, 0x400 + 101, 0, 0);
}
