// Registra asistencias enviadas por equipos biométricos (huella digital o reconocimiento facial).
// El equipo reconoce a la persona por su cuenta y solo envía aquí el ID del cliente:
// ningún dato biométrico (huella o rostro) llega ni se guarda en este sistema.
//
//  GET  /api/device-checkin            → { configured } (para que el portal sepa si está activo)
//  POST /api/device-checkin
//       Encabezado:  x-device-key: <DEVICE_KEY>
//       Cuerpo JSON: { "pin": "12" | "code": "JMP0012", "method": "huella" | "facial", "device": "Recepción",
//                      "time": "2026-11-21T15:30:12-05:00" (opcional: hora real del ingreso, para eventos enviados con retraso) }
//
// El personal (empleado, propietario, admin) pasa por el torniquete pero no cuenta como asistencia de cliente.
//
// Variables en Vercel: DEVICE_KEY (clave secreta que se configura también en el equipo)
const crypto = require('crypto');
const L = require('./_lib');

const METHODS = ['huella', 'facial'];
const configured = () => !!(process.env.DEVICE_KEY && L.SERVICE_KEY);

function sameKey(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

// "12" → "JMP0012"   ·   "jmp0012" → "JMP0012"
function toCode(b) {
  if (b.code) return String(b.code).trim().toUpperCase();
  const n = String(b.pin || '').replace(/\D/g, '');
  return n ? 'JMP' + n.padStart(4, '0') : '';
}

module.exports = async (req, res) => {
  if (req.method === 'GET') return res.status(200).json({ configured: configured() });
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Método no permitido' });
  if (!configured()) return res.status(503).json({ ok: false, error: 'Integración de equipos no configurada (falta DEVICE_KEY)' });
  if (!sameKey(req.headers['x-device-key'], process.env.DEVICE_KEY)) return res.status(401).json({ ok: false, error: 'Clave del equipo no válida' });

  try {
    const b = req.body || {};
    const method = METHODS.includes(b.method) ? b.method : 'huella';
    const code = toCode(b);
    if (!/^[A-Z0-9]{2,20}$/.test(code)) return res.status(400).json({ ok: false, error: 'Falta el ID del cliente' });

    // Hora del ingreso: la que manda el equipo (si viene) o ahora. Se aceptan eventos de hasta 7 días atrás.
    let at = Date.now();
    if (b.time) {
      const x = Date.parse(b.time);
      if (!Number.isFinite(x) || x > at + 10 * 60e3 || x < at - 7 * 864e5) return res.status(400).json({ ok: false, error: 'Hora del evento no válida' });
      at = x;
    }

    const m = await L.getProfile('code=eq.' + encodeURIComponent(code));
    if (m && ['empleado', 'propietario', 'admin'].includes(m.role)) return res.status(200).json({ ok: true, code: m.code, name: m.full_name, ignored: 'personal' });
    if (!m || !['cliente', 'entrenador'].includes(m.role)) return res.status(404).json({ ok: false, error: 'Cliente no registrado: ' + code });
    const base = { code: m.code, name: m.full_name };
    if (!m.active) return res.status(403).json({ ok: false, ...base, error: 'Cuenta desactivada' });

    const t = new Date(at - 5 * 3600e3).toISOString().slice(0, 10);   // fecha del ingreso en Ecuador
    const staffIn = m.role === 'entrenador';   // entrenadores: acceso de personal, sin membresía
    if (!staffIn && !m.end_date) return res.status(403).json({ ok: false, ...base, error: 'No tiene membresía activa' });
    if (!staffIn && m.start_date && m.start_date > t) return res.status(403).json({ ok: false, ...base, error: 'Su membresía inicia el ' + m.start_date });
    if (!staffIn && m.end_date < t) return res.status(403).json({ ok: false, ...base, error: 'Membresía vencida el ' + m.end_date });

    // Evita duplicados si marca varias veces seguidas (3 horas alrededor del ingreso)
    const from = new Date(at - 3 * 3600e3).toISOString(), to = new Date(at + 3 * 3600e3).toISOString();
    const recent = await L.adminJson('/rest/v1/attendance?select=id&limit=1&member_id=eq.' + m.id + '&checked_at=gte.' + encodeURIComponent(from) + '&checked_at=lte.' + encodeURIComponent(to));
    if (!recent.length) {
      const row = { member_id: m.id, method, checked_at: new Date(at).toISOString() };
      let r = await L.admin('/rest/v1/attendance', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(row) });
      if (!r.ok && r.status === 400) {   // la columna "method" aún no existe (falta 006_attendance_method.sql)
        r = await L.admin('/rest/v1/attendance', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ member_id: m.id, checked_at: row.checked_at }) });
      }
      if (!r.ok) return res.status(500).json({ ok: false, ...base, error: 'No se pudo registrar la asistencia' });
    }
    if (staffIn) return res.status(200).json({ ok: true, ...base, already: !!recent.length, staff: true, method });
    const [y, mo, d] = m.end_date.split('-').map(Number), [ty, tm, td] = t.split('-').map(Number);
    const daysLeft = Math.round((Date.UTC(y, mo - 1, d) - Date.UTC(ty, tm - 1, td)) / 864e5);
    return res.status(200).json({ ok: true, ...base, already: !!recent.length, end_date: m.end_date, days_left: daysLeft, method });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Error del servidor: ' + e.message });
  }
};
