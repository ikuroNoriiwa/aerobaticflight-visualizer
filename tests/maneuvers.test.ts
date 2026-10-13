import { describe, expect, it } from 'vitest';
import { computeKinematics } from '../src/analysis/kinematics';
import { detectManeuvers, findLoops } from '../src/analysis/maneuvers';
import type { Flight, TrackPoint } from '../src/model';

const R_EARTH = 6371000;
const RAD = Math.PI / 180;
const T0 = Date.UTC(2026, 0, 1, 10);

type Seg = (p: { n: number; e: number; u: number; hdg: number }, dt: number) => void;

function build(segments: { seconds: number; step: Seg }[]): Flight {
  const s = { n: 0, e: 0, u: 500, hdg: 0 };
  const points: TrackPoint[] = [];
  let t = 0;
  const push = () =>
    points.push({
      t: T0 + t * 1000,
      lat: 46 + (s.n / R_EARTH) / RAD,
      lon: 6 + (s.e / (R_EARTH * Math.cos(46 * RAD))) / RAD,
      alt: s.u,
    });
  push();
  for (const seg of segments) {
    for (let i = 0; i < seg.seconds; i++) {
      seg.step(s, 1);
      t += 1;
      push();
    }
  }
  return { name: 'synthetic', points, hasTime: true };
}

const V = 60;
const level: Seg = (s, dt) => {
  s.n += V * Math.cos(s.hdg * RAD) * dt;
  s.e += V * Math.sin(s.hdg * RAD) * dt;
};
const turn = (bankDeg: number): Seg => (s, dt) => {
  const w = ((9.80665 * Math.tan(bankDeg * RAD)) / V) / RAD;
  const h1 = s.hdg + w * dt;
  const hm = ((s.hdg + h1) / 2) * RAD;
  s.n += V * Math.cos(hm) * dt;
  s.e += V * Math.sin(hm) * dt;
  s.hdg = h1;
};
function loop(radius: number, speed: number): { seconds: number; step: Seg } {
  const omega = speed / radius;
  const seconds = Math.round((2 * Math.PI) / omega);
  let theta = 0;
  return {
    seconds,
    step: (s, dt) => {
      const next = theta + omega * dt;
      s.n += radius * (Math.sin(next) - Math.sin(theta));
      s.u += radius * (Math.cos(theta) - Math.cos(next));
      theta = next;
    },
  };
}

describe('maneuver detection (synthetic flights)', () => {
  it('finds nothing special in straight and gentle flight', () => {
    const f = build([{ seconds: 40, step: level }, { seconds: 60, step: turn(20) }, { seconds: 40, step: level }]);
    const kinds = detectManeuvers(f).map((m) => m.kind);
    expect(kinds).not.toContain('loop');
    expect(kinds).not.toContain('steep-turn');
    expect(kinds).not.toContain('steep-climb');
    expect(kinds).not.toContain('steep-dive');
  });

  it('detects a right steep turn and estimates the bank', () => {
    const f = build([{ seconds: 30, step: level }, { seconds: 25, step: turn(60) }, { seconds: 30, step: level }]);
    const turns = detectManeuvers(f).filter((m) => m.kind === 'steep-turn');
    expect(turns).toHaveLength(1);
    expect(turns[0].label).toMatch(/right/);
    expect(turns[0].detail).toMatch(/~(5\d|6\d)°/);
  });

  it('detects a left steep turn', () => {
    const f = build([{ seconds: 30, step: level }, { seconds: 25, step: turn(-60) }, { seconds: 30, step: level }]);
    const turns = detectManeuvers(f).filter((m) => m.kind === 'steep-turn');
    expect(turns).toHaveLength(1);
    expect(turns[0].label).toMatch(/left/);
  });

  it('detects a loop and does not also report its parts as dives or climbs', () => {
    const f = build([{ seconds: 30, step: level }, loop(300, 70), { seconds: 30, step: level }]);
    const kinds = detectManeuvers(f).map((m) => m.kind);
    expect(kinds.filter((k) => k === 'loop')).toHaveLength(1);
    expect(kinds).not.toContain('steep-climb');
    expect(kinds).not.toContain('steep-dive');
  });

  it('tracks the full path angle through a loop, passing inverted at the top', () => {
    const f = build([{ seconds: 30, step: level }, loop(300, 70), { seconds: 30, step: level }]);
    const loops = findLoops(f, computeKinematics(f.points));
    expect(loops).toHaveLength(1);
    const deg = loops[0].phi.map((p) => (p * 180) / Math.PI);
    expect(Math.max(...deg)).toBeGreaterThan(300);
    expect(deg.some((d) => d > 150 && d < 210)).toBe(true);
    expect(deg.every((d, i) => i === 0 || d >= deg[i - 1] - 1)).toBe(true);
  });

  it('computes bank from turn rate with the right sign', () => {
    const right = computeKinematics(build([{ seconds: 20, step: level }, { seconds: 30, step: turn(30) }]).points);
    const left = computeKinematics(build([{ seconds: 20, step: level }, { seconds: 30, step: turn(-30) }]).points);
    expect(right.bank[40]).toBeGreaterThan(25);
    expect(right.bank[40]).toBeLessThan(35);
    expect(left.bank[40]).toBeLessThan(-25);
  });

  it('does not invent a bank while parked on the ground', () => {
    const parked: Flight = {
      name: 'parked',
      hasTime: true,
      points: Array.from({ length: 30 }, (_, i) => ({ t: T0 + i * 1000, lat: 46 + (i % 2) * 1e-6, lon: 6, alt: 400 })),
    };
    expect(computeKinematics(parked.points).bank.every((b) => b === 0)).toBe(true);
  });
});
