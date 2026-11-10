import { directionTo } from "./navigation.js";

const between = (low, high) => low + Math.random() * (high - low);

export function createWander({
  onActivity = () => {},
  roll,
  jump,
  peck,
  spawnBall = () => {},
  arenaHalf,
}) {
  const command = new Float32Array(3);
  let active = false,
    activity = "",
    shown = "",
    remaining = 0,
    waypoint = 0,
    peckIn = 0;
  let retreating = false,
    retreatTime = 0,
    inwardX = 0,
    inwardY = 0;
  function releaseFromEdge(velocity, dof, dt) {
    if (!active || !retreating || retreatTime < 0.7) return;
    const inward = velocity[dof] * inwardX + velocity[dof + 1] * inwardY;
    // A duck pinned against the fence may keep balancing without taking a step.
    // Supply bounded traction only while its inward progress stays below a walk.
    const impulse = Math.max(0, Math.min(0.2 - inward, 5 * dt));
    velocity[dof] += impulse * inwardX;
    velocity[dof + 1] += impulse * inwardY;
  }
  let targetX = 0,
    targetY = 0,
    social = 0,
    cooldown = 0;
  function label(value) {
    if (value !== shown) {
      shown = value;
      onActivity(value);
    }
  }
  function start() {
    active = true;
    retreating = false;
    activity = "";
    shown = "";
    remaining = waypoint = social = cooldown = 0;
    peckIn = between(5, 60);
  }
  function stop() {
    active = false;
    command.fill(0);
  }
  function update(dt, x, y, yaw, ball, limits, rollers, island, other) {
    command.fill(0);
    if (!active) return;
    const half = island ? 1.44 : arenaHalf;
    const edge = Math.max(Math.abs(x), Math.abs(y));
    if (edge > half - 0.22) retreating = true;
    if (edge < half - 0.58) retreating = false;
    retreatTime = retreating ? retreatTime + dt : 0;
    if (retreating) {
      const r = Math.hypot(x, y);
      inwardX = -x / r;
      inwardY = -y / r;
    }
    const near = other && Math.hypot(x - other[0], y - other[1]) < 0.28;
    cooldown -= dt;
    if (near && cooldown <= 0) {
      social = between(1, 2);
      cooldown = between(6, 12);
    }
    if (retreating) {
      label("Turning back");
    } else if (social > 0) {
      social -= dt;
      label("Greeting");
    } else {
      remaining -= dt;
      if (!island && !rollers && peck && (peckIn -= dt) <= 0) {
        peckIn = between(5, 60);
        peck();
        label("Pecking grass");
        return;
      }
      if (remaining <= 0) {
        const chase = island ? "Chasing toy" : "Chasing ball";
        const options = ["Walking", "Running", chase, "Looking around"];
        if (!rollers && jump) options.push("Jumping");
        if (!rollers && roll) options.push("Rolling");
        const pool = options.filter((s) => s !== activity);
        activity = activity
          ? pool[Math.floor(Math.random() * pool.length)]
          : "Walking";
        remaining = between(
          ["Walking", "Running", chase].includes(activity) ? 15 : 5,
          60,
        );
        waypoint = 0;
        if (activity === chase) spawnBall();
        if (activity === "Jumping") jump();
        if (activity === "Rolling") roll();
      }
      label(activity);
      if (activity === "Looking around") return;
    }
    const chasing = activity.startsWith("Chasing") && ball && social <= 0;
    waypoint -= dt;
    if (waypoint <= 0 || Math.hypot(targetX - x, targetY - y) < 0.2) {
      const bearing = yaw + between(-1.7, 1.7),
        distance = between(0.6, 1.7);
      const bound = (v) => Math.max(-half + 0.22, Math.min(half - 0.22, v));
      targetX = bound(x + distance * Math.cos(bearing));
      targetY = bound(y + distance * Math.sin(bearing));
      waypoint = between(3, 8);
    }
    let tx = chasing ? ball[0] : targetX,
      ty = chasing ? ball[1] : targetY;
    if (social > 0 && other) {
      tx = 2 * x - other[0];
      ty = 2 * y - other[1];
    }
    if (retreating) {
      tx = x * 0.5;
      ty = y * 0.5;
      waypoint = 0;
    }
    const angle = directionTo(x, y, tx, ty, half, island) - yaw;
    const reverse = Math.cos(angle) < -0.35,
      steer = angle + (reverse ? Math.PI : 0);
    const error = Math.atan2(Math.sin(steer), Math.cos(steer));
    const speed = retreating || activity === "Running" || chasing ? 1 : 0.85;
    command[0] =
      (reverse ? limits[1] : limits[0]) *
      speed *
      Math.max(0.6, Math.cos(error));
    command[2] = Math.max(-limits[2], Math.min(limits[2], error * 1.8));
  }
  return {
    command,
    start,
    stop,
    update,
    releaseFromEdge,
    get active() {
      return active;
    },
  };
}
