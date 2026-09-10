var __freeze = Object.freeze;
var __defProp = Object.defineProperty;
var __template = (cooked, raw) => __freeze(__defProp(cooked, "raw", { value: __freeze(raw || cooked.slice()) }));

// teamup-work/agenda-reader/src/range.js
function dateRange(from, to, max = 366) {
  const parse = (s) => {
    if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) throw Error("Inserisci data iniziale e finale");
    const n = Date.parse(s + "T12:00:00Z");
    if (!Number.isFinite(n) || new Date(n).toISOString().slice(0, 10) !== s) throw Error("Data non valida");
    return n;
  };
  const a = parse(from), b = parse(to), count = (b - a) / 864e5 + 1;
  if (count < 1) throw Error("La data finale precede quella iniziale");
  if (count > max) throw Error("Seleziona al massimo " + max + " giorni");
  return Array.from({ length: count }, (_, i) => new Date(a + i * 864e5).toISOString().slice(0, 10));
}
function paymentTotal(reports) {
  let cents2 = 0, review = 0, missing = 0;
  const seen = /* @__PURE__ */ new Set();
  for (const r of reports) {
    if (r.error || r.stale || !Array.isArray(r.payments)) {
      missing++;
      continue;
    }
    for (const p of r.payments) {
      const id = p.event_id + "|" + p.start_dt;
      if (seen.has(id)) continue;
      seen.add(id);
      if (p.status !== "due" || !Number.isFinite(p.amount_due)) {
        review++;
        continue;
      }
      cents2 += Math.round(p.amount_due * 100);
    }
  }
  return { amount: cents2 / 100, review, missing };
}

// teamup-work/backend/src/teamup.js
var ZONE = "Europe/Rome";
var MINUTE = 6e4;
var formatter = new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function localParts(ms) {
  const p = Object.fromEntries(formatter.formatToParts(ms).map((p2) => [p2.type, p2.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
function romeTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time || "")) throw new Error("Data o orario non validi");
  const wanted = `${date}T${time}`;
  const utc = Date.parse(wanted + ":00Z");
  const matches = [utc - 60 * MINUTE, utc - 120 * MINUTE].filter((t) => Number.isFinite(t) && localParts(t) === wanted);
  if (matches.length !== 1) throw new Error("Data o orario inesistente o ambiguo");
  return matches[0];
}
var TeamupReadError = class extends Error {
};
async function read(env, resource, params, fetcher) {
  const apiKey = String(env.TEAMUP_API_KEY || "").trim();
  const calendarKey = String(env.TEAMUP_CALENDAR_KEY || "").trim();
  if (!apiKey || !/^ks[a-zA-Z0-9]+$/.test(calendarKey)) throw new Error("Configurare i secret TEAMUP_API_KEY e TEAMUP_CALENDAR_KEY nel Worker");
  if (/\s/.test(apiKey)) throw new Error("TEAMUP_API_KEY contiene spazi o ritorni a capo interni. Ricopiare la chiave API.");
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1e4);
  try {
    const response = await fetcher(`https://api.teamup.com/${calendarKey}/${resource}?${params}`, { headers: { "Teamup-Token": apiKey, Accept: "application/json" }, signal: controller.signal, redirect: "manual" });
    if (response.status >= 300 && response.status < 400) throw new TeamupReadError(`Teamup HTTP ${response.status} (${resource}): reindirizzamento bloccato. Nessuna credenziale inoltrata.`);
    if (!response.ok) {
      const hints = {
        400: "Richiesta rifiutata da Teamup: verificare i parametri dell\u2019integrazione.",
        401: "Autenticazione rifiutata da Teamup: verificare chiave API e accesso al calendario.",
        403: "Accesso negato da Teamup: verificare permessi del collegamento e abilitazione della chiave API.",
        404: "Risorsa non trovata o non accessibile: verificare il collegamento del calendario.",
        429: "Limite di richieste Teamup raggiunto. Riprovare pi\xF9 tardi."
      };
      let detail = "dettaglio non disponibile";
      try {
        const raw = await response.text();
        if (raw.length <= 65536) {
          try {
            const body = JSON.parse(raw);
            const known = {
              invalid_api_key: "invalid_api_key: chiave API non riconosciuta",
              account_no_permission: "account_no_permission: accesso al calendario negato",
              login_required: "login_required: questo accesso richiede autenticazione Teamup",
              password_required: "password_required: collegamento protetto da password",
              calendar_not_found: "calendar_not_found: calendario non trovato",
              key_not_found: "key_not_found: collegamento non trovato"
            };
            const candidates = [body?.error?.id, body?.error?.code, body?.code, body?.id, body?.errors?.[0]?.code, body?.error];
            const id = candidates.find((value) => {
              const code = typeof value === "number" && Number.isSafeInteger(value) ? String(value) : value;
              return typeof code === "string" && /^(?:[a-z][a-z0-9_-]{0,95}|[0-9]{1,8})$/.test(code) && ![apiKey, calendarKey].some((secret) => code.includes(secret) || secret.includes(code));
            });
            detail = id !== void 0 ? Object.hasOwn(known, id) ? known[id] : `codice API: ${id}` : "JSON senza codice identificativo utilizzabile; verificare la risposta con il supporto Teamup";
          } catch {
            detail = /<html|<!doctype html/i.test(raw) ? "risposta HTML, non errore JSON dell\u2019API" : "risposta non JSON";
          }
        }
      } catch {
      }
      throw new TeamupReadError(`Teamup HTTP ${response.status} (${resource}; ${detail}). ${hints[response.status] || (response.status >= 500 ? "Errore del servizio Teamup. Riprovare pi\xF9 tardi." : "Risposta inattesa da Teamup.")}`);
    }
    try {
      return await response.json();
    } catch {
      if (controller.signal.aborted) throw new TeamupReadError(`Teamup timeout (${resource}): nessuna risposta completa entro 10 secondi.`);
      throw new TeamupReadError(`Teamup formato risposta non valido (${resource}): atteso JSON.`);
    }
  } catch (error) {
    if (error instanceof TeamupReadError) throw error;
    if (controller.signal.aborted) throw new TeamupReadError(`Teamup timeout (${resource}): nessuna risposta completa entro 10 secondi.`);
    throw new TeamupReadError(`Teamup connessione non riuscita (${resource}): errore di rete o reindirizzamento inatteso.`);
  } finally {
    clearTimeout(timer);
  }
}
async function calendars(env, fetcher = fetch) {
  const data = await read(env, "configuration", new URLSearchParams(), fetcher);
  const items = data?.configuration?.subcalendars;
  if (!Array.isArray(items)) throw new Error("Elenco agende Teamup incompleto nella configurazione");
  const result = [];
  for (const c of items) {
    if (!c || !Number.isSafeInteger(c.id)) throw new Error("Identificativo agenda non valido");
    if (c.active !== false) result.push({ id: c.id, name: String(c.name || ""), active: true });
  }
  return result;
}
async function readDay(env, date, ids, fetcher = fetch) {
  romeTime(date, "12:00");
  const params = new URLSearchParams({ startDate: date, endDate: date, tz: ZONE, format: "markdown" });
  ids.forEach((id) => params.append("subcalendarId[]", String(id)));
  const data = await read(env, "events", params, fetcher);
  if (!Array.isArray(data.events)) throw new Error("Risposta Teamup incompleta");
  return data.events;
}
function rollingDates(clock2 = Date.now(), count = 14) {
  const today = localParts(clock2).slice(0, 10);
  const base = Date.parse(today + "T12:00:00Z");
  return Array.from({ length: count }, (_, i) => new Date(base + i * 864e5).toISOString().slice(0, 10));
}

