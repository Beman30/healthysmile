var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// teamup-work/backend/src/teamup.js
var ZONE = "Europe/Rome";
var MINUTE = 6e4;
var formatter = new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function localParts(ms) {
  const p = Object.fromEntries(formatter.formatToParts(ms).map((p2) => [p2.type, p2.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
__name(localParts, "localParts");
function romeTime(date, time) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time || "")) throw new Error("Data o orario non validi");
  const wanted = `${date}T${time}`;
  const utc = Date.parse(wanted + ":00Z");
  const matches = [utc - 60 * MINUTE, utc - 120 * MINUTE].filter((t) => Number.isFinite(t) && localParts(t) === wanted);
  if (matches.length !== 1) throw new Error("Data o orario inesistente o ambiguo");
  return matches[0];
}
__name(romeTime, "romeTime");
function timestamp(value) {
  const t = typeof value === "number" ? value * 1e3 : typeof value === "string" && /(?:Z|[+-]\d{2}:?\d{2})$/.test(value) ? Date.parse(value) : NaN;
  if (!Number.isFinite(t)) throw new Error("Teamup ha restituito un orario non valido");
  return t;
}
__name(timestamp, "timestamp");
function preview(events, input) {
  const start = romeTime(input.date, input.start), end = romeTime(input.date, input.end);
  if (end - start < 60 * MINUTE) throw new Error("La finestra deve durare almeno un\u2019ora");
  const ids = input.subcalendar_ids;
  if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((x) => !Number.isSafeInteger(x) || x <= 0)) throw new Error("Seleziona le agende Medici");
  if (input.window_confirmed !== true) throw new Error("Conferma apertura e presenza degli operatori nella finestra scelta");
  if (!Array.isArray(events)) throw new Error("Risposta Teamup incompleta");
  const unique = /* @__PURE__ */ new Map();
  let review = false;
  for (const e of events) {
    if (!e || !Array.isArray(e.subcalendar_ids)) throw new Error("Evento Teamup incompleto");
    if (!e.subcalendar_ids.some((id) => ids.includes(id)) || e.delete_dt) continue;
    if (!e.id) throw new Error("Evento Teamup senza identificativo");
    if (e.all_day) {
      review = true;
      continue;
    }
    const a = timestamp(e.start_dt), b = timestamp(e.end_dt);
    if (b <= a) throw new Error("Durata evento Teamup non valida");
    const text = `${e.title || ""} ${e.notes || e.note || ""}`.replace(/<[^>]*>/g, " ");
    const block = /\b(?:pausa|stop)\b/i.test(text);
    if (/\b(?:apertura|chiusura|apriamo|chiudiamo|apre|chiude|aprire|chiudere)\b/i.test(text)) review = true;
    const item = { a, b, block };
    const prev = unique.get(String(e.id));
    if (prev && JSON.stringify(prev) !== JSON.stringify(item)) throw new Error("Evento duplicato con dati discordanti");
    unique.set(String(e.id), item);
  }
  const intervals = [...unique.values()];
  const slots = [];
  for (let t = start; t + 60 * MINUTE <= end; t += 15 * MINUTE) {
    const finish = t + 60 * MINUTE;
    const relevant = intervals.filter((e) => e.a < finish && e.b > t);
    const points = [.../* @__PURE__ */ new Set([t, ...relevant.flatMap((e) => [Math.max(t, e.a), Math.min(finish, e.b)])])].filter((p) => p < finish);
    const peak = Math.max(0, ...points.map((p) => relevant.filter((e) => !e.block && e.a <= p && e.b > p).length));
    const blocked = relevant.some((e) => e.block);
    slots.push({
      time: localParts(t).slice(11),
      end_time: localParts(finish).slice(11),
      existing_chairs_peak: peak,
      status: review ? "review" : blocked ? "blocked" : peak >= 2 ? "full" : "candidate"
    });
  }
  return {
    date: input.date,
    time_zone: ZONE,
    duration_minutes: 60,
    mode: "preview_only",
    slots,
    warnings: review ? ["Note organizzative o eventi giornalieri: verificare gli orari in Teamup. Nessuno slot approvato."] : [],
    notice: "Solo capienza Teamup nelle agende selezionate. Verificare note, personale e prenotazioni del sito. Gli orari proposti sono alternativi, non prenotazioni confermate."
  };
}
__name(preview, "preview");
var TeamupReadError = class extends Error {
  static {
    __name(this, "TeamupReadError");
  }
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
__name(read, "read");
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
__name(calendars, "calendars");
async function teamupPreview(env, input, fetcher = fetch) {
  preview([], input);
  const available = await calendars(env, fetcher);
  if (input.subcalendar_ids.some((id) => !available.some((c) => c.id === id))) throw new Error("Una delle agende selezionate non \xE8 accessibile");
  const params = new URLSearchParams({ startDate: input.date, endDate: input.date, tz: ZONE, format: "markdown" });
  input.subcalendar_ids.forEach((id) => params.append("subcalendarId[]", String(id)));
  const data = await read(env, "events", params, fetcher);
  return preview(data.events, input);
}
__name(teamupPreview, "teamupPreview");
async function readDay(env, date, ids, fetcher = fetch) {
  romeTime(date, "12:00");
  const params = new URLSearchParams({ startDate: date, endDate: date, tz: ZONE, format: "markdown" });
  ids.forEach((id) => params.append("subcalendarId[]", String(id)));
  const data = await read(env, "events", params, fetcher);
  if (!Array.isArray(data.events)) throw new Error("Risposta Teamup incompleta");
  return data.events;
}
__name(readDay, "readDay");

// teamup-work/backend/src/teamup-write.js
var WRITE_SCHEMA = `CREATE TABLE IF NOT EXISTS teamup_owned_events (
 booking_id TEXT PRIMARY KEY, event_id TEXT UNIQUE, remote_id TEXT NOT NULL UNIQUE,
 calendar_id INTEGER NOT NULL, key_hash TEXT NOT NULL, version TEXT,
 state TEXT NOT NULL, busy INTEGER NOT NULL DEFAULT 0, updated_at TEXT NOT NULL)`;
var now = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
async function digest(s) {
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s)))].map((x) => x.toString(16).padStart(2, "0")).join("");
}
__name(digest, "digest");
function key(env) {
  const k = String(env.TEAMUP_CALENDAR_KEY || "").trim();
  if (!/^ks[a-zA-Z0-9]+$/.test(k)) throw Error("Collegamento Teamup non configurato");
  return k;
}
__name(key, "key");
async function request(env, method, path, body, version, fetcher = fetch) {
  const token2 = String(env.TEAMUP_API_KEY || "").trim();
  if (!token2 || /\s/.test(token2)) throw Error("Chiave API Teamup non valida");
  const params = new URLSearchParams({ inputFormat: "markdown", format: "markdown" });
  if (version) params.set("version", version);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 1e4);
  try {
    const r = await fetcher(`https://api.teamup.com/${key(env)}/${path}?${params}`, {
      method,
      redirect: "manual",
      signal: controller.signal,
      headers: { "Teamup-Token": token2, Accept: "application/json", "Content-Type": "application/json" },
      ...body ? { body: JSON.stringify(body) } : {}
    });
    if (!r.ok) throw Error(`Scrittura Teamup HTTP ${r.status}: nessuna modifica confermata. Verificare permessi o modifiche in agenda.`);
    return await r.json();
  } catch (e) {
    if (/^Scrittura Teamup HTTP/.test(e.message)) throw e;
    throw Error("Esito Teamup non verificabile: controllare l\u2019agenda prima di riprovare.");
  } finally {
    clearTimeout(timer);
  }
}
__name(request, "request");
async function owned(db, id) {
  if (!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teamup_owned_events'").first()) return null;
  return db.prepare("SELECT * FROM teamup_owned_events WHERE booking_id=?").bind(id).first();
}
__name(owned, "owned");
async function validateWriteAccess(env, calendarId, fetcher = fetch) {
  const d = await request(env, "GET", "configuration", null, null, fetcher);
  const c = d.configuration?.subcalendars?.find((c2) => c2.id === calendarId);
  if (!c || c.readonly !== false) throw Error("Il calendario del sito deve essere accessibile con il permesso Modify from same link.");
}
__name(validateWriteAccess, "validateWriteAccess");
function identity(e, row) {
  return e && /^\d+$/.test(String(e.id)) && (!row.event_id || String(e.id) === row.event_id) && e.remote_id === row.remote_id && Array.isArray(e.subcalendar_ids) && e.subcalendar_ids.length === 1 && e.subcalendar_ids[0] === row.calendar_id && !e.rrule && !e.series_id && !e.all_day && !e.delete_dt && typeof e.version === "string" && e.version.length > 0;
}
__name(identity, "identity");
async function current(env, row, fetcher) {
  if (!row.event_id || row.key_hash !== await digest(key(env))) throw Error("Evento non associato a questo collegamento del sito");
  const { event } = await request(env, "GET", "events/" + row.event_id, null, null, fetcher);
  if (!identity(event, row) || event.version !== row.version || event.readonly) throw Error("Evento modificato fuori dal sito o non pi\xF9 verificabile: intervento dello studio necessario.");
  return event;
}
__name(current, "current");
async function omitOwnEvent(db, bookingId, events) {
  if (bookingId === "-none-") return events;
  const row = await owned(db, bookingId);
  if (!row) return events;
  if (!row.event_id || !["held", "confirmed", "review"].includes(row.state)) throw Error("Sincronizzazione Teamup da verificare");
  const e = events.find((e2) => String(e2.id) === row.event_id);
  if (!e || !identity(e, row) || e.version !== row.version) throw Error("Appuntamento Teamup cambiato: verifica necessaria");
  return events.filter((e2) => String(e2.id) !== row.event_id);
}
__name(omitOwnEvent, "omitOwnEvent");
async function createOwnedHold(env, b, config, fetcher = fetch) {
  if (!config?.write_enabled) return false;
  if (await owned(env.DB, b.booking_id)) throw Error("Inserimento Teamup gi\xE0 tentato: non viene duplicato");
  const marker = "hs-site-" + crypto.randomUUID();
  const row = { booking_id: b.booking_id, remote_id: marker, calendar_id: config.write_calendar_id, key_hash: await digest(key(env)) };
  await env.DB.prepare(`INSERT INTO teamup_owned_events(booking_id,remote_id,calendar_id,key_hash,state,busy,updated_at)
  VALUES(?,?,?,?,'creating',1,?)`).bind(row.booking_id, marker, row.calendar_id, row.key_hash, now()).run();
  const date = b.date || b.appointment_date, time = b.time || b.appointment_time, start = romeTime(date, time);
  const payload = {
    subcalendar_ids: [row.calendar_id],
    remote_id: marker,
    title: "Sito \xB7 in attesa di pagamento \xB7 " + b.booking_id.slice(0, 8),
    start_dt: new Date(start).toISOString(),
    end_dt: new Date(start + 36e5).toISOString(),
    all_day: false,
    notes: "Prenotazione sito " + b.booking_id,
    signup_enabled: false,
    comments_enabled: false,
    attachments: []
  };
  try {
    const { event } = await request(env, "POST", "events", payload, null, fetcher);
    if (!identity(event, row) || Date.parse(event.start_dt) !== start || Date.parse(event.end_dt) !== start + 36e5) throw Error("Risposta alla creazione Teamup non verificabile");
    await env.DB.prepare("UPDATE teamup_owned_events SET event_id=?,version=?,state='held',busy=0,updated_at=? WHERE booking_id=?").bind(String(event.id), event.version, now(), b.booking_id).run();
    return true;
  } catch (e) {
    await env.DB.prepare("UPDATE teamup_owned_events SET state='uncertain',busy=0,updated_at=? WHERE booking_id=?").bind(now(), b.booking_id).run();
    throw e;
  }
}
__name(createOwnedHold, "createOwnedHold");
async function syncOwnedEvent(env, b, action, fetcher = fetch) {
  let row = await owned(env.DB, b.booking_id);
  if (!row) return false;
  if (!["confirm", "delete"].includes(action)) throw Error("Operazione Teamup non consentita");
  if (action === "delete" && row.state === "deleted") return true;
  if (!["held", "confirmed", "review"].includes(row.state)) throw Error("Evento Teamup da verificare: nessuna modifica automatica consentita");
  const lock = await env.DB.prepare("UPDATE teamup_owned_events SET busy=1 WHERE booking_id=? AND busy=0").bind(b.booking_id).run();
  if (lock.meta.changes !== 1) {
    const error = Error("Aggiornamento Teamup gi\xE0 in corso");
    error.code = "TEAMUP_BUSY";
    throw error;
  }
  try {
    row = await owned(env.DB, b.booking_id);
    const event = await current(env, row, fetcher);
    if (action === "confirm" && row.state === "confirmed") return true;
    if (action === "delete") {
      await request(env, "DELETE", "events/" + row.event_id, null, event.version, fetcher);
      await env.DB.prepare("UPDATE teamup_owned_events SET state='deleted',updated_at=? WHERE booking_id=?").bind(now(), b.booking_id).run();
    } else {
      const payload = {
        id: row.event_id,
        version: event.version,
        subcalendar_ids: [row.calendar_id],
        remote_id: row.remote_id,
        start_dt: event.start_dt,
        end_dt: event.end_dt,
        all_day: false,
        signup_enabled: event.signup_enabled,
        comments_enabled: event.comments_enabled,
        attachments: event.attachments,
        title: `Sito \xB7 ${b.last_name} ${b.first_name} \xB7 Visita + Igiene`,
        notes: `Prenotazione sito ${b.booking_id}
Telefono: ${b.phone}
Acconto ricevuto.`,
        location: event.location,
        who: event.who,
        custom: event.custom
      };
      const { event: updated } = await request(env, "PUT", "events/" + row.event_id, payload, null, fetcher);
      if (!identity(updated, row)) throw Error("Aggiornamento Teamup non verificabile");
      await env.DB.prepare("UPDATE teamup_owned_events SET version=?,state='confirmed',updated_at=? WHERE booking_id=?").bind(updated.version, now(), b.booking_id).run();
    }
    return true;
  } catch (error) {
    await env.DB.prepare("UPDATE teamup_owned_events SET state='review',updated_at=? WHERE booking_id=? AND state<>'deleted'").bind(now(), b.booking_id).run();
    throw error;
  } finally {
    await env.DB.prepare("UPDATE teamup_owned_events SET busy=0 WHERE booking_id=?").bind(b.booking_id).run();
  }
}
__name(syncOwnedEvent, "syncOwnedEvent");
async function cleanupOwnedEvents(env) {
  if (!await env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teamup_owned_events'").first()) return;
  const { results } = await env.DB.prepare(`SELECT e.booking_id FROM teamup_owned_events e LEFT JOIN bookings b ON b.booking_id=e.booking_id
  WHERE e.state IN ('held','confirmed','review') AND e.busy=0 AND (b.booking_status='cancelled' OR b.booking_id IS NULL) LIMIT 10`).all();
  for (const b of results || []) {
    try {
      await syncOwnedEvent(env, b, "delete");
    } catch {
    }
  }
}
__name(cleanupOwnedEvents, "cleanupOwnedEvents");

// teamup-work/backend/src/availability.js
var TEAMUP_SERVICE = "igiene-sonicare";
var stamp = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "stamp");
var ACTIVE = "('held','booked','review')";
var overlap = /* @__PURE__ */ __name((alias, date = "NEW.date", start = "NEW.time", end = "NEW.end_time") => `${alias}.date=${date} AND ${alias}.time<${end} AND strftime('%H:%M',${alias}.time,'+60 minutes')>${start}`, "overlap");
async function installed(db) {
  return !!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teamup_settings'").first();
}
__name(installed, "installed");
async function settings(db) {
  if (!await installed(db)) return null;
  const row = await db.prepare("SELECT value, revision FROM teamup_settings WHERE id=1").first();
  return row ? { ...JSON.parse(row.value), revision: row.revision } : null;
}
__name(settings, "settings");
async function reservation(db, id) {
  if (!await installed(db)) return null;
  return db.prepare("SELECT * FROM teamup_reservations WHERE booking_id=?").bind(id).first();
}
__name(reservation, "reservation");
async function install(db) {
  const commands = [
    WRITE_SCHEMA,
    "CREATE TABLE IF NOT EXISTS teamup_settings (id INTEGER PRIMARY KEY CHECK(id=1), value TEXT NOT NULL, revision INTEGER NOT NULL)",
    `CREATE TABLE IF NOT EXISTS teamup_reservations (
      booking_id TEXT PRIMARY KEY, date TEXT NOT NULL, time TEXT NOT NULL, end_time TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('held','booked','review','released')),
      checkout_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    "CREATE INDEX IF NOT EXISTS teamup_reservations_date ON teamup_reservations(date,status)",
    `CREATE TRIGGER IF NOT EXISTS teamup_claim_conflict BEFORE INSERT ON teamup_reservations
     WHEN NEW.status IN ${ACTIVE} BEGIN
       SELECT RAISE(ABORT,'TEAMUP_SLOT_CONFLICT') WHERE EXISTS (
         SELECT 1 FROM teamup_reservations r WHERE r.status IN ${ACTIVE} AND r.date=NEW.date
         AND r.time<NEW.end_time AND r.end_time>NEW.time AND r.booking_id<>NEW.booking_id);
       SELECT RAISE(ABORT,'TEAMUP_SLOT_CONFLICT') WHERE EXISTS (
         SELECT 1 FROM slots s WHERE s.status IN ('held','booked','blocked') AND ${overlap("s")}
         AND COALESCE(s.booking_id,'')<>NEW.booking_id);
       SELECT RAISE(ABORT,'TEAMUP_SLOT_CONFLICT') WHERE EXISTS (
         SELECT 1 FROM bookings b WHERE b.appointment_date=NEW.date AND b.appointment_time<NEW.end_time
         AND strftime('%H:%M',b.appointment_time,'+60 minutes')>NEW.time AND b.booking_id<>NEW.booking_id
         AND b.booking_status NOT IN ('cancelled','no_show','completed'));
     END`,
    ...["INSERT", "UPDATE"].map((action) => `CREATE TRIGGER IF NOT EXISTS teamup_slots_${action.toLowerCase()}
      BEFORE ${action} ON slots WHEN NEW.status IN ('held','booked') BEGIN
      SELECT RAISE(ABORT,'TEAMUP_SLOT_CONFLICT') WHERE EXISTS (
        SELECT 1 FROM teamup_reservations r WHERE r.status IN ${ACTIVE} AND r.date=NEW.date
        AND r.time<strftime('%H:%M',NEW.time,'+60 minutes') AND r.end_time>NEW.time
        AND r.booking_id<>COALESCE(NEW.booking_id,'')); END`),
    ...["INSERT", "UPDATE"].map((action) => `CREATE TRIGGER IF NOT EXISTS teamup_bookings_${action.toLowerCase()}
      BEFORE ${action} ON bookings WHEN NEW.booking_status NOT IN ('cancelled','no_show','completed','needs_review') BEGIN
      SELECT RAISE(ABORT,'TEAMUP_SLOT_CONFLICT') WHERE EXISTS (
        SELECT 1 FROM teamup_reservations r WHERE r.status IN ${ACTIVE} AND r.date=NEW.appointment_date
        AND r.time<strftime('%H:%M',NEW.appointment_time,'+60 minutes') AND r.end_time>NEW.appointment_time
        AND r.booking_id<>NEW.booking_id); END`),
    `CREATE TRIGGER IF NOT EXISTS teamup_cancel AFTER UPDATE OF booking_status ON bookings
     WHEN NEW.booking_status IN ('cancelled','no_show','completed') BEGIN
       UPDATE teamup_reservations SET status='released',updated_at=NEW.updated_at WHERE booking_id=NEW.booking_id;
     END`,
    `CREATE TRIGGER IF NOT EXISTS teamup_delete AFTER DELETE ON bookings BEGIN
       UPDATE teamup_reservations SET status='released' WHERE booking_id=OLD.booking_id;
     END`
  ];
  await db.batch(commands.map((sql) => db.prepare(sql)));
}
__name(install, "install");
function validateSettings(body, currentTime = Date.now()) {
  if (typeof body.enabled !== "boolean" || !Number.isSafeInteger(body.revision) || body.revision < 0) throw new Error("Configurazione non valida");
  const ids = [...new Set(body.subcalendar_ids || [])].sort((a, b) => a - b);
  if (!Array.isArray(body.subcalendar_ids) || !ids.length || ids.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Seleziona tutte le agende Medici");
  if (!Array.isArray(body.windows) || body.windows.length > 40 || body.enabled && !body.windows.length) throw new Error("Aggiungi le fasce da aprire (massimo 40)");
  const windows = body.windows.map((w) => {
    preview([], { ...w, subcalendar_ids: ids });
    if (body.enabled && (romeTime(w.date, w.end) <= currentTime || romeTime(w.date, w.start) > currentTime + 60 * 864e5)) throw new Error("Scegli date future entro 60 giorni");
    return { date: w.date, start: w.start, end: w.end, window_confirmed: true };
  }).sort((a, b) => (a.date + a.start).localeCompare(b.date + b.start));
  if (new Set(windows.map((w) => w.date)).size > 14) throw new Error("Pubblica al massimo 14 giornate per volta");
  for (let i = 1; i < windows.length; i++) if (windows[i].date === windows[i - 1].date && windows[i].start < windows[i - 1].end) throw new Error("Le fasce della stessa giornata non devono sovrapporsi");
  const write_enabled = body.write_enabled === true;
  const write_calendar_id = Number(body.write_calendar_id) || null;
  if (write_enabled && (!Number.isSafeInteger(write_calendar_id) || write_calendar_id <= 0)) throw new Error("Seleziona il calendario Prenotazioni sito");
  return { enabled: body.enabled, subcalendar_ids: ids, windows, write_enabled, write_calendar_id };
}
__name(validateSettings, "validateSettings");
async function accessible(env, ids, fetcher) {
  const visible = await calendars(env, fetcher);
  if (ids.some((id) => !visible.some((c) => c.id === id))) throw new Error("Una delle agende Medici non \xE8 pi\xF9 accessibile");
}
__name(accessible, "accessible");
async function saveSettings(env, body, fetcher = fetch) {
  const config = validateSettings(body);
  if (config.enabled) await accessible(env, [...config.subcalendar_ids, ...config.write_calendar_id ? [config.write_calendar_id] : []], fetcher);
  if (config.write_enabled) await validateWriteAccess(env, config.write_calendar_id, fetcher);
  await install(env.DB);
  const active = await env.DB.prepare("SELECT calendar_id FROM teamup_owned_events WHERE state<>'deleted' LIMIT 1").first();
  if (active && active.calendar_id !== config.write_calendar_id) throw new Error("Mantieni il calendario del sito: contiene eventi ancora gestiti dal collegamento.");
  const sql = body.revision === 0 ? "INSERT OR IGNORE INTO teamup_settings(id,value,revision) VALUES(1,?,1)" : "UPDATE teamup_settings SET value=?,revision=revision+1 WHERE id=1 AND revision=?";
  const args = body.revision === 0 ? [JSON.stringify(config)] : [JSON.stringify(config), body.revision];
  const r = await env.DB.prepare(sql).bind(...args).run();
  if (r.meta.changes !== 1) throw new Error("Configurazione cambiata in un\u2019altra finestra. Ricarica prima di salvare.");
  return { ...config, revision: body.revision + 1 };
}
__name(saveSettings, "saveSettings");
async function siteBusy(db, date, ignoreId = "-none-") {
  const { results } = await db.prepare(`
    SELECT time,end_time FROM teamup_reservations WHERE date=? AND status IN ${ACTIVE} AND booking_id<>?
    UNION ALL SELECT time,strftime('%H:%M',time,'+60 minutes') FROM slots
      WHERE date=? AND status IN ('held','booked','blocked') AND COALESCE(booking_id,'')<>?
    UNION ALL SELECT appointment_time,strftime('%H:%M',appointment_time,'+60 minutes') FROM bookings
      WHERE appointment_date=? AND booking_status NOT IN ('cancelled','no_show','completed') AND booking_id<>?
  `).bind(date, ignoreId, date, ignoreId, date, ignoreId).all();
  return results || [];
}
__name(siteBusy, "siteBusy");
async function liveSlots(env, date = null, ignoreId = "-none-", fetcher = fetch, clock = Date.now()) {
  const config = await settings(env.DB);
  if (!config) return null;
  if (!config.enabled) return [];
  if (date) romeTime(date, "12:00");
  const windows = config.windows.filter((w) => (!date || w.date === date) && romeTime(w.date, w.end) > clock);
  if (!windows.length) return [];
  const calendarIds = [.../* @__PURE__ */ new Set([...config.subcalendar_ids, ...config.write_calendar_id ? [config.write_calendar_id] : []])];
  await accessible(env, calendarIds, fetcher);
  const dates = [...new Set(windows.map((w) => w.date))];
  const slots = [];
  for (const day of dates) {
    const events = await omitOwnEvent(env.DB, ignoreId, await readDay(env, day, calendarIds, fetcher));
    const busy = await siteBusy(env.DB, day, ignoreId);
    for (const w of windows.filter((w2) => w2.date === day)) {
      const result = preview(events, { ...w, subcalendar_ids: calendarIds });
      for (const s of result.slots) if (s.status === "candidate" && romeTime(day, s.time) > clock && !busy.some((b) => b.time < s.end_time && b.end_time > s.time)) slots.push({ date: day, time: s.time });
    }
  }
  return slots;
}
__name(liveSlots, "liveSlots");
async function claimSlot(env, service, date, time, id) {
  if (service !== TEAMUP_SERVICE) return null;
  const config = await settings(env.DB);
  if (!config) return null;
  const slots = await liveSlots(env, date);
  if (slots === null) return null;
  if (!slots.some((s) => s.time === time)) throw new Error("Questo orario non \xE8 pi\xF9 disponibile. Scegline un altro.");
  const end = new Date(romeTime(date, time) + 36e5).toLocaleTimeString("it-IT", { timeZone: "Europe/Rome", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  const t = stamp();
  try {
    const result = await env.DB.batch([
      env.DB.prepare(`INSERT INTO teamup_reservations(booking_id,date,time,end_time,status,created_at,updated_at)
        SELECT ?,?,?,?,'held',?,? WHERE EXISTS(SELECT 1 FROM teamup_settings WHERE id=1 AND revision=?)`).bind(id, date, time, end, t, t, config.revision),
      env.DB.prepare(`INSERT INTO slots(service_id,date,time,status,booking_id,held_until,updated_at)
        SELECT ?,?,?,'held',?,'9999-12-31T23:59:59.000Z',? WHERE EXISTS(SELECT 1 FROM teamup_reservations WHERE booking_id=?)
        ON CONFLICT(service_id,date,time) DO UPDATE SET status='held',booking_id=excluded.booking_id,
          held_until=excluded.held_until,updated_at=excluded.updated_at`).bind(service, date, time, id, t, id)
    ]);
    if (result[0].meta.changes !== 1) throw new Error("Disponibilit\xE0 modificate. Aggiorna gli orari.");
  } catch (error) {
    if (String(error.message).includes("TEAMUP_SLOT_CONFLICT")) throw new Error("Questo orario \xE8 appena stato prenotato. Scegline un altro.");
    throw error;
  }
  return true;
}
__name(claimSlot, "claimSlot");
async function rememberCheckout(db, id, checkoutId) {
  if (!await installed(db)) return;
  await db.prepare("UPDATE teamup_reservations SET checkout_id=?,updated_at=? WHERE booking_id=?").bind(checkoutId, stamp(), id).run();
}
__name(rememberCheckout, "rememberCheckout");
async function settlePayment(env, booking, amount, paymentId) {
  const r = await reservation(env.DB, booking.booking_id);
  if (!r) return void 0;
  let confirmed = false;
  if (r.status === "held") {
    try {
      const slots = await liveSlots(env, r.date, r.booking_id);
      confirmed = !!slots?.some((s) => s.time === r.time);
      if (confirmed) await syncOwnedEvent(env, booking, "confirm");
    } catch (error) {
      if (error.code === "TEAMUP_BUSY") throw error;
      confirmed = false;
    }
  }
  const status = confirmed ? "confirmed" : "needs_review";
  const balance = Math.round((booking.total_price - amount) * 100) / 100;
  const t = stamp();
  const results = await env.DB.batch([
    env.DB.prepare(`UPDATE bookings SET amount_paid=?,balance_due=?,payment_status='paid',booking_status=CASE WHEN ?='confirmed' AND EXISTS(SELECT 1 FROM teamup_reservations r WHERE r.booking_id=bookings.booking_id AND r.status='held') THEN 'confirmed' ELSE 'needs_review' END,
      payment_id=COALESCE(?,payment_id),updated_at=? WHERE booking_id=? AND payment_status<>'paid'`).bind(amount, balance, status, paymentId || null, t, booking.booking_id),
    env.DB.prepare(`UPDATE teamup_reservations SET status=CASE WHEN status='released' THEN 'released'
      WHEN (SELECT booking_status FROM bookings WHERE booking_id=?)='confirmed' THEN 'booked' ELSE 'review' END,
      updated_at=? WHERE booking_id=?`).bind(booking.booking_id, t, booking.booking_id),
    env.DB.prepare("UPDATE slots SET status='booked',held_until=NULL,updated_at=? WHERE booking_id=?").bind(t, booking.booking_id)
  ]);
  if (results[0].meta.changes !== 1) return null;
  return env.DB.prepare("SELECT * FROM bookings WHERE booking_id=?").bind(booking.booking_id).first();
}
__name(settlePayment, "settlePayment");

// teamup-work/backend/src/services.js
var SERVICES = {
  "igiene-sonicare": {
    name: "Visita + Igiene + Spazzolino elettrico",
    totalPrice: 98,
    paymentMode: "fixed",
    amountDueNow: 15,
    balanceDueLater: 83,
    requiresAppointment: true,
    // dichiarato a Google Ads per l'ottimizzazione sull'acquisizione:
    // vale solo per le offerte davvero riservate a chi non e' gia' paziente
    newPatientsOnly: true,
    termsVersion: "prenotazione-2026-09",
    terms: "I 15 \u20AC vengono scalati dal prezzo totale. Se annulli o sposti l'appuntamento con almeno 24 ore di preavviso, la quota pu\xF2 essere rimborsata o utilizzata per una nuova prenotazione. In caso di cancellazione nelle 24 ore precedenti o mancata presentazione, i 15 \u20AC vengono trattenuti."
  },
  "allineatori-visita": {
    name: "Visita per allineatori + teleradiografia",
    totalPrice: 15,
    paymentMode: "full",
    amountDueNow: 15,
    balanceDueLater: 0,
    requiresAppointment: true,
    termsVersion: "allineatori-2026-09",
    terms: "I 15 \u20AC comprendono la visita e la teleradiografia, eseguita presso CDC. Se annulli o sposti l\u2019appuntamento con almeno 48 ore di preavviso la quota ti viene rimborsata, oppure resta valida per una nuova prenotazione. In caso di cancellazione nelle 48 ore precedenti o mancata presentazione, la quota viene trattenuta."
  },
  sbiancamento: {
    name: "Sbiancamento",
    totalPrice: 188,
    paymentMode: "full",
    amountDueNow: 188,
    balanceDueLater: 0,
    requiresAppointment: false,
    termsVersion: null,
    terms: null
  }
};
function getService(id) {
  if (!id || !Object.prototype.hasOwnProperty.call(SERVICES, id)) return null;
  return SERVICES[id];
}
__name(getService, "getService");
function resolveAmounts(service, requestedAmount) {
  const total = service.totalPrice;
  if (service.paymentMode === "full") {
    return { totalPrice: total, amountDueNow: total, balanceDueLater: 0 };
  }
  if (service.paymentMode === "fixed") {
    return {
      totalPrice: total,
      amountDueNow: service.amountDueNow,
      balanceDueLater: service.balanceDueLater
    };
  }
  if (service.paymentMode === "custom") {
    const min = service.minimumAmount ?? 1;
    const max = service.maximumAmount ?? total;
    const n = Number(requestedAmount);
    if (!Number.isFinite(n)) throw new Error("Importo non valido");
    const amount = Math.round(n * 100) / 100;
    if (amount < min || amount > max) {
      throw new Error(`L'importo deve essere compreso fra ${min} \u20AC e ${max} \u20AC`);
    }
    return {
      totalPrice: total,
      amountDueNow: amount,
      balanceDueLater: Math.round((total - amount) * 100) / 100
    };
  }
  throw new Error("Modalita di pagamento non riconosciuta");
}
__name(resolveAmounts, "resolveAmounts");
function publicService(id, service) {
  return {
    service_id: id,
    name: service.name,
    total_price: service.totalPrice,
    payment_mode: service.paymentMode,
    amount_due_now: service.paymentMode === "custom" ? null : service.amountDueNow,
    balance_due_later: service.paymentMode === "custom" ? null : service.balanceDueLater,
    requires_appointment: service.requiresAppointment,
    minimum_amount: service.minimumAmount ?? null,
    maximum_amount: service.maximumAmount ?? null,
    terms: service.terms,
    terms_version: service.termsVersion
  };
}
__name(publicService, "publicService");

