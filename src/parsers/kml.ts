import { buildFlight, type Flight, type TrackPoint } from '../model';

export function parseKml(text: string, name: string): Flight {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid KML file.');

  const raw: Partial<TrackPoint>[] = [];

  // gx:Track: parallel <when> and <gx:coord> lists (lon lat alt, space separated)
  for (const track of Array.from(doc.getElementsByTagNameNS('*', 'Track'))) {
    const whens = Array.from(track.getElementsByTagNameNS('*', 'when')).map((e) => Date.parse(e.textContent ?? ''));
    const coords = Array.from(track.getElementsByTagNameNS('*', 'coord'));
    coords.forEach((c, i) => {
      const [lon, lat, alt] = (c.textContent ?? '').trim().split(/\s+/).map(parseFloat);
      raw.push({ lat, lon, alt: alt ?? 0, t: whens[i] });
    });
  }
  if (raw.length >= 2) return buildFlight(name, raw, raw.every((p) => Number.isFinite(p.t)));

  // Fallback: LineString "lon,lat,alt lon,lat,alt ..." with no timestamps
  raw.length = 0;
  for (const el of Array.from(doc.getElementsByTagNameNS('*', 'coordinates'))) {
    for (const tuple of (el.textContent ?? '').trim().split(/\s+/)) {
      const [lon, lat, alt] = tuple.split(',').map(parseFloat);
      raw.push({ lat, lon, alt: alt ?? 0 });
    }
  }
  return buildFlight(name, raw, false);
}
