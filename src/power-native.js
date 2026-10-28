import koffi from 'koffi';
import { createPowercfgWriter } from './powercfg.js';
import { powerError } from './power-error.js';

const SUB_BUTTONS = '4f971e89-eebd-4455-a8de-9e59040e7347';
const LID = '5ca83367-6e45-459f-a27b-476b1d01c936';

export function guidBuffer(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) throw new Error('Invalid power scheme GUID.');
  const hex = value.replaceAll('-', ''), b = Buffer.alloc(16);
  b.writeUInt32LE(parseInt(hex.slice(0, 8), 16), 0);
  b.writeUInt16LE(parseInt(hex.slice(8, 12), 16), 4);
  b.writeUInt16LE(parseInt(hex.slice(12, 16), 16), 6);
  Buffer.from(hex.slice(16), 'hex').copy(b, 8);
  return b;
}

function guidString(b) {
  return [b.readUInt32LE().toString(16).padStart(8, '0'), b.readUInt16LE(4).toString(16).padStart(4, '0'),
    b.readUInt16LE(6).toString(16).padStart(4, '0'), b.subarray(8, 10).toString('hex'), b.subarray(10).toString('hex')].join('-');
}

export function createPowerPolicyNative({ backend = 'powercfg' } = {}) {
  if (!['powercfg', 'native'].includes(backend)) throw new Error('Unknown power configuration backend.');
  const lib = koffi.load('powrprof.dll'), kernel = koffi.load('kernel32.dll');
  const active = lib.func('uint32 __stdcall PowerGetActiveScheme(void*, _Out_ void**)');
  const free = kernel.func('void* __stdcall LocalFree(void*)');
  const activate = lib.func('uint32 __stdcall PowerSetActiveScheme(void*, const void*)');
  const accessCheck = lib.func('uint32 __stdcall PowerSettingAccessCheck(uint32, const void*)');
  const read = {}, write = {};
  for (const mode of ['AC', 'DC']) {
    read[mode.toLowerCase()] = lib.func(`uint32 __stdcall PowerRead${mode}ValueIndex(void*, const void*, const void*, const void*, _Out_ uint32*)`);
    write[mode.toLowerCase()] = lib.func(`uint32 __stdcall PowerWrite${mode}ValueIndex(void*, const void*, const void*, const void*, uint32)`);
  }
  const subgroup = guidBuffer(SUB_BUTTONS), setting = guidBuffer(LID);
  const writer = backend === 'powercfg' ? createPowercfgWriter() : null;
  const check = (code, operation) => { if (code) throw powerError(code, operation); };
  return {
    backend,
    active() {
      const pointer = [null]; check(active(null, pointer), 'Read active power scheme');
      try { return guidString(Buffer.from(koffi.decode(pointer[0], 'uint8', 16))); }
      finally { free(pointer[0]); }
    },
    read(scheme, mode) { const value = [0]; check(read[mode](null, guidBuffer(scheme), subgroup, setting, value), `Read ${mode.toUpperCase()} lid action`); return value[0]; },
    write(scheme, mode, value) {
      if (writer) writer.write(scheme, mode, value);
      else check(write[mode](null, guidBuffer(scheme), subgroup, setting, value), `Write ${mode.toUpperCase()} lid action`);
    },
    refresh(scheme) {
      if (this.active() !== scheme) return;
      if (writer) writer.refresh(scheme);
      else check(activate(null, guidBuffer(scheme)), 'Apply active power scheme');
    },
    access() {
      return { ac: accessCheck(0, setting), dc: accessCheck(1, setting), activeScheme: accessCheck(19, null) };
    }
  };
}
