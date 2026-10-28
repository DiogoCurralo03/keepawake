import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { WindowsAwake, isWindowsElevated, acquireLock } from './windows.js';
import { stateDir, readJson, writeJson, identity, assertNotMaintaining } from './paths.js';
import { loadConfig, validateConfig, saveConfig } from './config.js';
import { endpointFile } from './client.js';
import { createAuditLog } from './log.js';
import { TrayIcon } from './tray.js';
import { createPowerPolicyNative } from './power-native.js';
import { inspectLid } from './power-policy.js';
import { powerErrorDetails } from './power-error.js';

const version = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url))).version;

export class KeepAwakeDaemon {
  constructor(home, { tray = true, awake, lidReader } = {}) {
    this.home = home;
    this.stateDir = stateDir(home);
    this.withTray = tray;
    this.awake = awake;
    this.lidReader = lidReader;
    this.lid = null;
    this.lastLidCheck = 0;
    this.activity = { state: 'waiting', lastSentAt: null, message: null };
    this.instance = crypto.randomUUID();
    this.token = crypto.randomBytes(32).toString('hex');
    this.startedAt = new Date().toISOString();
    this.stopping = false;
    this.active = false;
    this.pulses = 0;
    this.lastPulse = 0;
    this.lastWarning = 0;
    this.power = { source: 'unknown', battery: null };
    this.idle = null;
    this.pausedUntil = null;
  }

