import test from "node:test";
import assert from "node:assert/strict";
import {
  extractJson,
  normalizeDialogue,
  MAX_LINES_PER_DUCK,
  getSettings,
  canChat,
  usageSummary,
  DEFAULT_DAILY_TOKENS,
  DEFAULT_COOLDOWN_MS,
} from "../src/game/deepseek.js";

test("extractJson parses a plain object", () => {
  assert.deepEqual(extractJson('{"lines":[]}'), { lines: [] });
});

test("extractJson parses a fenced reply with surrounding prose", () => {
  const text = 'Sure! Here you go:\n```json\n{"lines":[{"duck":"white","line":"hi"}]}\n```\nEnjoy!';
  assert.deepEqual(extractJson(text), {
    lines: [{ duck: "white", line: "hi" }],
  });
});

test("extractJson parses a reply with the object before trailing text", () => {
  const text = '{"lines":[{"duck":"blue","line":"yo"}]} and that is all';
  assert.deepEqual(extractJson(text), { lines: [{ duck: "blue", line: "yo" }] });
});

test("normalizeDialogue maps speaker tokens, trims text and tags emotion", () => {
  const out = normalizeDialogue({
    lines: [
      { duck: "white", line: "  Hello   there  ", emotion: "excited" },
      { duck: "blue", line: "Hi!" },
    ],
  });
  assert.deepEqual(out, [
    { duck: 0, text: "Hello there", emotion: "excited" },
    { duck: 1, text: "Hi!", emotion: "neutral" },
  ]);
});

test("normalizeDialogue falls back to neutral for unknown emotions", () => {
  const out = normalizeDialogue([
    { duck: "white", line: "one", emotion: "ecstatic" },
  ]);
  assert.deepEqual(out, [{ duck: 0, text: "one", emotion: "neutral" }]);
});

test("normalizeDialogue re-assigns alternation when the model forgets", () => {
  const out = normalizeDialogue([
    { duck: "white", line: "one" },
    { duck: "white", line: "two" },
    { duck: "blue", line: "three" },
  ]);
  assert.deepEqual(out, [
    { duck: 0, text: "one", emotion: "neutral" },
    { duck: 1, text: "two", emotion: "neutral" }, // corrected to alternate
    { duck: 0, text: "three", emotion: "neutral" },
  ]);
});

test("normalizeDialogue hard-caps each duck at MAX_LINES_PER_DUCK", () => {
  const lines = [];
  for (let i = 0; i < MAX_LINES_PER_DUCK * 3; i++) {
    lines.push({ duck: i % 2 === 0 ? "white" : "blue", line: `line ${i}` });
  }
  const out = normalizeDialogue({ lines });
  const counts = [0, 0];
  for (const l of out) counts[l.duck]++;
  assert.ok(counts[0] <= MAX_LINES_PER_DUCK);
  assert.ok(counts[1] <= MAX_LINES_PER_DUCK);
  assert.equal(out.length, MAX_LINES_PER_DUCK * 2);
});

test("spend guard defaults are conservative", () => {
  assert.equal(DEFAULT_DAILY_TOKENS, 2000);
  assert.equal(DEFAULT_COOLDOWN_MS, 15000);
  assert.deepEqual(getSettings(), {
    dailyTokens: DEFAULT_DAILY_TOKENS,
    cooldownMs: DEFAULT_COOLDOWN_MS,
  });
});

test("canChat allows a fresh session", () => {
  assert.equal(canChat().ok, true);
});

test("usageSummary reports the daily limit", () => {
  const s = usageSummary();
  assert.equal(s.limit, DEFAULT_DAILY_TOKENS);
  assert.equal(s.used, 0);
  assert.equal(s.cooldownLeftMs, 0);
});

test("extractJson parses a top-level JSON array", () => {
  assert.deepEqual(extractJson('[{"duck":"white","line":"hi"}]'), [
    { duck: "white", line: "hi" },
  ]);
});

test("normalizeDialogue reads content/message field names", () => {
  const out = normalizeDialogue({
    lines: [
      { duck: "white", content: "first" },
      { duck: "blue", message: "second" },
    ],
  });
  assert.deepEqual(out, [
    { duck: 0, text: "first", emotion: "neutral" },
    { duck: 1, text: "second", emotion: "neutral" },
  ]);
});
