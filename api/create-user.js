// Vercel Serverless Function: crea cuentas de usuario.
// Solo la pueden usar trabajadores (recepción), propietarios y el administrador.
// Requiere en Vercel → Settings → Environment Variables:
//   SUPABASE_SERVICE_ROLE_KEY  (la clave secreta de Supabase; nunca va en el navegador)
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://mqxlteaneroqxduxqdit.supabase.co';
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const STAFF = ['empleado', 'propietario', 'admin'];
const HIGH = ['propietario', 'admin'];

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

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!SERVICE_KEY) return res.status(500).json({ error: 'Falta configurar SUPABASE_SERVICE_ROLE_KEY en Vercel' });

  try {
    // 1. ¿Quién hace la petición?
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (!token) return res.status(401).json({ error: 'Debes iniciar sesión' });
    const who = await fetch(SUPABASE_URL + '/auth/v1/user', {
      headers: { apikey: SERVICE_KEY, Authorization: 'Bearer ' + token },
    });
    if (!who.ok) return res.status(401).json({ error: 'Sesión no válida. Vuelve a iniciar sesión.' });
    const caller = await who.json();

    const pr = await admin('/rest/v1/profiles?select=role,active&id=eq.' + encodeURIComponent(caller.id));
    const [callerProfile] = await pr.json();
    if (!callerProfile || !callerProfile.active || !STAFF.includes(callerProfile.role)) {
      return res.status(403).json({ error: 'No tienes permiso para crear cuentas' });
    }

    // 2. Validar datos
    const b = req.body || {};
    const email = String(b.email || '').trim().toLowerCase();
    const password = String(b.password || '');
    const full_name = String(b.full_name || '').trim();
    const phone = String(b.phone || '').trim();
    const cedula = String(b.cedula || '').trim();
    const role = String(b.role || 'cliente');
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return res.status(400).json({ error: 'Correo no válido' });
    if (password.length < 6) return res.status(400).json({ error: 'La contraseña debe tener al menos 6 caracteres' });
    if (!full_name) return res.status(400).json({ error: 'Falta el nombre' });
    if (!['cliente', 'empleado', 'propietario', 'admin'].includes(role)) return res.status(400).json({ error: 'Rol no válido' });
    if (role !== 'cliente' && !HIGH.includes(callerProfile.role)) {
      return res.status(403).json({ error: 'Solo el propietario puede crear cuentas de trabajadores' });
    }
    if (HIGH.includes(role) && callerProfile.role !== 'admin') {
      return res.status(403).json({ error: 'Solo el administrador puede crear propietarios' });
    }

    // 3. Crear la cuenta (ya confirmada)
    const cr = await admin('/auth/v1/admin/users', {
      method: 'POST',
      body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name, phone, cedula } }),
    });
    const created = await cr.json();
    if (!cr.ok) {
      const msg = created.msg || created.message || created.error_description || 'No se pudo crear la cuenta';
      const exists = /already|registered|exists/i.test(msg);
      return res.status(exists ? 409 : 400).json({ error: exists ? 'Ya existe una cuenta con ese correo' : msg });
    }

    // 4. Asignar rol si no es cliente
    if (role !== 'cliente') {
      const up = await admin('/rest/v1/profiles?id=eq.' + created.id, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ role }),
      });
      if (!up.ok) return res.status(500).json({ error: 'Cuenta creada pero no se pudo asignar el rol', id: created.id });
    }

    return res.status(200).json({ id: created.id, email });
  } catch (e) {
    return res.status(500).json({ error: 'Error del servidor: ' + (e && e.message ? e.message : e) });
  }
};
