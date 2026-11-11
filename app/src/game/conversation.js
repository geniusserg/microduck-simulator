// Two-duck conversation director.
//
// Owns the whole "press Talk -> ducks meet -> they chat -> stop" sequence:
//   - approach: steer both ducks to opposite sides of a meet point, facing
//     each other (velocity commands handed back to the game loop);
//   - speak: play the DeepSeek-generated lines one at a time — a speech
//     bubble above the speaker, the duck's own emotion voice clips for the
//     audio, and the clip's viseme track driving the speaker's beak.
//
// The director is deliberately self-contained: game.js passes small
// accessor/effect callbacks so nothing in here reaches into the physics
// loop directly. It never blocks the render loop (the dialogue is fetched
// in the background while the ducks are still waddling over).
import * as THREE from "three";
import { setJawOpen } from "./duck.js";
import { generateDialogue } from "./deepseek.js";
import { playVoice, voiceFrame, stopVoice } from "./voice.js";

// ── Tuning ──────────────────────────────────────────────────────────────
const MEET_OFFSET = 0.6; // each duck stops this far from the meet center
const ARRIVE_DIST = 0.4; // m from target = "arrived"
const APPROACH_TIMEOUT = 14; // s before we give up walking and just talk
const SPEED = 0.22; // legs forward speed while approaching
const TURN = 1.0; // max yaw rate
const HEAD_OFFSET = 0.17; // bubble clearance above the head body origin
const LINE_PAUSE_MS = 420; // gap between lines (bubble hidden)
const MIN_LINE_MS = 1100; // shortest time a line stays up
const WORLD_W = 1.5; // bubble width in world units

function yawOf(q) {
  return Math.atan2(2 * (q[3] * q[6] + q[4] * q[5]), 1 - 2 * (q[5] * q[5] + q[6] * q[6]));
}
function wrapPi(a) {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a < -Math.PI) a += 2 * Math.PI;
  return a;
}
const clampMeet = (v) => Math.max(-1.2, Math.min(1.2, v));

// ── Emotion -> duck-voice clip ───────────────────────────────────────────
// Each dialogue line carries an emotion; it is spoken with the SAME voice
// bank the duck uses for its in-game reactions (duck-voice/*.wav), so the
// duck "talks" like the microduck and the clip's viseme track (voice.js)
// drives the beak. Long songs are excluded; a few clips are picked at
// random per emotion for variety.
// Only clips with a viseme track in voice-frames.json (the songs and the
// newer effects like snarl/challenge have no frames, so they stay out).
const EMOTION_CLIPS = {
  neutral: ["mmh", "curious"],
  happy: ["yes", "yes_fast", "excited"],
  excited: ["excited"],
  curious: ["curious"],
  sad: ["sad", "no", "mmh"],
  angry: ["angry", "defiant", "impatient", "mock"],
  amused: ["laugh", "mock"],
  surprised: ["curious", "excited"],
};
function clipFor(emotion) {
  const pool = EMOTION_CLIPS[emotion] || EMOTION_CLIPS.neutral;
  return pool[(Math.random() * pool.length) | 0];
}

// Steer one duck toward (tx,ty) and, once close, align it to `face`.
// Returns true when it is both close and aligned (i.e. "arrived").
function steer(q, tx, ty, face, cmd) {
  const x = q[0];
  const y = q[1];
  const dist = Math.hypot(tx - x, ty - y);
  const yaw = yawOf(q);
  if (dist > ARRIVE_DIST) {
    const heading = Math.atan2(ty - y, tx - x);
    const angle = heading - yaw;
    const reverse = Math.cos(angle) < -0.35;
    const delta = angle + (reverse ? Math.PI : 0);
    const error = Math.atan2(Math.sin(delta), Math.cos(delta));
    cmd[0] = (reverse ? -0.5 : 1) * SPEED * Math.max(0.2, Math.cos(error));
    cmd[1] = 0;
    cmd[2] = Math.max(-TURN, Math.min(TURN, 2 * error));
    return false;
  }
  // Close enough: keep a gentle forward waddle toward the target so the
  // gait never freezes; the speak phase takes over the motion next update.
  const err = wrapPi(face - yaw);
  cmd[0] = 0.12;
  cmd[1] = 0;
  cmd[2] = Math.max(-TURN, Math.min(TURN, 2 * err));
  return true;
}

