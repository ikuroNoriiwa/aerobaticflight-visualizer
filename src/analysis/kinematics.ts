import type { TrackPoint } from '../model';

export type Kinematics = {
  t: number[];
  speed: number[];
  vs: number[];
  heading: number[];
  turnRate: number[];
  bank: number[];
  gamma: number[];
  flying: boolean[];
};

const G = 9.80665;
const EARTH_R = 6371000;
const RAD = Math.PI / 180;
const MAX_NEIGHBOR_GAP_S = 6;
const MIN_FLYING_SPEED = 20;
const MAX_BANK_DEG = 80;
const MAX_TURN_RATE_FOR_BANK = 60;

export function wrap180(deg: number): number {
  let d = deg % 360;
  if (d > 180) d -= 360;
  else if (d <= -180) d += 360;
  return d;
}

export function computeKinematics(points: TrackPoint[]): Kinematics {
  const n = points.length;
  const t = points.map((p) => (p.t - points[0].t) / 1000);
  const speed = new Array<number>(n).fill(0);
  const vs = new Array<number>(n).fill(0);
  const heading = new Array<number>(n).fill(0);
  const turnRate = new Array<number>(n).fill(0);
  const gamma = new Array<number>(n).fill(0);
  const valid = new Array<boolean>(n).fill(false);

  for (let i = 0; i < n; i++) {
    const a = points[Math.max(0, i - 1)];
    const b = points[Math.min(n - 1, i + 1)];
    const dt = (b.t - a.t) / 1000;
    if (dt <= 0 || dt > MAX_NEIGHBOR_GAP_S) continue;
    const north = ((b.lat - a.lat) * RAD * EARTH_R) / dt;
    const east = ((b.lon - a.lon) * RAD * EARTH_R * Math.cos(points[i].lat * RAD)) / dt;
    speed[i] = Math.hypot(east, north);
    vs[i] = (b.alt - a.alt) / dt;
    heading[i] = (Math.atan2(east, north) / RAD + 360) % 360;
    gamma[i] = Math.atan2(vs[i], speed[i]) / RAD;
    valid[i] = true;
  }

  for (let i = 1; i < n - 1; i++) {
    if (!valid[i - 1] || !valid[i + 1]) continue;
    const dt = t[i + 1] - t[i - 1];
    if (dt <= 0 || dt > MAX_NEIGHBOR_GAP_S) continue;
    turnRate[i] = wrap180(heading[i + 1] - heading[i - 1]) / dt;
  }

  const flying = valid.map((v, i) => v && speed[i] >= MIN_FLYING_SPEED);

  const rawBank = turnRate.map((w, i) => {
    if (!flying[i] || Math.abs(w) > MAX_TURN_RATE_FOR_BANK) return 0;
    const b = Math.atan((speed[i] * w * RAD) / G) / RAD;
    return Math.max(-MAX_BANK_DEG, Math.min(MAX_BANK_DEG, b));
  });
  const bank = rawBank.map((_, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(n - 1, i + 1);
    let sum = 0;
    for (let k = lo; k <= hi; k++) sum += rawBank[k];
    return sum / (hi - lo + 1);
  });

  return { t, speed, vs, heading, turnRate, bank, gamma, flying };
}
