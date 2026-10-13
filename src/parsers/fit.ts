import FitParser from 'fit-file-parser';
import { buildFlight, type Flight, type TrackPoint } from '../model';

export async function parseFit(buf: ArrayBuffer, name: string): Promise<Flight> {
  const data = await new FitParser({ speedUnit: 'm/s', lengthUnit: 'm' }).parseAsync(buf);
  const raw: Partial<TrackPoint>[] = (data.records ?? []).map((r) => ({
    lat: r.position_lat,
    lon: r.position_long,
    alt: r.enhanced_altitude ?? r.altitude,
    speed: r.enhanced_speed ?? r.speed,
    hr: r.heart_rate,
    t: r.timestamp ? new Date(r.timestamp).getTime() : NaN,
  }));
  return buildFlight(name, raw, raw.every((p) => Number.isFinite(p.t)));
}
