// Plan around the island before sending a velocity command to the gait policy.
export function directionTo(x, y, tx, ty, half, island) {
  const bound = (n) => Math.max(-half + 0.24, Math.min(half - 0.24, n));
  let dx = bound(tx) - x,
    dy = bound(ty) - y;
  if (Math.max(Math.abs(x), Math.abs(y)) > half - 0.2) {
    dx = bound(x * 0.65) - x;
    dy = bound(y * 0.65) - y;
  }
  if (island) {
    const r = Math.hypot(x, y),
      length = Math.hypot(dx, dy);
    const t = Math.max(
      0,
      Math.min(1, -(x * dx + y * dy) / (length * length || 1)),
    );
    if (Math.hypot(x + t * dx, y + t * dy) < 0.54 && r > 0) {
      const side = x * dy - y * dx >= 0 ? 1 : -1;
      const outward = Math.max(-0.18, Math.min(1, (0.6 - r) * 4));
      dx = (outward * x - side * y) / r;
      dy = (outward * y + side * x) / r;
    }
  }
  return Math.atan2(dy, dx);
}
export function driveToward(command, q, heading, speed, turn) {
  const yaw = Math.atan2(
    2 * (q[3] * q[6] + q[4] * q[5]),
    1 - 2 * (q[5] ** 2 + q[6] ** 2),
  );
  const angle = heading - yaw,
    reverse = Math.cos(angle) < -0.35;
  const delta = angle + (reverse ? Math.PI : 0);
  const error = Math.atan2(Math.sin(delta), Math.cos(delta));
  command[0] = (reverse ? -0.65 : 1) * speed * Math.max(0.18, Math.cos(error));
  command[2] = Math.max(-turn, Math.min(turn, 2 * error));
}
