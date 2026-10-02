"""Baseline di comprensione: solo Ollama locale, nessuna cartella o API esterna."""
import json
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


def local_request(path, body=None, timeout=360):
    if path not in ("/api/tags", "/api/version", "/api/chat"):
        raise ValueError("Percorso locale non autorizzato")
    data = None if body is None else json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = Request(ENDPOINT + path, data=data, headers={"Content-Type": "application/json"})
    # Non usare proxy di sistema e non seguire redirect verso altri server.
    opener = build_opener(ProxyHandler({}), NoRedirect())
    with opener.open(req, timeout=timeout) as response:
        return json.load(response)


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
    result = local_request("/api/chat", {
        "model": MODEL,
        "messages": [
            {"role": "system", "content": protocol["instructions"]},
            {"role": "user", "content": json.dumps({"frasi": source}, ensure_ascii=False)},
        ],
        "format": protocol["schema"], "stream": False, "think": False,
        "options": {"temperature": 0, "num_ctx": 8192, "num_predict": 3000},
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
    report = {"prova": "baseline locale, nessun addestramento", "modello": MODEL,
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
                exit_code = 1
                print("Caso non completato; dettagli nel risultato.", flush=True)
            row["secondi"] = round(time.perf_counter() - start, 2)
            report["casi"].append(row)
            output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    except Exception as error:
        report["errore_avvio"] = str(error)
        report["indicazione"] = "Apri Ollama sul PC e riprova. Non serve la chiave OpenAI."
        print("Prova non avviata. Apri Ollama sul PC; leggi i dettagli nel risultato.", flush=True)
        exit_code = 1
    finally:
        output.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
        print("Fine. Carica qui risultato-prova-locale.json, presente in questa cartella.", flush=True)
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
