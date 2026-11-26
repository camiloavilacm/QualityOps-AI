"""Offline calibration controls. Synthetic test votes stay in memory."""

import unittest

import calibrate
import evaluate as ev


class CalibrationTests(unittest.TestCase):
    def setUp(self):
        self.cases = calibrate.packet()["cases"]

    def test_controls_cross_the_intended_validation_boundary(self):
        grades = calibrate.automated(self.cases)
        self.assertEqual(grades, calibrate.automated(self.cases))
        self.assertEqual(grades["A"]["verdict"], "supported")
        self.assertEqual(grades["B"]["claims"], [{"citation_exists": [True], "support": "unsupported"}])
        self.assertEqual(grades["C"]["final_status"], "DIAGNOSED")
        self.assertEqual(grades["C"]["claims"], [{"citation_exists": [True, True], "support": "review_required"}])
        self.assertEqual(grades["D"]["verdict"], "justified_abstention")
        self.assertEqual(grades["E"]["verdict"], "review_required")
        self.assertEqual(grades["F"]["verdict"], "malformed")
        self.assertEqual(grades["F"]["final_status"], "ERROR")
        self.assertTrue(grades["F"]["final_schema_valid"])
        self.assertFalse(grades["F"]["malformed_final_record_control_valid"])

    def test_blind_review_and_aggregate_denominators(self):
        # Synthetic input exercises counting only. Never recorded as a human judgment.
        review = dict(packet_sha256=calibrate.PACKET_SHA, reviewer="test",
                      independent_blind_review=True, judgments={})
        public = calibrate.comparison(review)
        self.assertEqual(public["agreement"], ev.rate([]))
        for case in self.cases[:-1]:
            review["judgments"][case["id"]] = dict(verdict="malformed", rationale="synthetic test")
        with self.assertRaisesRegex(ValueError, "complete blind judgments"):
            calibrate.comparison(review, private=True)
        review["judgments"]["F"] = dict(verdict="malformed", rationale="synthetic test")
        review["judgments"]["A"]["verdict"] = "unresolved"
        report = calibrate.comparison(review)
        self.assertEqual(report["agreement"], ev.rate([True] + [False]*4))
        self.assertEqual((report["disagreements"], report["unresolved"]), (2, 3))
        self.assertNotIn("cases", report)
        details = calibrate.comparison(review, private=True)["cases"]
        self.assertEqual(len(details), 6)
        self.assertEqual(details[0]["human"], review["judgments"]["A"])
        review["independent_blind_review"] = False
        with self.assertRaisesRegex(ValueError, "attestation"):
            calibrate.comparison(review)
        review["packet_sha256"] = "0"*64
        with self.assertRaisesRegex(ValueError, "different review packet"):
            calibrate.comparison(review)

    def test_committed_aggregate_replays_byte_for_byte(self):
        review = ev.decode(ev.read(calibrate.DIRECTORY / "judgments.json"))
        self.assertEqual(ev.encode(calibrate.comparison(review)),
                         ev.read(calibrate.DIRECTORY / "aggregate.json"))

    def test_review_material_is_outside_investigator_tools(self):
        from backend.investigator.examples import Script, backend, read
        from backend.investigator.investigator import invoke
        fixture = self.cases[0]["fixture"]
        for target in ("judgments.json", "evaluators/calibration/v1/judgments.json", calibrate.PACKET_SHA):
            with self.subTest(target=target):
                request = read(target)
                request["output"]["message"]["content"][0]["toolUse"]["toolUseId"] = "review-read"
                script = Script(read("a1", "a2"), request)
                result, _ = invoke({"fixture_id": fixture}, backend=backend(script))
                self.assertEqual(result["uncertainties"], ["unauthorized_evidence"])
                returned = script.requests[1]["messages"][-1]["content"]
                self.assertEqual([row["toolResult"]["content"][0]["json"] for row in returned],
                                 ev.model_input(fixture)["observations"])
                self.assertEqual(len(script.requests), 2)
                with self.assertRaises(ValueError):
                    invoke({"fixture_id": target}, backend=backend(script))
                self.assertEqual(len(script.requests), 2)