// teamup-work/backend/src/stripe.js
var API = "https://api.stripe.com/v1";
function form(obj, prefix = "", out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(obj)) {
    if (v === void 0 || v === null) continue;
    const key2 = prefix ? `${prefix}[${k}]` : k;
    if (typeof v === "object" && !Array.isArray(v)) form(v, key2, out);
    else if (Array.isArray(v)) v.forEach((item, i) => {
      if (typeof item === "object") form(item, `${key2}[${i}]`, out);
      else out.append(`${key2}[${i}]`, String(item));
    });
    else out.append(key2, String(v));
  }
  return out;
}
__name(form, "form");
async function createCheckoutSession(env, { booking, service, amounts, successUrl, cancelUrl }) {
  const chi = `${booking.last_name || ""} ${booking.first_name || ""}`.trim();
  const quando = booking.date && booking.time ? `${booking.date.slice(8, 10)}/${booking.date.slice(5, 7)} ore ${booking.time}` : null;
  const descrizione = [chi || null, quando, booking.phone || null].filter(Boolean).join(" \xB7 ") || service.name;
  const body = form({
    mode: "payment",
    ...booking.teamup_managed ? { expires_at: Math.floor(Date.now() / 1e3) + 35 * 60 } : {},
    // Stripe ragiona in centesimi interi
    "line_items[0][price_data][currency]": "eur",
    "line_items[0][price_data][unit_amount]": Math.round(amounts.amountDueNow * 100),
    "line_items[0][price_data][product_data][name]": service.name,
    "line_items[0][price_data][product_data][description]": amounts.balanceDueLater > 0 ? `Acconto. Saldo di ${amounts.balanceDueLater} \u20AC da pagare in studio.` : "Pagamento completo.",
    "line_items[0][quantity]": 1,
    success_url: `${successUrl}?booking=${booking.booking_id}`,
    cancel_url: cancelUrl,
    customer_email: booking.email,
    client_reference_id: booking.booking_id,
    // metadati sulla sessione
    "metadata[booking_id]": booking.booking_id,
    "metadata[service_id]": booking.service_id,
    "metadata[paziente]": chi || null,
    "metadata[telefono]": booking.phone || null,
    "metadata[data]": booking.date || null,
    "metadata[ora]": booking.time || null,
    // e sul pagamento: e' la scheda che si apre cliccando l'incasso
    "payment_intent_data[description]": descrizione,
    "payment_intent_data[metadata][booking_id]": booking.booking_id,
    "payment_intent_data[metadata][paziente]": chi || null,
    "payment_intent_data[metadata][telefono]": booking.phone || null,
    "payment_intent_data[metadata][appuntamento]": quando || null,
    "payment_intent_data[metadata][servizio]": service.name,
    "payment_intent_data[metadata][saldo_in_studio]": amounts.balanceDueLater > 0 ? `${amounts.balanceDueLater} EUR` : null,
    locale: "it"
  });
  const res = await fetch(`${API}/checkout/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.STRIPE_SECRET_KEY}`,
      "Idempotency-Key": booking.booking_id,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message || res.status}`);
  return { id: data.id, url: data.url };
}
__name(createCheckoutSession, "createCheckoutSession");
function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
__name(timingSafeEqual, "timingSafeEqual");
async function getSession(env, sessionId) {
  const res = await fetch(
    `https://api.stripe.com/v1/checkout/sessions/${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` } }
  );
  const data = await res.json();
  if (!res.ok) throw new Error(`Stripe: ${data.error?.message || res.status}`);
  return data;
}
__name(getSession, "getSession");
async function verifyStripeSignature(payload, header, secret, toleranceSec = 300) {
  if (!header) return false;
  const parts = Object.fromEntries(
    header.split(",").map((p) => p.trim().split("=").map((x) => x.trim()))
  );
  const t = parts.t;
  const v1 = parts.v1;
  if (!t || !v1) return false;
  const age = Math.abs(Math.floor(Date.now() / 1e3) - Number(t));
  if (!Number.isFinite(age) || age > toleranceSec) return false;
  const key2 = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key2, new TextEncoder().encode(`${t}.${payload}`));
  const expected = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  return timingSafeEqual(expected, v1);
}
__name(verifyStripeSignature, "verifyStripeSignature");

