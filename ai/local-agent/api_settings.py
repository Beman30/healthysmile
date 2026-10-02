"""API secrets are encrypted by Windows DPAPI for the current PC user."""
import ctypes
import getpass
import json
import os
from pathlib import Path

CONFIG = Path(__file__).resolve().parent / "api-settings.local.json"
SECRET = Path(__file__).resolve().parent / "api-key.local.bin"


def crypt(data, decrypt=False):
    if os.name != "nt":
        raise RuntimeError("La configurazione guidata della chiave è disponibile su Windows; altrove usa OPENAI_API_KEY")
    from ctypes import wintypes

    class Blob(ctypes.Structure):
        _fields_ = [("cbData", wintypes.DWORD), ("pbData", ctypes.POINTER(ctypes.c_ubyte))]

    buffer = (ctypes.c_ubyte * len(data)).from_buffer_copy(data)
    source, dest = Blob(len(data), buffer), Blob()
    if decrypt:
        ok = ctypes.windll.crypt32.CryptUnprotectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(dest))
    else:
        ok = ctypes.windll.crypt32.CryptProtectData(ctypes.byref(source), None, None, None, None, 1, ctypes.byref(dest))
    if not ok:
        raise RuntimeError("Windows non ha potuto proteggere/aprire la chiave API")
    try:
        return ctypes.string_at(dest.pbData, dest.cbData)
    finally:
        ctypes.windll.kernel32.LocalFree(dest.pbData)


def load_settings():
    settings = json.loads(CONFIG.read_text(encoding="utf-8")) if CONFIG.exists() else {}
    key = os.environ.get("OPENAI_API_KEY", "")
    if not key and SECRET.exists():
        key = crypt(SECRET.read_bytes(), decrypt=True).decode("utf-8")
    return {"provider": "openai" if key else "local", "api_key": key,
            "model": os.environ.get("HS_OPENAI_MODEL", settings.get("model", "gpt-6-astra")),
            "base_url": settings.get("base_url", "https://api.openai.com/v1"),
            "test_only": settings.get("test_only", True)}


def configure():
    print("Healthy Smile — comprensione OpenAI, compilazione sul PC")
    print("La chiave resta cifrata sul tuo PC; non incollarla nella chat o nel sito.")
    print("1. Prova con casi fittizi (API globale, dati minimizzati)")
    print("2. Progetto API europeo già abilitato e trattamento clinico verificato dallo studio")
    option = input("Scegli 1 o 2 [1]: ").strip() or "1"
    if option not in ("1", "2"):
        raise ValueError("Scelta non valida")
    if option == "2":
        print("Questa opzione non certifica la conformità GDPR. Il progetto deve essere abilitato")
        print("all'elaborazione europea e ai controlli di conservazione previsti da OpenAI.")
    key = getpass.getpass("Incolla qui la chiave API (non sarà mostrata): ").strip()
    if not key or any(c.isspace() for c in key):
        raise ValueError("Chiave mancante o contenente spazi")
    encrypted = crypt(key.encode("utf-8"))
    SECRET.write_bytes(encrypted)
    CONFIG.write_text(json.dumps({"base_url": "https://eu.api.openai.com/v1" if option == "2" else "https://api.openai.com/v1",
                                  "test_only": option == "1", "model": "gpt-6-astra"}, indent=2), encoding="utf-8")
    print("Configurazione salvata. Chiudi la vecchia finestra e avvia AVVIA-AGENTE.bat.")


if __name__ == "__main__":
    try:
        configure()
    except Exception as error:
        print("Configurazione non completata:", error)
        raise SystemExit(1)