  async start() {
    if (isWindowsElevated()) throw new Error('KeepAwake must run as a standard user. Open a terminal without administrator privileges.');
    assertNotMaintaining(this.home);
    this.releaseLock = acquireLock(`Global\\keepawake-${identity(this.home)}`);
    try {
      fs.mkdirSync(this.stateDir, { recursive: true });
      this.logger = createAuditLog(this.stateDir);
      this.config = loadConfig(this.home);
      const runtime = readJson(path.join(this.stateDir, 'runtime.json'), {});
      if (runtime.pausedUntil === -1 || (Number.isFinite(runtime.pausedUntil) && runtime.pausedUntil > Date.now())) this.pausedUntil = runtime.pausedUntil;
      this.awake ||= new WindowsAwake();
      if (!this.lidReader) {
        try {
          const power = createPowerPolicyNative();
          this.lidReader = () => inspectLid(power);
        } catch (error) {
          this.lidReader = () => ({ configured: false, error: powerErrorDetails(error) });
        }
      }
      this.tick();
      this.server = http.createServer((req, res) => { void this.handle(req, res); });
      this.server.requestTimeout = 5000;
      this.server.headersTimeout = 5000;
      this.server.keepAliveTimeout = 1000;
      this.server.maxConnections = 16;
      await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(0, '127.0.0.1', resolve); });
      this.server.on('error', error => this.fail(error));
      this.port = this.server.address().port;
      if (this.withTray) {
        this.tray = new TrayIcon(this);
        await this.tray.start();
      }
      assertNotMaintaining(this.home);
      writeJson(endpointFile(this.home), { schema: 1, pid: process.pid, instance: this.instance, port: this.port, token: this.token });
      this.timer = setInterval(() => { try { this.tick(); } catch (error) { this.fail(error); } }, 5000);
      this.audit('started', { version, tray: this.withTray, elevated: false });
      return this.getStatus();
    } catch (error) { await this.stop(); throw error; }
  }

  getStatus() {
    return { schema: 1, version, pid: process.pid, instance: this.instance, home: this.home, startedAt: this.startedAt,
      active: this.active, pausedUntil: this.pausedUntil, config: this.config, power: this.power,
      idleSeconds: this.idle === null ? null : Math.floor(this.idle), pulses: this.pulses, activity: this.activity, lid: this.lid,
      elevated: false, tray: Boolean(this.tray?.hwnd), stopping: this.stopping };
  }

  audit(event, fields) { this.logger?.info(event, fields); }

  tick() {
    if (this.stopping) return;
    if (this.pausedUntil !== null && this.pausedUntil !== -1 && this.pausedUntil <= Date.now()) { this.pausedUntil = null; this.saveRuntime(); this.audit('resumed_automatically'); }
    this.active = this.pausedUntil === null;
    this.awake.set(this.active, this.config.display);
    this.power = this.awake.powerStatus();
    this.idle = this.awake.idleSeconds();
    this.refreshLid();
    this.activity.state = !this.active ? 'paused' : !this.config.activity ? 'disabled' : this.idle === null ? 'unavailable' : 'waiting';
    this.activity.message = this.idle === null ? 'The Windows idle counter is unavailable.' : null;
    if (this.active && this.config.activity && this.idle !== null && this.idle >= this.config.interval && Date.now() - this.lastPulse >= this.config.interval * 1000) {
      try {
        if (this.awake.pulse()) {
          this.pulses++; this.lastPulse = Date.now();
          this.activity = { state: 'sent', lastSentAt: new Date(this.lastPulse).toISOString(), message: null };
        } else {
          this.activity.state = 'unavailable';
          this.activity.message = 'Activity simulation is unavailable on the current input desktop (locked or non-interactive session).';
        }
      }
      catch (error) {
        this.activity.state = 'unavailable'; this.activity.message = error.message;
        if (Date.now() - this.lastWarning > 60000) { this.lastWarning = Date.now(); this.logger.warn('activity_unavailable', { message: error.message }); }
      }
    }
    this.tray?.update();
  }

  refreshLid(force = false) {
    if (!this.lidReader || (!force && Date.now() - this.lastLidCheck < 30000)) return;
    this.lastLidCheck = Date.now();
    try { this.lid = this.lidReader(); }
    catch (error) { this.lid = { configured: false, error: powerErrorDetails(error) }; }
  }

  saveRuntime() { writeJson(path.join(this.stateDir, 'runtime.json'), { pausedUntil: this.pausedUntil }); }
  pause(duration = -1) {
    if (duration !== -1 && (!Number.isSafeInteger(duration) || duration < 1000 || duration > 30 * 86400000)) throw new Error('Invalid pause duration.');
    this.pausedUntil = duration === -1 ? -1 : Date.now() + duration;
    this.saveRuntime(); this.tick(); this.audit('paused', { until: this.pausedUntil });
  }
  resume() { this.pausedUntil = null; this.saveRuntime(); this.tick(); this.audit('resumed'); }
  configure(patch) {
    validateConfig(patch);
    this.config = saveConfig(this.home, { ...this.config, ...patch });
    this.tick(); this.audit('configured', { config: this.config });
  }

  async handle(req, res) {
    const send = (code, body) => { res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' }); res.end(JSON.stringify(body)); };
    try {
      if (req.headers.origin || req.headers.host !== `127.0.0.1:${this.port}`) return send(403, { error: 'Origin rejected.' });
      const supplied = req.headers['x-keepawake-token'];
      if (typeof supplied !== 'string' || !/^[a-f0-9]{64}$/.test(supplied) || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from(this.token))) return send(401, { error: 'Authentication required.' });
      if (req.method === 'GET' && req.url === '/v1/status') return send(200, this.getStatus());
      if (req.method !== 'POST') return send(405, { error: 'Method not allowed.' });
      if (this.stopping) return send(409, { error: 'KeepAwake is shutting down.' });
      let data = '';
      for await (const chunk of req) { data += chunk; if (Buffer.byteLength(data) > 8192) { send(413, { error: 'Request too large.' }); req.destroy(); return; } }
      const body = JSON.parse(data || '{}');
      if (req.url === '/v1/pause') this.pause(body.duration);
      else if (req.url === '/v1/resume') this.resume();
      else if (req.url === '/v1/config') this.configure(body);
      else if (req.url === '/v1/refresh-power') { this.refreshLid(true); this.tray?.update(); }
      else if (req.url === '/v1/quit') { send(200, this.getStatus()); setImmediate(() => { void this.stop(); }); return; }
      else return send(404, { error: 'Unknown command.' });
      send(200, this.getStatus());
    } catch (error) { if (!res.headersSent) send(400, { error: error.message }); else res.destroy(); }
  }

  fail(error) {
    this.logger?.error('failed', { message: error.message });
    process.exitCode = 1;
    void this.stop();
  }

  stop() {
    if (this.stopPromise) return this.stopPromise;
    this.stopping = true;
    this.stopPromise = (async () => {
      clearInterval(this.timer);
      try { this.awake?.close(); } catch (error) { this.logger?.warn('release_failed', { message: error.message }); }
      this.active = false;
      if (this.server) {
        await new Promise(resolve => { this.server.close(resolve); this.server.closeAllConnections(); });
      }
      await this.tray?.destroy();
      const current = readJson(endpointFile(this.home));
      if (current?.instance === this.instance) fs.rmSync(endpointFile(this.home), { force: true });
      this.releaseLock?.(); this.releaseLock = null;
      this.audit('stopped');
    })();
    return this.stopPromise;
  }
}
