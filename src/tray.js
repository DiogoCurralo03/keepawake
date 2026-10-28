import { Worker } from 'node:worker_threads';
import { cancelTrayMenu } from './windows.js';

// The native menu must never block power refresh, pause expiry or shutdown.
export class TrayIcon {
  constructor(server, { workerUrl = new URL('./tray-worker.js', import.meta.url) } = {}) {
    this.server = server; this.workerUrl = workerUrl; this.worker = null; this.closing = false; this.refresh = null; this.hwnd = null;
  }

  async start() {
    this.worker = new Worker(this.workerUrl, {
      workerData: { status: this.server.getStatus(), dir: this.server.stateDir }
    });
    this.exited = new Promise(resolve => this.worker.once('exit', resolve));
    await new Promise((resolve, reject) => {
      const deadline = setTimeout(() => reject(new Error('Tray initialization timed out')), 10000);
      this.worker.on('error', error => {
        clearTimeout(deadline);
        reject(error);
        if (!this.closing) { this.server.audit('tray_failed', { message: error.message }); void this.server.stop(); }
      });
      this.worker.on('message', message => {
        if (message.type === 'ready') { this.hwnd = message.hwnd; clearTimeout(deadline); resolve(); }
        else if (message.type === 'failed') { clearTimeout(deadline); reject(new Error(message.message)); }
        else if (!this.closing) {
          if (message.type === 'pause') this.server.pause(message.duration);
          else if (message.type === 'resume') this.server.resume();
          else if (message.type === 'config') this.server.configure(message.patch);
          else if (message.type === 'power') this.server.tick();
          else if (message.type === 'quit') void this.server.stop();
          else if (message.type === 'warning') this.server.audit('tray_warning', { message: message.message });
        }
      });
      this.worker.once('exit', code => {
        clearTimeout(deadline);
        reject(new Error(`Tray worker exited (${code})`));
        if (!this.closing) { this.server.audit('tray_exited', { code }); void this.server.stop(); }
      });
    });
    this.refresh = setInterval(() => this.update(), 1000);
    this.refresh.unref();
  }

  update() { if (this.worker && !this.closing) this.worker.postMessage({ type: 'status', status: this.server.getStatus() }); }

  async destroy() {
    if (!this.worker) return;
    this.closing = true;
    clearInterval(this.refresh);
    if (this.hwnd) cancelTrayMenu(this.hwnd);
    this.worker.postMessage({ type: 'stop' });
    const timeout = setTimeout(() => { void this.worker?.terminate(); }, 2000);
    try { await this.exited; }
    finally { clearTimeout(timeout); this.worker = null; }
  }
}
