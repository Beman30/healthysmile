/**
 * Stripe via API REST. Niente SDK: sui Worker non serve e pesa.
 * La secret key vive solo come secret del Worker, mai nel browser.
 */

const API = 'https://api.stripe.com/v1';

function form(obj, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === 'object' && !Array.isArray(v)) form(v, key, out);
    else if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === 'object') form(item, `${key}[${i}]`, out);
      else out.append(`${key}[${i}]`, String(item));
    });
    else out.append(key, String(v));
  }
  return out;
}

/**
 * Crea una Checkout Session.
 * L'importo arriva SEMPRE da resolveAmounts lato server, mai dal browser.
 * Carte, Apple Pay e Google Pay si attivano da soli con automatic_payment_methods
 * se sono abilitati nel cruscotto Stripe: non serve codice per ciascuno.
 */
export async function createCheckoutSession(env, { booking, service, amounts, successUrl, cancelUrl }) {
  const body = form({
    mode: 'payment',
    // Stripe ragiona in centesimi interi
    'line_items[0][price_data][currency]': 'eur',
    'line_items[0][price_data][unit_amount]': Math.round(amounts.amountDueNow * 100),
    'line_items[0][price_data][product_data][name]': service.name,
    'line_items[0][price_data][product_data][description]':
      amounts.balanceDueLater > 0
        ? `Acconto. Saldo di ${amounts.balanceDueLater} € da pagare in studio.`
        : 'Pagamento completo.',
    'line_items[0][quantity]': 1,
    success_url: `${successUrl}?booking=${booking.booking_id}`,
    cancel_url: cancelUrl,
    customer_email: booking.email,
    client_reference_id: booking.booking_id,
    'metadata[booking_id]': booking.booking_id,
    'metadata[service_id]': booking.service_id,
    'payment_intent_data[metadata][booking_id]': booking.booking_id,
    locale: 'it',
  });

  const res = await fetch(`${API}/checkout/sessions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message || res.status}`);
  return { id: data.id, url: data.url };
}

/* ── Verifica firma webhook ──────────────────────────────────────────
   Stripe firma con HMAC-SHA256 su "timestamp.payload". Va verificata:
   senza, chiunque conosca l'endpoint potrebbe dichiarare pagato un
   ordine mai pagato.                                                   */

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyStripeSignature(payload, header, secret, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(',').map((p) => p.trim().split('=').map((x) => x.trim()))
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;

  // rifiuta eventi vecchi: blocca il replay di una notifica catturata
  const age = Math.abs(Math.floor(Date.now() / 1000) - Number(t));
  if (!Number.isFinite(age) || age > toleranceSec) return false;

  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return timingSafeEqual(expected, v1);
}