// Gentle waddle used while talking: each duck keeps walking in slow loops
// around its meet spot so the waddle gait never stops, instead of standing
// frozen while it speaks.
function waddleCommand(q, homeX, homeY, t, phaseOffset, cmd) {
  const x = q[0];
  const y = q[1];
  const yaw = yawOf(q);
  const ang = phaseOffset + t * 0.35;
  const tx = homeX + 0.28 * Math.cos(ang);
  const ty = homeY + 0.28 * Math.sin(ang);
  const heading = Math.atan2(ty - y, tx - x);
  const angle = heading - yaw;
  const reverse = Math.cos(angle) < -0.35;
  const delta = angle + (reverse ? Math.PI : 0);
  const error = Math.atan2(Math.sin(delta), Math.cos(delta));
  cmd[0] = (reverse ? -0.5 : 1) * 0.16 * Math.max(0.25, Math.cos(error));
  cmd[1] = 0;
  cmd[2] = Math.max(-0.7, Math.min(0.7, 1.5 * error));
}

export function createConversation({
  scene,
  rig,
  getFriend,
  getMainQ,
  getFriendQ,
  setStore,
  setInputLock,
  resumeWander,
  shouldAbort,
  whiteName = "White",
  blueName = "Blue",
}) {
  const mainCmd = new Float32Array(3);
  const friendCmd = new Float32Array(3);
  const _v = new THREE.Vector3();

  const state = {
    active: false,
    phase: "idle", // "approach" | "speak"
    lines: [],
    lineIndex: -1,
    speaker: -1,
    text: "",
    flap: false,
    speechEndAt: 0,
    lineEndAt: 0,
    approachT: 0,
    speakT: 0, // seconds in the "speak" phase, drives the waddle
    arrivedMain: false,
    arrivedFriend: false,
    mainTx: 0,
    mainTy: 0,
    friendTx: 0,
    friendTy: 0,
    mainFace: 0,
    friendFace: 0,
  };

  // ── Speech bubbles (three.js sprites always face the camera) ──────────
  const bubbles = [makeBubble("#ff7a2f"), makeBubble("#2ff0e6")];

  function makeBubble(accent) {
    const canvas = document.createElement("canvas");
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mat = new THREE.SpriteMaterial({
      map: tex,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    const sprite = new THREE.Sprite(mat);
    sprite.visible = false;
    sprite.renderOrder = 999;
    scene.add(sprite);
    return { canvas, tex, sprite, accent, worldH: 0 };
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function setBubbleText(which, text) {
    const b = bubbles[which];
    const ctx = b.canvas.getContext("2d");
    // Plain, smaller, easy-to-read type (no display font) for the dialogue.
    const font = '500 24px system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif';
    ctx.font = font;
    const maxW = 400;
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const test = cur ? cur + " " + w : w;
      if (ctx.measureText(test).width > maxW && cur) {
        lines.push(cur);
        cur = w;
      } else {
        cur = test;
      }
    }
    if (cur) lines.push(cur);

    const lineH = 30;
    const padX = 18;
    const padY = 14;
    const textW = Math.max(...lines.map((l) => ctx.measureText(l).width));
    const w = Math.ceil(textW + padX * 2);
    const h = Math.ceil(lines.length * lineH + padY * 2 + 14);
    b.canvas.width = w;
    b.canvas.height = h;

    const c = b.canvas.getContext("2d");
    c.font = font;
    c.textBaseline = "middle";
    c.fillStyle = "#faf8f2";
    c.strokeStyle = "#101018";
    c.lineWidth = 5;
    c.lineJoin = "round";
    roundRect(c, 2.5, 2.5, w - 5, h - 19, 18);
    c.fill();
    c.stroke();
    // Tail pointing down toward the duck's head.
    c.beginPath();
    c.moveTo(w / 2 - 16, h - 20);
    c.lineTo(w / 2 + 16, h - 20);
    c.lineTo(w / 2, h - 3);
    c.closePath();
    c.fillStyle = b.accent;
    c.fill();
    c.stroke();
    // Re-stroke the body so the tail overlaps cleanly.
    c.fillStyle = "#101018";
    lines.forEach((l, i) => c.fillText(l, padX, padY + 6 + lineH * (i + 0.5)));
    b.tex.needsUpdate = true;
    b.worldH = (h / w) * WORLD_W;
    b.sprite.scale.set(WORLD_W, b.worldH, 1);
    b.sprite.visible = true;
  }

  function clearBubble(which) {
    bubbles[which].sprite.visible = false;
  }
  function clearBubbles() {
    clearBubble(0);
    clearBubble(1);
  }

  function headWorldPos(rig) {
    const head = rig?.bodies?.get("jaw_soft");
    if (!head) return null;
    head.updateWorldMatrix(true, false);
    _v.setFromMatrixPosition(head.matrixWorld);
    return _v;
  }

  function positionBubble(which, rig) {
    const b = bubbles[which];
    if (!b.sprite.visible || !rig) return;
    const p = headWorldPos(rig);
    if (!p) {
      b.sprite.visible = false;
      return;
    }
    b.sprite.position.set(p.x, p.y + HEAD_OFFSET + b.worldH / 2, p.z);
  }

  // ── Duck voice (emotion clips, no TTS) ────────────────────────────────
  // Fire-and-forget: the clip's own viseme track (voiceFrame) drives the
  // beak, and the next line's playVoice() stops the previous clip.
  function playLineVoice(emotion) {
    playVoice(clipFor(emotion)).catch(() => {});
  }

  // ── Sequence ──────────────────────────────────────────────────────────
  function beginLine(i) {
    const line = state.lines[i];
    state.lineIndex = i;
    state.speaker = line.duck;
    state.text = line.text;
    playLineVoice(line.emotion);
    const speechDur = Math.max(MIN_LINE_MS, 600 + line.text.length * 55);
    state.speechEndAt = performance.now() + speechDur;
    state.lineEndAt = state.speechEndAt + LINE_PAUSE_MS;
    state.flap = true;
    setBubbleText(line.duck, line.text);
    clearBubble(1 - line.duck);
    setStore({
      conversation: { status: "speak", speaker: line.duck, text: line.text },
    });
  }

  function tickSpeech() {
    const now = performance.now();
    if (state.flap && now >= state.speechEndAt) {
      state.flap = false;
      stopVoice(); // cut the emotion clip cleanly at the end of the line
      clearBubble(state.speaker);
    }
    if (now >= state.lineEndAt) {
      state.lineIndex++;
      if (state.lineIndex < state.lines.length) beginLine(state.lineIndex);
      else finish();
    }
  }

  function finish() {
    clearBubbles();
    stopVoice();
    state.active = false;
    state.phase = "idle";
    state.speaker = -1;
    state.text = "";
    state.flap = false;
    setInputLock(false);
    resumeWander();
    setStore({ conversation: { status: "done", speaker: -1, text: "" } });
  }

  async function loadDialogue() {
    try {
      const lines = await generateDialogue({ whiteName, blueName });
      if (!state.active) return; // stopped while the request was in flight
      state.lines = lines;
    } catch (e) {
      if (!state.active) return;
      stopVoice();
      clearBubbles();
      state.active = false;
      state.phase = "idle";
      setInputLock(false);
      resumeWander();
      setStore({ conversation: { status: "error", speaker: -1, text: "", error: e?.message || String(e) } });
    }
  }

  // ── Commands (consumed by the game loop) ──────────────────────────────
  function computeCommands() {
    const mq = getMainQ();
    const fq = getFriendQ();
    state.arrivedMain = steer(mq, state.mainTx, state.mainTy, state.mainFace, mainCmd);
    state.arrivedFriend = steer(fq, state.friendTx, state.friendTy, state.friendFace, friendCmd);
  }

  function mainCommand() {
    if (!state.active) {
      mainCmd.fill(0);
      return mainCmd;
    }
    if (state.phase === "approach") {
      computeCommands();
      return mainCmd;
    }
    // Speak phase: keep waddling around the meet spot.
    waddleCommand(getMainQ(), state.mainTx, state.mainTy, state.speakT, 0, mainCmd);
    return mainCmd;
  }

  function friendCommand() {
    if (!state.active) {
      friendCmd.fill(0);
      return friendCmd;
    }
    if (state.phase === "approach") {
      computeCommands();
      return friendCmd;
    }
    waddleCommand(getFriendQ(), state.friendTx, state.friendTy, state.speakT, Math.PI, friendCmd);
    return friendCmd;
  }

  // ── Per-frame update ──────────────────────────────────────────────────
  function update(dt) {
    if (!state.active) return;
    if (shouldAbort()) {
      finish();
      return;
    }
    state.approachT += dt;
    if (state.phase === "approach") {
      computeCommands();
      const arrived = state.arrivedMain && state.arrivedFriend;
      if (arrived || state.approachT > APPROACH_TIMEOUT) {
        state.phase = "speak";
        state.speakT = 0;
        setStore({ conversation: { status: "speak", speaker: -1, text: "" } });
        if (state.lines.length) beginLine(0);
      }
    } else if (state.phase === "speak") {
      state.speakT += dt;
      if (state.lines.length && state.lineIndex === -1) {
        beginLine(0);
      } else if (state.lineIndex >= 0) {
        tickSpeech();
      }
    }
    positionBubble(0, rig);
    positionBubble(1, getFriend()?.rig);

    // Beak: the speaking duck follows the emotion clip's viseme track
    // (voiceFrame). If the clip has ended but the bubble is still up, fall
    // back to a gentle flap so the mouth keeps moving while the text reads.
    const frame = voiceFrame();
    let mouth = frame ? frame[4] : 0;
    if (state.flap && (!frame || mouth < 0.02)) {
      const t = performance.now() / 1000;
      mouth = 0.25 + 0.55 * Math.abs(Math.sin(t * 10));
    }
    setJawOpen(rig, state.flap && state.speaker === 0 ? Math.min(1, mouth) : 0);
    const friendRig = getFriend()?.rig;
    if (friendRig) setJawOpen(friendRig, state.flap && state.speaker === 1 ? Math.min(1, mouth) : 0);
  }

  function start() {
    if (state.active) return;
    const mq = getMainQ();
    const fq = getFriendQ();
    let dx = mq[0] - fq[0];
    let dy = mq[1] - fq[1];
    let dist = Math.hypot(dx, dy);
    if (dist < 0.01) {
      dx = 1;
      dy = 0;
      dist = 1;
    }
    const ux = dx / dist;
    const uy = dy / dist;
    const cx = clampMeet((mq[0] + fq[0]) / 2);
    const cy = clampMeet((mq[1] + fq[1]) / 2);
    state.mainTx = clampMeet(cx + ux * MEET_OFFSET);
    state.mainTy = clampMeet(cy + uy * MEET_OFFSET);
    state.friendTx = clampMeet(cx - ux * MEET_OFFSET);
    state.friendTy = clampMeet(cy - uy * MEET_OFFSET);
    state.mainFace = Math.atan2(cy - state.mainTy, cx - state.mainTx);
    state.friendFace = Math.atan2(cy - state.friendTy, cx - state.friendTx);

    state.active = true;
    state.phase = "approach";
    state.approachT = 0;
    state.speakT = 0;
    state.lines = [];
    state.lineIndex = -1;
    state.speaker = -1;
    state.flap = false;
    clearBubbles();
    stopVoice();
    setInputLock(true);
    setStore({ conversation: { status: "approach", speaker: -1, text: "" } });
    loadDialogue();
  }

  function stop() {
    if (!state.active) return;
    clearBubbles();
    stopVoice();
    state.active = false;
    state.phase = "idle";
    state.speaker = -1;
    state.lines = [];
    setInputLock(false);
    resumeWander();
    setStore({ conversation: null });
  }

  return {
    get active() {
      return state.active;
    },
    start,
    stop,
    update,
    mainCommand,
    friendCommand,
  };
}
