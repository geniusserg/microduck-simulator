import * as T from "three";
import { ARENA_HALF, CTRL_DT, RVEL_FWD } from "./constants.js";
import { driveToward } from "./navigation.js";

const line = ARENA_HALF - 0.34,
  mouth = 0.52,
  height = 0.32;
export const FOOTBALL_RADIUS = 0.091;
export const isRace = (kind) => kind === "race" || kind === "circuit";
const laneRadii = [1.62, 1.98];
const names = ["White", "Blue"];
const between = (a, b) => a + Math.random() * (b - a);
export const goalBars = [];
for (const sign of [-1, 1]) {
  for (const y of [-mouth, mouth])
    goalBars.push([sign * line, y, height / 2, 0.018, 0.018, height / 2]);
  goalBars.push([sign * line, 0, height, 0.018, mouth + 0.018, 0.018]);
}

export function sportsField(scene) {
  const pitch = new T.Group(),
    track = new T.Group();
  function box(parent, x, y, z, w, d, h, color) {
    const m = new T.Mesh(
      new T.BoxGeometry(w, h, d),
      new T.MeshLambertMaterial({ color }),
    );
    m.position.set(x, z, -y);
    parent.add(m);
  }
  for (const [x, y, z, w, d, h] of goalBars)
    box(pitch, x, y, z, w * 2, d * 2, h * 2, x < 0 ? 0xb63936 : 0x386baa);
  for (const sign of [-1, 1]) {
    for (let i = -5; i <= 5; i++)
      box(
        pitch,
        sign * (line + 0.25),
        (mouth * i) / 5,
        height / 2,
        0.006,
        0.006,
        height,
        0xeceada,
      );
    for (let i = 0; i <= 4; i++)
      box(
        pitch,
        sign * (line + 0.25),
        0,
        (height * i) / 4,
        0.006,
        2 * mouth,
        0.006,
        0xeceada,
      );
    box(
      pitch,
      sign * line,
      0,
      0.002,
      0.015,
      2 * (ARENA_HALF - 0.23),
      0.004,
      0xfff4d9,
    );
    box(
      pitch,
      0,
      sign * (ARENA_HALF - 0.23),
      0.002,
      2 * line,
      0.015,
      0.004,
      0xfff4d9,
    );
  }
  box(pitch, 0, 0, 0.002, 0.015, 2 * (ARENA_HALF - 0.23), 0.004, 0xfff4d9);
  box(track, 0, 0, 0.002, 2 * ARENA_HALF, 0.94, 0.004, 0xa95947);
  for (const y of [-0.46, 0, 0.46])
    box(track, 0, y, 0.005, 2 * ARENA_HALF, 0.014, 0.002, 0xfff4d9);
  for (const x of [-line, line])
    box(track, x, 0, 0.005, 0.035, 0.94, 0.002, 0xfff4d9);
  const circuit = new T.Group();
  function ring(inner, outer, color, y) {
    const mesh = new T.Mesh(
      new T.RingGeometry(inner, outer, 128),
      new T.MeshLambertMaterial({ color }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    circuit.add(mesh);
  }
  ring(1.43, 2.17, 0xa95947, 0.002);
  for (const r of [1.43, 1.8, 2.17])
    ring(r - 0.008, r + 0.008, 0xfff4d9, 0.004);
  box(circuit, 1.8, 0, 0.006, 0.74, 0.035, 0.002, 0xfff4d9);
  circuit.visible = false;
  scene.add(pitch, track, circuit);
  pitch.visible = track.visible = false;
  return (kind) => {
    pitch.visible = kind === "football";
    track.visible = kind === "race";
    circuit.visible = kind === "circuit";
  };
}

export function createMatch(
  kind,
  data,
  model,
  ballAdr,
  ballDof,
  report,
  cue = () => {},
) {
  const roots = [0, Number(model.jnt("blue_trunk_base_freejoint").qposadr)];
  const dofs = [0, Number(model.jnt("blue_trunk_base_freejoint").dofadr)];
  const commands = roots.map(() => new Float32Array(3));
  const speeds = roots.map(() => RVEL_FWD * between(0.9, 1));
  const score = [0, 0],
    times = [null, null],
    metres = [0, 0],
    radians = [0, 0];
  const football = kind === "football",
    circuit = kind === "circuit";
  const starts = roots.map((_, i) =>
    football
      ? [(i ? 1 : -1) * 1.05, i ? 0.14 : -0.14]
      : circuit
        ? [laneRadii[i], 0]
        : [-line, i ? 0.23 : -0.23],
  );
  const previous = [null, null];
  let clock = 0,
    phase = "start",
    cooldown = 0,
    nextJoy = 3,
    duel = 0,
    duelEnd = 0,
    phaseStart = 0;
  let restAt = between(30, 60),
    restEnd = 0,
    prevBall = null,
    winner = null;
  const pose = (i) => data.qpos.subarray(roots[i]);
  const ball = () => data.qpos.subarray(ballAdr, ballAdr + 3);
  function announce(text) {
    report({ sportStatus: text });
  }
  function face(i, angle) {
    const q = pose(i),
      yaw = Math.atan2(
        2 * (q[3] * q[6] + q[4] * q[5]),
        1 - 2 * (q[5] ** 2 + q[6] ** 2),
      );
    const delta = Math.atan2(Math.sin(angle - yaw), Math.cos(angle - yaw));
    const d = dofs[i] + 5;
    data.qvel[d] += Math.max(-0.12, Math.min(0.12, 3 * delta - data.qvel[d]));
  }
  function drive(i, tx, ty, speed, automatic = true) {
    const q = pose(i),
      d = dofs[i],
      dx = tx - q[0],
      dy = ty - q[1],
      angle = Math.atan2(dy, dx);
    driveToward(commands[i], q, angle, Math.min(speed, RVEL_FWD), 0.3);
    if (!automatic || 1 - 2 * (q[4] ** 2 + q[5] ** 2) < 0.65 || q[2] > 0.24)
      return;
    if (speed > 0.05) face(i, angle);
    for (const [k, unit] of [
      [0, Math.cos(angle)],
      [1, Math.sin(angle)],
    ]) {
      data.qvel[d + k] += Math.max(
        -0.1,
        Math.min(0.1, speed * unit - data.qvel[d + k]),
      );
    }
  }
  function kickoff() {
    data.qpos.set(
      [0, between(-0.11, 0.11), FOOTBALL_RADIUS + 0.004, 1, 0, 0, 0],
      ballAdr,
    );
    data.qvel.fill(0, ballDof, ballDof + 6);
    prevBall = Array.from(ball());
    duel = 0;
    cooldown = 0.25;
    phase = "play";
    announce("");
  }
  function init() {
    roots.forEach((r, i) => {
      const yaw = circuit ? Math.PI / 2 : football && i ? Math.PI : 0;
      data.qpos.set(
        [...starts[i], 0.12, Math.cos(yaw / 2), 0, 0, Math.sin(yaw / 2)],
        r,
      );
      data.qvel.fill(0, dofs[i], dofs[i] + 6);
    });
    if (football) kickoff();
    else {
      data.qpos[ballAdr] = 50;
      phase = "racing";
    }
  }
  function goal(i) {
    score[i]++;
    winner = score[i] === 3 ? i : null;
    phase = winner === null ? "return" : "won";
    phaseStart = clock;
    duel = 0;
    report({ score: [...score], winner: winner === null ? null : names[i] });
    announce(
      winner === null
        ? names[i] + " scores · returning to start"
        : names[i] + " wins!",
    );
    cue("disappointed", 1 - i);
    cue("joy", i);
    data.qpos[ballAdr] = 0;
    data.qpos[ballAdr + 1] = 0;
    data.qpos[ballAdr + 2] = FOOTBALL_RADIUS + 0.002;
    data.qvel.fill(0, ballDof, ballDof + 6);
  }
  function kick(i, contested) {
    const b = ball(),
      sign = i ? -1 : 1,
      op = pose(1 - i);
    let angle = Math.atan2(-b[1], sign * line - b[0]);
    const side = (op[1] >= b[1] ? -1 : 1) * sign;
    if (contested) angle += side * between(0.28, 0.65);
    // At the boards play the clearance back into the pitch.
    let vx = Math.cos(angle),
      vy = Math.sin(angle);
    if (Math.abs(b[1]) > ARENA_HALF - 0.34 && vy * b[1] >= 0)
      vy = -Math.sign(b[1]) * 0.65;
    if (Math.abs(b[0]) > line && vx * b[0] > 0) vx = -Math.sign(b[0]) * 0.55;
    const norm = Math.hypot(vx, vy),
      power = contested ? 4.2 : 4.9;
    data.qvel[ballDof] = (vx / norm) * power;
    data.qvel[ballDof + 1] = (vy / norm) * power;
    data.qvel[ballDof + 2] = contested ? 1.2 : 0.56;
    cooldown = 0.58;
    duel = 0;
  }
  function footballStep(manual, manualCommand) {
    if (phase === "return" || phase === "won") {
      let arrived = true;
      for (let i = 0; i < 2; i++) {
        const [x, y] = starts[i],
          q = pose(i),
          dist = Math.hypot(x - q[0], y - q[1]);
        drive(i, x, y, Math.min(0.98, dist * 3));
        if (dist > 0.13) arrived = false;
        else face(i, i ? Math.PI : 0);
      }
      data.qpos.set([0, 0, FOOTBALL_RADIUS + 0.002], ballAdr);
      data.qvel.fill(0, ballDof, ballDof + 6);
      if (phase === "return" && arrived && clock - phaseStart > 1.6) kickoff();
      return;
    }
    const b = ball(),
      bx = b[0],
      by = b[1];
    const boundary = line + FOOTBALL_RADIUS;
    if (Math.abs(prevBall[0]) < boundary && Math.abs(bx) >= boundary) {
      const t = (Math.sign(bx) * boundary - prevBall[0]) / (bx - prevBall[0]);
      const y = prevBall[1] + t * (by - prevBall[1]),
        z = prevBall[2] + t * (b[2] - prevBall[2]);
      if (
        Math.abs(y) < mouth - FOOTBALL_RADIUS &&
        z < height - FOOTBALL_RADIUS
      ) {
        goal(bx > 0 ? 0 : 1);
        return;
      }
    }
    prevBall = Array.from(b);
    const dist = roots.map((_, i) =>
      Math.hypot(pose(i)[0] - bx, pose(i)[1] - by),
    );
    const fighting = dist.every((d) => d < 0.36);
    if (fighting && !duel && cooldown <= 0) {
      duel = clock;
      duelEnd = clock + between(1, 3.4);
      cue("duel", dist[0] < dist[1] ? 0 : 1);
      announce("Tackle");
    }
    if (duel && (!fighting || clock >= duelEnd)) {
      if (Math.min(...dist) < 0.36)
        kick(dist[0] + between(-0.08, 0.08) < dist[1] ? 0 : 1, true);
      duel = 0;
      announce("");
    }
    const first = dist[0] <= dist[1] ? 0 : 1;
    for (let i = 0; i < 2; i++) {
      const sign = i ? -1 : 1,
        q = pose(i),
        auto = i !== 0 || !manual;
      const approach = sign * (bx - q[0]);
      // Get goal-side before the shot. The second skater cuts off the outlet.
      const lead = Math.min(0.18, dist[i] * 0.12);
      let tx = bx + lead * data.qvel[ballDof],
        ty = by + lead * data.qvel[ballDof + 1];
      if (duel) {
        tx -= sign * 0.09;
        ty += (i ? 1 : -1) * 0.15 * Math.sin((clock - duel) * 5);
      } else if (approach < -0.08 && dist[i] > 0.22) {
        tx -= sign * 0.22;
        ty += (q[1] > by ? 1 : -1) * 0.17;
      } else if (i !== first && dist[i] > 0.65) {
        tx -= sign * 0.32;
      }
      // Approach on opposite shoulders to leave room for the opponent's wheels.
      const rival = pose(1 - i),
        dx = q[0] - rival[0],
        dy = q[1] - rival[1];
      const gap = Math.hypot(dx, dy);
      if (gap < 0.45 && gap > 0.001) {
        const shift = (0.45 - gap) * 0.8;
        tx += (shift * dx) / gap;
        ty += (shift * dy) / gap;
      }
      drive(i, tx, ty, duel ? 0.78 : 1.08, auto);
      if (!auto && manualCommand) {
        const yaw = Math.atan2(
          2 * (q[3] * q[6] + q[4] * q[5]),
          1 - 2 * (q[5] ** 2 + q[6] ** 2),
        );
        const speed = manualCommand[0] * 1.8;
        if (speed && 1 - 2 * (q[4] ** 2 + q[5] ** 2) > 0.7) {
          for (const [k, u] of [
            [0, Math.cos(yaw)],
            [1, Math.sin(yaw)],
          ])
            data.qvel[dofs[i] + k] += Math.max(
              -0.075,
              Math.min(0.075, speed * u - data.qvel[dofs[i] + k]),
            );
        }
      }
    }
    if (!cooldown && !duel && dist[first] < 0.225 && b[2] < 0.25)
      kick(first, false);
    if (!duel && clock >= nextJoy) {
      cue("joy", first);
      nextJoy = clock + between(3, 6);
    }
  }
  function raceStep() {
    if (clock >= restAt && clock >= 3 && times.some((t) => t === null)) {
      restEnd = clock + between(3, 4.8);
      restAt = restEnd + between(30, 60);
      cue("breath", 0);
      cue("breath", 1);
    }
    const resting = clock < restEnd;
    for (let i = 0; i < 2; i++) {
      const q = pose(i),
        p = previous[i],
        active = clock >= 3 && !resting && times[i] === null;
      const a = Math.atan2(q[1], q[0]);
      if (p && active) {
        const dx = q[0] - p[0],
          dy = q[1] - p[1];
        if (Math.hypot(dx, dy) < 0.16) {
          metres[i] += Math.hypot(dx, dy);
          radians[i] += Math.atan2(Math.sin(a - p[2]), Math.cos(a - p[2]));
        }
      }
      previous[i] = [q[0], q[1], a];
      const tx = circuit ? laneRadii[i] * Math.cos(a + 0.28) : line + 0.08;
      const ty = circuit ? laneRadii[i] * Math.sin(a + 0.28) : starts[i][1];
      drive(i, tx, ty, active ? speeds[i] : 0);
      if (!circuit && active && q[0] >= line) times[i] = clock - 3;
    }
    if (Math.floor(clock * 10) !== Math.floor((clock - CTRL_DT) * 10)) {
      report({
        countdown: Math.max(0, Math.ceil(3 - clock)),
        times: times.map((t) => t ?? Math.max(0, clock - 3)),
        finished: times.map((t) => t !== null),
        metres: [...metres],
        laps: radians.map((r) => Math.max(0, Math.floor(r / (2 * Math.PI)))),
        sportStatus: resting ? "Catching breath" : "",
      });
    }
  }
  return {
    commands,
    get ownsWhite() {
      return !football || phase !== "play";
    },
    get breath() {
      return clock < restEnd ? (1 - Math.cos(clock * 8)) * 0.5 : 0;
    },
    get fireworks() {
      return phase === "won" ? [winner, clock - phaseStart] : null;
    },
    update(manual, manualCommand) {
      if (phase === "start") init();
      clock += CTRL_DT;
      cooldown = Math.max(0, cooldown - CTRL_DT);
      if (football) footballStep(manual, manualCommand);
      else raceStep();
    },
  };
}
