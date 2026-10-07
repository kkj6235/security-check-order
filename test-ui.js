const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { getDays, makeSchedule, TIMES } = require("./schedule-core.js");

const names = ["김하린", "박도윤", "이서윤", "최민재", "정지우"];

function input(participants = names.map((name) => ({ name, unavailable: [] })), start = "2026-10-07", end = "2026-10-19") {
  return { start, end, participants };
}

test("시작일과 종료일을 포함해 날짜와 요일을 만든다", () => {
  const days = getDays("2026-10-07", "2026-10-19");
  assert.equal(days.length, 13);
  assert.deepEqual(days[0], { date: "2026-10-07", label: "10/7(수)" });
  assert.deepEqual(days.at(-1), { date: "2026-10-19", label: "10/19(월)" });
  assert.equal(getDays("2028-02-28", "2028-03-01").length, 3);
});

test("가용 인원 5명의 39개 회차를 7·8회로 균등 배정한다", () => {
  const result = makeSchedule(input());
  assert.equal(result.entries.length, 39);
  assert.deepEqual(result.counts.map(({ count }) => count).sort(), [7, 8, 8, 8, 8]);
  assert.equal(result.maxDifference, 1);
  assert.equal(result.perfectlyBalanced, true);
  assert.equal(result.sameDayRepeats, 0);
  const slots = new Set(result.entries.map(({ date, time }) => `${date}|${time}`));
  assert.equal(slots.size, 39);
  for (const day of result.days) for (const time of TIMES) assert.ok(slots.has(`${day.date}|${time}`));
});

test("인원이 세 명보다 적으면 필요한 하루 중복을 표시한다", () => {
  const result = makeSchedule(input(
    [{ name: "가", unavailable: [] }, { name: "나", unavailable: [] }],
    "2026-10-07",
    "2026-10-07"
  ));
  assert.deepEqual(result.counts.map(({ count }) => count).sort(), [1, 2]);
  assert.equal(result.sameDayRepeats, 1);
});

test("날짜·시간별 체크 해제 조건을 반드시 지킨다", () => {
  const day = "2026-10-07";
  const people = [
    { name: "가", unavailable: [`${day}|17:00`, `${day}|22:00`] },
    { name: "나", unavailable: [`${day}|08:00`, `${day}|22:00`] },
    { name: "다", unavailable: [`${day}|08:00`, `${day}|17:00`] }
  ];
  assert.deepEqual(makeSchedule(input(people, day, day)).entries.map(({ name }) => name), ["가", "나", "다"]);
});

test("기존 예시의 불가능한 날·시간·추가 불가 회차도 모두 피한다", () => {
  const raw = JSON.parse(fs.readFileSync(path.join(__dirname, "availability.json"), "utf8"));
  const days = getDays("2026-10-07", "2026-10-19");
  const people = raw.participants.map((person) => {
    const unavailable = [];
    for (const day of days) for (const time of TIMES) {
      if (!person.available_dates.includes(day.date)
        || !person.available_times.includes(time)
        || person.unavailable_slots.some((slot) => slot.date === day.date && slot.time === time)) {
        unavailable.push(`${day.date}|${time}`);
      }
    }
    return { name: person.name, unavailable };
  });
  const result = makeSchedule(input(people));
  assert.deepEqual(result.counts.map(({ count }) => count).sort(), [7, 8, 8, 8, 8]);
  assert.equal(result.sameDayRepeats, 0);
  for (const entry of result.entries) {
    assert.equal(people.find((person) => person.name === entry.name).unavailable.includes(`${entry.date}|${entry.time}`), false);
  }
});

test("한 회차에 가능한 사람이 없으면 잘못된 당직표 대신 오류를 낸다", () => {
  const day = "2026-10-07";
  const people = ["가", "나", "다"].map((name) => ({ name, unavailable: [`${day}|08:00`] }));
  assert.throws(() => makeSchedule(input(people, day, day)), /가능한 참석자가 없습니다/);
});

