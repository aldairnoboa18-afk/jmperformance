#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════
//  JMPerformance — Agente biométrico (Hikvision DS-K1T342MFWX)
//  Corre en una PC / Raspberry Pi dentro de la red del gimnasio y hace dos cosas:
//   1) SINCRONIZA (cada 10 s): copia de la web al terminal cada cliente con su vigencia
//      (el terminal solo abre el torniquete dentro de esas fechas).
//   2) ASISTENCIAS: lee los ingresos del terminal (rostro / huella) y los envía
//      a la web. Si no hay internet, los guarda y los reenvía después.
//  Ningún rostro ni huella sale del terminal: solo viaja el número del cliente.
//
//  Uso:   node agente.js            → funciona sin parar
//         node agente.js --probar   → revisa la conexión con el terminal y con la web y termina
//  Requiere Node.js 18 o superior. Sin dependencias.
// ════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DIR = __dirname;
const CONFIG_FILE = path.join(DIR, 'config.json');
const STATE_FILE = path.join(DIR, 'estado.json');
const LOG_FILE = path.join(DIR, 'agente.log');

// Eventos de "acceso concedido" del terminal (major 5 = control de acceso)
//   75 (0x4b) rostro reconocido · 38 (0x26) huella reconocida · 1 tarjeta válida
const PASS_MINORS = { 75: 'facial', 38: 'huella' };

// ─── configuración ───
function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('Falta config.json. Copia config.ejemplo.json como config.json y complétalo.');
    process.exit(1);
  }
  const c = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  const need = ['terminal_ip', 'terminal_usuario', 'terminal_clave', 'sitio', 'clave_equipo'];
  const miss = need.filter((k) => !c[k] || String(c[k]).includes('PON_AQUI'));
  if (miss.length) { console.error('Completa en config.json: ' + miss.join(', ')); process.exit(1); }
  return {
    ip: String(c.terminal_ip).replace(/^https?:\/\//, '').replace(/\/+$/, ''),
    user: c.terminal_usuario,
    pass: c.terminal_clave,
    https: !!c.terminal_https,
    site: String(c.sitio).replace(/\/+$/, ''),
    key: c.clave_equipo,
    // cada cuántos segundos se revisan cambios en la web (mínimo 5). Acepta también el antiguo "sincronizar_cada_min".
    syncSec: Math.max(5, Number(c.sincronizar_cada_seg) || (Number(c.sincronizar_cada_min) || 0) * 60 || 10),
    pollSec: Math.max(2, Number(c.revisar_ingresos_cada_seg) || 5),
    door: String(c.puerta || 1),
    cards: !!c.contar_tarjetas,
  };
}

// ─── registro ───
function log(...a) {
  const line = new Date().toLocaleString('es-EC', { timeZone: 'America/Guayaquil' }) + '  ' + a.join(' ');
  console.log(line);
  try {
    if (fs.existsSync(LOG_FILE) && fs.statSync(LOG_FILE).size > 5e6) fs.renameSync(LOG_FILE, LOG_FILE + '.1');
    fs.appendFileSync(LOG_FILE, line + '\n');
  } catch (_) {}
}

// ─── estado (se guarda en disco para sobrevivir reinicios) ───
function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch (_) { return {}; }
}
function saveState(s) {
  const tmp = STATE_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 1));
  fs.renameSync(tmp, STATE_FILE);
}

// ─── fechas en hora de Ecuador (UTC-5) ───
const ecIso = (ms) => new Date(ms - 5 * 3600e3).toISOString().slice(0, 19) + '-05:00';

