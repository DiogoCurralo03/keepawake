import { parentPort, workerData } from 'node:worker_threads';
import { NativeTrayIcon } from './tray-native.js';

let status = workerData.status;
const controller = {
  stateDir: workerData.dir,
  getStatus: () => status,
  isActive: () => status.active,
  pause: duration => parentPort.postMessage({ type: 'pause', duration }),
  resume: () => parentPort.postMessage({ type: 'resume' }),
  configure: patch => parentPort.postMessage({ type: 'config', patch }),
  powerChanged: () => parentPort.postMessage({ type: 'power' }),
  quit: () => parentPort.postMessage({ type: 'quit' }),
  logger: { warn: message => parentPort.postMessage({ type: 'warning', message }) }
};
const tray = new NativeTrayIcon(controller);
try {
  tray.start();
  parentPort.postMessage({ type: 'ready', hwnd: tray.hwnd });
  parentPort.on('message', message => {
    if (message.type === 'status') { status = message.status; tray.update(); }
    else if (message.type === 'stop') { tray.destroy(); parentPort.close(); }
  });
} catch (error) {
  parentPort.postMessage({ type: 'failed', message: error.message });
  parentPort.close();
}
