// Inicia un pago con PayPhone (botón por redirección).
//  GET  → { enabled, surchargePct, plans } para mostrar precios.
//  POST → crea la orden y devuelve la URL de PayPhone a donde redirigir al cliente.
// Variables en Vercel: PAYPHONE_TOKEN, PAYPHONE_STORE_ID, (opcional) PAYPHONE_RECARGO_PCT
const L = require('./_lib');

const PREPARE_URL = process.env.PAYPHONE_PREPARE_URL || 'https://pay.payphonetodoesposible.com/api/button/Prepare';
const enabled = () => !!(process.env.PAYPHONE_TOKEN && process.env.PAYPHONE_STORE_ID && L.SERVICE_KEY);

function phoneE164(p) {
  let d = String(p || '').replace(/\D/g, '');
  if (d.startsWith('593')) return '+' + d;
  if (d.startsWith('0')) d = d.slice(1);
  return d.length === 9 ? '+593' + d : '';
}

module.exports = async (req, res) => {
  if (req.method === 'GET') {
    return res.status(200).json({
      enabled: enabled(),
      surchargePct: L.surchargePct(),
      plans: L.PLANS.map((p) => ({ id: p.id, name: p.name, months: p.months, ...L.quote(p) })),
    });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!enabled()) return res.status(503).json({ error: 'El pago con tarjeta aún no está activado. Usa transferencia por ahora.' });

  try {
    const b = req.body || {};
    const plan = L.findPlan(b.plan);
    if (!plan) return res.status(400).json({ error: 'Plan no válido' });

    // ¿Cliente con sesión (renovación desde el portal) o cliente nuevo?
    let member = null;
    const user = await L.userFromRequest(req);
    if (user) member = await L.getProfile('id=eq.' + user.id);

    const data = member
      ? { full_name: member.full_name, email: member.email, phone: member.phone, cedula: member.cedula }
      : {
          full_name: String(b.full_name || '').trim(),
          email: String(b.email || '').trim().toLowerCase(),
          phone: String(b.phone || '').trim(),
          cedula: String(b.cedula || '').replace(/\D/g, ''),
        };
    if (!member) {
      if (data.full_name.length < 3) return res.status(400).json({ error: 'Escribe tu nombre completo' });
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(data.email)) return res.status(400).json({ error: 'Correo no válido' });
      if (!phoneE164(data.phone)) return res.status(400).json({ error: 'Teléfono no válido (ej: 0991234567)' });
      if (!/^\d{10}(\d{3})?$/.test(data.cedula)) return res.status(400).json({ error: 'Cédula no válida (10 dígitos) o RUC (13)' });
    }

    const q = L.quote(plan);
    const id = 'J' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).slice(2, 6).toUpperCase(); // ≤ 15 caracteres
    await L.adminJson('/rest/v1/orders', {
      method: 'POST', headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        id, plan: plan.id, base_cents: q.base, surcharge_cents: q.surcharge, amount_cents: q.total,
        full_name: data.full_name, email: data.email, phone: data.phone, cedula: data.cedula,
        member_id: member ? member.id : null, status: 'pending',
      }),
    });

    const origin = L.siteOrigin(req);
    const body = {
      amount: q.total,
      amountWithoutTax: q.total,
      currency: 'USD',
      clientTransactionId: id,
      storeId: process.env.PAYPHONE_STORE_ID,
      reference: (plan.name + ' · ' + data.full_name).slice(0, 100),
      responseUrl: origin + '/pago.html',
      cancellationUrl: origin + '/pago.html?cancelado=1&clientTransactionId=' + id,
      email: data.email || undefined,
      phoneNumber: phoneE164(data.phone) || undefined,
      documentId: data.cedula || undefined,
      lang: 'es',
    };
    const r = await fetch(PREPARE_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.PAYPHONE_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    let j = {};
    try { j = await r.json(); } catch (_) {}
    if (!r.ok || !j.payWithCard) {
      const msg = j.message || j.Message || ('PayPhone respondió ' + r.status);
      await L.admin('/rest/v1/orders?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ status: 'error', error: 'Prepare: ' + msg }) });
      return res.status(502).json({ error: 'No se pudo iniciar el pago: ' + msg });
    }
    await L.admin('/rest/v1/orders?id=eq.' + id, { method: 'PATCH', body: JSON.stringify({ payphone_payment_id: String(j.paymentId || '') }) });
    return res.status(200).json({ orderId: id, url: j.payWithCard, payphoneUrl: j.payWithPayPhone || null });
  } catch (e) {
    return res.status(500).json({ error: 'Error del servidor: ' + e.message });
  }
};
