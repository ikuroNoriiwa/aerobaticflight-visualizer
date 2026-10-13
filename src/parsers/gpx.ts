import { buildFlight, type Flight, type TrackPoint } from '../model';

export function parseGpx(text: string, name: string): Flight {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Invalid GPX file.');

  const raw: Partial<TrackPoint>[] = [];
  let hasTime = true;
  for (const pt of Array.from(doc.getElementsByTagName('trkpt'))) {
    const time = pt.getElementsByTagName('time')[0]?.textContent;
    const ele = pt.getElementsByTagName('ele')[0]?.textContent;
    const hr = pt.getElementsByTagNameNS('*', 'hr')[0]?.textContent;
    const t = time ? Date.parse(time) : NaN;
    if (!Number.isFinite(t)) hasTime = false;
    raw.push({
      lat: parseFloat(pt.getAttribute('lat') ?? ''),
      lon: parseFloat(pt.getAttribute('lon') ?? ''),
      alt: ele ? parseFloat(ele) : 0,
      t,
      hr: hr ? parseFloat(hr) : undefined,
    });
  }
  return buildFlight(name, raw, hasTime);
}