// teamup-work/agenda-reader/src/payments.js
var clean = (v) => String(v ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
function cents(value) {
  let s = value.replace(/\s/g, "");
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
  } else if (s.includes(",")) s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, "");
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return null;
  const n = Math.round(Number(s) * 100);
  return Number.isSafeInteger(n) ? n : null;
}
function amounts(text, field = false) {
  const result = [];
  const re = /(?:€|\bEUR\b)\s*(\d+(?:[.,]\d+)*)|(\d+(?:[.,]\d+)*)\s*(?:€|\bEUR\b)/gi;
  for (const m of text.matchAll(re)) {
    const n = cents(m[1] || m[2]);
    if (n !== null) result.push(n);
  }
  if (field && !result.length && /^\d+(?:[.,]\d+)*$/.test(text)) {
    const n = cents(text);
    if (n !== null) result.push(n);
  }
  return [...new Set(result)];
}
function paymentFor(event) {
  const title = clean(event.title), field = clean(event.who);
  const a = amounts(field, true), b = amounts(title);
  const noField = !field || /^[-–—]$/.test(field);
  const paid = /\b(?:pagat[oaie]|saldat[oaie]|incassat[oaie]|ricevut[oaie])\b|nessun saldo/i;
  const noDebt = /^(?:no|zero|nessun saldo|pagato|saldato)$/i.test(field);
  const due = /\b(?:pagare|saldo|non saldato|non pagato|da saldare)\b/i;
  if (!a.length && !b.length && !due.test(title) && noField) return null;
  if (noDebt && !b.some((n2) => n2 > 0)) return null;
  const reasons = [];
  if (a.length > 1 || b.length > 1) reasons.push("Pi\xF9 importi: verificare quale resta da pagare");
  if (a.length === 1 && b.length === 1 && a[0] !== b[0]) reasons.push("Importi discordanti");
  if (!noField && !a.length && !noDebt) reasons.push("Campo Deve pagare non numerico");
  if (noDebt && b.some((n2) => n2 > 0)) reasons.push("Campo e titolo discordanti");
  if (paid.test(title) || paid.test(field)) reasons.push("\xC8 indicato anche un pagamento: verificare il residuo");
  const n = a.length === 1 ? a[0] : b.length === 1 ? b[0] : null;
  if (n === null) reasons.push("Importo da specificare");
  if (n === 0 && !reasons.length) return null;
  return { event_id: String(event.id), appointment: title, start_dt: event.start_dt, all_day: !!event.all_day, field_text: field, title_amounts: b.map((n2) => n2 / 100), amount_due: reasons.length ? null : n / 100, status: reasons.length ? "review" : "due", reason: reasons.join("; "), source: a.length && b.length ? "Deve pagare e titolo" : a.length ? "Deve pagare" : "Titolo" };
}
function readPayments(raw, records) {
  const appointments = new Set(records.filter((r) => r.kind === "appointment").map((r) => r.event_id));
  const seen = /* @__PURE__ */ new Set(), out = [];
  for (const e of raw) {
    const id = String(e.id);
    if (e.delete_dt || !appointments.has(id) || seen.has(id)) continue;
    seen.add(id);
    const p = paymentFor(e);
    if (p) out.push(p);
  }
  return out.sort((a, b) => String(a.start_dt).localeCompare(String(b.start_dt)));
}

