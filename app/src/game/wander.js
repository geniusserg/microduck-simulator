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
    const near = other && Math.hypot(x - other[0], y - other[1]) < 0.28;
    cooldown -= dt;
    if (near && cooldown <= 0) {
      social = between(1, 2);
      cooldown = between(6, 12);
    }
    if (social > 0) {
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
    const half = island ? 1.44 : arenaHalf;
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
    const angle = directionTo(x, y, tx, ty, half, island) - yaw;
    const reverse = Math.cos(angle) < -0.35,
      steer = angle + (reverse ? Math.PI : 0);
    const error = Math.atan2(Math.sin(steer), Math.cos(steer));
    const speed = activity === "Running" || chasing ? 0.94 : 0.53;
    command[0] =
      limits[0] *
      speed *
      (reverse ? -0.65 : 1) *
      Math.max(0.2, Math.cos(error));
    command[2] = Math.max(-limits[2], Math.min(limits[2], error * 1.8));
  }
  return {
    command,
    start,
    stop,
    update,
    get active() {
      return active;
    },
  };
}