// teamup-work/backend/src/paypal.js
function base(env) {
  return env.PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}
__name(base, "base");
async function token(env) {
  const auth = btoa(`${env.PAYPAL_CLIENT_ID}:${env.PAYPAL_CLIENT_SECRET}`);
  const res = await fetch(`${base(env)}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${auth}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal auth: ${data.error_description || res.status}`);
  return data.access_token;
}
__name(token, "token");
async function createOrder(env, { booking, service, amounts, successUrl, cancelUrl }) {
  const access = await token(env);
  const res = await fetch(`${base(env)}/v2/checkout/orders`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${access}`,
      "Content-Type": "application/json",
      "PayPal-Request-Id": booking.booking_id
      // idempotenza
    },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [
        {
          reference_id: booking.booking_id,
          custom_id: booking.booking_id,
          // PayPal limita a 127 caratteri e la mostra anche al paziente,
          // quindi qui niente telefono: solo servizio e appuntamento.
          description: (booking.date && booking.time ? `${service.name} \u2014 ${booking.date.slice(8, 10)}/${booking.date.slice(5, 7)} ore ${booking.time}` : service.name).slice(0, 127),
          amount: { currency_code: "EUR", value: amounts.amountDueNow.toFixed(2) }
        }
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: "Healthy Smile By N",
            locale: "it-IT",
            user_action: "PAY_NOW",
            return_url: `${successUrl}?booking=${booking.booking_id}&provider=paypal`,
            cancel_url: cancelUrl
          }
        }
      }
    })
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal: ${data.message || res.status}`);
  const approve = (data.links || []).find((l) => l.rel === "payer-action" || l.rel === "approve");
  return { id: data.id, url: approve?.href };
}
__name(createOrder, "createOrder");
async function getOrder(env, orderId) {
  const access = await token(env);
  const res = await fetch(`${base(env)}/v2/checkout/orders/${orderId}`, {
    headers: { Authorization: `Bearer ${access}` }
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal: ${data.message || res.status}`);
  return data;
}
__name(getOrder, "getOrder");
async function captureOrder(env, orderId) {
  const access = await token(env);
  const res = await fetch(`${base(env)}/v2/checkout/orders/${orderId}/capture`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    // dichiariamo JSON: senza un corpo, anche vuoto, PayPal puo' rifiutare
    body: "{}"
  });
  const data = await res.json();
  if (!res.ok) throw new Error(`PayPal capture: ${data.message || res.status}`);
  return data;
}
__name(captureOrder, "captureOrder");
async function verifyWebhook(env, headers, rawBody) {
  const access = await token(env);
  const res = await fetch(`${base(env)}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      auth_algo: headers.get("paypal-auth-algo"),
      cert_url: headers.get("paypal-cert-url"),
      transmission_id: headers.get("paypal-transmission-id"),
      transmission_sig: headers.get("paypal-transmission-sig"),
      transmission_time: headers.get("paypal-transmission-time"),
      webhook_id: env.PAYPAL_WEBHOOK_ID,
      webhook_event: JSON.parse(rawBody)
    })
  });
  const data = await res.json();
  return res.ok && data.verification_status === "SUCCESS";
}
__name(verifyWebhook, "verifyWebhook");

