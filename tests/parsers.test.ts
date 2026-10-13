import { describe, expect, it } from 'vitest';
import { FitBaseType, FitEncoder } from 'fit-file-parser';
import { parseFlightFile } from '../src/parsers';

const file = (name: string, body: BlobPart) => new File([body], name);

const GPX = `<?xml version="1.0"?><gpx><trk><trkseg>
<trkpt lat="46.0" lon="6.0"><ele>400</ele><time>2026-01-01T10:00:00Z</time></trkpt>
<trkpt lat="46.1" lon="6.1"><ele>1500.5</ele><time>2026-01-01T10:00:10Z</time></trkpt>
<trkpt lat="46.2" lon="6.2"><ele>900</ele><time>2026-01-01T10:00:20Z</time></trkpt>
</trkseg></trk></gpx>`;

const KML_TRACK = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2" xmlns:gx="http://www.google.com/kml/ext/2.2"><Document><Placemark><gx:Track>
<when>2026-01-01T10:00:00Z</when><when>2026-01-01T10:00:10Z</when>
<gx:coord>6.0 46.0 400</gx:coord><gx:coord>6.1 46.1 1500</gx:coord>
</gx:Track></Placemark></Document></kml>`;

const KML_LINE = `<?xml version="1.0"?><kml xmlns="http://www.opengis.net/kml/2.2"><Document><Placemark><LineString>
<coordinates>6.0,46.0,400 6.1,46.1,1500 6.2,46.2,900</coordinates>
</LineString></Placemark></Document></kml>`;

function makeFit(): Uint8Array {
  const semi = (deg: number) => Math.round((deg * 2 ** 31) / 180);
  const enc = new FitEncoder();
  enc.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
  ]);
  const t0 = new Date('2026-01-01T10:00:00Z');
  [[46.0, 6.0, 400], [46.1, 6.1, 1500], [46.2, 6.2, 900]].forEach(([lat, lon, alt], i) => {
    enc.writeMessage(20, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(t0.getTime() + i * 10000)) },
      { number: 0, size: 4, baseType: FitBaseType.Sint32, value: semi(lat) },
      { number: 1, size: 4, baseType: FitBaseType.Sint32, value: semi(lon) },
      { number: 2, size: 2, baseType: FitBaseType.Uint16, value: Math.round((alt + 500) * 5) },
    ], 1);
  });
  return enc.close();
}

describe('parsers', () => {
  it('parses GPX', async () => {
    const f = await parseFlightFile(file('a.gpx', GPX));
    expect(f.points).toHaveLength(3);
    expect(f.hasTime).toBe(true);
    expect(f.points[1]).toMatchObject({ lat: 46.1, lon: 6.1, alt: 1500.5 });
    expect(f.points[2].t - f.points[0].t).toBe(20000);
  });

  it('parses KML gx:Track', async () => {
    const f = await parseFlightFile(file('a.kml', KML_TRACK));
    expect(f.points).toHaveLength(2);
    expect(f.hasTime).toBe(true);
    expect(f.points[1]).toMatchObject({ lat: 46.1, lon: 6.1, alt: 1500 });
  });

  it('parses KML LineString without time and synthesizes 1 s spacing', async () => {
    const f = await parseFlightFile(file('a.kml', KML_LINE));
    expect(f.points).toHaveLength(3);
    expect(f.hasTime).toBe(false);
    expect(f.points[1].t - f.points[0].t).toBe(1000);
  });

  it('parses FIT', async () => {
    const f = await parseFlightFile(file('a.fit', makeFit() as BlobPart));
    expect(f.points).toHaveLength(3);
    expect(f.points[1].lat).toBeCloseTo(46.1, 4);
    expect(f.points[1].lon).toBeCloseTo(6.1, 4);
    expect(f.points[1].alt).toBeCloseTo(1500, 0);
    expect(f.points[2].t - f.points[0].t).toBe(20000);
  });

  it('reads heart rate from GPX extensions and drops implausible values', async () => {
    const gpx = `<?xml version="1.0"?><gpx xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><trk><trkseg>
<trkpt lat="46.0" lon="6.0"><ele>400</ele><time>2026-01-01T10:00:00Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>92</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
<trkpt lat="46.1" lon="6.1"><ele>500</ele><time>2026-01-01T10:00:10Z</time><extensions><gpxtpx:TrackPointExtension><gpxtpx:hr>0</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions></trkpt>
<trkpt lat="46.2" lon="6.2"><ele>600</ele><time>2026-01-01T10:00:20Z</time></trkpt>
</trkseg></trk></gpx>`;
    const f = await parseFlightFile(file('hr.gpx', gpx));
    expect(f.points.map((p) => p.hr)).toEqual([92, undefined, undefined]);
  });

  it('reads heart rate from FIT records', async () => {
    const semi = (deg: number) => Math.round((deg * 2 ** 31) / 180);
    const enc = new FitEncoder();
    enc.writeMessage(0, [{ number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 }]);
    const t0 = new Date('2026-01-01T10:00:00Z');
    [140, 151].forEach((hr, i) => {
      enc.writeMessage(20, [
        { number: 253, size: 4, baseType: FitBaseType.Uint32, value: FitEncoder.toFitTimestamp(new Date(t0.getTime() + i * 1000)) },
        { number: 0, size: 4, baseType: FitBaseType.Sint32, value: semi(46 + i / 100) },
        { number: 1, size: 4, baseType: FitBaseType.Sint32, value: semi(6) },
        { number: 3, size: 1, baseType: FitBaseType.Uint8, value: hr },
      ], 1);
    });
    const f = await parseFlightFile(file('hr.fit', enc.close() as BlobPart));
    expect(f.points.map((p) => p.hr)).toEqual([140, 151]);
  });

  it('rejects unsupported and malformed files', async () => {
    await expect(parseFlightFile(file('a.txt', 'x'))).rejects.toThrow(/Unsupported/);
    await expect(parseFlightFile(file('a.gpx', '<gpx><oops'))).rejects.toThrow();
    await expect(parseFlightFile(file('a.gpx', '<gpx></gpx>'))).rejects.toThrow(/No usable/);
  });
});