// teamup-work/agenda-reader/src/engine.js
var MIN = 6e4;
var clean2 = (s) => String(s || "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
var bare = (s) => clean2(s).replace(/^[^/\r\n]{1,40}\/\s*/, "").replace(/^[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ .]{0,39}\s*[-–—]\s*(?=\d|PALMIA\b|STOP\b|PAUSA\b)/i, "").trim();
var clock = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
var hit = (e, a, b) => e.a < b && e.b > a;
function parseTime(s) {
  const m = /^(\d{1,2})(?:[.:](\d{2}))?$/.exec(s);
  if (!m || +m[1] > 23 || +(m[2] || 0) > 59) throw Error("Orario non valido");
  return +m[1] * 60 + +(m[2] || 0);
}
function openingText(text) {
  const m = /^(?:(?:DOTT\.?\s*)?PALMIA\s+)?(\d{1,2}(?:[.:]\d{2})?)\s*[-–—]\s*(\d{1,2}(?:[.:]\d{2})?)\s*$/i.exec(bare(text));
  if (!m) return null;
  const a = parseTime(m[1]), b = parseTime(m[2]);
  if (b <= a) throw Error("Apertura e chiusura discordanti");
  return { start: clock(a), end: clock(b) };
}
function merge(items) {
  const out = [];
  for (const e of [...items].sort((x, y) => x.a - y.a)) {
    const last = out.at(-1);
    if (last && e.a <= last.b) last.b = Math.max(last.b, e.b);
    else out.push({ a: e.a, b: e.b });
  }
  return out;
}
function peak(items, a, b) {
  const relevant = items.filter((e) => hit(e, a, b));
  return Math.max(0, ...[a, ...relevant.map((e) => Math.max(a, e.a))].map((t) => relevant.filter((e) => e.a <= t && e.b > t).length));
}
function validateConfig(c) {
  const ids = c.medical_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 30 || ids.some((x) => !Number.isSafeInteger(x) || x <= 0)) throw Error("Seleziona le agende Medici");
  if (!ids.includes(c.palmia_id)) throw Error("Seleziona Dott. Palmia tra le agende Medici");
  const site = c.site_id || null;
  if (site && (!Number.isSafeInteger(site) || site <= 0 || ids.includes(site))) throw Error("Il calendario del sito deve essere distinto dalle agende Medici");
  return { medical_ids: [...new Set(ids)], palmia_id: c.palmia_id, site_id: site };
}
function interpretDay(raw, date, input, now = Date.now()) {
  const c = validateConfig(input), start = romeTime(date, "00:00");
  const next = new Date(Date.parse(date + "T12:00Z") + 864e5).toISOString().slice(0, 10), end = romeTime(next, "00:00");
  if (!Array.isArray(raw)) throw Error("Elenco eventi incompleto");
  const allowed = [...c.medical_ids, ...c.site_id ? [c.site_id] : []];
  const seen = /* @__PURE__ */ new Map(), records = [], issues = [], openings = [], blocks = [], patients = [], staffBlocks = [], site = [];
  const issue = (id, reason) => issues.push({ event_id: id, reason });
  for (const e of raw) {
    if (e?.delete_dt) continue;
    if (!e || !e.id || !Array.isArray(e.subcalendar_ids)) throw Error("Evento Teamup incompleto");
    if (!e.subcalendar_ids.some((x) => allowed.includes(x))) continue;
    const id = String(e.id), signature = JSON.stringify([e.start_dt, e.end_dt, e.title, e.notes, e.all_day, [...e.subcalendar_ids].sort()]);
    if (seen.has(id)) {
      if (seen.get(id) !== signature) throw Error("Evento duplicato discordante: " + id);
      continue;
    }
    seen.set(id, signature);
    const parse = (v) => typeof v === "number" ? v * 1e3 : Date.parse(v);
    let a, b;
    if (e.all_day) {
      const from = String(e.start_dt).slice(0, 10), to = String(e.end_dt).slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) throw Error("Data evento giornaliero non valida");
      if (date < from || date > to) continue;
      a = start;
      b = end;
    } else {
      if ([e.start_dt, e.end_dt].some((v) => typeof v !== "number" && !(typeof v === "string" && /(Z|[+-]\d{2}:?\d{2})$/.test(v)))) throw Error("Fuso orario evento mancante");
      a = parse(e.start_dt);
      b = parse(e.end_dt);
      if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) throw Error("Durata evento non valida");
      if (a >= end || b <= start) continue;
    }
    const title = clean2(e.title), notes = clean2(e.notes || e.note);
    const r = { event_id: id, title, notes, calendar_ids: e.subcalendar_ids, start_dt: e.start_dt, end_dt: e.end_dt, kind: "appointment", reason: "Evento clinico: occupa una poltrona" };
    records.push(r);
    let hours = null;
    if (e.subcalendar_ids.includes(c.palmia_id)) {
      try {
        hours = openingText(title) || openingText(notes);
      } catch (err) {
        r.kind = "ambiguous";
        r.reason = err.message;
        issue(id, r.reason);
        continue;
      }
    }
    if (hours) {
      r.kind = "opening";
      r.reason = `Apertura ${hours.start}\u2013${hours.end}`;
      openings.push({ a: romeTime(date, hours.start), b: romeTime(date, hours.end), event_id: id });
      continue;
    }
    if (/^(?:STOP|PAUSA)\b/i.test(bare(title))) {
      r.kind = "pause";
      r.reason = e.subcalendar_ids.includes(c.palmia_id) ? "Intervallo escluso dall\u2019apertura Palmia" : "Indisponibilit\xE0 operatore, non paziente";
      const block = { a, b, ids: e.subcalendar_ids, event_id: id };
      staffBlocks.push(block);
      if (e.subcalendar_ids.includes(c.palmia_id)) blocks.push(block);
      continue;
    }
    if (e.all_day || /^(?:PALMIA|DOTT\.?\s+PALMIA|APERTURA|CHIUSURA|APRIAMO|CHIUDIAMO|ASSENTE|FERIE)\b/i.test(bare(title))) {
      r.kind = "ambiguous";
      r.reason = "Avviso organizzativo non interpretato: verifica necessaria";
      issue(id, r.reason);
      continue;
    }
    const p = { a, b, ids: e.subcalendar_ids, event_id: id };
    patients.push(p);
    if (c.site_id && e.subcalendar_ids.includes(c.site_id)) site.push(p);
  }
  let windows = [], source = "none";
  if (openings.length) {
    source = "explicit";
    if (openings.some((o) => o.a !== openings[0].a || o.b !== openings[0].b)) issue(null, "Pi\xF9 avvisi di apertura discordanti");
    else windows = [{ a: openings[0].a, b: openings[0].b }];
  } else {
    source = "between_blocks";
    const m = merge(blocks);
    for (let i = 1; i < m.length; i++) if (m[i].a > m[i - 1].b) windows.push({ a: m[i - 1].b, b: m[i].a });
  }
  if (!windows.length) issue(null, "Apertura non ricavabile dai dati letti");
  for (const block of merge(blocks)) windows = windows.flatMap((w) => !hit(block, w.a, w.b) ? [w] : [{ a: w.a, b: Math.min(w.b, block.a) }, { a: Math.max(w.a, block.b), b: w.b }].filter((x) => x.b > x.a));
  const capacity = [];
  for (const w of windows) {
    const points = [.../* @__PURE__ */ new Set([w.a, w.b, ...patients.filter((e) => hit(e, w.a, w.b)).flatMap((e) => [Math.max(w.a, e.a), Math.min(w.b, e.b)])])].sort((a, b) => a - b);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i], free = Math.max(0, 2 - patients.filter((e) => hit(e, a, b)).length);
      const previous = capacity.at(-1);
      if (previous && previous.b === a && previous.free === free) previous.b = b;
      else capacity.push({ a, b, free });
    }
  }
  const free_intervals = issues.length ? [] : capacity.filter((e) => e.free > 0).map((e) => ({ start_dt: new Date(e.a).toISOString(), end_dt: new Date(e.b).toISOString(), free_chairs: e.free }));
  const slots = [];
  for (let minute = 0; minute < 1440; minute += 15) {
    let a;
    try {
      a = romeTime(date, clock(minute));
    } catch {
      continue;
    }
    const b = a + 60 * MIN, why = [];
    if (a <= now) why.push("Orario passato");
    if (!windows.some((w) => a >= w.a && b <= w.b)) why.push("Fuori apertura o meno di 60 minuti prima di pausa/chiusura");
    if (issues.length) why.push("Interpretazione da verificare");
    const chairs = peak(patients, a, b);
    if (chairs >= 2) why.push("Due poltrone occupate durante l\u2019ora");
    if (site.some((e) => hit(e, a, b))) why.push("Prenotazione sito sovrapposta");
    slots.push({ time: clock(minute), status: why.length ? "excluded" : "candidate", chairs_peak: chairs, reasons: why, event_ids: patients.filter((e) => hit(e, a, b)).map((e) => e.event_id) });
  }
  return { date, payments: readPayments(raw, records), free_intervals, opening_source: source, windows: windows.map((w) => ({ start_dt: new Date(w.a).toISOString(), end_dt: new Date(w.b).toISOString() })), issues, events: records, slots, candidate_count: slots.filter((s) => s.status === "candidate").length, mode: "read_only_review", note: "Lettura di apertura, pause e capienza delle agende selezionate. Nessuna verifica del personale o dei pagamenti. Nessuno slot pubblicato." };
}

