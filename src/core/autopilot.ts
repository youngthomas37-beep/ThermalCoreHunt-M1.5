import { normalizeAngle } from './glider';
import type { Sim } from './sim';

/**
 * 简单盘气流自动驾驶：选一个当前高度仍有上升的热气流，飞到 0.6R 处盘旋。
 * 仅用于演示、截图与无头校验。
 */
export function autopilot(sim: Sim): { uL: number; uR: number } {
  const g = sim.glider;
  const f = sim.field;
  const zEval = sim.mode === 'fixed' ? sim.startZ : g.z;
  const fixed = sim.mode === 'fixed';

  let target = null as (typeof f.thermals)[number] | null;
  let best = -Infinity;
  for (const th of f.thermals) {
    const peak = f.peakAt(th, zEval, fixed);
    if (peak < 0.4) continue;
    const c = f.center(th);
    const d = Math.hypot(c.x - g.x, c.y - g.y);
    const score = peak - d * 0.004;
    if (score > best) {
      best = score;
      target = th;
    }
  }
  if (!target) return { uL: 0, uR: 0 };

  const c = f.center(target);
  const rz = f.radiusAt(target, zEval, fixed);
  const dx = g.x - c.x;
  const dy = g.y - c.y;
  const r = Math.hypot(dx, dy);
  const bearing = Math.atan2(-dx, -dy);

  let desired: number;
  if (r > 1.1 * rz) {
    desired = bearing;
  } else {
    const theta = Math.atan2(dy, dx);
    const lead = -0.95;
    const targetR = 0.6 * rz;
    const px = c.x + Math.cos(theta + lead) * targetR;
    const py = c.y + Math.sin(theta + lead) * targetR;
    desired = Math.atan2(px - g.x, py - g.y);
  }

  const err = normalizeAngle(desired - g.psi);
  const bankCmd = Math.max(-0.35, Math.min(0.35, err * 1.35));
  const ratio = Math.min(0.98, Math.abs(bankCmd) / g.p.bankMax);
  const diff = Math.sign(bankCmd) * ratio ** (1 / g.p.bankExpo);

  return { uL: Math.max(0, -diff), uR: Math.max(0, diff) };
}