// ════════════════════════════════════════════════════════════════
//  Cliente ISAPI con autenticación Digest (la que usan los equipos Hikvision)
// ════════════════════════════════════════════════════════════════
function makeDevice(cfg) {
  const base = (cfg.https ? 'https://' : 'http://') + cfg.ip;
  let challenge = null, nc = 0;

  function parseChallenge(h) {
    const out = {};
    for (const m of String(h || '').replace(/^Digest\s+/i, '').matchAll(/(\w+)=(?:"([^"]*)"|([^,\s]*))/g)) out[m[1].toLowerCase()] = m[2] !== undefined ? m[2] : m[3];
    return out.nonce ? out : null;
  }
  function authHeader(method, uri) {
    const c = challenge, alg = (c.algorithm || 'MD5').toUpperCase();
    const H = (s) => crypto.createHash(alg.startsWith('SHA-256') ? 'sha256' : 'md5').update(s).digest('hex');
    const cnonce = crypto.randomBytes(8).toString('hex'), ncs = (++nc).toString(16).padStart(8, '0');
    let ha1 = H(`${cfg.user}:${c.realm}:${cfg.pass}`);
    if (alg.endsWith('-SESS')) ha1 = H(`${ha1}:${c.nonce}:${cnonce}`);
    const ha2 = H(`${method}:${uri}`);
    const qop = c.qop ? (c.qop.split(',').map((s) => s.trim()).includes('auth') ? 'auth' : c.qop.split(',')[0].trim()) : null;
    const response = qop ? H(`${ha1}:${c.nonce}:${ncs}:${cnonce}:${qop}:${ha2}`) : H(`${ha1}:${c.nonce}:${ha2}`);
    let h = `Digest username="${cfg.user}", realm="${c.realm}", nonce="${c.nonce}", uri="${uri}", algorithm=${c.algorithm || 'MD5'}, response="${response}"`;
    if (qop) h += `, qop=${qop}, nc=${ncs}, cnonce="${cnonce}"`;
    if (c.opaque) h += `, opaque="${c.opaque}"`;
    return h;
  }

  async function request(method, uri, body) {
    const init = { method, headers: {}, signal: AbortSignal.timeout(15000) };
    if (body !== undefined) { init.body = JSON.stringify(body); init.headers['Content-Type'] = 'application/json'; }
    for (let attempt = 0; attempt < 2; attempt++) {
      if (challenge) init.headers.Authorization = authHeader(method, uri);
      const r = await fetch(base + uri, init);
      if (r.status === 401 && attempt === 0) {
        const c = parseChallenge(r.headers.get('www-authenticate'));
        if (!c) throw new Error('El terminal pidió una autenticación desconocida');
        challenge = c; nc = 0;
        continue;
      }
      const text = await r.text();
      let json = null;
      try { json = JSON.parse(text); } catch (_) {}
      if (r.status === 401) throw new Error('Usuario o contraseña del terminal incorrectos');
      return { status: r.status, ok: r.ok, json, text };
    }
  }
  return { request, base };
}

// ════════════════════════════════════════════════════════════════
//  Web (jmperformancecoca.com)
// ════════════════════════════════════════════════════════════════
async function site(cfg, method, p, body) {
  const r = await fetch(cfg.site + p, {
    method,
    headers: { 'x-device-key': cfg.key, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20000),
  });
  let json = null;
  try { json = await r.json(); } catch (_) {}
  return { status: r.status, ok: r.ok, json };
}

// ════════════════════════════════════════════════════════════════
//  1) Sincronizar clientes y vigencias → terminal
// ════════════════════════════════════════════════════════════════
// Nombre de hasta 32 bytes (límite del terminal) sin cortar una letra con tilde
function shortName(s) {
  let out = '';
  for (const ch of String(s)) { if (Buffer.byteLength(out + ch) > 32) break; out += ch; }
  return out.trim();
}
function userInfo(cfg, m) {
  const v = m.valid ? { begin: m.begin, end: m.end } : { begin: '2020-01-01', end: '2020-01-01' };   // bloqueado = vigencia en el pasado
  return {
    UserInfo: {
      employeeNo: m.no,
      name: shortName(m.name),
      userType: 'normal',
      Valid: { enable: true, beginTime: v.begin + 'T00:00:00', endTime: v.end + 'T23:59:59', timeType: 'local' },
      doorRight: cfg.door,
      RightPlan: [{ doorNo: Number(cfg.door), planTemplateNo: '1' }],
    },
  };
}
const isOk = (r) => r.ok && (!r.json || r.json.statusCode === undefined || r.json.statusCode === 1);
const errOf = (r) => (r.json && (r.json.subStatusCode || r.json.errorMsg || r.json.statusString)) || 'HTTP ' + r.status;

async function pushUser(dev, cfg, m) {
  const body = userInfo(cfg, m);
  // SetUp crea o actualiza; los firmwares que no lo tienen usan Modify / Record
  let r = await dev.request('PUT', '/ISAPI/AccessControl/UserInfo/SetUp?format=json', body);
  if (isOk(r)) return;
  if (r.status === 404 || /notSupport|invalidOperation/i.test(errOf(r))) {
    r = await dev.request('PUT', '/ISAPI/AccessControl/UserInfo/Modify?format=json', body);
    if (isOk(r)) return;
    r = await dev.request('POST', '/ISAPI/AccessControl/UserInfo/Record?format=json', body);
    if (isOk(r)) return;
  }
  throw new Error(errOf(r));
}

async function syncMembers(dev, cfg, state) {
  const r = await site(cfg, 'GET', '/api/device-members');
  if (!r.ok || !r.json || !r.json.ok) throw new Error('La web respondió: ' + ((r.json && r.json.error) || 'HTTP ' + r.status));
  state.synced = state.synced || {};
  // Una vez al día se reenvía todo (por si alguien cambió algo a mano en el terminal)
  const today = r.json.today;
  if (state.fullSyncDay !== today) { state.synced = {}; state.fullSyncDay = today; }

  let sent = 0, failed = 0;
  for (const m of r.json.members) {
    const sig = crypto.createHash('sha1').update(JSON.stringify([shortName(m.name), m.valid, m.begin, m.end])).digest('hex');
    if (state.synced[m.no] === sig) continue;
    try {
      await pushUser(dev, cfg, m);
      state.synced[m.no] = sig; sent++;
      log(`Terminal ← ${m.code} ${shortName(m.name)}: ${!m.valid ? 'BLOQUEADO' : m.end < today ? `VENCIDO el ${m.end}` : `vigente ${m.begin} → ${m.end}`}`);
    } catch (e) {
      failed++;
      log(`ERROR al cargar ${m.code} en el terminal: ${e.message}`);
    }
  }
  saveState(state);
  if (sent || failed) log(`Sincronización: ${sent} actualizados, ${failed} con error, ${r.json.members.length} en total`);
}

// ════════════════════════════════════════════════════════════════
//  2) Ingresos del terminal → web
// ════════════════════════════════════════════════════════════════
async function fetchEvents(dev, fromMs, toMs) {
  const out = [];
  let pos = 0;
  const searchID = crypto.randomUUID();
  for (let page = 0; page < 50; page++) {
    const r = await dev.request('POST', '/ISAPI/AccessControl/AcsEvent?format=json', {
      AcsEventCond: { searchID, searchResultPosition: pos, maxResults: 30, major: 5, minor: 0, startTime: ecIso(fromMs), endTime: ecIso(toMs) },
    });
    if (!r.ok || !r.json || !r.json.AcsEvent) throw new Error('El terminal no devolvió eventos: ' + errOf(r));
    const a = r.json.AcsEvent, list = a.InfoList || [];
    out.push(...list);
    pos += list.length;
    if (a.responseStatusStrg !== 'MORE' || !list.length) break;
  }
  return out;
}

function methodOf(ev, cfg) {
  if (PASS_MINORS[ev.minor]) return PASS_MINORS[ev.minor];
  if (cfg.cards && ev.minor === 1) return 'manual';
  return null;   // denegados, vencidos, puerta abierta, alarmas, etc.
}

async function collectEvents(dev, cfg, state) {
  const now = Date.now();
  // Primera vez: empieza desde ahora (no reenvía el historial viejo del terminal)
  if (!state.lastEventMs) { state.lastEventMs = now; state.seen = []; saveState(state); log('Primera ejecución: se registrarán los ingresos desde ahora.'); return; }
  const from = state.lastEventMs - 60e3;   // 1 min de margen por si el reloj del terminal va desfasado
  const events = await fetchEvents(dev, from, now + 60e3);
  const seen = new Set(state.seen || []);
  state.queue = state.queue || [];
  let maxMs = state.lastEventMs;
  for (const ev of events) {
    const id = String(ev.serialNo != null ? ev.serialNo : ev.time + '|' + ev.employeeNoString);
    if (seen.has(id)) continue;
    seen.add(id);
    const t = Date.parse(ev.time);
    if (Number.isFinite(t) && t > maxMs) maxMs = t;
    const method = methodOf(ev, cfg), no = String(ev.employeeNoString || ev.employeeNo || '').trim();
    if (!method || !/^\d+$/.test(no)) continue;   // denegados, puertas, alarmas, etc.
    state.queue.push({ pin: no, method, time: ev.time, device: 'Torniquete', name: ev.name || '' });
  }
  state.lastEventMs = Math.min(maxMs, now);
  state.seen = [...seen].slice(-500);
  saveState(state);
}

async function flushQueue(cfg, state) {
  if (!state.queue || !state.queue.length) return;
  while (state.queue.length) {
    const item = state.queue[0];
    let r;
    try {
      r = await site(cfg, 'POST', '/api/device-checkin', { pin: item.pin, method: item.method, time: item.time, device: item.device });
    } catch (e) {
      log(`Sin conexión con la web (${e.message}). ${state.queue.length} ingreso(s) en espera.`);
      break;
    }
    if (r.status >= 500 || r.status === 401 || r.status === 503) {
      log(`La web no aceptó el ingreso (${(r.json && r.json.error) || 'HTTP ' + r.status}). Se reintentará.`);
      break;
    }
    const j = r.json || {};
    if (r.ok && j.ignored) log(`Ingreso de personal: ${j.code} ${j.name} (no cuenta como asistencia)`);
    else if (r.ok) log(`Asistencia ✓ ${j.code} ${j.name} · ${item.method}${j.already ? ' (ya registrada)' : ''}${j.days_left != null ? ` · quedan ${j.days_left} días` : ''}`);
    else log(`Ingreso no registrado (${item.pin} ${item.name}): ${j.error || 'HTTP ' + r.status}`);
    state.queue.shift();
    saveState(state);
  }
}

// ════════════════════════════════════════════════════════════════
//  Prueba de conexión
// ════════════════════════════════════════════════════════════════
async function probar(cfg) {
  const dev = makeDevice(cfg);
  let ok = true;
  console.log('\n1) Terminal Hikvision en ' + dev.base);
  try {
    const r = await dev.request('GET', '/ISAPI/System/deviceInfo');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const tag = (t) => (r.text.match(new RegExp(`<${t}>([^<]*)</${t}>`)) || [])[1] || '?';
    console.log(`   ✓ Conectado: ${tag('model')} · firmware ${tag('firmwareVersion')} ${tag('firmwareReleasedDate')} · serie ${tag('serialNumber')}`);
    const t = await dev.request('GET', '/ISAPI/System/time');
    const lt = (t.text.match(/<localTime>([^<]*)<\/localTime>/) || [])[1];
    if (lt) {
      const diff = Math.round((Date.parse(lt) - Date.now()) / 1000);
      console.log(`   ${Math.abs(diff) > 120 ? '⚠' : '✓'} Hora del terminal: ${lt} (diferencia con esta PC: ${diff} s)`);
      if (Math.abs(diff) > 120) { console.log('     → Ajusta la hora del terminal (zona horaria UTC-05:00 y NTP activado).'); ok = false; }
    }
    const cap = await dev.request('GET', '/ISAPI/AccessControl/UserInfo/count?format=json');
    if (cap.json && cap.json.UserInfoCount) console.log(`   ✓ Personas registradas en el terminal: ${cap.json.UserInfoCount.userNumber}`);
    const ev = await fetchEvents(dev, Date.now() - 24 * 3600e3, Date.now() + 60e3);
    const passes = ev.filter((e) => methodOf(e, cfg));
    console.log(`   ✓ Eventos de las últimas 24 h: ${ev.length} (ingresos reconocidos: ${passes.length})`);
    for (const e of passes.slice(-5)) console.log(`     · ${e.time}  ID ${e.employeeNoString}  ${e.name || ''}  → ${methodOf(e, cfg)}`);
  } catch (e) {
    ok = false;
    console.log('   ✗ ' + e.message);
    console.log('     → Revisa terminal_ip, usuario y clave en config.json, y que esta PC esté en la misma red WiFi del gimnasio.');
  }

  console.log('\n2) Web ' + cfg.site);
  try {
    const r = await site(cfg, 'GET', '/api/device-members');
    if (!r.ok) throw new Error((r.json && r.json.error) || 'HTTP ' + r.status);
    const ms = r.json.members, valid = ms.filter((m) => m.valid);
    console.log(`   ✓ Clave aceptada. Personas: ${ms.length} (con acceso: ${valid.length}, bloqueadas: ${ms.length - valid.length})`);
  } catch (e) {
    ok = false;
    console.log('   ✗ ' + e.message);
    console.log('     → Revisa "sitio" y "clave_equipo" (debe ser igual a DEVICE_KEY en Vercel).');
  }
  console.log(ok ? '\nTodo listo. Inicia el agente con: node agente.js\n' : '\nCorrige lo marcado con ✗ / ⚠ y vuelve a probar.\n');
  process.exitCode = ok ? 0 : 1;   // (process.exit() con conexiones abiertas cuelga Node en Windows)
}

// ════════════════════════════════════════════════════════════════
//  Bucle principal
// ════════════════════════════════════════════════════════════════
async function main() {
  const cfg = loadConfig();
  if (process.argv.includes('--probar')) return probar(cfg);

  const dev = makeDevice(cfg);
  const state = loadState();
  log(`Agente iniciado · terminal ${dev.base} · web ${cfg.site}`);

  let lastSync = 0, busy = false, lastErr = '';
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      if (Date.now() - lastSync >= cfg.syncSec * 1000) { await syncMembers(dev, cfg, state); lastSync = Date.now(); }
      await collectEvents(dev, cfg, state);
      await flushQueue(cfg, state);
      if (lastErr) { log('Conexión recuperada.'); lastErr = ''; }
    } catch (e) {
      const msg = e.name === 'TimeoutError' ? 'tiempo de espera agotado' : e.cause ? e.cause.code || e.message : e.message;
      if (msg !== lastErr) log('ERROR: ' + msg);   // no repetir el mismo error cada pocos segundos
      lastErr = msg;
      try { await flushQueue(cfg, state); } catch (_) {}
    } finally {
      busy = false;
    }
  };
  await tick();
  setInterval(tick, cfg.pollSec * 1000);
}

main().catch((e) => { log('ERROR FATAL: ' + e.message); process.exit(1); });
