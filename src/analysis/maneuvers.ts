import type { Flight } from '../model';
import { computeKinematics, type Kinematics } from './kinematics';

export type ManeuverKind = 'takeoff' | 'landing' | 'max-altitude' | 'loop' | 'steep-turn' | 'steep-climb' | 'steep-dive';

export type Maneuver = {
  kind: ManeuverKind;
  label: string;
  detail: string;
  startMs: number;
  endMs: number;
};

const RAD = Math.PI / 180;
const MIN_FLYING_SPEED = 20;
const STEEP_BANK_DEG = 45;
const STEEP_BANK_MIN_S = 6;
const STEEP_PATH_DEG = 30;
const STEEP_PATH_MIN_S = 4;
const LOOP_MAX_DURATION_S = 45;
const LOOP_MIN_ROTATION_DEG = 300;
const LOOP_MIN_PEAK_PATH_DEG = 55;
const LOOP_MIN_ALT_GAIN_M = 80;

type Run = { from: number; to: number };

export type LoopPose = Run & { headingDeg: number; phi: number[] };

function wrapPi(a: number): number {
  let d = a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return d;
}

function loopPose(k: Kinematics, from: number, to: number): LoopPose {
  const h0 = k.heading[from] * RAD;
  let prev = Math.atan2(k.vs[from], k.speed[from]);
  let acc = prev;
  const phi = [acc];
  for (let j = from + 1; j <= to; j++) {
    const raw = Math.atan2(k.vs[j], k.speed[j] * Math.cos(k.heading[j] * RAD - h0));
    acc += wrapPi(raw - prev);
    prev = raw;
    phi.push(acc);
  }
  return { from, to, headingDeg: k.heading[from], phi };
}

function findRuns(n: number, pred: (i: number) => boolean, maxHole: number, minSamples: number): Run[] {
  const runs: Run[] = [];
  let from = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    if (pred(i)) {
      if (from < 0) from = i;
      last = i;
    } else if (from >= 0 && i - last > maxHole) {
      if (last - from + 1 >= minSamples) runs.push({ from, to: last });
      from = -1;
    }
  }
  if (from >= 0 && last - from + 1 >= minSamples) runs.push({ from, to: last });
  return runs;
}

function overlaps(a: Run, list: Run[]): boolean {
  return list.some((b) => a.from <= b.to && b.from <= a.to);
}

export function findLoops(flight: Flight, k: Kinematics): LoopPose[] {
  const pts = flight.points;
  const n = pts.length;
  const loops: LoopPose[] = [];
  let i = 0;
  while (i < n - 2) {
    if (!k.flying[i]) {
      i++;
      continue;
    }
    const h0 = k.heading[i] * RAD;
    let phiPrev = Math.atan2(k.vs[i], k.speed[i]);
    const phi0 = phiPrev;
    let phi = phiPrev;
    let peakPath = 0;
    let maxAlt = pts[i].alt;
    let found = -1;
    for (let j = i + 1; j < n && k.t[j] - k.t[i] <= LOOP_MAX_DURATION_S; j++) {
      if (k.speed[j] === 0 && k.vs[j] === 0) break;
      const raw = Math.atan2(k.vs[j], k.speed[j] * Math.cos(k.heading[j] * RAD - h0));
      phi += wrapPi(raw - phiPrev);
      phiPrev = raw;
      peakPath = Math.max(peakPath, Math.abs(k.gamma[j]));
      maxAlt = Math.max(maxAlt, pts[j].alt);
      if (
        Math.abs(phi - phi0) >= LOOP_MIN_ROTATION_DEG * RAD &&
        peakPath >= LOOP_MIN_PEAK_PATH_DEG &&
        maxAlt - pts[i].alt >= LOOP_MIN_ALT_GAIN_M
      ) {
        found = j;
        break;
      }
    }
    if (found > 0) {
      let start = i;
      while (start < found && Math.abs(k.gamma[start]) < 15) start++;
      loops.push(loopPose(k, Math.max(i, start - 1), found));
      i = found + 1;
    } else {
      i++;
    }
  }
  return loops;
}

export function detectManeuvers(flight: Flight): Maneuver[] {
  const pts = flight.points;
  const n = pts.length;
  const k = computeKinematics(pts);
  const out: Maneuver[] = [];
  const add = (kind: ManeuverKind, label: string, detail: string, from: number, to: number) =>
    out.push({ kind, label, detail, startMs: pts[from].t, endMs: pts[to].t });

  const flyingRuns = findRuns(n, (i) => k.flying[i], 5, 10);
  if (flyingRuns.length) {
    const first = flyingRuns[0].from;
    const last = flyingRuns[flyingRuns.length - 1].to;
    add('takeoff', 'Takeoff', `${Math.round(k.speed[first] * 3.6)} km/h`, first, first);
    add('landing', 'Landing', `${Math.round(k.speed[last] * 3.6)} km/h`, last, last);
  }

  let maxI = 0;
  for (let i = 1; i < n; i++) if (pts[i].alt > pts[maxI].alt) maxI = i;
  add('max-altitude', 'Max altitude', `${Math.round(pts[maxI].alt)} m`, maxI, maxI);

  const loops = findLoops(flight, k);
  for (const r of loops) {
    const peak = Math.max(...pts.slice(r.from, r.to + 1).map((p) => p.alt));
    add('loop', 'Loop', `${Math.round(k.t[r.to] - k.t[r.from])} s, top at ${Math.round(peak)} m`, r.from, r.to);
  }

  const turns = findRuns(n, (i) => Math.abs(k.bank[i]) >= STEEP_BANK_DEG, 1, STEEP_BANK_MIN_S);
  for (const r of turns) {
    if (overlaps(r, loops)) continue;
    const slice = k.bank.slice(r.from, r.to + 1);
    const peak = slice.reduce((m, b) => (Math.abs(b) > Math.abs(m) ? b : m), 0);
    const side = peak < 0 ? 'left' : 'right';
    add('steep-turn', `Steep turn ${side}`, `~${Math.round(Math.abs(peak))}° bank (estimated), ${Math.round(k.t[r.to] - k.t[r.from])} s`, r.from, r.to);
  }

  const climbs = findRuns(n, (i) => k.flying[i] && k.gamma[i] >= STEEP_PATH_DEG, 1, STEEP_PATH_MIN_S);
  for (const r of climbs) {
    if (overlaps(r, loops)) continue;
    const gain = pts[r.to].alt - pts[r.from].alt;
    add('steep-climb', 'Steep climb', `+${Math.round(gain)} m in ${Math.round(k.t[r.to] - k.t[r.from])} s`, r.from, r.to);
  }

  const dives = findRuns(n, (i) => k.flying[i] && k.gamma[i] <= -STEEP_PATH_DEG, 1, STEEP_PATH_MIN_S);
  for (const r of dives) {
    if (overlaps(r, loops)) continue;
    const loss = pts[r.from].alt - pts[r.to].alt;
    add('steep-dive', 'Steep dive', `-${Math.round(loss)} m in ${Math.round(k.t[r.to] - k.t[r.from])} s`, r.from, r.to);
  }

  return out.sort((a, b) => a.startMs - b.startMs);
}
