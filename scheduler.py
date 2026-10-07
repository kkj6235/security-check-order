"""가능한 날짜·시간을 지키면서 보안 점검 당직을 배정한다."""

import json
from collections import Counter, deque
from datetime import date, timedelta
from pathlib import Path


START = date(2026, 10, 7)
END = date(2026, 10, 19)
TIMES = ("08:00", "17:00", "22:00")
DAYS = tuple(START + timedelta(days=offset) for offset in range((END - START).days + 1))
WEEKDAYS = ("월", "화", "수", "목", "금", "토", "일")


def parse_day(value):
    if not isinstance(value, str):
        raise ValueError("가능 날짜는 YYYY-MM-DD 문자열이어야 합니다.")
    try:
        day = date.fromisoformat(value)
    except ValueError as error:
        raise ValueError(f"잘못된 날짜: {value}") from error
    if day.isoformat() != value or day not in DAYS:
        raise ValueError(f"기간 밖이거나 형식이 잘못된 날짜: {value}")
    return day


def load_participants(path):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    return validate_participants(data)


def validate_participants(data):
    raw_people = data.get("participants") if isinstance(data, dict) else None
    if not isinstance(raw_people, list) or len(raw_people) != 5:
        raise ValueError("참석자는 정확히 5명이어야 합니다.")

    people = []
    names = set()
    for raw in raw_people:
        if not isinstance(raw, dict):
            raise ValueError("참석자 정보는 객체여야 합니다.")
        name = raw.get("name")
        if not isinstance(name, str) or not name.strip() or any(char in name for char in "|\r\n<>"):
            raise ValueError("참석자 이름이 비었거나 표에 쓸 수 없는 문자를 포함합니다.")
        name = name.strip()
        if name in names:
            raise ValueError(f"중복된 참석자 이름: {name}")
        names.add(name)

        raw_dates = raw.get("available_dates")
        raw_times = raw.get("available_times")
        raw_blocked = raw.get("unavailable_slots", [])
        if not isinstance(raw_dates, list) or not raw_dates:
            raise ValueError(f"{name}: 가능 날짜 목록이 필요합니다.")
        if not isinstance(raw_times, list) or not raw_times:
            raise ValueError(f"{name}: 가능 시간 목록이 필요합니다.")
        if not isinstance(raw_blocked, list):
            raise ValueError(f"{name}: 불가 슬롯은 목록이어야 합니다.")

        dates = [parse_day(value) for value in raw_dates]
        if len(set(dates)) != len(dates):
            raise ValueError(f"{name}: 가능 날짜가 중복되었습니다.")
        if any(not isinstance(value, str) or value not in TIMES for value in raw_times):
            raise ValueError(f"{name}: 가능 시간에 잘못된 값이 있습니다.")
        if len(set(raw_times)) != len(raw_times):
            raise ValueError(f"{name}: 가능 시간에 잘못된 값이나 중복이 있습니다.")

        blocked = set()
        for item in raw_blocked:
            if not isinstance(item, dict):
                raise ValueError(f"{name}: 불가 슬롯의 형식이 잘못되었습니다.")
            day, time = parse_day(item.get("date")), item.get("time")
            if not isinstance(time, str) or day not in dates or time not in raw_times or (day, time) in blocked:
                raise ValueError(f"{name}: 불가 슬롯이 중복되었거나 가능 범위 밖입니다.")
            blocked.add((day, time))

        people.append({
            "name": name,
            "available_dates": set(dates),
            "available_times": set(raw_times),
            "unavailable_slots": blocked,
        })
    return people


def can_assign(person, day, time):
    return (
        day in person["available_dates"]
        and time in person["available_times"]
        and (day, time) not in person["unavailable_slots"]
    )


def make_schedule(people):
    """각 회차를 한 사람에게 배정하고, 하루 중복과 횟수 편차를 제한한다."""
    if len(people) != 5 or len({person["name"] for person in people}) != 5:
        raise ValueError("이름이 서로 다른 참석자 5명이 필요합니다.")

    slots = [(day, time) for day in DAYS for time in TIMES]
    slot_base = 1
    day_base = slot_base + len(slots)
    person_base = day_base + len(people) * len(DAYS)
    sink = person_base + len(people)
    graph = [[] for _ in range(sink + 1)]

    def add_edge(source, target, capacity):
        graph[source].append([target, capacity, len(graph[target])])
        graph[target].append([source, 0, len(graph[source]) - 1])

    for index, (day, time) in enumerate(slots):
        slot_node = slot_base + index
        add_edge(0, slot_node, 1)
        day_index, time_index = divmod(index, len(TIMES))
        first = (day_index * len(TIMES) + time_index) % len(people)
        eligible = 0
        for offset in range(len(people)):
            person_index = (first + offset) % len(people)
            if can_assign(people[person_index], day, time):
                person_day_node = day_base + person_index * len(DAYS) + day_index
                add_edge(slot_node, person_day_node, 1)
                eligible += 1
        if not eligible:
            raise ValueError(f"{day} {time}: 가능한 참석자가 없습니다.")

    for person_index in range(len(people)):
        for day_index in range(len(DAYS)):
            person_day_node = day_base + person_index * len(DAYS) + day_index
            add_edge(person_day_node, person_base + person_index, 1)
        add_edge(person_base + person_index, sink, 8)

    flow = 0
    while flow < len(slots):
        previous = [None] * len(graph)
        previous[0] = (0, -1)
        queue = deque([0])
        while queue and previous[sink] is None:
            current = queue.popleft()
            for edge_index, (target, capacity, _) in enumerate(graph[current]):
                if capacity > 0 and previous[target] is None:
                    previous[target] = (current, edge_index)
                    queue.append(target)
        if previous[sink] is None:
            break

        current = sink
        while current != 0:
            source, edge_index = previous[current]
            edge = graph[source][edge_index]
            edge[1] -= 1
            graph[current][edge[2]][1] += 1
            current = source
        flow += 1

    if flow != len(slots):
        raise ValueError(
            f"{len(slots) - flow}회 배정 불가: 가능 날짜·시간, 하루 최대 1회, "
            "각자 7~8회 조건을 동시에 만족할 수 없습니다."
        )

    schedule = []
    for index, (day, time) in enumerate(slots):
        slot_node = slot_base + index
        assigned = [
            (edge[0] - day_base) // len(DAYS)
            for edge in graph[slot_node]
            if day_base <= edge[0] < person_base and edge[1] == 0
        ]
        if len(assigned) != 1:
            raise ValueError(f"{day} {time}: 배정 결과를 확인할 수 없습니다.")
        schedule.append({"date": day.isoformat(), "time": time, "name": people[assigned[0]]["name"]})

    check_schedule(schedule, people)
    return schedule


