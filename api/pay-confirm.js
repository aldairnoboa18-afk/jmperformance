// Confirma un pago con PayPhone y activa la membresía.
// Se llama desde pago.html cuando PayPhone devuelve al cliente (?id=...&clientTransactionId=...).
// IMPORTANTE: PayPhone reversa el cobro si no se confirma dentro de 5 minutos.
const crypto = require('crypto');
const L = require('./_lib');

const CONFIRM_URL = process.env.PAYPHONE_CONFIRM_URL || 'https://pay.payphonetodoesposible.com/api/button/V2/Confirm';

const patchOrder = (id, data) =>
  L.admin('/rest/v1/orders?id=eq.' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(data) });

function summary(order, extra) {
  const plan = L.findPlan(order.plan) || {};
  return { status: order.status, orderId: order.id, plan: plan.name, amount: order.amount_cents / 100, name: order.full_name, email: order.email, ...extra };
}

module.exports = async (req, res) => {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  if (!process.env.PAYPHONE_TOKEN || !L.SERVICE_KEY) return res.status(503).json({ error: 'Pagos con tarjeta no activados' });

  const b = req.body || {};
  const orderId = String(b.clientTransactionId || '');
  const ppId = parseInt(b.id, 10);
  if (!/^[A-Z0-9]{6,20}$/.test(orderId)) return res.status(400).json({ error: 'Orden no válida' });

  try {
    const [order] = await L.adminJson('/rest/v1/orders?select=*&id=eq.' + orderId);
    if (!order) return res.status(404).json({ error: 'Orden no encontrada' });
    if (order.status === 'paid') {
      const m = order.member_id ? await L.getProfile('id=eq.' + order.member_id) : null;
      return res.status(200).json(summary(order, { end_date: m && m.end_date }));
    }
    if (['canceled', 'error'].includes(order.status)) return res.status(200).json(summary(order, { error: order.error }));
    if (b.cancelado || !Number.isFinite(ppId)) {
      await patchOrder(orderId, { status: 'canceled', error: 'Cancelado por el cliente' });
      return res.status(200).json(summary({ ...order, status: 'canceled' }));
    }

    // Bloquear la orden para que no se procese dos veces
    const locked = await L.adminJson('/rest/v1/orders?id=eq.' + orderId + '&status=eq.pending', {
      method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ status: 'processing' }),
    });
    if (!locked.length) return res.status(202).json({ status: 'processing' });

    // 1. Confirmar con PayPhone
    const r = await fetch(CONFIRM_URL, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + process.env.PAYPHONE_TOKEN, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: ppId, clientTxId: orderId }),
    });
    let t = {};
    try { t = await r.json(); } catch (_) {}
    const approved = r.ok && (t.statusCode === 3 || t.transactionStatus === 'Approved');
    const pp = { payphone_id: String(ppId), payphone_status: String(t.transactionStatus || t.statusCode || r.status), payphone_auth: t.authorizationCode || null };

    if (!approved) {
      const msg = t.message || (t.statusCode === 2 ? 'Pago cancelado o rechazado' : 'PayPhone no aprobó el pago');
      await patchOrder(orderId, { ...pp, status: t.statusCode === 2 ? 'canceled' : 'error', error: msg });
      return res.status(200).json(summary({ ...order, status: t.statusCode === 2 ? 'canceled' : 'error' }, { error: msg }));
    }
    if (Number(t.amount) !== order.amount_cents || (t.clientTransactionId && t.clientTransactionId !== orderId)) {
      const msg = `Monto o referencia no coinciden (PayPhone: ${t.amount}, orden: ${order.amount_cents})`;
      await patchOrder(orderId, { ...pp, status: 'error', error: msg });
      return res.status(200).json(summary({ ...order, status: 'error' }, { error: 'El pago no coincide con la orden. Contáctanos por WhatsApp con el código ' + orderId }));
    }

    // 2. Pago aprobado → buscar o crear la cuenta del cliente
    try {
      const plan = L.findPlan(order.plan);
      let member = order.member_id ? await L.getProfile('id=eq.' + order.member_id) : null;
      if (!member && order.email) member = await L.getProfile('email=eq.' + encodeURIComponent(order.email));
      let newAccount = false;
      if (!member) {
        const created = await L.adminJson('/auth/v1/admin/users', {
          method: 'POST',
          body: JSON.stringify({
            email: order.email,
            password: crypto.randomBytes(24).toString('base64url'),
            email_confirm: true,
            user_metadata: { full_name: order.full_name, phone: order.phone, cedula: order.cedula },
          }),
        });
        member = await L.getProfile('id=eq.' + created.id);
        newAccount = true;
      }

      // 3. Extender la membresía
      const today = L.todayEC();
      const active = member.end_date && member.end_date >= today;
      const start = active ? member.start_date || today : today;
      const end = L.addMonths(active ? member.end_date : today, plan.months);
      await L.adminJson('/rest/v1/profiles?id=eq.' + member.id, {
        method: 'PATCH', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ plan: plan.id, start_date: start, end_date: end }),
      });

      // 4. Registrar el pago (aparece en Pagos y Reportes)
      const recargo = order.surcharge_cents ? ` (incluye recargo $${(order.surcharge_cents / 100).toFixed(2)})` : '';
      await L.adminJson('/rest/v1/payments', {
        method: 'POST', headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({
          member_id: member.id, amount: order.amount_cents / 100, plan: plan.id, method: 'PayPhone',
          paid_on: today, note: (newAccount || !member.end_date ? 'Inscripción' : 'Renovación') + recargo,
        }),
      });

      // 5. Cuenta nueva → enlace de un solo uso para crear su contraseña
      let setPasswordUrl = null;
      if (newAccount) {
        try {
          const link = await L.adminJson('/auth/v1/admin/generate_link', {
            method: 'POST',
            body: JSON.stringify({ type: 'recovery', email: order.email, redirect_to: L.siteOrigin(req) + '/portal.html' }),
          });
          setPasswordUrl = link.action_link || (link.properties && link.properties.action_link) || null;
        } catch (_) { /* el cliente puede usar "¿Olvidaste tu contraseña?" */ }
      }

      await patchOrder(orderId, { ...pp, status: 'paid', member_id: member.id, paid_at: new Date().toISOString(), error: null });
      return res.status(200).json(summary({ ...order, status: 'paid' }, { end_date: end, newAccount, setPasswordUrl }));
    } catch (e) {
      await patchOrder(orderId, { ...pp, status: 'error', error: 'Pago aprobado pero no se activó: ' + e.message });
      return res.status(200).json(summary({ ...order, status: 'error' }, {
        approved: true,
        error: 'Tu pago fue aprobado, pero hubo un problema al activar tu membresía. Escríbenos por WhatsApp con el código ' + orderId + ' y lo resolvemos de inmediato.',
      }));
    }
  } catch (e) {
    return res.status(500).json({ error: 'Error del servidor: ' + e.message });
  }
};
