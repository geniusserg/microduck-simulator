// A skater can balance until the work needed to lift its centre of mass
// over a wheel exceeds the kinetic energy of the closing pair.
export function skateImpact(model, data, blue) {
  const q = data.qpos,
    v = data.qvel;
  const dx = q[blue.pos] - q[0],
    dy = q[blue.pos + 1] - q[1],
    gap = Math.hypot(dx, dy);
  if (gap > 0.32 || gap < 0.001 || Math.abs(q[2] - q[blue.pos + 2]) > 0.18)
    return null;
  const nx = dx / gap,
    ny = dy / gap;
  const closing = (v[0] - v[blue.dof]) * nx + (v[1] - v[blue.dof + 1]) * ny;
  const height = 0.12,
    base = 0.034;
  const barrier = Math.hypot(height, base) - height;
  const excess = (closing / 2) ** 2 - 2 * 9.81 * barrier;
  if (closing <= 0 || excess <= 0) return null;
  return () => {
    for (let i = 0; i < data.ncon; i++) {
      const c = data.contact.get(i);
      const a = model.body_rootid[model.geom_bodyid[c.geom1]],
        b = model.body_rootid[model.geom_bodyid[c.geom2]];
      c.delete();
      if (!(
        (a === blue.body && b === blue.player) ||
        (b === blue.body && a === blue.player)
      ))
        continue;
      // Angular speed from the available energy about the contact edge.
      const spin = Math.min(12, Math.sqrt(excess) / base);
      const torques = [];
      for (const [r, d, sign] of [
        [0, 0, -1],
        [blue.pos, blue.dof, 1],
      ]) {
        const yaw = Math.atan2(
          2 * (q[r + 3] * q[r + 6] + q[r + 4] * q[r + 5]),
          1 - 2 * (q[r + 5] ** 2 + q[r + 6] ** 2),
        );
        const cy = Math.cos(yaw),
          sy = Math.sin(yaw);
        torques.push([
          d,
          sign * (-ny * cy + nx * sy),
          sign * (ny * sy + nx * cy),
        ]);
        v[d + 3] += sign * spin * (-ny * cy + nx * sy);
        v[d + 4] += sign * spin * (ny * sy + nx * cy);
      }
      return (elapsed) => {
        // Contact load acts over the brief skid, then both stabilizers resume.
        const load =
          Math.min(1.9, spin * 0.16) * Math.max(0, 1 - elapsed / 0.15);
        for (const [d, x, y] of torques) {
          data.qfrc_applied[d + 3] = load * x;
          data.qfrc_applied[d + 4] = load * y;
        }
      };
    }
    return false;
  };
}