test("가용성 때문에 완전 균형이 불가능하면 배정하고 그 차이를 표시한다", () => {
  const days = getDays("2026-10-07", "2026-10-08");
  const unavailable = days.flatMap(({ date }) => TIMES.map((time) => `${date}|${time}`));
  const people = [
    { name: "가", unavailable },
    { name: "나", unavailable: [] },
    { name: "다", unavailable: [] },
    { name: "라", unavailable: [] }
  ];
  const result = makeSchedule(input(people, "2026-10-07", "2026-10-08"));
  assert.equal(result.entries.length, 6);
  assert.equal(result.counts[0].count, 0);
  assert.equal(result.perfectlyBalanced, false);
  assert.ok(result.maxDifference > 1);
});

test("날짜 역전·31일 초과·이름 누락과 중복을 거부한다", () => {
  assert.throws(() => getDays("2026-10-19", "2026-10-07"), /종료일/);
  assert.throws(() => getDays("2026-10-01", "2026-11-01"), /최대 31일/);
  assert.throws(() => makeSchedule(input([{ name: "", unavailable: [] }])), /이름/);
  assert.throws(() => makeSchedule(input([{ name: "가" }, { name: "가" }])), /서로 다른/);
  assert.throws(() => makeSchedule(input([])), /1~20명/);
});

test("인원과 날짜가 바뀌어도 결과 구조를 유지한다", () => {
  const result = makeSchedule(input(
    ["가", "나", "다", "라"].map((name) => ({ name, unavailable: [] })),
    "2026-11-01",
    "2026-11-02"
  ));
  assert.equal(result.days.length, 2);
  assert.equal(result.entries.length, 6);
  assert.deepEqual(result.counts.map(({ count }) => count).sort(), [1, 1, 2, 2]);
});

test("동률 선택은 난수에 따라 달라도 동일한 난수에는 재현되며 균형과 가용성을 지킨다", () => {
  const seeded = (start) => {
    let seed = start;
    return () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
  };
  const sample = input(undefined, "2026-10-07", "2026-10-09");
  const outcomes = Array.from({ length: 6 }, (_, index) => {
    const result = makeSchedule(sample, seeded(index + 1));
    assert.equal(result.maxDifference, 1);
    assert.equal(result.sameDayRepeats, 0);
    return result.entries.map((entry) => entry.name).join(",");
  });
  assert.ok(new Set(outcomes).size > 1, "동률인데도 모든 난수에 동일한 당직표");
  assert.equal(outcomes[0], makeSchedule(sample, seeded(1)).entries.map((entry) => entry.name).join(","));
});

test("index.html이 3단계 캘린더와 이름·기간·결과 영역을 포함한다", () => {
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  for (const id of [
    "personCount", "startDate", "endDate", "people", "setup", "availability",
    "personTabs", "availabilityCalendar", "dayEditor", "blockWholeDay",
    "result", "resultCalendar", "dayAssignments", "countBody"
  ]) {
    assert.ok(html.includes(`id="${id}"`), `${id} 입력/출력 영역 누락`);
  }
  assert.ok(html.includes('<script src="schedule-core.js"></script>'));
});

