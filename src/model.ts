export type TrackPoint = {
  t: number;
  lat: number;
  lon: number;
  alt: number;
  speed?: number;
  hr?: number;
};

export type Flight = {
  name: string;
  points: TrackPoint[];
  hasTime: boolean;
};

export function buildFlight(name: string, raw: Partial<TrackPoint>[], hasTime: boolean): Flight {
  let points = raw.filter(
    (p): p is TrackPoint =>
      Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
      Math.abs(p.lat!) <= 90 && Math.abs(p.lon!) <= 180 &&
      (!hasTime || Number.isFinite(p.t)),
  ).map((p) => ({
    ...p,
    alt: Number.isFinite(p.alt) ? p.alt : 0,
    hr: p.hr !== undefined && p.hr >= 20 && p.hr <= 250 ? p.hr : undefined,
  })) as TrackPoint[];

  if (hasTime) {
    points.sort((a, b) => a.t - b.t);
    points = points.filter((p, i) => i === 0 || p.t > points[i - 1].t);
  } else {
    const t0 = Date.now();
    points = points.map((p, i) => ({ ...p, t: t0 + i * 1000 }));
  }

  if (points.length < 2) throw new Error('No usable track points found in file.');
  return { name, points, hasTime };
}
