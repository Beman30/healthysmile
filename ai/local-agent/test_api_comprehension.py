"""Contract tests of local compilation; no paid API calls."""
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
import agent
import api_comprehension as api


def action(label, status, ids, kind="intervento", target="", timing=""):
    return {"procedure":label,"status":status,"evidence_ids":ids,"kind":kind,
            "target":target,"timing":timing,"uncertain":False}


class HybridContractTests(unittest.TestCase):
    def test_postoperative_history_today_future_and_trial(self):
        text=("Abbiamo messo gli impianti una settimana fa. Adesso ho tolto i punti. "
              "Le gengive sono chiuse. Proviamo il provvisorio con un po' di colla. "
              "Tra una settimana e dieci giorni la rivedo e faccio la ribasatura.")
        result={"diary_entries":[
            {"text":"Controllo postoperatorio implantare. Rimosse le suture; ferite chiuse.","evidence_ids":[1,2,3]},
            {"text":"Provato il provvisorio, utilizzabile con adesivo. Ribasatura programmata tra 7–10 giorni.","evidence_ids":[4,5]}],
            "actions":[action("inserimento impianti","pregresso",[1]),action("rimozione suture","eseguito",[2]),
                       action("prova protesi provvisoria","eseguito",[4],"prova_protesi"),
                       action("ribasatura della protesi","dafare",[5],timing="tra 7–10 giorni")]}
        p=api.compile_comprehension(text,result)
        self.assertEqual(len(p["events"]),3)
        self.assertEqual([(t["label"],t["status"]) for t in p["treatments"]],[("ribasatura della protesi","dafare")])
        self.assertEqual(p["estimate"],[])
        self.assertIn("Rimosse le suture",p["diary"]["text"])
        self.assertTrue(any("Quale voce" in q for q in p["questions"]))
        self.assertTrue(any("arcata" in q for q in p["questions"]))
        self.assertEqual(p["findings"],[])

    def test_prosthetics_executed_procedures_no_new_estimate(self):
        text="Abbiamo fatto la ribasatura. Abbiamo cambiato i quattro gommini."
        result={"diary_entries":[{"text":"Eseguita ribasatura e sostituzione di quattro gommini.","evidence_ids":[1,2]}],
                "actions":[action("ribasatura della protesi","eseguito",[1]),action("cambio gommini","eseguito",[2])]}
        p=api.compile_comprehension(text,result)
        self.assertEqual(p["estimate"],[])
        self.assertTrue(any(t["id_listino"]=="cambio_gommini_e_cappette" for t in p["treatments"]))

    def test_followup_control_without_new_procedure(self):
        text="Gengive gonfie senza sanguinamento. Col cortisone è passata. Potrebbe essere herpes o candida. Teniamo sotto controllo."
        note="Gonfiore gengivale senza sanguinamento riferito, risolto dopo cortisone. Ipotesi di herpes o candida non confermate. Monitoraggio."
        p=api.compile_comprehension(text,{"diary_entries":[{"text":note,"evidence_ids":[1,2,3,4]}],"actions":[]})
        self.assertEqual(p["diary"]["text"],note)
        self.assertEqual(p["treatments"],[])
        self.assertEqual(p["estimate"],[])

    def test_future_not_overridden_by_other_procedure_in_evidence(self):
        text="Ho fatto il controllo e farò l'igiene professionale sul prossimo appuntamento."
        result={"diary_entries":[{"text":"Controllo eseguito; igiene programmata.","evidence_ids":[1]}],
                "actions":[action("igiene professionale","dafare",[1])]}
        p=api.compile_comprehension(text,result)
        self.assertEqual(p["estimate"][0]["status"],"dafare")
        self.assertEqual(p["estimate"][0]["prezzo"],agent.PLAN["igiene_seduta"]["prezzo"])

    def test_invalid_reference_rejects_whole_response(self):
        for ids in ([],[999],[True]):
            with self.subTest(ids=ids),self.assertRaises(ValueError):
                api.compile_comprehension("Abbiamo tolto i punti.",{"diary_entries":[{"text":"Rimosse le suture.","evidence_ids":ids}],"actions":[]})

    def test_only_minimized_transcript_sent(self):
        text="Paziente Test, abbiamo tolto i punti. Scrivi a test@example.it o chiama 3331234567."
        minimized=api.minimize_transcript(text,["Paziente Test"])
        for identifier in ("Paziente","Test","test@example.it","3331234567"):
            self.assertNotIn(identifier,minimized)
        self.assertIn("tolto i punti",minimized)
        response={"status":"completed","output":[{"type":"message","content":[{"type":"output_text","text":'{"diary_entries": [], "actions": []}'}]}]}
        with patch.object(api,"urlopen") as mock:
            mock.return_value.__enter__.return_value.read.return_value=json.dumps(response).encode()
            api.request_comprehension(api.indexed_segments(minimized),{"api_key":"test-placeholder","model":"gpt-6-astra"})
            request=mock.call_args.args[0]
            body=json.loads(request.data)
        self.assertFalse(body["store"])
        self.assertNotIn("test-placeholder",request.data.decode())
        self.assertEqual(set(json.loads(body["input"])),{"frasi"})

    def test_test_only_guard_before_network(self):
        with patch.object(api,"request_comprehension") as mock,self.assertRaises(ValueError):
            api.analyze_api("Abbiamo tolto i punti.",{"test_only":True},fictional=False)
        mock.assert_not_called()

    def test_api_errors_do_not_echo_secret(self):
        with patch.object(api,"urlopen",side_effect=HTTPError("https://api.openai.com",401,"secret",{},None)):
            with self.assertRaisesRegex(RuntimeError,"Chiave API non valida") as error:
                api.request_comprehension([],{"api_key":"secret"})
        self.assertNotIn("secret",str(error.exception))

    def test_live_catalog_and_separate_teeth_are_used_without_mutating_default_catalog(self):
        catalog={"plan":[{"id":"custom_restauro","label":"Restauro composito","scope":"TOOTH_LEVEL","prezzo":123},
                         {"id":"custom_igiene","label":"Igiene professionale","scope":"SESSION_LEVEL","prezzo":91}]}
        text="Programmiamo un restauro composito sul 12. Programmiamo un restauro composito sul 13."
        result={"diary_entries":[{"text":"Restauri programmati su 12 e 13.","evidence_ids":[1,2]}],
                "actions":[action("restauro composito","dafare",[1],target="12"),action("restauro composito","dafare",[2],target="13")]}
        p=api.compile_comprehension(text,result,catalog=catalog)
        self.assertEqual([t["target"] for t in p["treatments"]],["12","13"])
        self.assertEqual([t["prezzo"] for t in p["estimate"]],[123,123])
        self.assertTrue(all(t["id_listino"]=="custom_restauro" for t in p["treatments"]))
        self.assertNotIn("custom_restauro",agent.PLAN)

    def test_distant_validated_sources_are_not_discarded(self):
        text="Proponiamo la ribasatura diretta della protesi superiore. Il dolore iniziale è passato. La faremo tra dieci giorni."
        result={"diary_entries":[{"text":"Ribasatura diretta superiore programmata tra dieci giorni.","evidence_ids":[1,3]}],
                "actions":[action("ribasatura diretta","dafare",[1,3],target="AS")]}
        p=api.compile_comprehension(text,result)
        self.assertEqual(len(p["treatments"]),1)
        self.assertEqual(p["treatments"][0]["status"],"dafare")

    def test_confirmed_tooth_requires_explicit_source_and_general_followup_has_no_false_empty_warning(self):
        result={"diary_entries":[{"text":"Carie sul 12.","evidence_ids":[1]}],"actions":[],
                "findings":[{"target":"12","state":"Cariato","description":"Carie distale","confirmed":True,"evidence_ids":[1]}]}
        p=api.compile_comprehension("Sul 12 è presente una carie distale.",result)
        self.assertEqual(p["findings"][0]["target"],"12")
        self.assertEqual(p["questions"],[])
        result["findings"][0]["target"]="13"
        with self.assertRaises(ValueError):api.compile_comprehension("Sul 12 è presente una carie distale.",result)

    def test_catalog_validation_rejects_duplicates_and_nonfinite_prices(self):
        from server import validate_catalog
        item={"id":"example","label":"Prestazione test","scope":"SESSION_LEVEL","prezzo":12}
        self.assertEqual(validate_catalog({"plan":[item]})["plan"],[item])
        for plan in ([item,item],[{**item,"prezzo":float("nan")}],[{**item,"scope":"anything"}]):
            with self.subTest(plan=plan),self.assertRaises(ValueError):validate_catalog({"plan":plan})

if __name__=="__main__":unittest.main()