function openUi() {
  function element(tag = "div") {
    return {
      tag, children: [],
      dataset: new Proxy({}, { set(target, key, value) { target[key] = String(value); return true; } }),
      style: {}, className: "", value: "", checked: false, attributes: {},
      _text: "", events: {}, hidden: false,
      setAttribute(key, value) { this.attributes[key] = String(value); },
      getAttribute(key) { return this.attributes[key]; },
      focus() { this.focused = true; },
      set textContent(value) { this._text = String(value); this.children = []; },
      get textContent() { return this._text; },
      append(...children) {
        for (const child of children) {
          child.parent = this;
          this.children.push(child);
        }
      },
      replaceChildren(...children) { this.children = []; this.append(...children); },
      querySelectorAll(selector) {
        const found = [];
        const visit = (node) => {
          for (const child of node.children) {
            if (child.matches(selector)) found.push(child);
            visit(child);
          }
        };
        visit(this);
        return found;
      },
      querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
      matches(selector) {
        if (selector === "input" || selector === "button") return this.tag === selector;
        if (selector === "button[data-calendar-date]") return this.tag === "button" && !!this.dataset.calendarDate;
        if (selector === "button[data-person-choice]") return this.tag === "button" && !!this.dataset.personChoice;
        return false;
      },
      closest(selector) {
        for (let node = this; node; node = node.parent) {
          if (node.matches(selector)) return node;
        }
        return null;
      },
      addEventListener(type, callback) { this.events[type] = callback; }
    };
  }

  const selectors = [
    "planner", "personCount", "startDate", "endDate", "people", "message", "setup",
    "availability", "availabilityMessage", "result", "personTabs", "availabilityCalendar",
    "dayEditor", "blockWholeDay", "stats", "notice", "resultCalendar",
    "resultDayTitle", "dayAssignments", "countBody", "toAvailability",
    "backToSetup", "backToAvailability"
  ];
  const nodes = Object.fromEntries(selectors.map((name) => [`#${name}`, element()]));
  const steps = [1, 2, 3].map((index) => {
    const item = element("li");
    item.dataset.step = index;
    return item;
  });
  nodes["#personCount"].value = "5";
  nodes["#startDate"].value = "2026-10-07";
  nodes["#endDate"].value = "2026-10-19";
  const document = {
    querySelector(selector) { return nodes[selector]; },
    querySelectorAll(selector) { return selector === ".steps li" ? steps : []; },
    createElement: element,
  };
  const html = fs.readFileSync(path.join(__dirname, "index.html"), "utf8");
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  vm.runInNewContext(inline, { document, SecuritySchedule: require("./schedule-core.js") });
  const get = (id) => nodes[`#${id}`];
  const click = (id) => get(id).events.click({});
  const chooseDate = (calendar, date) => {
    const button = get(calendar).querySelectorAll("button[data-calendar-date]")
      .find((item) => item.dataset.calendarDate === date);
    assert.ok(button, `${calendar}에서 ${date} 누락`);
    get(calendar).events.click({ target: button.children[0] });
  };
  return { get, click, chooseDate, steps, nodes };
}

test("인원·이름·날짜 유효성을 검사하고 1단계에서 2단계로 이동한다", () => {
  const { get, click, steps } = openUi();
  assert.equal(get("people").children.length, 5);
  get("personCount").value = "6";
  get("personCount").events.change();
  assert.equal(get("people").children.length, 6);
  click("toAvailability");
  assert.match(get("message").textContent, /이름/);
  assert.equal(get("availability").hidden, true);
  const lastName = get("people").children[5].querySelector("input");
  lastName.value = "한도윤";
  get("people").events.input({ target: lastName });
  get("endDate").value = "2026-10-06";
  click("toAvailability");
  assert.match(get("message").textContent, /종료일/);
  get("endDate").value = "2026-10-19";
  click("toAvailability");
  assert.equal(get("availability").hidden, false);
  assert.equal(get("setup").hidden, true);
  assert.equal(steps[1].className, "active");
  assert.equal(get("personTabs").children.length, 6);
  assert.equal(get("availabilityCalendar").querySelectorAll("button[data-calendar-date]").length, 13);
});

test("참석자별 날짜·시간 다중 제외, 하루 전체 제외와 해제를 캘린더에서 변경한다", () => {
  const { get, click, chooseDate } = openUi();
  click("toAvailability");
  chooseDate("availabilityCalendar", "2026-10-08");
  for (const time of ["08:00", "22:00"]) {
    const box = get("dayEditor").querySelectorAll("input").find((item) => item.dataset.blockTime === time);
    box.checked = true;
    get("dayEditor").events.change({ target: box });
  }
  assert.match(get("availabilityCalendar").querySelectorAll("button[data-calendar-date]")[1].children[1].textContent, /불가 2\/3/);
  assert.match(get("personTabs").children[0].textContent, /불가 2회/);
  get("personTabs").events.click({ target: get("personTabs").children[1] });
  assert.equal(get("personTabs").children[1].focused, true);
  assert.ok(get("dayEditor").querySelectorAll("input").every((box) => !box.checked));
  chooseDate("availabilityCalendar", "2026-10-07");
  click("blockWholeDay");
  assert.ok(get("dayEditor").querySelectorAll("input").every((box) => box.checked));
  click("blockWholeDay");
  assert.ok(get("dayEditor").querySelectorAll("input").every((box) => !box.checked));
  get("personTabs").events.click({ target: get("personTabs").children[0] });
  chooseDate("availabilityCalendar", "2026-10-08");
  assert.equal(get("dayEditor").querySelectorAll("input")[0].focused, true);
  assert.deepEqual(get("dayEditor").querySelectorAll("input").map((box) => box.checked), [true, false, true]);
});

