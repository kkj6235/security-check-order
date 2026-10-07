import json
import unittest
from collections import Counter
from copy import deepcopy
from datetime import date
from pathlib import Path

import scheduler


class ScheduleTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.raw = json.loads(Path(__file__).with_name("availability.json").read_text(encoding="utf-8"))
        cls.people = scheduler.validate_participants(cls.raw)
        cls.schedule = scheduler.make_schedule(cls.people)

    def test_every_day_and_time_has_one_assignment(self):
        expected = {(day.isoformat(), time) for day in scheduler.DAYS for time in scheduler.TIMES}
        actual = [(entry["date"], entry["time"]) for entry in self.schedule]
        self.assertEqual(len(actual), 39)
        self.assertEqual(len(set(actual)), 39)
        self.assertEqual(set(actual), expected)

    def test_counts_are_as_equal_as_possible(self):
        counts = Counter(entry["name"] for entry in self.schedule)
        self.assertEqual(sorted(counts.values()), [7, 8, 8, 8, 8])
        self.assertEqual(len(counts), 5)

    def test_no_one_is_assigned_twice_a_day(self):
        assigned = [(entry["date"], entry["name"]) for entry in self.schedule]
        self.assertEqual(len(assigned), len(set(assigned)))

    def test_every_assignment_respects_raw_availability(self):
        by_name = {person["name"]: person for person in self.raw["participants"]}
        for entry in self.schedule:
            person = by_name[entry["name"]]
            with self.subTest(**entry):
                self.assertIn(entry["date"], person["available_dates"])
                self.assertIn(entry["time"], person["available_times"])
                self.assertNotIn(
                    {"date": entry["date"], "time": entry["time"]},
                    person["unavailable_slots"],
                )

    def test_unavailable_days_times_and_slot_overrides(self):
        by_name = {person["name"]: person for person in self.people}
        self.assertFalse(scheduler.can_assign(by_name["김하린"], date(2026, 10, 11), "08:00"))
        self.assertFalse(scheduler.can_assign(by_name["김하린"], date(2026, 10, 7), "22:00"))
        self.assertFalse(scheduler.can_assign(by_name["이서윤"], date(2026, 10, 18), "08:00"))
        self.assertTrue(scheduler.can_assign(by_name["이서윤"], date(2026, 10, 18), "22:00"))

    def test_validation_rejects_unavailable_assignment(self):
        altered = [entry.copy() for entry in self.schedule]
        altered[0]["name"] = "박도윤"
        with self.assertRaisesRegex(ValueError, "불가능한 날짜·시간"):
            scheduler.check_schedule(altered, self.people)

    def test_validation_rejects_missing_or_double_day_assignment(self):
        with self.assertRaisesRegex(ValueError, "누락 또는 중복"):
            scheduler.check_schedule(self.schedule[:-1], self.people)
        altered = [entry.copy() for entry in self.schedule]
        altered[1]["name"] = altered[0]["name"]
        with self.assertRaisesRegex(ValueError, "하루에 두 번"):
            scheduler.check_schedule(altered, self.people)

    def test_unschedulable_slot_is_reported(self):
        raw = deepcopy(self.raw)
        raw["participants"][3]["available_dates"].remove("2026-10-18")
        with self.assertRaisesRegex(ValueError, "가능한 참석자가 없습니다"):
            scheduler.make_schedule(scheduler.validate_participants(raw))

    def test_impossible_balanced_counts_are_reported(self):
        raw = deepcopy(self.raw)
        raw["participants"][0]["available_dates"] = ["2026-10-07"]
        raw["participants"][0]["unavailable_slots"] = []
        with self.assertRaisesRegex(ValueError, "배정 불가"):
            scheduler.make_schedule(scheduler.validate_participants(raw))

    def test_bad_names_dates_times_and_overrides_are_rejected(self):
        changes = (
            lambda raw: raw["participants"][1].update(name=raw["participants"][0]["name"]),
            lambda raw: raw["participants"][0]["available_dates"].append("2026-10-20"),
            lambda raw: raw["participants"][0]["available_times"].append("13:00"),
            lambda raw: raw["participants"][0]["unavailable_slots"].append(
                {"date": "2026-10-11", "time": "08:00"}
            ),
        )
        for change in changes:
            raw = deepcopy(self.raw)
            change(raw)
            with self.subTest(change=change):
                with self.assertRaises(ValueError):
                    scheduler.validate_participants(raw)

    def test_report_includes_counts_and_availability_audit(self):
        report = scheduler.make_report(self.schedule, self.people)
        self.assertIn("총 배정: 39/39회", report)
        self.assertIn("최대·최소 횟수 차이: 1회", report)
        self.assertIn("불가능 날짜", report)
        self.assertIn("추가 불가", report)


if __name__ == "__main__":
    unittest.main()