// teamup-work/agenda-reader/src/page.js
var _a;
var PAGE = String.raw(_a || (_a = __template(['<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lettore agenda Healthy Smile</title>\n<style>body{font:16px system-ui;max-width:1100px;margin:30px auto;padding:0 20px;color:#20252b;background:#f5f7fa}fieldset,article{background:white;border:1px solid #ccc;border-radius:8px;padding:18px;margin:16px 0}button[aria-pressed="true"]{background:#20252b;color:white}button{padding:12px;margin:8px 8px 8px 0;cursor:pointer}label{display:block;margin:10px 0}select,input{padding:8px;max-width:100%}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}#message{font-weight:bold;white-space:pre-wrap}.warn{color:#9a3412}summary{cursor:pointer;padding:8px}.scroll{overflow:auto}</style>\n<h1>Agenda studio \xB7 v7</h1><p>Igieni sito e pagamenti dalle agende selezionate. Solo lettura.</p>\n\n<label>Token amministratore <input id="token" type="password" autocomplete="off"></label><button id="connect">Connetti</button><p id="message" role="status"></p>\n<fieldset id="config" hidden><legend>Agende</legend><p>Apertura e pause vengono lette dall\u2019agenda Palmia. Le agende Medici selezionate servono a leggere gli appuntamenti e la capienza.</p><div id="choices"></div>\n<label>Dott. Palmia: apertura e pause <select id="palmia"></select></label><label>Prenotazioni sito (facoltativo) <select id="site"></select></label>\n<button id="save">Salva configurazione lettore</button></fieldset>\n<section id="actions" hidden><nav><button id="view-slots" aria-pressed="true">Igieni sito</button><button id="view-payments" aria-pressed="false">Pagamenti</button></nav><label>Dal <input id="date" type="date"></label><label>Al <input id="date-end" type="date"></label><button id="day">Leggi periodo</button><button id="all">Leggi prossimi 14 giorni</button><button id="reload">Mostra ultima lettura</button><p id="last"></p></section><div id="reports"></div>\n<script>\nconst dateRange=', ";\nconst paymentTotal=", ";\nconst $=id=>document.getElementById(id);let token='',busy=false,view='slots',lastData={reports:[]};\nasync function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Errore '+r.status);return d;}\nasync function run(fn){if(busy)return;busy=true;$('message').textContent='Lettura in corso\u2026';try{await fn();}catch(e){$('message').textContent=e.message;}finally{busy=false;}}\nfunction text(tag,value,parent){const e=document.createElement(tag);e.textContent=value;parent.append(e);return e;}\nconst hour=v=>new Date(v).toLocaleTimeString('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'});\nfunction render(d){\n lastData=d;\n $('reports').replaceChildren();\n if(view==='payments'&&d.reports.length){const total=paymentTotal(d.reports);text('h2','Totale '+(total.missing?'parziale ':'')+money(total.amount),$('reports'));text('p','Dal '+d.reports[0].date+' al '+d.reports.at(-1).date+' \xB7 Somma degli importi indicati per appuntamento.', $('reports'));if(total.review)text('p',total.review+' voci da verificare, escluse dalla somma.', $('reports'));if(total.missing)text('p',total.missing+' giornate senza dati aggiornati, escluse dalla somma.', $('reports'));}\n if(!d.reports.length)text('p','Premi Leggi periodo.',$('reports'));\n for(const r of d.reports){\n  const a=document.createElement('article');$('reports').append(a);\n  text('h2',new Date(r.date+'T12:00:00Z').toLocaleDateString('it-IT',{timeZone:'Europe/Rome',weekday:'long',day:'numeric',month:'long',year:'numeric'}),a);\n  if(view==='payments'){renderPayments(r,a);continue;}\n  if(r.error||r.issues?.length){text('p','Orari da verificare: '+(r.error||r.issues.map(i=>i.reason).join('; ')),a);continue;}\n  const windows=r.windows||[];\n  if(!windows.length){text('p','Nessun orario di apertura riconosciuto.',a);continue;}\n  text('p','Apertura '+hour(windows[0].start_dt)+' \xB7 Chiusura '+hour(windows.at(-1).end_dt),a);\n  const pauses=windows.slice(1).map((w,i)=>hour(windows[i].end_dt)+'\u2013'+hour(w.start_dt));\n  if(pauses.length)text('p','Pausa '+pauses.join(', '),a);\n  if(r.stale){text('p','Lettura da aggiornare: premi Leggi periodo.',a);continue;}\n  if(!Array.isArray(r.free_intervals)){text('p','Premi Leggi periodo per aggiornare il risultato.',a);continue;}\n  if(!r.free_intervals.length){text('p','Nessuna poltrona libera durante l\u2019apertura.',a);continue;}\n  const table=document.createElement('table');a.append(table);\n  const head=document.createElement('tr');table.append(head);text('th','Orario',head);text('th','Poltrone libere',head);\n  for(const f of r.free_intervals){const tr=document.createElement('tr');table.append(tr);text('td',hour(f.start_dt)+'\u2013'+hour(f.end_dt),tr);text('td',f.free_chairs===2?'2 libere':'1 libera',tr);}\n }\n}\nconst money=n=>Number(n).toLocaleString('it-IT',{style:'currency',currency:'EUR'});\nfunction renderPayments(r,a){\n if(r.error){text('p','Lettura non riuscita: '+r.error,a);return;}\n if(r.stale){text('p','Rileggi la giornata per aggiornare gli importi.',a);return;}\n if(!Array.isArray(r.payments)){text('p','Rileggi la giornata per caricare i pagamenti.',a);return;}\n text('p','Totale giornata: '+money(paymentTotal([r]).amount),a);\n if(!r.payments.length){text('p','Nessun importo da pagare riconosciuto.',a);return;}\n const table=document.createElement('table');a.append(table);const head=document.createElement('tr');table.append(head);\n for(const name of ['Ora','Paziente / appuntamento','Da pagare','Indicazione in agenda'])text('th',name,head);\n for(const p of r.payments){const tr=document.createElement('tr');table.append(tr);text('td',p.all_day?'Giornata':hour(p.start_dt),tr);text('td',p.appointment,tr);text('td',p.amount_due===null?'Da verificare':money(p.amount_due),tr);text('td',(p.field_text?'Deve pagare: '+p.field_text+'. ':'')+(p.title_amounts.length?'Titolo: '+p.title_amounts.map(money).join(', ')+'. ':'')+(p.reason||p.source),tr);}\n}\nfor(const [id,next] of [['view-slots','slots'],['view-payments','payments']])$(id).onclick=()=>{view=next;$('view-slots').setAttribute('aria-pressed',String(view==='slots'));$('view-payments').setAttribute('aria-pressed',String(view==='payments'));render(lastData);};\n$('connect').onclick=()=>run(async()=>{token=$('token').value;const d=await api('config');$('choices').replaceChildren();$('palmia').replaceChildren(new Option('Seleziona',''));$('site').replaceChildren(new Option('Nessuno',''));for(const c of d.calendars){const row=document.createElement('div');$('choices').append(row);const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.dataset.medical=c.id;check.checked=d.config?d.config.medical_ids.includes(c.id):/^Medici\b/i.test(c.name);label.append(check,document.createTextNode(c.name+' ['+c.id+']'));row.append(label);$('palmia').add(new Option(c.name,c.id));$('site').add(new Option(c.name,c.id));}\nconst palmias=d.calendars.filter(c=>/\bPalmia\b/i.test(c.name));$('palmia').value=d.config?.palmia_id||(palmias.length===1?palmias[0].id:'');$('site').value=d.config?.site_id||'';$('config').hidden=false;$('actions').hidden=false;$('date').value=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Rome'});$('date-end').value=$('date').value;$('message').textContent='Connesso. Configura le agende e avvia una lettura.';});\n$('save').onclick=()=>run(async()=>{await api('config',{medical_ids:[...document.querySelectorAll('[data-medical]:checked')].map(x=>+x.dataset.medical),palmia_id:+$('palmia').value,site_id:+$('site').value||null});$('message').textContent='Configurazione del lettore salvata. Nessuna modifica al sito.';});\nasync function readPeriod(){\n const days=dateRange($('date').value,$('date-end').value),reports=[];\n lastData={reports:[]};render(lastData);\n for(let i=0;i<days.length;i+=7){\n  $('message').textContent='Lettura '+(i+1)+'\u2013'+Math.min(i+7,days.length)+' di '+days.length+' giornate\u2026';\n  try {const d=await api('scan',{from:days[i],to:days[Math.min(i+6,days.length-1)]});reports.push(...d.reports);}\n  catch(error){for(const day of days.slice(i))reports.push({date:day,error:'Giornata non letta: '+error.message});render({reports});throw error;}\n  render({reports});\n }\n $('message').textContent='Lettura del periodo completata.';\n}\n$('day').onclick=()=>run(readPeriod);\n$('all').onclick=()=>run(async()=>{const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Rome'});$('date').value=today;$('date-end').value=new Date(Date.parse(today+'T12:00:00Z')+13*86400000).toISOString().slice(0,10);await readPeriod();});\n$('reload').onclick=()=>run(async()=>{const days=dateRange($('date').value,$('date-end').value),d=await api('reports'),byDate=new Map(d.reports.map(r=>[r.date,r]));render({...d,reports:days.map(date=>byDate.get(date)||{date,error:'Giornata non ancora letta'})});$('message').textContent='Risultati del periodo caricati.';});\n<\/script></html>"], ['<!doctype html><html lang="it"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Lettore agenda Healthy Smile</title>\n<style>body{font:16px system-ui;max-width:1100px;margin:30px auto;padding:0 20px;color:#20252b;background:#f5f7fa}fieldset,article{background:white;border:1px solid #ccc;border-radius:8px;padding:18px;margin:16px 0}button[aria-pressed="true"]{background:#20252b;color:white}button{padding:12px;margin:8px 8px 8px 0;cursor:pointer}label{display:block;margin:10px 0}select,input{padding:8px;max-width:100%}table{border-collapse:collapse;width:100%}td,th{padding:8px;border-bottom:1px solid #ddd;text-align:left}pre{white-space:pre-wrap;overflow-wrap:anywhere}#message{font-weight:bold;white-space:pre-wrap}.warn{color:#9a3412}summary{cursor:pointer;padding:8px}.scroll{overflow:auto}</style>\n<h1>Agenda studio \xB7 v7</h1><p>Igieni sito e pagamenti dalle agende selezionate. Solo lettura.</p>\n\n<label>Token amministratore <input id="token" type="password" autocomplete="off"></label><button id="connect">Connetti</button><p id="message" role="status"></p>\n<fieldset id="config" hidden><legend>Agende</legend><p>Apertura e pause vengono lette dall\u2019agenda Palmia. Le agende Medici selezionate servono a leggere gli appuntamenti e la capienza.</p><div id="choices"></div>\n<label>Dott. Palmia: apertura e pause <select id="palmia"></select></label><label>Prenotazioni sito (facoltativo) <select id="site"></select></label>\n<button id="save">Salva configurazione lettore</button></fieldset>\n<section id="actions" hidden><nav><button id="view-slots" aria-pressed="true">Igieni sito</button><button id="view-payments" aria-pressed="false">Pagamenti</button></nav><label>Dal <input id="date" type="date"></label><label>Al <input id="date-end" type="date"></label><button id="day">Leggi periodo</button><button id="all">Leggi prossimi 14 giorni</button><button id="reload">Mostra ultima lettura</button><p id="last"></p></section><div id="reports"></div>\n<script>\nconst dateRange=', ";\nconst paymentTotal=", ";\nconst $=id=>document.getElementById(id);let token='',busy=false,view='slots',lastData={reports:[]};\nasync function api(path,body){const r=await fetch('/api/'+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,cache:'no-store'});const d=await r.json();if(!r.ok)throw Error(d.error||'Errore '+r.status);return d;}\nasync function run(fn){if(busy)return;busy=true;$('message').textContent='Lettura in corso\u2026';try{await fn();}catch(e){$('message').textContent=e.message;}finally{busy=false;}}\nfunction text(tag,value,parent){const e=document.createElement(tag);e.textContent=value;parent.append(e);return e;}\nconst hour=v=>new Date(v).toLocaleTimeString('it-IT',{timeZone:'Europe/Rome',hour:'2-digit',minute:'2-digit'});\nfunction render(d){\n lastData=d;\n $('reports').replaceChildren();\n if(view==='payments'&&d.reports.length){const total=paymentTotal(d.reports);text('h2','Totale '+(total.missing?'parziale ':'')+money(total.amount),$('reports'));text('p','Dal '+d.reports[0].date+' al '+d.reports.at(-1).date+' \xB7 Somma degli importi indicati per appuntamento.', $('reports'));if(total.review)text('p',total.review+' voci da verificare, escluse dalla somma.', $('reports'));if(total.missing)text('p',total.missing+' giornate senza dati aggiornati, escluse dalla somma.', $('reports'));}\n if(!d.reports.length)text('p','Premi Leggi periodo.',$('reports'));\n for(const r of d.reports){\n  const a=document.createElement('article');$('reports').append(a);\n  text('h2',new Date(r.date+'T12:00:00Z').toLocaleDateString('it-IT',{timeZone:'Europe/Rome',weekday:'long',day:'numeric',month:'long',year:'numeric'}),a);\n  if(view==='payments'){renderPayments(r,a);continue;}\n  if(r.error||r.issues?.length){text('p','Orari da verificare: '+(r.error||r.issues.map(i=>i.reason).join('; ')),a);continue;}\n  const windows=r.windows||[];\n  if(!windows.length){text('p','Nessun orario di apertura riconosciuto.',a);continue;}\n  text('p','Apertura '+hour(windows[0].start_dt)+' \xB7 Chiusura '+hour(windows.at(-1).end_dt),a);\n  const pauses=windows.slice(1).map((w,i)=>hour(windows[i].end_dt)+'\u2013'+hour(w.start_dt));\n  if(pauses.length)text('p','Pausa '+pauses.join(', '),a);\n  if(r.stale){text('p','Lettura da aggiornare: premi Leggi periodo.',a);continue;}\n  if(!Array.isArray(r.free_intervals)){text('p','Premi Leggi periodo per aggiornare il risultato.',a);continue;}\n  if(!r.free_intervals.length){text('p','Nessuna poltrona libera durante l\u2019apertura.',a);continue;}\n  const table=document.createElement('table');a.append(table);\n  const head=document.createElement('tr');table.append(head);text('th','Orario',head);text('th','Poltrone libere',head);\n  for(const f of r.free_intervals){const tr=document.createElement('tr');table.append(tr);text('td',hour(f.start_dt)+'\u2013'+hour(f.end_dt),tr);text('td',f.free_chairs===2?'2 libere':'1 libera',tr);}\n }\n}\nconst money=n=>Number(n).toLocaleString('it-IT',{style:'currency',currency:'EUR'});\nfunction renderPayments(r,a){\n if(r.error){text('p','Lettura non riuscita: '+r.error,a);return;}\n if(r.stale){text('p','Rileggi la giornata per aggiornare gli importi.',a);return;}\n if(!Array.isArray(r.payments)){text('p','Rileggi la giornata per caricare i pagamenti.',a);return;}\n text('p','Totale giornata: '+money(paymentTotal([r]).amount),a);\n if(!r.payments.length){text('p','Nessun importo da pagare riconosciuto.',a);return;}\n const table=document.createElement('table');a.append(table);const head=document.createElement('tr');table.append(head);\n for(const name of ['Ora','Paziente / appuntamento','Da pagare','Indicazione in agenda'])text('th',name,head);\n for(const p of r.payments){const tr=document.createElement('tr');table.append(tr);text('td',p.all_day?'Giornata':hour(p.start_dt),tr);text('td',p.appointment,tr);text('td',p.amount_due===null?'Da verificare':money(p.amount_due),tr);text('td',(p.field_text?'Deve pagare: '+p.field_text+'. ':'')+(p.title_amounts.length?'Titolo: '+p.title_amounts.map(money).join(', ')+'. ':'')+(p.reason||p.source),tr);}\n}\nfor(const [id,next] of [['view-slots','slots'],['view-payments','payments']])$(id).onclick=()=>{view=next;$('view-slots').setAttribute('aria-pressed',String(view==='slots'));$('view-payments').setAttribute('aria-pressed',String(view==='payments'));render(lastData);};\n$('connect').onclick=()=>run(async()=>{token=$('token').value;const d=await api('config');$('choices').replaceChildren();$('palmia').replaceChildren(new Option('Seleziona',''));$('site').replaceChildren(new Option('Nessuno',''));for(const c of d.calendars){const row=document.createElement('div');$('choices').append(row);const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.dataset.medical=c.id;check.checked=d.config?d.config.medical_ids.includes(c.id):/^Medici\\b/i.test(c.name);label.append(check,document.createTextNode(c.name+' ['+c.id+']'));row.append(label);$('palmia').add(new Option(c.name,c.id));$('site').add(new Option(c.name,c.id));}\nconst palmias=d.calendars.filter(c=>/\\bPalmia\\b/i.test(c.name));$('palmia').value=d.config?.palmia_id||(palmias.length===1?palmias[0].id:'');$('site').value=d.config?.site_id||'';$('config').hidden=false;$('actions').hidden=false;$('date').value=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Rome'});$('date-end').value=$('date').value;$('message').textContent='Connesso. Configura le agende e avvia una lettura.';});\n$('save').onclick=()=>run(async()=>{await api('config',{medical_ids:[...document.querySelectorAll('[data-medical]:checked')].map(x=>+x.dataset.medical),palmia_id:+$('palmia').value,site_id:+$('site').value||null});$('message').textContent='Configurazione del lettore salvata. Nessuna modifica al sito.';});\nasync function readPeriod(){\n const days=dateRange($('date').value,$('date-end').value),reports=[];\n lastData={reports:[]};render(lastData);\n for(let i=0;i<days.length;i+=7){\n  $('message').textContent='Lettura '+(i+1)+'\u2013'+Math.min(i+7,days.length)+' di '+days.length+' giornate\u2026';\n  try {const d=await api('scan',{from:days[i],to:days[Math.min(i+6,days.length-1)]});reports.push(...d.reports);}\n  catch(error){for(const day of days.slice(i))reports.push({date:day,error:'Giornata non letta: '+error.message});render({reports});throw error;}\n  render({reports});\n }\n $('message').textContent='Lettura del periodo completata.';\n}\n$('day').onclick=()=>run(readPeriod);\n$('all').onclick=()=>run(async()=>{const today=new Date().toLocaleDateString('sv-SE',{timeZone:'Europe/Rome'});$('date').value=today;$('date-end').value=new Date(Date.parse(today+'T12:00:00Z')+13*86400000).toISOString().slice(0,10);await readPeriod();});\n$('reload').onclick=()=>run(async()=>{const days=dateRange($('date').value,$('date-end').value),d=await api('reports'),byDate=new Map(d.reports.map(r=>[r.date,r]));render({...d,reports:days.map(date=>byDate.get(date)||{date,error:'Giornata non ancora letta'})});$('message').textContent='Risultati del periodo caricati.';});\n<\/script></html>"])), dateRange.toString(), paymentTotal.toString());

