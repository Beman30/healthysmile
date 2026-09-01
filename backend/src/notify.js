/**
 * Avviso allo studio quando arriva una prenotazione pagata.
 *
 * Non manda nulla al paziente: la conferma la inoltri tu a mano, e in
 * fondo alla mail trovi un link che apre WhatsApp col messaggio gia'
 * scritto verso il suo numero.
 *
 * Provider: Resend (API HTTP). I Worker non possono usare SMTP.
 * Se RESEND_API_KEY non e' configurata la funzione esce senza fare
 * rumore: il pagamento resta valido, semplicemente non parte l'avviso.
 */

/**
 * Porta un numero italiano in formato internazionale per wa.me.
 * Serve perche' i pazienti lo scrivono in dieci modi diversi:
 * "333 1234567", "+39 333-1234567", "0039...", "3331234567".
 */
export function waNumber(raw) {
  if (!raw) return null;
  let n = String(raw).replace(/[^\d+]/g, '');
  if (n.startsWith('+')) n = n.slice(1);
  else if (n.startsWith('00')) n = n.slice(2);
  // numero italiano scritto senza prefisso internazionale
  if (!n.startsWith('39') && (n.length === 9 || n.length === 10)) n = '39' + n;
  return /^\d{10,15}$/.test(n) ? n : null;
}

function fmtDate(iso) {
  if (!iso) return null;
  const p = iso.split('-');
  if (p.length !== 3) return iso;
  const mesi = ['gennaio','febbraio','marzo','aprile','maggio','giugno',
                'luglio','agosto','settembre','ottobre','novembre','dicembre'];
  return `${Number(p[2])} ${mesi[Number(p[1]) - 1]} ${p[0]}`;
}

const eur = (n) => `${Number(n).toLocaleString('it-IT', { maximumFractionDigits: 2 })} €`;
const esc = (s) => String(s ?? '').replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));

/** Costruisce oggetto e corpo. Esportata a parte per poterla testare. */
export function buildMessage(booking, serviceName) {
  const appt = booking.appointment_date && booking.appointment_time;
  const quando = appt ? `${fmtDate(booking.appointment_date)} alle ${booking.appointment_time}` : null;
  const wa = waNumber(booking.phone);

  const testo =
    `Ciao ${booking.first_name}, ti confermo l'appuntamento da Healthy Smile` +
    (quando ? ` per ${quando}` : '') +
    `. ${serviceName}.` +
    (booking.balance_due > 0 ? ` Hai già versato ${eur(booking.amount_paid)}, il saldo di ${eur(booking.balance_due)} lo regoli in studio.` : '') +
    ` Ti aspettiamo in Via Madama Cristina 2, Torino.`;

  const waLink = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(testo)}` : null;

  const subject =
    `Nuova prenotazione · ${booking.first_name} ${booking.last_name}` +
    (quando ? ` · ${quando}` : '');

  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#111;line-height:1.6">
  <p style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#C8005C;margin:0 0 6px">
    Prenotazione pagata
  </p>
  <h2 style="font-size:20px;margin:0 0 18px">${esc(serviceName)}</h2>

  <table style="width:100%;border-collapse:collapse;font-size:15px">
    <tr><td style="padding:7px 0;color:#666">Paziente</td>
        <td style="padding:7px 0;text-align:right"><b>${esc(booking.first_name)} ${esc(booking.last_name)}</b></td></tr>
    <tr><td style="padding:7px 0;color:#666">Telefono</td>
        <td style="padding:7px 0;text-align:right">${esc(booking.phone)}</td></tr>
    <tr><td style="padding:7px 0;color:#666">Email</td>
        <td style="padding:7px 0;text-align:right">${esc(booking.email)}</td></tr>
    ${quando ? `<tr><td style="padding:7px 0;color:#666">Appuntamento</td>
        <td style="padding:7px 0;text-align:right"><b>${esc(quando)}</b></td></tr>` : ''}
    <tr><td style="padding:7px 0;color:#666">Incassato online</td>
        <td style="padding:7px 0;text-align:right;color:#1a7a4a"><b>${eur(booking.amount_paid)}</b></td></tr>
    ${booking.balance_due > 0 ? `<tr><td style="padding:7px 0;color:#666">Saldo in studio</td>
        <td style="padding:7px 0;text-align:right"><b>${eur(booking.balance_due)}</b></td></tr>` : ''}
    <tr><td style="padding:7px 0;color:#666">Riferimento</td>
        <td style="padding:7px 0;text-align:right;font-family:monospace;font-size:13px">${esc(booking.booking_id)}</td></tr>
  </table>

  ${waLink ? `
  <p style="margin:26px 0 8px">
    <a href="${waLink}"
       style="display:inline-block;background:#C8005C;color:#fff;text-decoration:none;
              padding:13px 22px;border-radius:8px;font-weight:600">
      Scrivi a ${esc(booking.first_name)} su WhatsApp
    </a>
  </p>
  <p style="font-size:13px;color:#888;margin:0">
    Il messaggio di conferma è già compilato: puoi rileggerlo e modificarlo prima di inviarlo.
  </p>`
  : `<p style="margin-top:24px;font-size:14px;color:#a33">
       Il numero di telefono non è in un formato riconoscibile: contatta il paziente a mano.
     </p>`}

  <p style="margin-top:28px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:14px">
    Ricordati di segnare l'appuntamento in agenda: il sito non è ancora collegato al gestionale.
  </p>
</div>`.trim();

  return { subject, html, waLink };
}

/** Invio vero e proprio. Non lancia mai: al massimo restituisce false. */
export async function notifyStudio(env, booking, serviceName) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL_TO) return false;

  const { subject, html } = buildMessage(booking, serviceName);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: env.NOTIFY_EMAIL_FROM || 'Healthy Smile <prenotazioni@healthysmile.it>',
        to: env.NOTIFY_EMAIL_TO.split(',').map((s) => s.trim()),
        reply_to: booking.email,
        subject,
        html,
      }),
    });
    if (!res.ok) {
      console.error('notifica non inviata:', res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('notifica non inviata:', e.message);
    return false;
  }
}