// teamup-work/backend/src/notify.js
function waNumber(raw) {
  if (!raw) return null;
  let n = String(raw).replace(/[^\d+]/g, "");
  if (n.startsWith("+")) n = n.slice(1);
  else if (n.startsWith("00")) n = n.slice(2);
  if (!n.startsWith("39") && (n.length === 9 || n.length === 10)) n = "39" + n;
  return /^\d{10,15}$/.test(n) ? n : null;
}
__name(waNumber, "waNumber");
function fmtDate(iso) {
  if (!iso) return null;
  const p = iso.split("-");
  if (p.length !== 3) return iso;
  const mesi = [
    "gennaio",
    "febbraio",
    "marzo",
    "aprile",
    "maggio",
    "giugno",
    "luglio",
    "agosto",
    "settembre",
    "ottobre",
    "novembre",
    "dicembre"
  ];
  return `${Number(p[2])} ${mesi[Number(p[1]) - 1]} ${p[0]}`;
}
__name(fmtDate, "fmtDate");
var eur = /* @__PURE__ */ __name((n) => `${Number(n).toLocaleString("it-IT", { maximumFractionDigits: 2 })} \u20AC`, "eur");
var esc = /* @__PURE__ */ __name((s) => String(s ?? "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]), "esc");
function buildMessage(booking, serviceName) {
  const review = booking.booking_status === "needs_review";
  const appt = booking.appointment_date && booking.appointment_time;
  const quando = appt ? `${fmtDate(booking.appointment_date)} alle ${booking.appointment_time}` : null;
  const wa = waNumber(booking.phone);
  const testo = (review ? `Ciao ${booking.first_name}, abbiamo ricevuto il pagamento. Dobbiamo concordare la conferma dell'appuntamento da Healthy Smile` : `Ciao ${booking.first_name}, ti confermo l'appuntamento da Healthy Smile`) + (quando ? ` per ${quando}` : "") + `. ${serviceName}.` + (booking.balance_due > 0 ? ` Hai gi\xE0 versato ${eur(booking.amount_paid)}, il saldo di ${eur(booking.balance_due)} lo regoli in studio.` : "") + (review ? ` Ti ricontattiamo per concordare l\u2019orario o il rimborso.` : ` Ti aspettiamo in Via Madama Cristina 2, Torino.`);
  const waLink = wa ? `https://wa.me/${wa}?text=${encodeURIComponent(testo)}` : null;
  const subject = (review ? "DA VERIFICARE \xB7 " : "") + `Nuova prenotazione \xB7 ${booking.first_name} ${booking.last_name}` + (quando ? ` \xB7 ${quando}` : "");
  const html = `
<div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;color:#111;line-height:1.6">
  <p style="font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:#C8005C;margin:0 0 6px">
    ${review ? "Pagamento ricevuto \xB7 appuntamento NON confermato" : "Prenotazione pagata"}
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
        <td style="padding:7px 0;text-align:right"><b>${esc(quando)}</b></td></tr>` : ""}
    <tr><td style="padding:7px 0;color:#666">Incassato online</td>
        <td style="padding:7px 0;text-align:right;color:#1a7a4a"><b>${eur(booking.amount_paid)}</b></td></tr>
    ${booking.balance_due > 0 ? `<tr><td style="padding:7px 0;color:#666">Saldo in studio</td>
        <td style="padding:7px 0;text-align:right"><b>${eur(booking.balance_due)}</b></td></tr>` : ""}
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
    Il messaggio di conferma \xE8 gi\xE0 compilato: puoi rileggerlo e modificarlo prima di inviarlo.
  </p>` : `<p style="margin-top:24px;font-size:14px;color:#a33">
       Il numero di telefono non \xE8 in un formato riconoscibile: contatta il paziente a mano.
     </p>`}

  <p style="margin-top:28px;font-size:12px;color:#999;border-top:1px solid #eee;padding-top:14px">
    ${review ? "Ricontrolla la capienza prima di confermare. Se non disponibile, concorda un altro orario o il rimborso." : booking.teamup_synced ? "Appuntamento inserito e confermato automaticamente in Teamup." : "Ricordati di segnare l\u2019appuntamento in Teamup: la scrittura automatica non risulta confermata."}
  </p>
</div>`.trim();
  return { subject, html, waLink };
}
__name(buildMessage, "buildMessage");
async function notifyStudio(env, booking, serviceName) {
  if (!env.RESEND_API_KEY || !env.NOTIFY_EMAIL_TO) return false;
  const { subject, html } = buildMessage(booking, serviceName);
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        from: env.NOTIFY_EMAIL_FROM || "Healthy Smile <prenotazioni@healthysmile.it>",
        to: env.NOTIFY_EMAIL_TO.split(",").map((s) => s.trim()),
        reply_to: booking.email,
        subject,
        html
      })
    });
    if (!res.ok) {
      console.error("notifica non inviata:", res.status, await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error("notifica non inviata:", e.message);
    return false;
  }
}
__name(notifyStudio, "notifyStudio");

