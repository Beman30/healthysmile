/**
 * PayPal Orders API v2. Stessa logica di Stripe: l'importo lo decide
 * il server, il browser riceve solo un link su cui mandare il paziente.
 */

function base(env) {
  return env.PAYPAL_ENV === 'live'
    ? 'https://api-m.paypal.com'
    : 'https://api-m.sandbox.paypal.com';
}

async function token(env) {
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${base(env)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth: ${data.error_description || res.status}`);
  return data.access_token;
}

export async function createOrder(env, { booking, service, amounts, successUrl, cancelUrl }) {
  const access = await token(env);
  const res = await fetch(`${base(env)}/v2/checkout/orders`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access}`,
      'Content-Type': 'application/json',
      'PayPal-Request-Id': booking.booking_id, // idempotenza
    },
    body: JSON.stringify({
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: booking.booking_id,
          custom_id: booking.booking_id,
          description: service.name.slice(0, 127),
          amount: { currency_code: 'EUR', value: amounts.amountDueNow.toFixed(2) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'Healthy Smile By N',
            locale: 'it-IT',
            user_action: 'PAY_NOW',
            return_url: `${successUrl}?booking=${booking.booking_id}&provider=paypal`,
            cancel_url: cancelUrl,
          },
        },
      },
    }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal: ${data.message || res.status}`);
  const approve = (data.links || []).find((l) => l.rel === 'payer-action' || l.rel === 'approve');
  return { id: data.id, url: approve?.href };
}

export async function captureOrder(env, orderId) {
  const access = await token(env);
  const res = await fetch(`${base(env)}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal capture: ${data.message || res.status}`);
  return data;
}

/**
 * PayPal non firma con HMAC: si chiede a PayPal stesso se la notifica
 * e' autentica. Una chiamata in piu', ma e' il metodo ufficiale.
 */
export async function verifyWebhook(env, headers, rawBody) {
  const access = await token(env);
  const res = await fetch(`${base(env)}/v1/notifications/verify-webhook-signature`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${access}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      auth_algo: headers.get('paypal-auth-algo'),
      cert_url: headers.get('paypal-cert-url'),
      transmission_id: headers.get('paypal-transmission-id'),
      transmission_sig: headers.get('paypal-transmission-sig'),
      transmission_time: headers.get('paypal-transmission-time'),
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: JSON.parse(rawBody),
    }),
  });
  const data = await res.json();
  return res.ok && data.verification_status === 'SUCCESS';
}
