// Utilidades compartidas por las funciones del servidor.
// (En Vercel, los archivos de /api que empiezan con "_" no se publican como endpoints.)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mqxlteaneroqxduxqdit.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Planes (deben coincidir con los de index.html y portal.html)
const PLANS = [
  { id: 'm1', name: 'Membresía — 1 Mes', months: 1, price: 35 },
  { id: 'm2', name: 'Membresía — 2 Meses', months: 2, price: 59.99 },
  { id: 'm3', name: 'Membresía — Trimestral', months: 3, price: 80.99 },
  { id: 'p1', name: 'Preventa — 1 mes', months: 1, price: 25 },
  { id: 'p2', name: 'Preventa — 2 meses', months: 2, price: 45 },
  { id: 'p3', name: 'Preventa — 3 meses', months: 3, price: 59.99 },
  { id: 'p6', name: 'Preventa — 6 meses', months: 6, price: 110 },
  { id: 'p12', name: 'Preventa — 12 meses', months: 12, price: 210 },
];
const findPlan = (v) => PLANS.find((p) => p.id === v || p.name.toLowerCase() === String(v || '').toLowerCase());

// Recargo por pago con tarjeta, en % (Vercel → PAYPHONE_RECARGO_PCT). 0 si no está configurado.
function surchargePct() {
  const v = parseFloat(String(process.env.PAYPHONE_RECARGO_PCT || '0').replace(',', '.'));
  return Number.isFinite(v) && v >= 0 && v < 50 ? v : 0;
}
function quote(plan) {
  const base = Math.round(plan.price * 100);
  const surcharge = Math.round((base * surchargePct()) / 100);
  return { base, surcharge, total: base + surcharge }; // centavos
}

function admin(path, init = {}) {
  return fetch(SUPABASE_URL + path, {
    ...init,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: 'Bearer ' + SERVICE_KEY,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
}
async function adminJson(path, init) {
  const r = await admin(path, init);
  let j = null;
  try { j = await r.json(); } catch (_) {}
  if (!r.ok) {
    const msg = (j && (j.msg || j.message || j.error_description || j.error)) || 'Error ' + r.status;
    const e = new Error(msg); e.status = r.status; throw e;
  }
  return j;
}

// Usuario dueño del token de sesión (o null)
async function userFromRequest(req) {
  const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if (!token) return null;
  const r = await fetch(SUPABASE_URL + '/auth/v1/user', { headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token } });
  return r.ok ? r.json() : null;
}
async function getProfile(filter) {
  const rows = await adminJson('/rest/v1/profiles?select=*&' + filter);
  return rows[0] || null;
}

// Fechas en hora de Ecuador (UTC-5, sin horario de verano)
const todayEC = () => new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10);
function addMonths(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  const r = new Date(Date.UTC(y, m - 1 + n, Math.min(d, last)));
  return r.toISOString().slice(0, 10);
}

const siteOrigin = (req) => process.env.SITE_URL || 'https://' + req.headers.host;

module.exports = { SERVICE_KEY, PLANS, findPlan, surchargePct, quote, admin, adminJson, userFromRequest, getProfile, todayEC, addMonths, siteOrigin };
