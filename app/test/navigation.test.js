import test from "node:test";
import assert from "node:assert/strict";
import { directionTo } from "../src/game/navigation.js";
import { createWander } from "../src/game/wander.js";

test("a target behind the tree takes the duck around the gifts", () => {
  let x = -1,
    y = 0.03,
    minRadius = Infinity;
  for (
    let step = 0;
    step < 1100 && Math.hypot(1 - x, 0.03 - y) > 0.03;
    step++
  ) {
    const angle = directionTo(x, y, 1, 0.03, 1.44, true);
    x += 0.004 * Math.cos(angle);
    y += 0.004 * Math.sin(angle);
    minRadius = Math.min(minRadius, Math.hypot(x, y));
  }
  assert.ok(minRadius > 0.45);
  assert.ok(Math.hypot(1 - x, 0.03 - y) < 0.04);
});

test("wander can reverse away from a wall while facing it", () => {
  const wander = createWander({ arenaHalf: 3 });
  wander.start();
  wander.update(0.02, 2.91, 0, 0, null, [0.6, -0.5, 0.3], true, false, null);
  assert.ok(wander.command[0] < 0);
});
