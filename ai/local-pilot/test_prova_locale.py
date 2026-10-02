import json
import unittest
from unittest.mock import patch

import prova_locale as pilot


class PilotTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.protocol = json.loads((pilot.ROOT / "protocollo.json").read_text(encoding="utf-8"))

    def result(self):
        return {"diary_entries": [{"text": "Controllo eseguito.", "evidence_ids": [1]}],
                "findings": [], "actions": []}

    def test_invented_source_and_boolean_source_rejected(self):
        for bad_id in (99, True):
            value = self.result()
            value["diary_entries"][0]["evidence_ids"] = [bad_id]
            with self.assertRaises(ValueError):
                pilot.check_response(value, self.protocol["schema"], [{"id": 1, "text": "Controllo."}])

    def test_expected_answers_never_sent_and_no_clinical_pass_claim(self):
        case = {"trascrizione": "Controllo.", "aspetti_attesi_per_revisione": ["SEGRETO_ATTESO"]}
        response = {"done": True, "message": {"content": json.dumps(self.result())}}
        with patch.object(pilot, "local_request", return_value=response) as request:
            result = pilot.analyze(case, self.protocol)
        self.assertNotIn("SEGRETO_ATTESO", json.dumps(request.call_args.args))
        self.assertIsNone(result["errore_struttura"])
        self.assertIn("Da valutare", result["qualita_clinica"])

    def test_truncated_response_rejected(self):
        response = {"done": True, "done_reason": "length", "message": {"content": json.dumps(self.result())}}
        with patch.object(pilot, "local_request", return_value=response):
            with self.assertRaises(ValueError):
                pilot.analyze({"trascrizione": "Controllo."}, self.protocol)

    def test_redirect_rejected(self):
        with self.assertRaises(RuntimeError):
            pilot.NoRedirect().redirect_request(None, None, 302, "", {}, "https://example.com")

    def test_transport_disables_proxy_and_uses_only_loopback(self):
        class Reply:
            def __enter__(self):
                from io import StringIO
                return StringIO('{"models": []}')
            def __exit__(self, *args):
                pass
        with patch.object(pilot, "build_opener") as factory:
            factory.return_value.open.return_value = Reply()
            pilot.local_request("/api/tags", timeout=10)
        self.assertEqual(factory.call_args.args[0].proxies, {})
        self.assertEqual(factory.return_value.open.call_args.args[0].full_url,
                         "http://127.0.0.1:11434/api/tags")
        with self.assertRaises(ValueError):
            pilot.local_request("https://example.com")


if __name__ == "__main__":
    unittest.main()
