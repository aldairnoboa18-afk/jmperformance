// Lista de personas que el agente biométrico carga en el terminal Hikvision, con su vigencia.
// El terminal decide solo quién entra: deja pasar únicamente entre "begin" y "end".
//
//  GET /api/device-members
//      Encabezado: x-device-key: <DEVICE_KEY>
//      → { ok, today, members: [ { no: "12", uid, name, valid, begin: "YYYY-MM-DD", end: "YYYY-MM-DD" } ] }
//      Quien no está en la lista (cuenta borrada) el agente lo elimina del terminal.
//
// "no" es el número del código del cliente (JMP0012 → "12") y es el "ID de empleado" en el terminal.
// Reglas (las mismas que /api/device-checkin):
//   · cuenta desactivada o cliente sin membresía → valid:false (el terminal lo bloquea)
//   · cliente con membresía → desde start_date hasta end_date (al vencer, el terminal lo bloquea solo)
//   · entrenador y personal (empleado, propietario, admin) → acceso siempre
const crypto = require('crypto');
const L = require('./_lib');

const TEAM = ['entrenador', 'empleado', 'propietario', 'admin'];
const ALWAYS = { begin: '2020-01-01', end: '2037-12-31' };   // 2037 = año máximo del terminal

function sameKey(a, b) {
  const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || ''));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') return res.status(405).json({ ok: false, error: 'Método no permitido' });
  if (!process.env.DEVICE_KEY || !L.SERVICE_KEY) return res.status(503).json({ ok: false, error: 'Integración de equipos no configurada (falta DEVICE_KEY)' });
  if (!sameKey(req.headers['x-device-key'], process.env.DEVICE_KEY)) return res.status(401).json({ ok: false, error: 'Clave del equipo no válida' });

  try {
    const rows = await L.adminJson('/rest/v1/profiles?select=id,code,full_name,role,active,start_date,end_date&role=in.(cliente,' + TEAM.join(',') + ')&order=code');
    const members = [];
    for (const p of rows) {
      const mt = /^JMP0*(\d+)$/i.exec(String(p.code || '').trim());
      if (!mt) continue;
      const name = String(p.full_name || '').trim() || p.code;
      let v;
      if (!p.active) v = { valid: false };
      else if (TEAM.includes(p.role)) v = { valid: true, ...ALWAYS };
      else if (p.end_date) v = { valid: true, begin: p.start_date && p.start_date <= p.end_date ? p.start_date : ALWAYS.begin, end: p.end_date };
      else v = { valid: false };
      members.push({ no: mt[1], uid: p.id, code: p.code, name, role: p.role, ...v });   // uid: detecta si un código se reutiliza para otra persona
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, today: L.todayEC(), members });
  } catch (e) {
    return res.status(500).json({ ok: false, error: 'Error del servidor: ' + e.message });
  }
};