// teamup-work/agenda-reader/src/worker.js
var VERSION = "agenda-reader-7";
var json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" } });
function authorized(req, env) {
  const a = req.headers.get("Authorization") || "", b = "Bearer " + (env.ADMIN_TOKEN || "");
  if (!env.ADMIN_TOKEN || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
async function setup(env) {
  if (!env.DB) throw Error("Collega il database D1 con nome DB per configurazione e risultati");
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agenda_reader_config(id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, revision TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agenda_reader_reports(date TEXT PRIMARY KEY, value TEXT NOT NULL, checked_at TEXT NOT NULL, revision TEXT NOT NULL)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS agenda_reader_run(id INTEGER PRIMARY KEY CHECK(id=1), owner TEXT, until_ms INTEGER NOT NULL DEFAULT 0, attempted_at TEXT, finished_at TEXT, error TEXT)")
  ]);
}
async function config(env) {
  return env.DB.prepare("SELECT * FROM agenda_reader_config WHERE id=1").first();
}
async function scan(env, date = null, until = null) {
  await setup(env);
  const row = await config(env);
  if (!row) throw Error("Salva prima la configurazione del lettore");
  const c = validateConfig(JSON.parse(row.value)), owner = crypto.randomUUID(), ts = (/* @__PURE__ */ new Date()).toISOString();
  const lock = await env.DB.prepare(`INSERT INTO agenda_reader_run(id,owner,until_ms,attempted_at,error) VALUES(1,?,?,?,NULL)
 ON CONFLICT(id) DO UPDATE SET owner=excluded.owner,until_ms=excluded.until_ms,attempted_at=excluded.attempted_at,error=NULL WHERE agenda_reader_run.until_ms<?`).bind(owner, Date.now() + 24e4, ts, Date.now()).run();
  if (lock.meta.changes !== 1) throw Error("Lettura gi\xE0 in corso: attendi e carica i risultati");
  try {
    const days = date ? dateRange(date, until || date, 7) : rollingDates();
    const ids = [...c.medical_ids, ...c.site_id ? [c.site_id] : []], visible = await calendars(env);
    if (ids.some((id) => !visible.some((v) => v.id === id))) throw Error("Una delle agende configurate non \xE8 accessibile");
    const reports = [];
    for (const day of days) {
      let report;
      try {
        report = interpretDay(await readDay(env, day, ids), day, c);
      } catch (error) {
        report = { date: day, error: error.message, slots: [], events: [], issues: [], candidate_count: 0, mode: "read_only_review" };
      }
      const checked_at = (/* @__PURE__ */ new Date()).toISOString();
      reports.push({ ...report, checked_at });
      await env.DB.prepare(`INSERT INTO agenda_reader_reports(date,value,checked_at,revision)
    SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM agenda_reader_config WHERE id=1 AND revision=?)
    AND EXISTS(SELECT 1 FROM agenda_reader_run WHERE id=1 AND owner=?)
    ON CONFLICT(date) DO UPDATE SET value=excluded.value,checked_at=excluded.checked_at,revision=excluded.revision`).bind(day, JSON.stringify(report), checked_at, row.revision, row.revision, owner).run();
    }
    return { version: VERSION, reports };
  } catch (error) {
    await env.DB.prepare("UPDATE agenda_reader_run SET error=? WHERE id=1 AND owner=?").bind(error.message, owner).run();
    throw error;
  } finally {
    await env.DB.prepare("UPDATE agenda_reader_run SET until_ms=0,finished_at=? WHERE id=1 AND owner=?").bind((/* @__PURE__ */ new Date()).toISOString(), owner).run();
  }
}
var worker_default = {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (req.method === "GET" && u.pathname === "/") return new Response(PAGE, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Frame-Options": "DENY", "Referrer-Policy": "no-referrer" } });
    if (req.method === "GET" && u.pathname === "/api/health") return json({ version: VERSION, mode: "read_only", database_configured: !!env.DB });
    if (!authorized(req, env)) return json({ error: "Non autorizzato" }, 401);
    try {
      await setup(env);
      if (req.method === "GET" && u.pathname === "/api/config") {
        const saved = await config(env);
        return json({ config: saved ? JSON.parse(saved.value) : null, calendars: await calendars(env), version: VERSION });
      }
      if (req.method === "POST" && u.pathname === "/api/config") {
        const c = validateConfig(await req.json()), visible = await calendars(env);
        if ([...c.medical_ids, ...c.site_id ? [c.site_id] : []].some((id) => !visible.some((v) => v.id === id))) throw Error("Agenda non accessibile");
        await env.DB.prepare("INSERT INTO agenda_reader_config(id,value,revision) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value,revision=excluded.revision").bind(JSON.stringify(c), crypto.randomUUID()).run();
        return json({ saved: true });
      }
      if (req.method === "POST" && u.pathname === "/api/scan") {
        const body = await req.json();
        return json(await scan(env, body.from || body.date || null, body.to || null));
      }
      if (req.method === "GET" && u.pathname === "/api/reports") {
        const c = await config(env);
        const { results } = await env.DB.prepare("SELECT * FROM agenda_reader_reports ORDER BY date").all();
        const run = await env.DB.prepare("SELECT attempted_at,finished_at,error,until_ms FROM agenda_reader_run WHERE id=1").first();
        return json({ version: VERSION, run, reports: results.map((r) => ({ ...JSON.parse(r.value), checked_at: r.checked_at, stale: !!run?.error || r.revision !== c?.revision || Date.now() - Date.parse(r.checked_at) > 10 * 6e4 })) });
      }
      return json({ error: "Endpoint non trovato" }, 404);
    } catch (error) {
      return json({ error: error.message }, 400);
    }
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(scan(env).catch(() => {
      console.error("agenda-reader: ciclo fallito; controllare configurazione e stato lettura");
    }));
  }
};
export {
  worker_default as default
};
