# FlightVis

Browser-only 3D viewer for flights recorded with a Garmin watch (`.fit`, `.gpx`, `.kml`). Files are parsed locally and never uploaded.

## Run

```bash
npm install
cp .env.example .env   # then paste a free Cesium Ion token (https://ion.cesium.com)
npm run dev            # http://localhost:5173
npm test               # parser unit tests
npm run build          # typecheck + production build
```

Without an Ion token the app still works, but uses flat OpenStreetMap imagery with no terrain, so altitude above ground is only approximate.

## Use

1. Click **Open file** or drop a `.fit` / `.gpx` / `.kml` file on the page.
2. The camera flies to the track. The line is colored by altitude (blue low, red high). A translucent curtain and a ground shadow show height above the ground.
3. Use the timeline at the bottom to scrub, and the clock widget to play/pause and change speed. The panel at top right shows time, altitude and speed at the cursor.
4. Pan, zoom and rotate freely at any time (left drag to pan, right drag or scroll to zoom, middle drag or Ctrl+drag to tilt).

## Notes

- KML files without timestamps (plain `LineString`) are played back at a synthetic 1 s per point.
- Garmin altitude is usually barometric/MSL while Cesium uses the ellipsoid, so an offset of up to about 50 m against the terrain is expected.
- Tracks over 20,000 points are decimated for rendering. The readout still uses every point.
