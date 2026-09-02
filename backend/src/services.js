/**
 * FONTE AUTOREVOLE DEI PREZZI.
 *
 * Vive solo qui, lato server. Il browser non decide mai quanto si paga:
 * manda un service_id e il Worker guarda in questa tabella.
 *
 * Per aggiungere un servizio basta una voce nuova qui sotto e la landing
 * potra' puntare a /checkout.html?service=<chiave>. Nessun'altra modifica.
 *
 * paymentMode:
 *   "fixed"  → si paga online una quota decisa da noi, il resto in studio
 *   "full"   → si paga online l'intero importo
 *   "custom" → il paziente sceglie l'importo entro minimumAmount/maximumAmount
 *              (da abilitare esplicitamente, mai per default)
 */
export const SERVICES = {
  'igiene-sonicare': {
    name: 'Visita + Igiene + Spazzolino elettrico',
    totalPrice: 98,
    paymentMode: 'fixed',
    amountDueNow: 15,
    balanceDueLater: 83,
    requiresAppointment: true,
    termsVersion: 'prenotazione-2026-09',
    terms:
      'I 15 € vengono scalati dal prezzo totale. Se annulli o sposti ' +
      "l'appuntamento con almeno 24 ore di preavviso, la quota può essere " +
      'rimborsata o utilizzata per una nuova prenotazione. In caso di ' +
      'cancellazione nelle 24 ore precedenti o mancata presentazione, i 15 € ' +
      'vengono trattenuti.',
  },

  'allineatori-visita': {
    name: 'Visita per allineatori + teleradiografia',
    totalPrice: 15,
    paymentMode: 'full',
    amountDueNow: 15,
    balanceDueLater: 0,
    requiresAppointment: true,
    termsVersion: 'allineatori-2026-09',
    terms:
      'I 15 \u20ac comprendono la visita e la teleradiografia, eseguita ' +
      'presso CDC. Se annulli o sposti l\u2019appuntamento con almeno 48 ore ' +
      'di preavviso la quota ti viene rimborsata, oppure resta valida per ' +
      'una nuova prenotazione. In caso di cancellazione nelle 48 ore ' +
      'precedenti o mancata presentazione, la quota viene trattenuta.',
  },

  sbiancamento: {
    name: 'Sbiancamento',
    totalPrice: 188,
    paymentMode: 'full',
    amountDueNow: 188,
    balanceDueLater: 0,
    requiresAppointment: false,
    termsVersion: null,
    terms: null,
  },
};

/** Recupera un servizio, o null se l'id non esiste. */
export function getService(id) {
  if (!id || !Object.prototype.hasOwnProperty.call(SERVICES, id)) return null;
  return SERVICES[id];
}

/**
 * Decide quanto si incassa ORA. È l'unico punto in cui si stabilisce
 * l'importo: nessun valore che arriva dal browser viene mai usato,
 * tranne requestedAmount e solo in modalita' "custom".
 */
export function resolveAmounts(service, requestedAmount) {
  const total = service.totalPrice;

  if (service.paymentMode === 'full') {
    return { totalPrice: total, amountDueNow: total, balanceDueLater: 0 };
  }

  if (service.paymentMode === 'fixed') {
    return {
      totalPrice: total,
      amountDueNow: service.amountDueNow,
      balanceDueLater: service.balanceDueLater,
    };
  }

  if (service.paymentMode === 'custom') {
    const min = service.minimumAmount ?? 1;
    const max = service.maximumAmount ?? total;
    const n = Number(requestedAmount);
    if (!Number.isFinite(n)) throw new Error('Importo non valido');
    // due decimali, niente float sporchi
    const amount = Math.round(n * 100) / 100;
    if (amount < min || amount > max) {
      throw new Error(`L'importo deve essere compreso fra ${min} € e ${max} €`);
    }
    return {
      totalPrice: total,
      amountDueNow: amount,
      balanceDueLater: Math.round((total - amount) * 100) / 100,
    };
  }

  throw new Error('Modalita di pagamento non riconosciuta');
}

/** Versione pubblica: quello che il browser puo' sapere. Nessun segreto. */
export function publicService(id, service) {
  return {
    service_id: id,
    name: service.name,
    total_price: service.totalPrice,
    payment_mode: service.paymentMode,
    amount_due_now: service.paymentMode === 'custom' ? null : service.amountDueNow,
    balance_due_later: service.paymentMode === 'custom' ? null : service.balanceDueLater,
    requires_appointment: service.requiresAppointment,
    minimum_amount: service.minimumAmount ?? null,
    maximum_amount: service.maximumAmount ?? null,
    terms: service.terms,
    terms_version: service.termsVersion,
  };
}
