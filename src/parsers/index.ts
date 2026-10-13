import type { Flight } from '../model';
import { parseFit } from './fit';
import { parseGpx } from './gpx';
import { parseKml } from './kml';

export async function parseFlightFile(file: File): Promise<Flight> {
  const ext = file.name.split('.').pop()?.toLowerCase();
  const name = file.name.replace(/\.[^.]+$/, '');
  if (ext === 'fit') return parseFit(await file.arrayBuffer(), name);
  if (ext === 'gpx') return parseGpx(await file.text(), name);
  if (ext === 'kml') return parseKml(await file.text(), name);
  throw new Error(`Unsupported file type ".${ext}". Use .fit, .gpx or .kml.`);
}
