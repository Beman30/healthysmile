"""HTTP bridge integration tests. No real API calls, keys or patient data."""
import json
import threading
import unittest
from http.server import ThreadingHTTPServer
from urllib.request import Request, urlopen
from urllib.error import HTTPError
from unittest.mock import patch
import server


class BridgeTests(unittest.TestCase):
    def setUp(self):
        self.settings=patch.object(server,"load_settings",return_value={"provider":"openai","test_only":True,"api_key":"synthetic-key"})
        self.settings.start()
        self.logs=patch.object(server.Handler,"log_message");self.logs.start()
        self.http=ThreadingHTTPServer(("127.0.0.1",0),server.Handler)
        self.thread=threading.Thread(target=self.http.serve_forever,daemon=True);self.thread.start()
        self.url=f"http://127.0.0.1:{self.http.server_port}"

    def tearDown(self):
        self.http.shutdown();self.http.server_close();self.thread.join();self.settings.stop();self.logs.stop()

    def request(self,path,origin="https://healthysmile.it",data=None,method=None):
        return urlopen(Request(self.url+path,data=json.dumps(data).encode() if data is not None else None,
                              headers={"Origin":origin,"Content-Type":"application/json"},method=method),timeout=3)

    def test_version_allows_chart_and_demo_but_does_not_expose_key(self):
        for origin in server.ALLOWED_ORIGINS:
            with self.request("/version",origin) as response:
                self.assertEqual(response.headers.get("Access-Control-Allow-Origin"),origin)
                raw=response.read().decode();body=json.loads(raw)
                self.assertEqual(body["release"],8);self.assertNotIn("synthetic-key",raw)
        with self.assertRaises(HTTPError) as error:self.request("/version","https://untrusted.example")
        self.assertEqual(error.exception.code,403)

    def test_current_catalog_stays_in_bridge_and_is_forwarded_to_local_compilation(self):
        catalog={"plan":[{"id":"synthetic","label":"Prestazione test","scope":"SESSION_LEVEL","prezzo":17}]}
        with patch.object(server,"analyze_api",return_value={"diary":{"text":"Controllo di prova."}}) as analyze:
            with self.request("/analyze",data={"transcript":"Controllo di prova.","provider":"openai","fictional":True,"identifiers":[],"catalog":catalog}) as response:
                self.assertEqual(response.status,200)
            self.assertEqual(analyze.call_args.kwargs["catalog"],catalog)
            with self.assertRaises(HTTPError):self.request("/analyze","https://untrusted.example",data={"provider":"openai"})
            self.assertEqual(analyze.call_count,1)

    def test_preflight_advertises_private_network_and_exact_allowed_origin(self):
        with self.request("/analyze",method="OPTIONS") as response:
            self.assertEqual(response.status,204)
            self.assertEqual(response.headers.get("Access-Control-Allow-Private-Network"),"true")
            self.assertEqual(response.headers.get("Access-Control-Allow-Origin"),"https://healthysmile.it")


if __name__=="__main__":unittest.main()
