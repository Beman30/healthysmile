"""Baseline di comprensione: solo Ollama locale, nessuna cartella o API esterna."""
import json
import multiprocessing
import queue
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, build_opener, ProxyHandler, HTTPRedirectHandler

ROOT = Path(__file__).resolve().parent
MODEL = "qwen3:4b"
ENDPOINT = "http://127.0.0.1:11434"


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise RuntimeError("Redirect rifiutato: la prova deve restare sul PC.")


def local_request(path, body=None, timeout=10):
    if path not in ("/api/tags", "/api/version", "/api/ps", "/api/chat"):
        raise ValueError("Percorso locale non autorizzato")
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = Request(ENDPOINT + path, data=data, headers={"Content-Type": "application/json"})
    # Non usare proxy di sistema e non seguire redirect verso altri server.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with opener.open(req, timeout=timeout) as response:
        return json.load(response)


class ChatFailure(RuntimeError):
    def __init__(self, message, details):
        super().__init__(message)
        self.details = details


def _chat_worker(body, events):
    """Processo separato: il padre puo' interrompere anche una lettura bloccata."""
    try:
        req = Request(ENDPOINT + "/api/chat", data=json.dumps(body).encode("utf-8"),
                      headers={"Content-Type": "application/json"})
        opener = build_opener(ProxyHandler({}), NoRedirect())
        with opener.open(req, timeout=120) as response:
            for line in response:
                if not line.strip():
                    continue
                item = json.loads(line)
                if item.get("error"):
                    raise RuntimeError(str(item["error"]))
                events.put(("chunk", item))
                if item.get("done"):
                    return
        raise RuntimeError("Connessione chiusa senza risposta completa")
    except Exception as error:
        events.put(("error", str(error)))


def wait_chat(process, events, limit):
    start = time.perf_counter()
    next_notice = 10
    content = ""
    thinking_chars = 0
    chunks = 0
    try:
        while True:
            elapsed = time.perf_counter() - start
            details = {"secondi": round(elapsed, 2), "frammenti_ricevuti": chunks,
                       "caratteri_ragionamento": thinking_chars, "risposta_parziale": content}
            if elapsed >= limit:
                raise ChatFailure(f"Limite totale di {limit} secondi raggiunto", details)
            if elapsed >= next_notice:
                print(f"  {int(elapsed)} s: {len(content)} caratteri di risposta ricevuti.", flush=True)
                next_notice += 10
            try:
                kind, value = events.get(timeout=min(0.25, limit - elapsed))
            except queue.Empty:
                if not process.is_alive():
                    # Queue viene svuotata prima di controllare se il processo e' terminato.
                    raise ChatFailure("Processo Ollama terminato senza risultato", details)
                continue
            if kind == "error":
                raise ChatFailure(value, details)
            chunks += 1
            content += value.get("message", {}).get("content", "")
            thinking_chars += len(value.get("message", {}).get("thinking", ""))
            if value.get("done"):
                value["message"] = {"content": content}
                value["secondi_client"] = round(time.perf_counter() - start, 2)
                return value
    finally:
        if process.is_alive():
            process.terminate()
        process.join(timeout=1)


def stream_chat(body, limit=120):
    context = multiprocessing.get_context("spawn")
    events = context.Queue()
    body = dict(body, stream=True)
    process = context.Process(target=_chat_worker, args=(body, events))
    process.start()
    try:
        return wait_chat(process, events, limit)
    finally:
        events.close()


def diagnostic_snapshot():
    result = {}
    for key, path in (("versione", "/api/version"), ("modelli_caricati", "/api/ps")):
        try:
            result[key] = local_request(path)
        except Exception as error:
            result[key] = {"errore": str(error)}
    return result


def segments(text):
    return [{"id": i + 1, "text": match.group().strip()}
            for i, match in enumerate(re.finditer(r"[^.!?\n;,]+(?:[.!?\n;,]+|$)", text))]


def validate(value, schema, path="risposta"):
    kind = schema["type"]
    if kind == "object":
        if not isinstance(value, dict) or set(value) != set(schema["properties"]):
            raise ValueError(path + ": campi mancanti o inattesi")
        for key, child in schema["properties"].items():
            validate(value[key], child, path + "." + key)
    elif kind == "array":
        if not isinstance(value, list):
            raise ValueError(path + ": lista richiesta")
        for item in value:
            validate(item, schema["items"], path)
    elif ((kind == "string" and not isinstance(value, str))
          or (kind == "integer" and type(value) is not int)
          or (kind == "boolean" and type(value) is not bool)):
        raise ValueError(path + ": tipo non valido")
    if "enum" in schema and value not in schema["enum"]:
        raise ValueError(path + ": valore non previsto")


