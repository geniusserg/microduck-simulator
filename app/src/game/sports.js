import * as T from "three";
import { ARENA_HALF, BALL_RADIUS, CTRL_DT, RVEL_FWD } from "./constants.js";
import { driveToward } from "./navigation.js";

const line = ARENA_HALF - 0.34,
  mouth = 0.52,
  height = 0.32;
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
        sign * (line + 0.15),
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
        sign * (line + 0.15),
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
  scene.add(pitch, track);
  pitch.visible = track.visible = false;
  return (kind) => {
    pitch.visible = kind === "football";
    track.visible = kind === "race";
  };
}

export function createMatch(kind, data, model, ballAdr, ballDof, report) {
  const roots = [0, Number(model.jnt("blue_trunk_base_freejoint").qposadr)];
  const dofs = [0, Number(model.jnt("blue_trunk_base_freejoint").dofadr)];
  const speeds = roots.map(() => RVEL_FWD * (0.9 + 0.1 * Math.random()));
  const times = [null, null],
    score = [0, 0],
    commands = roots.map(() => new Float32Array(3));
  const returning = [false, false];
  let clock = 0,
    ready = false,
    shot = 0,
    previousX = 0;
  function kickoff() {
    data.qpos.set(
      [
        (Math.random() - 0.5) * 0.28,
        (Math.random() - 0.5) * 0.64,
        BALL_RADIUS + 0.002,
        1,
        0,
        0,
        0,
      ],
      ballAdr,
    );
    data.qvel.fill(0, ballDof, ballDof + 6);
    previousX = 0;
  }
  function place() {
    roots.forEach((r, i) => {
      const back = i === 1 && kind === "football";
      data.qpos.set(
        [
          kind === "race" ? -line : (i ? 1 : -1) * 0.75,
          kind === "race" ? (i ? 0.23 : -0.23) : 0,
          0.12,
          back ? 0 : 1,
          0,
          0,
          back ? 1 : 0,
        ],
        r,
      );
      data.qvel.fill(0, dofs[i], dofs[i] + 6);
    });
    if (kind === "football") kickoff();
    else data.qpos[ballAdr] = 50;
    ready = true;
  }
  function update(manual) {
    if (!ready) place();
    clock += CTRL_DT;
    shot = Math.max(0, shot - CTRL_DT);
    const bx = data.qpos[ballAdr],
      by = data.qpos[ballAdr + 1];
    if (
      kind === "football" &&
      Math.abs(previousX) < line &&
      Math.abs(bx) >= line
    ) {
      const y =
        by -
        (data.qvel[ballDof + 1] * CTRL_DT * (Math.abs(bx) - line)) /
          Math.max(0.0001, Math.abs(bx - previousX));
      if (
        Math.abs(y) < mouth - BALL_RADIUS &&
        data.qpos[ballAdr + 2] < height - BALL_RADIUS
      ) {
        score[bx > 0 ? 0 : 1]++;
        kickoff();
        report({ score: [...score] });
        return;
      }
    }
    previousX = bx;
    for (let i = 0; i < 2; i++) {
      const q = data.qpos.subarray(roots[i]),
        d = dofs[i],
        sign = i ? -1 : 1;
      const racing = kind === "race",
        active = !racing || (clock >= 3 && times[i] === null);
      const dx = racing ? (returning[i] ? -line : line) - q[0] : bx - q[0],
        dy = racing ? (i ? 0.23 : -0.23) - q[1] : by - q[1];
      const heading = Math.atan2(dy, dx),
        speed = active ? (racing ? speeds[i] : RVEL_FWD) : 0;
      driveToward(commands[i], q, heading, speed, 0.3);
      const controlled = i !== 0 || !manual || racing;
      const upright = 1 - 2 * (q[4] ** 2 + q[5] ** 2);
      if (controlled && upright > 0.75 && q[2] < 0.22) {
        // Powered roller traction is bounded so contact impulses still reach both bodies.
        const limit = 1.65 * CTRL_DT;
        for (const [axis, component] of [
          [0, Math.cos(heading)],
          [1, Math.sin(heading)],
        ]) {
          data.qvel[d + axis] += Math.max(
            -limit,
            Math.min(limit, speed * component - data.qvel[d + axis]),
          );
        }
      }
      if (
        !racing &&
        !shot &&
        Math.hypot(dx, dy) < 0.19 &&
        Math.abs(q[2] - data.qpos[ballAdr + 2]) < 0.18
      ) {
        const angle = Math.atan2(-by, sign * line - bx);
        data.qvel[ballDof] = 3 * Math.cos(angle);
        data.qvel[ballDof + 1] = 3 * Math.sin(angle);
        data.qvel[ballDof + 2] = 0.85;
        shot = 0.55;
      }
      if (racing && active) {
        if (returning[i] && q[0] <= -line + 0.025) times[i] = clock - 3;
        else if (q[0] >= line - 0.025) returning[i] = true;
      }
    }
    if (
      kind === "race" &&
      Math.floor(clock * 10) !== Math.floor((clock - CTRL_DT) * 10)
    )
      report({
        countdown: Math.max(0, Math.ceil(3 - clock)),
        times: times.map((t) => t ?? Math.max(0, clock - 3)),
        finished: times.map((t) => t !== null),
      });
  }
  return { update, commands };
}