def check_schedule(schedule, people):
    expected = {(day.isoformat(), time) for day in DAYS for time in TIMES}
    slots = [(entry["date"], entry["time"]) for entry in schedule]
    if len(slots) != len(expected) or set(slots) != expected:
        raise ValueError("39개 회차에 누락 또는 중복이 있습니다.")

    by_name = {person["name"]: person for person in people}
    counts = Counter({name: 0 for name in by_name})
    assigned_days = set()
    for entry in schedule:
        name, day_text, time = entry["name"], entry["date"], entry["time"]
        person = by_name.get(name)
        if person is None or not can_assign(person, date.fromisoformat(day_text), time):
            raise ValueError(f"{day_text} {time}: {name}의 불가능한 날짜·시간에 배정되었습니다.")
        if (name, day_text) in assigned_days:
            raise ValueError(f"{day_text}: {name}이(가) 하루에 두 번 배정되었습니다.")
        assigned_days.add((name, day_text))
        counts[name] += 1

    if sorted(counts.values()) != [7, 8, 8, 8, 8]:
        raise ValueError(f"배정 횟수가 공정 기준에 맞지 않습니다: {dict(counts)}")
    return counts


def make_report(schedule, people):
    counts = check_schedule(schedule, people)
    by_slot = {(entry["date"], entry["time"]): entry["name"] for entry in schedule}
    lines = [
        "# 보안 점검 당직 순서 — 가상 예시",
        "",
        "> **실제 당직에 사용하지 마세요.** 이름과 가능 날짜·시간은 모두 가짜 데이터입니다.",
        "",
        "- 기간: 2026-10-07 ~ 2026-10-19 (양끝 포함, 13일)",
        "- 점검: 매일 08:00, 17:00, 22:00 (총 39회)",
        "- 배정 원칙: 가능 날짜·시간만 사용, 추가 불가 슬롯 제외, 1인 하루 최대 1회, 8·8·8·8·7회",
        "",
        "## 당직표",
        "",
        "| 날짜 | 08:00 | 17:00 | 22:00 |",
        "| --- | --- | --- | --- |",
    ]
    for day in DAYS:
        label = f"{day.month}/{day.day}({WEEKDAYS[day.weekday()]})"
        names = [by_slot[(day.isoformat(), time)] for time in TIMES]
        lines.append(f"| {label} | {' | '.join(names)} |")

    lines += ["", "## 횟수 검토", "", "| 참석자 | 배정 횟수 |", "| --- | ---: |"]
    for person in people:
        lines.append(f"| {person['name']} | {counts[person['name']]}회 |")
    lines += [
        "",
        f"- 총 배정: {sum(counts.values())}/39회, 누락·중복: 0회",
        f"- 최대·최소 횟수 차이: {max(counts.values()) - min(counts.values())}회",
        "- 가능하지 않은 날짜·시간 또는 추가 불가 슬롯에 배정: 0회",
        "- 같은 사람의 하루 중복 배정: 0회",
        "",
        "## 가상 가능 조건 검토",
        "",
        "목록에 없는 날짜는 불가능한 날입니다. `추가 불가`는 가능한 날·시간 중 제외할 회차입니다.",
        "",
    ]
    for person in people:
        possible = ", ".join(f"{day.month}/{day.day}" for day in sorted(person["available_dates"]))
        impossible = ", ".join(
            f"{day.month}/{day.day}" for day in DAYS if day not in person["available_dates"]
        )
        times = ", ".join(sorted(person["available_times"]))
        blocked = ", ".join(
            f"{day.month}/{day.day} {time}" for day, time in sorted(person["unavailable_slots"])
        ) or "없음"
        lines.append(
            f"- **{person['name']}**: 가능 날짜 {possible}; 불가능 날짜 {impossible}; "
            f"가능 시간 {times}; 추가 불가 {blocked}"
        )
    lines += ["", "실제 참석자와 가능 날짜·시간을 받으면 `availability.json`을 바꿔 다시 생성해야 합니다.", ""]
    return "\n".join(lines)


def main():
    folder = Path(__file__).resolve().parent
    try:
        people = load_participants(folder / "availability.json")
        schedule = make_schedule(people)
        (folder / "schedule.md").write_text(make_report(schedule, people), encoding="utf-8")
    except (OSError, ValueError) as error:
        print(f"생성 실패: {error}")
        return 1
    counts = check_schedule(schedule, people)
    print(f"생성 완료: 39회, 횟수 {sorted(counts.values())}, 유효성 검사 통과")
    print(folder / "schedule.md")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