// teamup-work/backend/src/index.js
var HOLD_MINUTES = 20;
var now2 = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
function cors(env, request2) {
  const allowed = (env.ALLOWED_ORIGINS || "https://healthysmile.it").split(",").map((s) => s.trim());
  const origin = request2.headers.get("Origin");
  return {
    "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    // Authorization serve all'area admin: senza, il preflight del
    // browser blocca ogni chiamata autenticata.
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Max-Age": "86400"
  };
}
__name(cors, "cors");
function json(data, status, env, request2) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...cors(env, request2) }
  });
}
__name(json, "json");
var ok = /* @__PURE__ */ __name((d, env, r) => json(d, 200, env, r), "ok");
var bad = /* @__PURE__ */ __name((m, env, r, s = 400) => json({ error: m }, s, env, r), "bad");
function validatePatient(b) {
  const errs = [];
  const s = /* @__PURE__ */ __name((v) => typeof v === "string" ? v.trim() : "", "s");
  const first = s(b.first_name), last = s(b.last_name);
  const phone = s(b.phone), email = s(b.email);
  if (first.length < 2) errs.push("Nome mancante o troppo corto");
  if (last.length < 2) errs.push("Cognome mancante o troppo corto");
  if (!/^[+0-9 ().-]{6,25}$/.test(phone)) errs.push("Telefono non valido");
  if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(email)) errs.push("Email non valida");
  if (b.terms_accepted !== true) errs.push("Devi accettare le condizioni di prenotazione");
  return { errs, clean: { first_name: first, last_name: last, phone, email } };
}
__name(validatePatient, "validatePatient");
async function holdSlot(db, serviceId, date, time, bookingId) {
  const heldUntil = new Date(Date.now() + HOLD_MINUTES * 6e4).toISOString();
  const r = await db.prepare(
    `UPDATE slots SET status='held', booking_id=?, held_until=?, updated_at=?
         WHERE service_id=? AND date=? AND time=?
           AND (status='available' OR (status='held' AND held_until < ?))`
  ).bind(bookingId, heldUntil, now2(), serviceId, date, time, now2()).run();
  return r.meta.changes === 1;
}
__name(holdSlot, "holdSlot");
async function bookSlot(db, bookingId) {
  await db.prepare(
    `UPDATE slots SET status='booked', held_until=NULL, updated_at=? WHERE booking_id=?`
  ).bind(now2(), bookingId).run();
}
__name(bookSlot, "bookSlot");
async function freeSlot(db, { bookingId, serviceId, date, time }) {
  if (bookingId) {
    return db.prepare(
      `UPDATE slots SET status='available', booking_id=NULL, held_until=NULL, updated_at=?
         WHERE booking_id=?`
    ).bind(now2(), bookingId).run();
  }
  return db.prepare(
    `UPDATE slots SET status='available', booking_id=NULL, held_until=NULL, updated_at=?
       WHERE service_id=? AND date=? AND time=?`
  ).bind(now2(), serviceId, date, time).run();
}
__name(freeSlot, "freeSlot");
async function releaseSlot(db, bookingId) {
  await db.prepare(
    `UPDATE slots SET status='available', booking_id=NULL, held_until=NULL, updated_at=?
       WHERE booking_id=? AND status='held'`
  ).bind(now2(), bookingId).run();
}
__name(releaseSlot, "releaseSlot");
async function startCheckout(request2, env, provider) {
  const body = await request2.json().catch(() => null);
  if (!body) return bad("Richiesta non valida", env, request2);
  const service = getService(body.service_id);
  if (!service) return bad("Servizio non riconosciuto", env, request2);
  const { errs, clean } = validatePatient(body);
  if (errs.length) return bad(errs.join(". "), env, request2);
  let amounts;
  try {
    amounts = resolveAmounts(service, body.requested_amount);
  } catch (e) {
    return bad(e.message, env, request2);
  }
  let date = null, time = null;
  if (service.requiresAppointment) {
    date = String(body.date || "");
    time = String(body.time || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
      return bad("Data o ora mancanti", env, request2);
    }
  }
  const bookingId = crypto.randomUUID();
  const db = env.DB;
  let managed = false;
  if (service.requiresAppointment) {
    let held;
    try {
      const claim = await claimSlot(env, body.service_id, date, time, bookingId);
      managed = claim === true;
      held = managed || await holdSlot(db, body.service_id, date, time, bookingId);
    } catch {
      return bad("Non possiamo confermare questo orario. Aggiorna le disponibilit\xE0 e riprova.", env, request2, 409);
    }
    if (!held) return bad("Questo orario \xE8 appena stato prenotato. Scegline un altro.", env, request2, 409);
  }
  try {
    await db.prepare(
      `INSERT INTO bookings (
       booking_id, service_id, first_name, last_name, phone, email,
       appointment_date, appointment_time,
       total_price, amount_due_now, amount_paid, balance_due,
       payment_mode, payment_provider, payment_status, booking_status,
       terms_accepted, terms_version, terms_accepted_at, created_at, updated_at
     ) VALUES (?,?,?,?,?,?,?,?,?,?,0,?,?,?,'pending',?,1,?,?,?,?)`
    ).bind(
      bookingId,
      body.service_id,
      clean.first_name,
      clean.last_name,
      clean.phone,
      clean.email,
      date,
      time,
      amounts.totalPrice,
      amounts.amountDueNow,
      amounts.balanceDueLater,
      service.paymentMode,
      provider,
      service.requiresAppointment ? "held" : "awaiting_payment",
      service.termsVersion,
      now2(),
      now2(),
      now2()
    ).run();
  } catch {
    if (managed) await db.batch([
      db.prepare("UPDATE teamup_reservations SET status='released',updated_at=? WHERE booking_id=?").bind(now2(), bookingId),
      db.prepare("UPDATE slots SET status='available',booking_id=NULL,held_until=NULL,updated_at=? WHERE booking_id=?").bind(now2(), bookingId)
    ]);
    else await releaseSlot(db, bookingId);
    return bad("Non riusciamo a registrare la prenotazione. Riprova tra poco.", env, request2, 503);
  }
  const successUrl = `${env.SITE_URL}/checkout-success.html`;
  const cancelUrl = `${env.SITE_URL}/checkout.html?service=${encodeURIComponent(body.service_id)}` + (date ? `&date=${date}&time=${encodeURIComponent(time)}` : "") + "&annullato=1";
  const booking = {
    booking_id: bookingId,
    service_id: body.service_id,
    email: clean.email,
    first_name: clean.first_name,
    last_name: clean.last_name,
    phone: clean.phone,
    date,
    time,
    teamup_managed: managed
  };
  try {
    if (managed) {
      await createOwnedHold(env, booking, await settings(db));
      const stillAvailable = await liveSlots(env, date, bookingId);
      if (!stillAvailable?.some((s) => s.time === time)) throw new Error("Agenda cambiata prima del pagamento");
    }
    const session = provider === "stripe" ? await createCheckoutSession(env, { booking, service, amounts, successUrl, cancelUrl }) : await createOrder(env, { booking, service, amounts, successUrl, cancelUrl });
    if (managed) await rememberCheckout(db, bookingId, session.id);
    await db.prepare(`UPDATE bookings SET payment_id=?, updated_at=? WHERE booking_id=?`).bind(session.id, now2(), bookingId).run();
    return ok({ booking_id: bookingId, redirect_url: session.url }, env, request2);
  } catch (e) {
    if (managed) return bad("Il pagamento non \xE8 stato avviato correttamente. Contatta lo studio prima di riprovare.", env, request2, 502);
    await releaseSlot(db, bookingId);
    await db.prepare(
      `UPDATE bookings SET payment_status='failed', booking_status='cancelled', updated_at=? WHERE booking_id=?`
    ).bind(now2(), bookingId).run();
    return bad(`Non riusciamo ad avviare il pagamento. ${e.message}`, env, request2, 502);
  }
}
__name(startCheckout, "startCheckout");
async function markPaid(env, bookingId, paidAmount, providerPaymentId) {
  const db = env.DB;
  const b = await db.prepare(`SELECT * FROM bookings WHERE booking_id=?`).bind(bookingId).first();
  if (!b) return null;
  if (b.payment_status === "paid") return null;
  const managed = await settlePayment(env, b, paidAmount, providerPaymentId);
  if (managed !== void 0) return managed;
  const balance = Math.round((b.total_price - paidAmount) * 100) / 100;
  await db.prepare(
    `UPDATE bookings SET amount_paid=?, balance_due=?, payment_status='paid',
       booking_status='confirmed', payment_id=COALESCE(?,payment_id), updated_at=?
     WHERE booking_id=?`
  ).bind(paidAmount, balance, providerPaymentId || null, now2(), bookingId).run();
  await bookSlot(db, bookingId);
  return { ...b, amount_paid: paidAmount, balance_due: balance, payment_status: "paid", booking_status: "confirmed" };
}
__name(markPaid, "markPaid");
async function markFailed(db, bookingId) {
  await db.prepare(
    `UPDATE bookings SET payment_status='failed', booking_status='cancelled', updated_at=?
       WHERE booking_id=? AND payment_status='pending'`
  ).bind(now2(), bookingId).run();
  await releaseSlot(db, bookingId);
}
__name(markFailed, "markFailed");
async function seen(db, eventId, provider, type, bookingId, payload) {
  try {
    await db.prepare(
      `INSERT INTO webhook_events (event_id, provider, event_type, booking_id, received_at, payload)
       VALUES (?,?,?,?,?,?)`
    ).bind(eventId, provider, type, bookingId || null, now2(), payload.slice(0, 8e3)).run();
    return false;
  } catch (e) {
    const msg = String(e && e.message || e);
    if (/UNIQUE|PRIMARY KEY|constraint/i.test(msg)) return true;
    throw e;
  }
}
__name(seen, "seen");
function alertStudio(ctx, env, booking) {
  const service = getService(booking.service_id);
  const name = service ? service.name : booking.service_id;
  const p = owned(env.DB, booking.booking_id).then((row) => notifyStudio(env, { ...booking, teamup_synced: row?.state === "confirmed" }, name)).catch(() => false);
  if (ctx && typeof ctx.waitUntil === "function") ctx.waitUntil(p);
}
__name(alertStudio, "alertStudio");
function adminOk(request2, env) {
  if (!env.ADMIN_TOKEN) return false;
  const h = request2.headers.get("Authorization") || "";
  const given = h.startsWith("Bearer ") ? h.slice(7) : "";
  const a = new TextEncoder().encode(given);
  const b = new TextEncoder().encode(env.ADMIN_TOKEN);
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}
__name(adminOk, "adminOk");
async function adminRoutes(request2, env, url, path) {
  if (!adminOk(request2, env)) return bad("Non autorizzato", env, request2, 401);
  if (path === "/api/admin/teamup/calendars" || path === "/api/admin/teamup/preview") {
    const reply = /* @__PURE__ */ __name((data, status) => {
      const response = json(data, status, env, request2);
      response.headers.set("Cache-Control", "no-store");
      return response;
    }, "reply");
    try {
      if (request2.method === "GET" && path.endsWith("/calendars")) return reply({ calendars: await calendars(env) }, 200);
      if (request2.method === "POST" && path.endsWith("/preview")) return reply(await teamupPreview(env, await request2.json()), 200);
      return reply({ error: "Metodo non consentito" }, 405);
    } catch (error) {
      return reply({ error: error instanceof SyntaxError ? "Richiesta non valida" : error.message }, 400);
    }
  }
  const db = env.DB;
  if (request2.method === "GET" && path === "/api/admin/teamup/sync") {
    if (!await db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='teamup_owned_events'").first()) return ok({ events: [] }, env, request2);
    const { results } = await db.prepare("SELECT booking_id,event_id,calendar_id,state,busy,updated_at FROM teamup_owned_events ORDER BY updated_at DESC LIMIT 100").all();
    return ok({ events: results || [] }, env, request2);
  }
  if (path === "/api/admin/teamup/settings") {
    try {
      if (request2.method === "GET") return ok({ settings: await settings(db) }, env, request2);
      if (request2.method === "POST") return ok({ settings: await saveSettings(env, await request2.json()) }, env, request2);
      return bad("Metodo non consentito", env, request2, 405);
    } catch (error) {
      return bad(error instanceof SyntaxError ? "Richiesta non valida" : error.message, env, request2);
    }
  }
  if (request2.method === "GET" && path === "/api/admin/bookings") {
    const cond = [], args = [];
    const date = url.searchParams.get("date");
    const service = url.searchParams.get("service");
    const status = url.searchParams.get("status");
    const from = url.searchParams.get("from");
    if (date) {
      cond.push("appointment_date=?");
      args.push(date);
    }
    if (from) {
      cond.push("(appointment_date IS NULL OR appointment_date>=?)");
      args.push(from);
    }
    if (service) {
      cond.push("service_id=?");
      args.push(service);
    }
    if (status) {
      cond.push("booking_status=?");
      args.push(status);
    }
    const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
    const { results } = await db.prepare(
      `SELECT booking_id, service_id, first_name, last_name, phone, email,
              appointment_date, appointment_time, total_price, amount_due_now,
              amount_paid, balance_due,
              payment_provider, payment_status, booking_status, created_at
         FROM bookings ${where}
        ORDER BY appointment_date IS NULL, appointment_date, appointment_time, created_at`
    ).bind(...args).all();
    const rows = (results || []).map((r) => {
      const svc = getService(r.service_id);
      return { ...r, service_name: svc ? svc.name : r.service_id };
    });
    return ok({ bookings: rows }, env, request2);
  }
  if (request2.method === "GET" && path === "/api/admin/calendar") {
    const service = url.searchParams.get("service");
    const cond = [], args = [];
    if (service) {
      cond.push("s.service_id=?");
      args.push(service);
    }
    const where = cond.length ? "WHERE " + cond.join(" AND ") : "";
    const { results } = await db.prepare(
      `SELECT s.service_id, s.date, s.time, s.status, s.booking_id, s.held_until,
              b.first_name, b.last_name, b.phone, b.amount_paid, b.payment_status, b.booking_status
         FROM slots s LEFT JOIN bookings b ON b.booking_id = s.booking_id
         ${where}
        ORDER BY s.date, s.time`
    ).bind(...args).all();
    const rows = (results || []).map((r) => {
      const svc = getService(r.service_id);
      const scaduto = r.status === "held" && r.held_until && r.held_until < now2();
      return {
        ...r,
        status: scaduto ? "available" : r.status,
        service_name: svc ? svc.name : r.service_id
      };
    });
    return ok({ calendar: rows }, env, request2);
  }
  if (request2.method === "POST" && path === "/api/admin/booking-status") {
    const body = await request2.json().catch(() => ({}));
    const valid = ["confirmed", "cancelled", "no_show", "completed"];
    if (!valid.includes(body.status)) return bad("Stato non valido", env, request2);
    const b = await db.prepare(`SELECT * FROM bookings WHERE booking_id=?`).bind(body.booking_id).first();
    if (!b) return bad("Prenotazione non trovata", env, request2, 404);
    if (body.status === "cancelled") {
      try {
        await syncOwnedEvent(env, b, "delete");
      } catch (error) {
        return bad(error.message, env, request2, 409);
      }
    }
    if (body.status === "confirmed") {
      const claim = await reservation(db, body.booking_id);
      if (claim && b.booking_status !== "confirmed") {
        let eligible = false;
        try {
          eligible = claim.status !== "released" && (await liveSlots(env, claim.date, claim.booking_id))?.some((s) => s.time === claim.time);
        } catch {
        }
        if (!eligible) return bad("Orario non confermabile: ricontrolla Teamup e le fasce pubblicate.", env, request2, 409);
        try {
          await syncOwnedEvent(env, b, "confirm");
        } catch (error) {
          return bad(error.message, env, request2, 409);
        }
      }
    }
    await db.prepare(`UPDATE bookings SET booking_status=?, updated_at=? WHERE booking_id=?`).bind(body.status, now2(), body.booking_id).run();
    if (body.status === "cancelled") await freeSlot(db, { bookingId: body.booking_id });
    return ok({ booking_id: body.booking_id, booking_status: body.status }, env, request2);
  }
  if (request2.method === "POST" && path === "/api/admin/booking-mark-paid") {
    const body = await request2.json().catch(() => ({}));
    const importo = Number(body.amount_paid);
    if (!Number.isFinite(importo) || importo <= 0) return bad("Importo non valido", env, request2);
    const b = await db.prepare(`SELECT payment_status FROM bookings WHERE booking_id=?`).bind(body.booking_id).first();
    if (!b) return bad("Prenotazione non trovata", env, request2, 404);
    if (b.payment_status === "paid") return bad("Risulta gia" + String.fromCharCode(39) + " pagata", env, request2);
    const paid = await markPaid(env, body.booking_id, importo, body.payment_id || null);
    if (!paid) return bad("Non e" + String.fromCharCode(39) + " stato possibile registrare il pagamento", env, request2);
    if (await reservation(db, body.booking_id)) return ok({
      booking_id: body.booking_id,
      amount_paid: importo,
      payment_status: "paid",
      booking_status: paid.booking_status,
      avviso: paid.booking_status === "needs_review" ? "Pagamento registrato. Appuntamento da verificare: non ancora confermato." : null
    }, env, request2);
    let avviso = null;
    if (paid.appointment_date && paid.appointment_time) {
      const slot = await db.prepare(
        `SELECT status, booking_id FROM slots WHERE service_id=? AND date=? AND time=?`
      ).bind(paid.service_id, paid.appointment_date, paid.appointment_time).first();
      if (!slot) {
        avviso = "Registrata, ma quell" + String.fromCharCode(39) + "orario non esiste piu" + String.fromCharCode(39) + " in calendario.";
      } else if (slot.booking_id && slot.booking_id !== body.booking_id) {
        avviso = "ATTENZIONE: quell" + String.fromCharCode(39) + "orario risulta gia" + String.fromCharCode(39) + " assegnato a un" + String.fromCharCode(39) + "altra prenotazione.";
      } else {
        await db.prepare(
          `UPDATE slots SET status='booked', booking_id=?, held_until=NULL, updated_at=?
             WHERE service_id=? AND date=? AND time=?`
        ).bind(body.booking_id, now2(), paid.service_id, paid.appointment_date, paid.appointment_time).run();
      }
    }
    return ok({
      booking_id: body.booking_id,
      amount_paid: importo,
      payment_status: "paid",
      avviso
    }, env, request2);
  }
  if (request2.method === "POST" && path === "/api/admin/booking-create") {
    const body = await request2.json().catch(() => ({}));
    const service = getService(body.service_id);
    if (!service) return bad("Servizio non riconosciuto", env, request2);
    const nome = String(body.first_name || "").trim();
    const cognome = String(body.last_name || "").trim();
    const tel = String(body.phone || "").trim();
    if (!nome || !cognome) return bad("Nome e cognome sono obbligatori", env, request2);
    if (!tel) return bad("Il telefono e" + Q + " obbligatorio", env, request2);
    let date = null, time = null;
    if (body.appointment_date || body.appointment_time) {
      date = String(body.appointment_date || "");
      time = String(body.appointment_time || "");
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) {
        return bad("Data o ora non valide", env, request2);
      }
    }
    const versato = Math.max(0, Number(body.amount_paid) || 0);
    const totale = service.totalPrice;
    const pagata = versato > 0;
    const id = crypto.randomUUID();
    const t = now2();
    await db.prepare(
      `INSERT INTO bookings (
         booking_id, service_id, first_name, last_name, phone, email,
         appointment_date, appointment_time,
         total_price, amount_due_now, amount_paid, balance_due,
         payment_mode, payment_provider, payment_id, payment_status, booking_status,
         terms_accepted, terms_version, terms_accepted_at, created_at, updated_at
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'manuale',?,?,?,0,NULL,NULL,?,?)`
    ).bind(
      id,
      body.service_id,
      nome,
      cognome,
      tel,
      String(body.email || "").trim(),
      date,
      time,
      totale,
      service.amountDueNow ?? totale,
      versato,
      Math.round((totale - versato) * 100) / 100,
      service.paymentMode,
      String(body.payment_id || "").trim() || null,
      pagata ? "paid" : "pending",
      pagata ? "confirmed" : "awaiting_payment",
      t,
      t
    ).run();
    let avviso = null;
    if (date && time) {
      const slot = await db.prepare(
        `SELECT status, booking_id FROM slots WHERE service_id=? AND date=? AND time=?`
      ).bind(body.service_id, date, time).first();
      if (slot && slot.booking_id && slot.booking_id !== id) {
        avviso = "Prenotazione creata, ma attenzione: quell" + Q + "orario risulta gia" + Q + " assegnato a un" + Q + "altra prenotazione.";
      } else if (slot) {
        await db.prepare(
          `UPDATE slots SET status='booked', booking_id=?, held_until=NULL, updated_at=?
             WHERE service_id=? AND date=? AND time=?`
        ).bind(id, t, body.service_id, date, time).run();
      } else {
        await db.prepare(
          `INSERT INTO slots (service_id,date,time,status,booking_id,updated_at)
           VALUES (?,?,?,'booked',?,?)`
        ).bind(body.service_id, date, time, id, t).run();
      }
    }
    return ok({ booking_id: id, payment_status: pagata ? "paid" : "pending", avviso }, env, request2);
  }
  if (request2.method === "POST" && path === "/api/admin/booking-delete") {
    const body = await request2.json().catch(() => ({}));
    const b = await db.prepare(`SELECT booking_id FROM bookings WHERE booking_id=?`).bind(body.booking_id).first();
    if (!b) return bad("Prenotazione non trovata", env, request2, 404);
    try {
      await syncOwnedEvent(env, b, "delete");
    } catch (error) {
      return bad(error.message, env, request2, 409);
    }
    await freeSlot(db, { bookingId: b.booking_id });
    await db.prepare(`DELETE FROM bookings WHERE booking_id=?`).bind(b.booking_id).run();
    return ok({ booking_id: b.booking_id, deleted: true }, env, request2);
  }
  if (request2.method === "POST" && path === "/api/admin/slot-status") {
    const body = await request2.json().catch(() => ({}));
    const { service_id, date, time } = body;
    if (!service_id || !date || !time) return bad("Dati slot mancanti", env, request2);
    if (body.status === "available") {
      await freeSlot(db, { serviceId: service_id, date, time });
    } else if (body.status === "blocked") {
      await db.prepare(
        `UPDATE slots SET status='blocked', booking_id=NULL, held_until=NULL, updated_at=?
           WHERE service_id=? AND date=? AND time=?`
      ).bind(now2(), service_id, date, time).run();
    } else return bad("Stato non valido", env, request2);
    return ok({ service_id, date, time, status: body.status }, env, request2);
  }
  if (request2.method === "POST" && path === "/api/admin/slot-create") {
    const body = await request2.json().catch(() => ({}));
    const { service_id, date, time } = body;
    if (!getService(service_id)) return bad("Servizio non riconosciuto", env, request2);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !/^\d{2}:\d{2}$/.test(time || "")) {
      return bad("Data o ora non valide", env, request2);
    }
    await db.prepare(
      `INSERT OR IGNORE INTO slots (service_id,date,time,status,updated_at) VALUES (?,?,?,'available',?)`
    ).bind(service_id, date, time, now2()).run();
    return ok({ service_id, date, time, status: "available" }, env, request2);
  }
  return bad("Endpoint non trovato", env, request2, 404);
}
__name(adminRoutes, "adminRoutes");
var index_default = {
  async fetch(request2, env, ctx) {
    const url = new URL(request2.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";
    if (request2.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors(env, request2) });
    }
    if (request2.method === "GET" && path.startsWith("/api/services/")) {
      const id = decodeURIComponent(path.slice("/api/services/".length));
      const s = getService(id);
      if (!s) return bad("Servizio non riconosciuto", env, request2, 404);
      return ok(publicService(id, s), env, request2);
    }
    if (request2.method === "GET" && path === "/api/slots") {
      const service = url.searchParams.get("service");
      const date = url.searchParams.get("date");
      if (!getService(service)) return bad("Servizio non riconosciuto", env, request2, 404);
      if (service === TEAMUP_SERVICE) {
        try {
          const slots = await liveSlots(env, date);
          if (slots !== null) return ok({ slots }, env, request2);
        } catch {
          return bad("Disponibilit\xE0 temporaneamente non verificabile. Riprova tra poco o contatta lo studio.", env, request2, 503);
        }
      }
      const q = date ? env.DB.prepare(
        `SELECT date, time FROM slots
               WHERE service_id=? AND date=?
                 AND (status='available' OR (status='held' AND held_until < ?))
               ORDER BY time`
      ).bind(service, date, now2()) : env.DB.prepare(
        `SELECT date, time FROM slots
               WHERE service_id=?
                 AND (status='available' OR (status='held' AND held_until < ?))
               ORDER BY date, time`
      ).bind(service, now2());
      const { results } = await q.all();
      return ok({ slots: results || [] }, env, request2);
    }
    if (request2.method === "GET" && path.startsWith("/api/bookings/")) {
      const id = decodeURIComponent(path.slice("/api/bookings/".length));
      const b = await env.DB.prepare(
        `SELECT booking_id, service_id, first_name, appointment_date, appointment_time,
                total_price, amount_paid, balance_due, payment_status, booking_status
           FROM bookings WHERE booking_id=?`
      ).bind(id).first();
      if (!b) return bad("Prenotazione non trovata", env, request2, 404);
      const s = getService(b.service_id);
      return ok({
        ...b,
        service_name: s ? s.name : b.service_id,
        // serve alla pagina di conferma per dichiarare a Google Ads
        // se questa e' un'acquisizione di nuovo paziente
        new_patients_only: !!(s && s.newPatientsOnly)
      }, env, request2);
    }
    if (path.startsWith("/api/admin/")) {
      try {
        return await adminRoutes(request2, env, url, path);
      } catch (error) {
        if (String(error.message).includes("TEAMUP_SLOT_CONFLICT")) return bad("Orario occupato da una prenotazione del sito: scegli un altro orario.", env, request2, 409);
        throw error;
      }
    }
    if (request2.method === "POST" && path === "/api/checkout/stripe") return startCheckout(request2, env, "stripe");
    if (request2.method === "POST" && path === "/api/checkout/paypal") return startCheckout(request2, env, "paypal");
    if (request2.method === "POST" && path === "/api/checkout/stripe/verify") {
      const body = await request2.json().catch(() => ({}));
      if (!body.booking_id) return bad("Dati mancanti", env, request2);
      const b = await env.DB.prepare(
        `SELECT payment_id, payment_status FROM bookings WHERE booking_id=?`
      ).bind(body.booking_id).first();
      if (!b) return bad("Prenotazione non trovata", env, request2, 404);
      if (b.payment_status === "paid") return ok({ payment_status: "paid" }, env, request2);
      if (!b.payment_id) return ok({ payment_status: "pending" }, env, request2);
      let s;
      try {
        s = await getSession(env, b.payment_id);
      } catch (e) {
        return bad(e.message, env, request2, 502);
      }
      if (s.payment_status === "paid") {
        const paid = await markPaid(
          env,
          body.booking_id,
          (s.amount_total || 0) / 100,
          s.payment_intent || s.id
        );
        if (paid) alertStudio(ctx, env, paid);
        return ok({ payment_status: "paid" }, env, request2);
      }
      return ok({ payment_status: s.payment_status || "pending" }, env, request2);
    }
    if (request2.method === "POST" && path === "/api/checkout/paypal/capture") {
      const body = await request2.json().catch(() => ({}));
      const bookingId = body.booking_id, orderId = body.order_id;
      if (!bookingId || !orderId) return bad("Dati mancanti", env, request2);
      const b = await env.DB.prepare(`SELECT payment_status FROM bookings WHERE booking_id=?`).bind(bookingId).first();
      if (!b) return bad("Prenotazione non trovata", env, request2, 404);
      if (b.payment_status === "paid") return ok({ payment_status: "paid" }, env, request2);
      let order;
      try {
        order = await captureOrder(env, orderId);
      } catch (e) {
        order = await getOrder(env, orderId).catch(() => null);
        if (!order) return bad("Pagamento non completato", env, request2);
      }
      const unit = order.purchase_units?.[0];
      if (unit?.custom_id !== bookingId) return bad("Ordine non corrispondente", env, request2, 403);
      const cap = unit?.payments?.captures?.[0];
      if (order.status === "COMPLETED" && cap) {
        const paid = await markPaid(env, bookingId, Number(cap.amount.value), cap.id);
        if (paid) alertStudio(ctx, env, paid);
        return ok({ payment_status: "paid" }, env, request2);
      }
      return ok({ payment_status: "pending" }, env, request2);
    }
    if (request2.method === "POST" && path === "/api/webhooks/stripe") {
      const raw = await request2.text();
      const valid = await verifyStripeSignature(raw, request2.headers.get("stripe-signature"), env.STRIPE_WEBHOOK_SECRET);
      if (!valid) return new Response("firma non valida", { status: 400 });
      const event = JSON.parse(raw);
      const obj = event.data?.object || {};
      const bookingId = obj.metadata?.booking_id || obj.client_reference_id;
      if (await seen(env.DB, event.id, "stripe", event.type, bookingId, raw)) {
        return new Response("gia processato", { status: 200 });
      }
      if (event.type === "checkout.session.completed" && obj.payment_status === "paid") {
        const paid = await markPaid(env, bookingId, (obj.amount_total || 0) / 100, obj.payment_intent || obj.id);
        if (paid) alertStudio(ctx, env, paid);
      } else if (event.type === "checkout.session.expired" || event.type === "payment_intent.payment_failed") {
        if (event.type === "checkout.session.expired" || !await reservation(env.DB, bookingId)) await markFailed(env.DB, bookingId);
      } else if (event.type === "charge.refunded") {
        const full = obj.amount_refunded >= obj.amount;
        await env.DB.prepare(
          `UPDATE bookings SET payment_status=?, booking_status='cancelled', updated_at=? WHERE booking_id=?`
        ).bind(full ? "refunded" : "partially_refunded", now2(), bookingId).run();
        await releaseSlot(env.DB, bookingId);
      }
      return new Response("ok", { status: 200 });
    }
    if (request2.method === "POST" && path === "/api/webhooks/paypal") {
      const raw = await request2.text();
      if (!await verifyWebhook(env, request2.headers, raw)) {
        return new Response("firma non valida", { status: 400 });
      }
      const event = JSON.parse(raw);
      const res = event.resource || {};
      const bookingId = res.custom_id || res.purchase_units?.[0]?.custom_id || res.purchase_units?.[0]?.reference_id;
      if (await seen(env.DB, event.id, "paypal", event.event_type, bookingId, raw)) {
        return new Response("gia processato", { status: 200 });
      }
      if (event.event_type === "CHECKOUT.ORDER.APPROVED") {
        const cap = await captureOrder(env, res.id);
        const unit = cap.purchase_units?.[0]?.payments?.captures?.[0];
        if (cap.status === "COMPLETED" && unit) {
          const paid = await markPaid(env, bookingId, Number(unit.amount.value), unit.id);
          if (paid) alertStudio(ctx, env, paid);
        }
      } else if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
        const paid = await markPaid(env, bookingId, Number(res.amount?.value || 0), res.id);
        if (paid) alertStudio(ctx, env, paid);
      } else if (["PAYMENT.CAPTURE.DENIED", "CHECKOUT.ORDER.VOIDED"].includes(event.event_type)) {
        await markFailed(env.DB, bookingId);
      } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED") {
        await env.DB.prepare(
          `UPDATE bookings SET payment_status='refunded', booking_status='cancelled', updated_at=? WHERE booking_id=?`
        ).bind(now2(), bookingId).run();
        await releaseSlot(env.DB, bookingId);
      }
      return new Response("ok", { status: 200 });
    }
    if (path === "/api/health") {
      return ok({ status: "ok", services: Object.keys(SERVICES) }, env, request2);
    }
    return bad("Endpoint non trovato", env, request2, 404);
  },
  /**
   * Cron: libera gli slot il cui hold e' scaduto senza pagamento.
   * Senza questo, un checkout abbandonato terrebbe l'orario occupato
   * per sempre.
   */
  async scheduled(_event, env, ctx) {
    await cleanupOwnedEvents(env);
    const scaduto = new Date(Date.now() - 60 * 6e4).toISOString();
    const { results } = await env.DB.prepare(
      `SELECT booking_id, payment_id, payment_provider FROM bookings
        WHERE booking_status='held' AND payment_status='pending' AND created_at < ?`
    ).bind(scaduto).all();
    const abbandonate = [];
    for (const b of results || []) {
      const claim = await reservation(env.DB, b.booking_id);
      if (claim) {
        if (claim.checkout_id) try {
          if (b.payment_provider === "stripe") {
            const session = await getSession(env, claim.checkout_id);
            if (session.payment_status === "paid") {
              const rec = await markPaid(env, b.booking_id, (session.amount_total || 0) / 100, session.payment_intent || session.id);
              if (rec) alertStudio(ctx, env, rec);
            } else if (session.status === "expired") await markFailed(env.DB, b.booking_id);
          } else if (b.payment_provider === "paypal") {
            const order = await getOrder(env, claim.checkout_id);
            const cap = order.purchase_units?.[0]?.payments?.captures?.[0];
            if (order.status === "COMPLETED" && cap?.status === "COMPLETED" && order.purchase_units?.[0]?.custom_id === b.booking_id) {
              const rec = await markPaid(env, b.booking_id, Number(cap.amount.value), cap.id);
              if (rec) alertStudio(ctx, env, rec);
            } else if (order.status === "VOIDED") await markFailed(env.DB, b.booking_id);
          }
        } catch {
        }
        continue;
      }
      let incassato = false;
      if (b.payment_provider === "stripe" && b.payment_id) {
        try {
          const s = await getSession(env, b.payment_id);
          if (s.payment_status === "paid") {
            const rec = await markPaid(
              env,
              b.booking_id,
              (s.amount_total || 0) / 100,
              s.payment_intent || s.id
            );
            if (rec) alertStudio(ctx, env, rec);
            incassato = true;
          }
        } catch (e) {
          incassato = true;
        }
      }
      if (!incassato) abbandonate.push(b.booking_id);
    }
    for (const id of abbandonate) {
      await env.DB.prepare(
        `UPDATE bookings SET booking_status='cancelled', payment_status='failed', updated_at=?
           WHERE booking_id=?`
      ).bind(now2(), id).run();
    }
    await env.DB.prepare(
      `UPDATE slots SET status='available', booking_id=NULL, held_until=NULL, updated_at=?
         WHERE status='held' AND held_until < ?`
    ).bind(now2(), now2()).run();
  }
};
export {
  index_default as default
};
