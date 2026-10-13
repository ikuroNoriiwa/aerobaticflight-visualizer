import './style.css';
import { parseFlightFile } from './parsers';
import { detectManeuvers } from './analysis/maneuvers';
import {
  setActiveView, setLoaded, setManeuvers, setNotes, setupControls, setupViews, showError, showViews, updateReadout,
} from './ui/controls';
import { showHeart } from './ui/heart';
import { createFlightLayer } from './viewer/flightLayer';
import { createViewer } from './viewer/scene';

const { viewer, hasToken } = createViewer(document.getElementById('globe')!);
const baseNotes = hasToken
  ? []
  : ['No Cesium Ion token set: using flat OpenStreetMap map without terrain. See .env.example.'];
setNotes(baseNotes);

let layer: ReturnType<typeof createFlightLayer> | undefined;
setupViews((mode) => layer?.setView(mode));

setupControls(async (file) => {
  try {
    const flight = await parseFlightFile(file);
    layer?.dispose();
    layer = createFlightLayer(viewer, flight, updateReadout);
    const notes = [...baseNotes];
    if (!flight.hasTime) notes.push('File has no timestamps: playback uses a synthetic 1 s interval per point.');
    setLoaded(flight.name, flight.points.length, notes);
    showHeart(flight.points.some((p) => p.hr !== undefined));
    setActiveView('free');
    showViews(true);
    const current = layer;
    setManeuvers(detectManeuvers(flight), flight.points[0].t, (m) => current.jumpTo(m.startMs - 5000));
  } catch (e) {
    showError(e instanceof Error ? e.message : String(e));
  }
});