def check_response(value, schema, source):
    validate(value, schema)
    ids = {row["id"] for row in source}
    if not value["diary_entries"]:
        raise ValueError("Diario assente")
    for section in ("diary_entries", "findings", "actions"):
        for row in value[section]:
            if not row["evidence_ids"] or any(i not in ids for i in row["evidence_ids"]):
                raise ValueError("Riferimenti al testo mancanti o inventati")
    for row in value["diary_entries"]:
        if not row["text"].strip():
            raise ValueError("Frase del diario vuota")


def analyze(case, protocol):
    source = segments(case["trascrizione"])
    result = stream_chat({
        "model": MODEL,
        "messages": [
            {"role": "system", "content": protocol["instructions"]},
            {"role": "user", "content": json.dumps({"frasi": source}, ensure_ascii=False)},
        ],
        "format": protocol["schema"], "think": False,
        "options": {"temperature": 0, "num_ctx": 4096, "num_predict": 1500},
    })
    if result.get("done") is not True or result.get("done_reason") == "length":
        raise ValueError("Risposta incompleta")
    value = json.loads(result["message"]["content"])
    # Conserva anche una risposta strutturalmente errata per poterla diagnosticare.
    try:
        check_response(value, protocol["schema"], source)
        structure_error = None
    except ValueError as error:
        structure_error = str(error)
    return {"risposta": value, "errore_struttura": structure_error,
            "qualita_clinica": "Da valutare dal medico: la struttura valida non prova la correttezza clinica.",
            "frasi": source,
            "token_input": result.get("prompt_eval_count"),
            "token_output": result.get("eval_count")}


def main():
    report = {"prova": "baseline locale v2, nessun addestramento", "modello": MODEL,
              "parametri": {"num_ctx": 4096, "num_predict": 1500, "think": False},
              "data_utc": datetime.now(timezone.utc).isoformat(), "casi": []}
    output = ROOT / "risultato-prova-locale.json"
    exit_code = 0
    try:
        protocol = json.loads((ROOT / "protocollo.json").read_text(encoding="utf-8"))
        cases = json.loads((ROOT / "casi-prova.json").read_text(encoding="utf-8"))
        print("Prova locale: nessun costo API, nessun aggiornamento delle cartelle.", flush=True)
        tags = local_request("/api/tags", timeout=10)
        if MODEL not in {m.get("name") for m in tags.get("models", [])}:
            raise RuntimeError("Modello qwen3:4b assente. Esegui in un terminale: ollama pull qwen3:4b")
        report["diagnostica_prima"] = diagnostic_snapshot()
        print("Prova brevissima di funzionamento: limite totale 60 secondi.", flush=True)
        try:
            quick = stream_chat({"model": MODEL, "think": False,
                                 "messages": [{"role": "user", "content": "Rispondi soltanto OK."}],
                                 "options": {"temperature": 0, "num_ctx": 4096, "num_predict": 16}}, limit=60)
            report["prova_breve"] = {"testo": quick["message"]["content"],
                                     "secondi": quick["secondi_client"],
                                     "done_reason": quick.get("done_reason")}
        except ChatFailure as error:
            report["prova_breve"] = {"errore": str(error), **error.details}
            raise RuntimeError("Prova brevissima fallita: casi clinici non avviati") from None
        for number, case in enumerate(cases, 1):
            print(f"Caso {number}/{len(cases)}: {case['titolo']} - attendere...", flush=True)
            start = time.perf_counter()
            row = dict(case)
            try:
                row.update(analyze(case, protocol))
                if row["errore_struttura"]:
                    exit_code = 1
                print("Risposta ricevuta; la qualita clinica deve ancora essere valutata.", flush=True)
            except Exception as error:
                row["errore"] = str(error)
                if isinstance(error, ChatFailure):
                    row["diagnostica_risposta"] = error.details
                exit_code = 1
                print("Caso non completato: " + str(error), flush=True)
            row["secondi"] = round(time.perf_counter() - start, 2)
            report["casi"].append(row)
            output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
            if exit_code:
                print("Prova interrotta al primo errore; nessuna ulteriore attesa.", flush=True)
                break
    except Exception as error:
        report["errore_avvio"] = str(error)
        print("Prova interrotta: " + str(error), flush=True)
        exit_code = 1
    finally:
        report["diagnostica_dopo"] = diagnostic_snapshot()
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Fine. Carica qui risultato-prova-locale.json, presente in questa cartella.", flush=True)
    return exit_code


if __name__ == "__main__":
    multiprocessing.freeze_support()
    raise SystemExit(main())
