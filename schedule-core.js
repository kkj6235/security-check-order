(function (root) {
  "use strict";

  const TIMES = ["08:00", "17:00", "22:00"];
  const WEEKDAYS = ["일", "월", "화", "수", "목", "금", "토"];
  const DAY_MS = 24 * 60 * 60 * 1000;

  function getDays(start, end) {
    function parse(value) {
      if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        throw new Error("시작일과 종료일을 입력해 주세요.");
      }
      const timestamp = Date.parse(`${value}T00:00:00Z`);
      if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
        throw new Error("올바른 시작일과 종료일을 입력해 주세요.");
      }
      return timestamp;
    }

    const first = parse(start);
    const last = parse(end);
    if (first > last) throw new Error("종료일은 시작일보다 빠를 수 없습니다.");
    const count = (last - first) / DAY_MS + 1;
    if (count > 31) throw new Error("한 번에 최대 31일까지 만들 수 있습니다.");
    return Array.from({ length: count }, (_, index) => {
      const day = new Date(first + index * DAY_MS);
      const date = day.toISOString().slice(0, 10);
      return { date, label: `${day.getUTCMonth() + 1}/${day.getUTCDate()}(${WEEKDAYS[day.getUTCDay()]})` };
    });
  }

  function makeSchedule(input, random = Math.random) {
    const days = getDays(input.start, input.end);
    const people = input.participants;
    if (!Array.isArray(people) || people.length < 1 || people.length > 20) {
      throw new Error("참석자 인원은 1~20명이어야 합니다.");
    }
    const names = people.map((person) => typeof person?.name === "string" ? person.name.trim() : "");
    if (names.some((name) => !name) || new Set(names).size !== names.length) {
      throw new Error("모든 참석자의 서로 다른 이름을 입력해 주세요.");
    }
    const unavailable = people.map((person) => new Set(person.unavailable || []));
    const slots = days.flatMap((day) => TIMES.map((time) => ({ date: day.date, time })));
    const slotBase = 1;
    const dayBase = slotBase + slots.length;
    const personBase = dayBase + people.length * days.length;
    const sink = personBase + people.length;
    const graph = Array.from({ length: sink + 1 }, () => []);
    const slotEdges = [];

    function addEdge(from, to, capacity, cost) {
      const forward = { to, capacity, cost, reverse: graph[to].length };
      const backward = { to: from, capacity: 0, cost: -cost, reverse: graph[from].length };
      graph[from].push(forward);
      graph[to].push(backward);
      return forward;
    }

    slots.forEach((slot, slotIndex) => {
      addEdge(0, slotBase + slotIndex, 1, 0);
      const dayIndex = Math.floor(slotIndex / TIMES.length);
      const choices = [];
      const order = Array.from({ length: people.length }, (_, index) => index);
      for (let index = order.length - 1; index > 0; index -= 1) {
        const other = Math.floor(random() * (index + 1));
        [order[index], order[other]] = [order[other], order[index]];
      }
      for (const personIndex of order) {
        if (unavailable[personIndex].has(`${slot.date}|${slot.time}`)) continue;
        const personDay = dayBase + personIndex * days.length + dayIndex;
        choices.push({
          personIndex,
          edge: addEdge(slotBase + slotIndex, personDay, 1, 0)
        });
      }
      if (!choices.length) throw new Error(`${slot.date} ${slot.time}에 가능한 참석자가 없습니다.`);
      slotEdges.push(choices);
    });

    for (let personIndex = 0; personIndex < people.length; personIndex += 1) {
      for (let dayIndex = 0; dayIndex < days.length; dayIndex += 1) {
        const personDay = dayBase + personIndex * days.length + dayIndex;
        for (let turn = 0; turn < TIMES.length; turn += 1) {
          addEdge(personDay, personBase + personIndex, 1, turn === 0 ? 0 : 1);
        }
      }
      for (let turn = 1; turn <= slots.length; turn += 1) {
        addEdge(personBase + personIndex, sink, 1, (2 * turn - 1) * 1000);
      }
    }

    let assigned = 0;
    while (assigned < slots.length) {
      const distance = Array(graph.length).fill(Infinity);
      const previousNode = Array(graph.length).fill(-1);
      const previousEdge = Array(graph.length).fill(-1);
      const queued = Array(graph.length).fill(false);
      const queue = [0];
      let head = 0;
      distance[0] = 0;
      queued[0] = true;

      while (head < queue.length) {
        const node = queue[head++];
        queued[node] = false;
        graph[node].forEach((edge, edgeIndex) => {
          if (edge.capacity === 0 || distance[edge.to] <= distance[node] + edge.cost) return;
          distance[edge.to] = distance[node] + edge.cost;
          previousNode[edge.to] = node;
          previousEdge[edge.to] = edgeIndex;
          if (!queued[edge.to]) {
            queued[edge.to] = true;
            queue.push(edge.to);
          }
        });
      }
      if (previousNode[sink] < 0) break;

      for (let node = sink; node !== 0; node = previousNode[node]) {
        const edge = graph[previousNode[node]][previousEdge[node]];
        edge.capacity -= 1;
        graph[node][edge.reverse].capacity += 1;
      }
      assigned += 1;
    }

    if (assigned !== slots.length) {
      throw new Error(`가능한 날짜·시간만으로 모든 점검을 채울 수 없습니다. 미배정 ${slots.length - assigned}회`);
    }

    const counts = names.map((name) => ({ name, count: 0 }));
    const dayCounts = new Map();
    const entries = slots.map((slot, index) => {
      const choice = slotEdges[index].find(({ edge }) => edge.capacity === 0);
      if (!choice) throw new Error("배정 결과를 확인하지 못했습니다.");
      const { personIndex } = choice;
      counts[personIndex].count += 1;
      const key = `${personIndex}|${slot.date}`;
      dayCounts.set(key, (dayCounts.get(key) || 0) + 1);
      if (unavailable[personIndex].has(`${slot.date}|${slot.time}`)) {
        throw new Error("불가능한 날짜·시간에 배정되었습니다.");
      }
      return { ...slot, name: names[personIndex] };
    });
    const numbers = counts.map((person) => person.count);
    const idealDifference = slots.length % people.length === 0 ? 0 : 1;
    const maxDifference = Math.max(...numbers) - Math.min(...numbers);
    const sameDayRepeats = [...dayCounts.values()].reduce((total, count) => total + Math.max(0, count - 1), 0);

    return {
      days,
      entries,
      counts,
      maxDifference,
      perfectlyBalanced: maxDifference <= idealDifference,
      sameDayRepeats
    };
  }

  const api = { TIMES, getDays, makeSchedule };
  root.SecuritySchedule = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis);
