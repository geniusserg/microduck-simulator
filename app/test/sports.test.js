import test from "node:test";
import assert from "node:assert/strict";
import { createMatch, FOOTBALL_RADIUS } from "../src/game/sports.js";
import { CTRL_DT, ARENA_HALF } from "../src/game/constants.js";

function fixture(kind) {
  const data = { qpos: new Float64Array(24), qvel: new Float64Array(24) };
  const model = { jnt: () => ({ qposadr: 7, dofadr: 6 }) };
  const state = {},
    sounds = [];
  const match = createMatch(
    kind,
    data,
    model,
    14,
    12,
    (delta) => Object.assign(state, delta),
    (...cue) => sounds.push(cue),
  );
  const step = (n = 1) => {
    while (n--) match.update(false);
  };
  step();
  return { data, state, sounds, match, step };
}

test("both skaters return before kickoff, even with the manual switch on", () => {
  const { data, state, sounds, match, step } = fixture("football");
  const blueHome = Array.from(data.qpos.slice(7, 9));
  for (let n = 1; n <= 3; n++) {
    data.qpos[14] = ARENA_HALF - 0.34 + FOOTBALL_RADIUS + 0.01;
    data.qpos[15] = 0;
    data.qpos[16] = FOOTBALL_RADIUS;
    data.qpos[7] = 1.85;
    step();
    assert.deepEqual(state.score, [n, 0]);
    assert.equal(match.ownsWhite, true);
    for (let j = 0; j < 120; j++) match.update(true);
    assert.equal(match.ownsWhite, true);
    data.qpos.set(blueHome, 7);
    step();
    if (n < 3) assert.equal(match.ownsWhite, false);
  }
  assert.ok(match.fireworks);
  assert.equal(state.winner, "White");
  assert.ok(sounds.some(([name, i]) => name === "disappointed" && i === 1));
});

test("a contested ball is cleared within six seconds", () => {
  const { data, sounds, step } = fixture("football");
  data.qpos[14] = data.qpos[15] = 0;
  data.qpos[0] = -0.21;
  data.qpos[1] = 0;
  data.qpos[7] = 0.21;
  data.qpos[8] = 0;
  let elapsed = 0;
  while (Math.hypot(data.qvel[12], data.qvel[13]) < 4 && elapsed < 6) {
    step();
    elapsed += CTRL_DT;
  }
  assert.ok(elapsed >= 1 && elapsed < 6);
  assert.ok(sounds.some(([name]) => name === "duel"));
});

test("circuit counts actual completed revolutions and schedules a breathing break", () => {
  const { data, state, sounds, step, match } = fixture("circuit");
  let rested = false,
    resumed = false;
  for (let k = 0; k < 3400; k++) {
    const a = Math.max(0, k * CTRL_DT - 3) * 0.46;
    for (const [r, idx] of [
      [1.62, 0],
      [1.98, 7],
    ])
      data.qpos.set([r * Math.cos(a), r * Math.sin(a)], idx);
    step();
    if (match.breath > 0) rested = true;
    else if (rested) resumed = true;
  }
  assert.ok(state.laps.every((n) => n >= 3));
  assert.ok(state.metres.every((x) => x > 30));
  assert.ok(sounds.some(([s]) => s === "breath"));
  assert.ok(resumed);
});
