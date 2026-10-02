"""Local-only HTTP bridge between the private demo and agent.py."""
import json
import os
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from agent import AGENT_VERSION, AGENT_RELEASE, analyze
from api_settings import load_settings
from api_comprehension import analyze_api

HOST="127.0.0.1"
PORT=8765
ALLOWED_ORIGINS={"https://healthy-smile-agente-clinico-demo.nicolapalmia.chatgpt.site", "https://healthysmile.it", "https://www.healthysmile.it"}

def validate_catalog(value):
    if value is None:
        return None
    if not isinstance(value, dict) or not isinstance(value.get("plan"), list) or not 0 < len(value["plan"]) <= 2000:
        raise ValueError("Listino della cartella non valido")
    seen = set()
    for item in value["plan"]:
        if (not isinstance(item, dict) or not isinstance(item.get("id"), str) or not item["id"] or
                item["id"] in seen or not isinstance(item.get("label"), str) or not item["label"] or
                item.get("scope") not in ("TOOTH_LEVEL", "ARCH_LEVEL", "QUADRANT_LEVEL", "CASE_LEVEL", "SESSION_LEVEL") or
                type(item.get("prezzo", 0)) not in (int, float) or not 0 <= item.get("prezzo", 0) <= 1000000):
            raise ValueError("Voce del listino della cartella non valida")
        seen.add(item["id"])
    return {"plan": value["plan"]}

class Handler(BaseHTTPRequestHandler):
    def _headers(self,status=200):
        origin=self.headers.get("Origin","")
        self.send_response(status)
        self.send_header("Content-Type","application/json; charset=utf-8")
        if origin in ALLOWED_ORIGINS:
            self.send_header("Access-Control-Allow-Origin",origin)
            self.send_header("Vary","Origin")
            self.send_header("Access-Control-Allow-Methods","GET, POST, OPTIONS")
            self.send_header("Access-Control-Allow-Headers","Content-Type")
            self.send_header("Access-Control-Allow-Private-Network","true")
        self.end_headers()
    def _json(self,status,data):
        self._headers(status)
        self.wfile.write(json.dumps(data,ensure_ascii=False).encode("utf-8"))
    def do_OPTIONS(self):
        self._headers(204)
    def do_GET(self):
        if self.path!="/version":return self._json(404,{"error":"Endpoint inesistente"})
        if self.headers.get("Origin") not in ALLOWED_ORIGINS:return self._json(403,{"error":"Origine non autorizzata"})
        try:
            settings=load_settings()
            self._json(200,{"release":AGENT_RELEASE,"version":AGENT_VERSION,
                           "provider":settings["provider"],"test_only":settings["test_only"]})
        except Exception:
            self._json(422,{"error":"Configurazione API non leggibile: esegui CONFIGURA-API.bat"})
    def do_POST(self):
        if self.path!="/analyze":return self._json(404,{"error":"Endpoint inesistente"})
        if self.headers.get("Origin") not in ALLOWED_ORIGINS:return self._json(403,{"error":"Origine non autorizzata"})
        size=int(self.headers.get("Content-Length",0))
        if size<1 or size>500000:return self._json(413,{"error":"Testo non valido o troppo lungo"})
        try:
            request=json.loads(self.rfile.read(size))
            transcript=request.get("transcript","")
            if not isinstance(transcript,str) or len(transcript)>180000:raise ValueError("Trascrizione non valida")
            settings=load_settings()
            provider=request.get("provider","local")
            if provider=="openai":
                if settings["provider"]!="openai":raise ValueError("Configura la chiave con CONFIGURA-API.bat sul PC")
                identifiers=request.get("identifiers",[])
                if not isinstance(identifiers,list):raise ValueError("Identificativi non validi")
                catalog=validate_catalog(request.get("catalog"))
                result=analyze_api(transcript,settings,identifiers,request.get("fictional") is True,catalog=catalog)
            elif provider=="local":
                result=analyze(transcript,os.environ.get("HS_MODEL","qwen3:4b"),request.get("memory",{}))
            else:raise ValueError("Motore non valido")
            self._json(200,{"proposal":result,"agent_version":AGENT_VERSION})
        except Exception as e:
            self._json(422,{"error":str(e)})
    def log_message(self,format,*args):
        # No transcript or patient data in logs.
        print("Agente locale:",format % args)

if __name__=="__main__":
    print(f"Healthy Smile · agente locale {AGENT_VERSION} pronto su http://{HOST}:{PORT}")
    print("Tieni questa finestra aperta mentre analizzi la visita nella demo.")
    ThreadingHTTPServer((HOST,PORT),Handler).serve_forever()
