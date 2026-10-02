import unittest
import json
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import agent


class ClinicalExtractionTests(unittest.TestCase):
    def test_prosthetics_plan_then_completed_and_garbled_words(self):
        transcript = (
            "Adesso facciamo la ribasatura, vado a cambiare i gomini. "
            "La rivetta dei bianuoli. Ok Rodica, abbiamo fatto la ribasatura, "
            "abbiamo cambiato i 4 gommini. La protesi non fa male."
        )
        actions = [
            {"procedure": "ribasatura della protesi", "evidence": "Adesso facciamo la ribasatura", "status": "dafare", "target": "", "uncertain": False},
            {"procedure": "cambio gommini", "evidence": "vado a cambiare i gomini", "status": "dafare", "target": "", "uncertain": False},
            {"procedure": "rivetta dei bianuoli", "evidence": "La rivetta dei bianuoli", "status": "eseguito", "target": "", "uncertain": False},
            {"procedure": "ribasatura della protesi", "evidence": "abbiamo fatto la ribasatura", "status": "eseguito", "target": "", "uncertain": False},
            {"procedure": "sostituzione di quattro gommini", "evidence": "abbiamo cambiato i 4 gommini", "status": "eseguito", "target": "", "uncertain": False},
        ]
        proposal = agent.build_proposal(transcript, [(transcript, {"actions": actions, "observations": []})])
        self.assertEqual([(row["id_listino"], row["status"]) for row in proposal["treatments"]],
                         [("", "eseguito"), ("cambio_gommini_e_cappette", "eseguito")])
        self.assertEqual(proposal["estimate"], [])
        self.assertEqual(proposal["findings"], [])
        self.assertEqual(len(proposal["questions"]), 2)

    def test_unrelated_procedure_and_explicit_tooth(self):
        transcript = "Abbiamo eseguito una estrazione semplice del dente 16."
        action = {"procedure": "estrazione semplice", "evidence": transcript, "status": "eseguito", "target": "16", "uncertain": False}
        proposal = agent.build_proposal(transcript, [(transcript, {"actions": [action], "observations": []})])
        self.assertEqual(proposal["treatments"][0]["id_listino"], "estrazione_semplice")
        self.assertEqual(proposal["treatments"][0]["target"], "16")
        self.assertEqual(proposal["estimate"], [])

    def test_future_service_is_in_estimate_and_no_unsourced_action(self):
        transcript = "La prossima volta facciamo una seduta di igiene professionale."
        actions = [
            {"procedure": "igiene professionale", "evidence": transcript, "status": "dafare", "target": "", "uncertain": False},
            {"procedure": "impianto", "evidence": "Inseriremo un impianto", "status": "dafare", "target": "36", "uncertain": False},
        ]
        proposal = agent.build_proposal(transcript, [(transcript, {"actions": actions, "observations": []})])
        self.assertEqual([row["id_listino"] for row in proposal["estimate"]], ["igiene_seduta"])

    def test_negated_or_uncertain_action_is_excluded(self):
        actions = [{"procedure": "cambio gommini", "evidence": "Non abbiamo cambiato i gommini", "status": "negato", "target": "", "uncertain": False}]
        transcript = actions[0]["evidence"]
        proposal = agent.build_proposal(transcript, [(transcript, {"actions": actions, "observations": []})])
        self.assertEqual(proposal["treatments"], [])

    def test_later_negation_cancels_an_earlier_plan(self):
        transcript = "Volevamo fare l'igiene professionale. Non abbiamo fatto l'igiene professionale."
        actions = [
            {"procedure": "igiene professionale", "evidence": "Volevamo fare l'igiene professionale", "status": "dafare", "target": "", "uncertain": False},
            {"procedure": "igiene professionale", "evidence": "Non abbiamo fatto l'igiene professionale", "status": "eseguito", "target": "", "uncertain": False},
        ]
        proposal = agent.build_proposal(transcript, [(transcript, {"actions": actions, "observations": []})])
        self.assertEqual(proposal["treatments"], [])
        self.assertEqual(proposal["estimate"], [])

    def test_model_is_asked_for_clinical_facts(self):
        transcript = "Abbiamo eseguito una estrazione semplice del dente 16."
        extraction = {"actions": [{"procedure": "estrazione semplice", "evidence": transcript, "status": "eseguito", "target": "16", "uncertain": False}], "observations": []}
        with patch.object(agent, "ask", return_value=extraction) as mock:
            proposal = agent.analyze(transcript, "qwen3:4b")
        self.assertEqual(mock.call_count, 1)
        self.assertEqual(proposal["treatments"][0]["id_listino"], "estrazione_semplice")

    def test_followup_control_without_billable_procedure(self):
        transcript = (
            "Ti si sono gonfiate le gengive, strano che non sanguinassero. "
            "Secondo me hai avuto un abbassamento del sistema immunitario; a volte possono essere herpes o candida. "
            "Col cortisone è passata. Non facciamo niente, teniamo sotto controllo. "
            "Se si gonfiano ulteriormente richiamami: ti vedo subito, prima di prendere qualsiasi farmaco."
        )
        def fact(category, meaning, evidence, source="valutazione_medico"):
            return {"category": category, "meaning": meaning, "evidence": evidence, "source": source, "target": ""}
        observations = [
            fact("quadro", "gonfiore gengivale", "Ti si sono gonfiate le gengive"),
            fact("quadro", "assenza di sanguinamento riferita", "strano che non sanguinassero", "riferito"),
            fact("ipotesi", "possibile abbassamento delle difese immunitarie; herpes o candida da considerare, senza diagnosi certa", "Secondo me hai avuto un abbassamento del sistema immunitario; a volte possono essere herpes o candida"),
            fact("terapia_pregressa", "cortisone già assunto", "Col cortisone è passata", "riferito"),
            fact("decorso", "miglioramento dopo cortisone", "Col cortisone è passata", "riferito"),
            fact("piano", "nessuna nuova terapia; monitoraggio", "Non facciamo niente, teniamo sotto controllo", "indicazione_medico"),
            fact("controllo", "ricontattare lo studio in caso di ulteriore gonfiore, per valutazione prima di nuovi farmaci", "Se si gonfiano ulteriormente richiamami: ti vedo subito, prima di prendere qualsiasi farmaco", "indicazione_medico"),
            fact("piano", "prescritto antibiotico", "Ho prescritto un antibiotico", "indicazione_medico"),
        ]
        note = {"clinical_note": {
            "problema": {"text": "Gonfiore gengivale senza sanguinamento riferito", "evidence": ["Ti si sono gonfiate le gengive, strano che non sanguinassero"]},
            "terapia_decorso": {"text": "Risolto dopo terapia cortisonica", "evidence": ["Col cortisone è passata"]},
            "ipotesi": {"text": "Calo delle difese immunitarie; herpes o candida", "evidence": ["Secondo me hai avuto un abbassamento del sistema immunitario; a volte possono essere herpes o candida"]},
            "indicazioni": {"text": "Monitoraggio; ricontattare lo studio in caso di ulteriore gonfiore, prima di nuovi farmaci", "evidence": ["Non facciamo niente, teniamo sotto controllo", "Se si gonfiano ulteriormente richiamami: ti vedo subito, prima di prendere qualsiasi farmaco"]},
            "diagnosi": {"text": "Prescritto antibiotico", "evidence": ["Ho prescritto un antibiotico"]},
        }}
        with patch.object(agent, "ask", side_effect=[{"actions": [], "observations": observations}, note]) as mock:
            proposal = agent.analyze(transcript, "qwen3:4b")
        self.assertEqual(mock.call_count, 2)
        self.assertEqual(proposal["treatments"], [])
        self.assertEqual(proposal["estimate"], [])
        self.assertEqual(proposal["findings"], [])
        diary = proposal["diary"]["text"]
        for term in ("Gonfiore gengivale", "sanguinamento", "cortisonica", "Ipotesi da confermare", "Monitoraggio", "ricontattare"):
            self.assertIn(term, diary)
        self.assertNotIn("Eseguita", diary)
        self.assertNotIn("antibiotico", diary)

    def test_compact_note_replaces_fragmented_observations(self):
        transcript = (
            "Ti si sono gonfiate le gengive, strano che non sanguinassero. "
            "Col cortisone è passata. Secondo me hai avuto un abbassamento del sistema immunitario. "
            "Non facciamo niente, teniamo sotto controllo."
        )
        observations = [
            {"category": "decorso", "meaning": phrase, "evidence": quote,
             "source": "valutazione_medico", "target": ""}
            for phrase, quote in [
                ("si gonfiate le gengive", "Ti si sono gonfiate le gengive"),
                ("non sanguinassero", "strano che non sanguinassero"),
                ("col cortisone è passata", "Col cortisone è passata"),
                ("abbassamento del sistema immunitario", "Secondo me hai avuto un abbassamento del sistema immunitario"),
                ("teniamo sotto controllo", "teniamo sotto controllo"),
            ]
        ]
        note = {"clinical_note": {
            "problema": {"text": "Gonfiore gengivale senza sanguinamento riferito", "evidence": ["Ti si sono gonfiate le gengive, strano che non sanguinassero"]},
            "terapia_decorso": {"text": "Risolto dopo cortisone", "evidence": ["Col cortisone è passata"]},
            "ipotesi": {"text": "Calo delle difese immunitarie", "evidence": ["Secondo me hai avuto un abbassamento del sistema immunitario"]},
            "indicazioni": {"text": "Monitoraggio", "evidence": ["teniamo sotto controllo"]},
            "diagnosi": {"text": "", "evidence": []},
        }}
        with patch.object(agent, "ask", side_effect=[{"actions": [], "observations": observations}, note]):
            proposal = agent.analyze(transcript, "qwen3:4b")
        expected = ("Problema: Gonfiore gengivale senza sanguinamento riferito.\n"
                    "Terapia e decorso: Risolto dopo cortisone.\n"
                    "Ipotesi da confermare: Calo delle difese immunitarie.\n"
                    "Indicazioni: Monitoraggio.")
        self.assertEqual(proposal["diary"]["text"], expected)
        self.assertEqual(proposal["summary"], expected.replace("\n", " "))
        self.assertEqual(proposal["estimate"], [])

    def test_speculative_diagnosis_is_rendered_as_hypothesis(self):
        transcript = "Secondo me potrebbe essere bruxismo."
        note, facts = agent.clinical_note_sections(transcript, {"clinical_note": {
            "diagnosi": {"text": "Bruxismo", "evidence": [transcript]},
        }})
        self.assertEqual(note, "Ipotesi da confermare: Bruxismo.")
        self.assertEqual(facts[0]["category"], "ipotesi")

    def test_numbered_sources_include_short_clinical_clauses(self):
        transcript = "Gengive gonfie. Herpes; candida. Col cortisone è passata."
        segments = agent.indexed_segments(transcript)
        self.assertEqual([s["text"] for s in segments], ["Gengive gonfie.", "Herpes;", "candida.", "Col cortisone è passata."])
        note, facts = agent.clinical_note_sections(transcript, {"clinical_note": {
            "problema": {"text": "Gonfiore gengivale", "evidence_ids": [1]},
            "ipotesi": {"text": "Herpes o candida", "evidence_ids": [2, 3]},
            "terapia_decorso": {"text": "Risolto dopo cortisone", "evidence_ids": [4]},
            "diagnosi": {"text": "Diagnosi inventata", "evidence_ids": [99]},
        }})
        self.assertIn("Ipotesi da confermare: Herpes o candida", note)
        self.assertNotIn("inventata", note)
        self.assertEqual(len(facts), 3)
        self.assertTrue(agent.evidence_in(transcript, "Herpes", allow_short=True))
        self.assertFalse(agent.evidence_in(transcript, "herp", allow_short=True))

    def test_empty_note_recovers_from_single_facts(self):
        transcript = "Ti si sono gonfiate le gengive. Col cortisone è passata."
        recovery = {"actions": [], "observations": [{
            "category": "quadro", "meaning": "Gonfiore gengivale riferito", "evidence": "Ti si sono gonfiate le gengive",
            "source": "riferito", "target": "",
        }]}
        with patch.object(agent, "ask", side_effect=[{"actions": [], "observations": []},
                                                   {"clinical_note": {}}, recovery]) as mock:
            proposal = agent.analyze(transcript, "qwen3:4b")
        self.assertEqual(mock.call_count, 3)
        self.assertIn("Gonfiore gengivale riferito", proposal["diary"]["text"])
        self.assertEqual(proposal["estimate"], [])

    def test_failed_recovery_raises_instead_of_returning_blank_proposal(self):
        with TemporaryDirectory() as folder, patch.object(agent, "HERE", Path(folder)), \
                patch.object(agent, "ask", side_effect=[{"actions": [], "observations": []},
                                                       {"clinical_note": {}}, {"actions": [], "observations": []}]):
            with self.assertRaisesRegex(RuntimeError, "non è stata sostituita"):
                agent.analyze("Ti si sono gonfiate le gengive.", "qwen3:4b")
            debug = json.loads((Path(folder) / "ultima-analisi-debug.json").read_text())
            self.assertIn("recovery_attempt", debug["extracted"][0][1])


if __name__ == "__main__":
    unittest.main()