test("월이 바뀌는 기간도 월별 달력에 분리하고 날짜별 선택을 유지한다", () => {
  const { get, click, chooseDate } = openUi();
  get("startDate").value = "2026-10-30";
  get("endDate").value = "2026-11-02";
  click("toAvailability");
  assert.equal(get("availabilityCalendar").children.length, 2);
  chooseDate("availabilityCalendar", "2026-11-01");
  click("blockWholeDay");
  chooseDate("availabilityCalendar", "2026-10-31");
  chooseDate("availabilityCalendar", "2026-11-01");
  assert.ok(get("dayEditor").querySelectorAll("input").every((box) => box.checked));
  get("planner").events.submit({ preventDefault() {} });
  assert.equal(get("resultCalendar").children.length, 2);
  chooseDate("resultCalendar", "2026-11-02");
  assert.match(get("resultDayTitle").textContent, /2026-11-02/);
});

test("3단계에서 날짜를 클릭해 3개 시간대 담당자를 확인하고 제외 시간에는 배정하지 않는다", () => {
  const { get, click, chooseDate, steps } = openUi();
  click("toAvailability");
  chooseDate("availabilityCalendar", "2026-10-07");
  click("blockWholeDay");
  chooseDate("availabilityCalendar", "2026-10-08");
  const box = get("dayEditor").querySelectorAll("input")[1];
  box.checked = true;
  get("dayEditor").events.change({ target: box });
  get("planner").events.submit({ preventDefault() {} });
  assert.equal(get("result").hidden, false);
  assert.equal(steps[2].className, "active");
  assert.equal(get("resultCalendar").querySelectorAll("button[data-calendar-date]").length, 13);
  assert.equal(get("dayAssignments").children.length, 3);
  assert.ok(get("dayAssignments").children.every((item) => item.children[1].textContent !== "김하린"));
  chooseDate("resultCalendar", "2026-10-08");
  assert.equal(get("resultCalendar").querySelectorAll("button[data-calendar-date]")[1].focused, true);
  assert.match(get("resultDayTitle").textContent, /2026-10-08/);
  assert.equal(get("dayAssignments").children[1].children[0].textContent, "17:00");
  assert.notEqual(get("dayAssignments").children[1].children[1].textContent, "김하린");
  assert.equal(get("countBody").children.length, 5);
  click("backToAvailability");
  assert.equal(get("availability").hidden, false);
  click("backToSetup");
  get("endDate").value = "2026-10-08";
  click("toAvailability");
  assert.equal(get("availabilityCalendar").querySelectorAll("button[data-calendar-date]").length, 2);
});

test("아무도 불가능한 회차는 오류를 보여주고 결과 단계로 이동하지 않는다", () => {
  const { get, click } = openUi();
  click("toAvailability");
  for (let index = 0; index < 5; index += 1) {
    get("personTabs").events.click({ target: get("personTabs").children[index] });
    const box = get("dayEditor").querySelectorAll("input")[0];
    box.checked = true;
    get("dayEditor").events.change({ target: box });
  }
  get("planner").events.submit({ preventDefault() {} });
  assert.match(get("availabilityMessage").textContent, /가능한 참석자가 없습니다/);
  assert.equal(get("result").hidden, true);
  assert.equal(get("availability").hidden, false);
});
