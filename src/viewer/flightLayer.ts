import * as Cesium from 'cesium';
import { computeKinematics, wrap180 } from '../analysis/kinematics';
import { findLoops } from '../analysis/maneuvers';
import type { Flight } from '../model';

export type Sample = { time: Date; alt: number; speedKmh: number; bankDeg: number; hr?: number };
export type ViewMode = 'free' | 'chase' | 'cockpit';

const CHASE_BACK_M = 90;
const CHASE_UP_M = 22;
const CHASE_LOOK_AHEAD_M = 30;
const COCKPIT_UP_M = 1.5;
const FREE_RANGE_M = 800;

const MAX_TRACK_POINTS = 20000;
const MAX_WALL_POINTS = 1500;

function decimate<T>(arr: T[], max: number): T[] {
  if (arr.length <= max) return arr;
  const step = (arr.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => arr[Math.round(i * step)]);
}

export function createFlightLayer(viewer: Cesium.Viewer, flight: Flight, onSample: (s: Sample) => void) {
  const pts = flight.points;
  const cart = pts.map((p) => Cesium.Cartesian3.fromDegrees(p.lon, p.lat, p.alt));
  const times = pts.map((p) => Cesium.JulianDate.fromDate(new Date(p.t)));

  const alts = pts.map((p) => p.alt);
  const minAlt = Math.min(...alts);
  const span = Math.max(...alts) - minAlt || 1;
  const colorAt = (alt: number) => Cesium.Color.fromHsl(0.66 * (1 - (alt - minAlt) / span), 0.9, 0.55);

  const idx = decimate(pts.map((_, i) => i), MAX_TRACK_POINTS);
  const trackPrimitive = new Cesium.Primitive({
    geometryInstances: new Cesium.GeometryInstance({
      geometry: new Cesium.PolylineGeometry({
        positions: idx.map((i) => cart[i]),
        colors: idx.map((i) => colorAt(pts[i].alt)),
        colorsPerVertex: true,
        width: 5,
        vertexFormat: Cesium.PolylineColorAppearance.VERTEX_FORMAT,
      }),
    }),
    appearance: new Cesium.PolylineColorAppearance({ translucent: false }),
    asynchronous: false,
  });
  viewer.scene.primitives.add(trackPrimitive);

  const wallPositions = decimate(cart, MAX_WALL_POINTS);
  const wall = viewer.entities.add({
    wall: {
      positions: wallPositions,
      minimumHeights: wallPositions.map(() => 0),
      material: Cesium.Color.WHITE.withAlpha(0.15),
    },
  });
  const shadow = viewer.entities.add({
    polyline: {
      positions: wallPositions,
      width: 2,
      clampToGround: true,
      material: Cesium.Color.BLACK.withAlpha(0.6),
    },
  });

  const position = new Cesium.SampledPositionProperty();
  position.addSamples(times, cart);

  const start = times[0];
  const stop = times[times.length - 1];
  const durationS = Cesium.JulianDate.secondsDifference(stop, start);
  const clock = viewer.clock;

  const kin = computeKinematics(pts);
  const locate = (ms: number) => {
    let lo = 0;
    let hi = pts.length - 1;
    while (lo < hi - 1) {
      const mid = (lo + hi) >> 1;
      if (pts[mid].t <= ms) lo = mid;
      else hi = mid;
    }
    const span = pts[hi].t - pts[lo].t;
    return { lo, hi, f: span > 0 ? Math.min(1, Math.max(0, (ms - pts[lo].t) / span)) : 0 };
  };

  const loops = findLoops(flight, kin);
  const loopOf = new Int32Array(pts.length).fill(-1);
  loops.forEach((l, li) => {
    for (let i = l.from; i <= l.to; i++) loopOf[i] = li;
  });

  const pose = (lo: number, hi: number, f: number) => {
    const li = loopOf[lo];
    if (li >= 0 && loopOf[hi] === li) {
      const l = loops[li];
      const a = l.phi[lo - l.from];
      const b = l.phi[hi - l.from];
      return { heading: l.headingDeg, pitch: ((a + (b - a) * f) * 180) / Math.PI, bank: 0 };
    }
    if (kin.flying[lo] && kin.flying[hi]) {
      return {
        heading: (kin.heading[lo] + wrap180(kin.heading[hi] - kin.heading[lo]) * f + 360) % 360,
        pitch: kin.gamma[lo] + (kin.gamma[hi] - kin.gamma[lo]) * f,
        bank: kin.bank[lo] + (kin.bank[hi] - kin.bank[lo]) * f,
      };
    }
    return null;
  };

  const hpr = new Cesium.HeadingPitchRoll();
  const scratchPos = new Cesium.Cartesian3();
  let lastHeading = 0;
  let lastPitch = 0;
  let lastQuat = Cesium.Quaternion.clone(Cesium.Quaternion.IDENTITY);
  const orientation = new Cesium.CallbackProperty((time, result) => {
    const pos = position.getValue(time ?? clock.currentTime, scratchPos);
    if (!pos) return lastQuat;
    const { lo, hi, f } = locate(Cesium.JulianDate.toDate(time ?? clock.currentTime).getTime());
    const p = pose(lo, hi, f);
    if (p) {
      lastHeading = p.heading;
      lastPitch = p.pitch;
    }
    hpr.heading = Cesium.Math.toRadians(lastHeading - 90);
    hpr.pitch = Cesium.Math.toRadians(lastPitch);
    hpr.roll = Cesium.Math.toRadians(p?.bank ?? 0);
    lastQuat = Cesium.Transforms.headingPitchRollQuaternion(pos, hpr, undefined, undefined, result);
    return lastQuat;
  }, false);

  const marker = viewer.entities.add({
    position,
    orientation,
    model: {
      uri: `${import.meta.env.BASE_URL}models/plane.glb`,
      minimumPixelSize: 64,
      maximumScale: 2000,
    },
  });

  const camera = viewer.camera;
  const camCtrl = viewer.scene.screenSpaceCameraController;
  const camPos = new Cesium.Cartesian3();
  const camQuat = new Cesium.Quaternion();
  const camRot = new Cesium.Matrix3();
  const fwd = new Cesium.Cartesian3();
  const upv = new Cesium.Cartesian3();
  const right = new Cesium.Cartesian3();
  const eye = new Cesium.Cartesian3();
  const look = new Cesium.Cartesian3();
  let mode: ViewMode = 'free';

  const placeCamera = () => {
    const time = clock.currentTime;
    if (!position.getValue(time, camPos)) return;
    Cesium.Matrix3.fromQuaternion(orientation.getValue(time, camQuat), camRot);
    Cesium.Matrix3.getColumn(camRot, 0, fwd);
    Cesium.Matrix3.getColumn(camRot, 2, upv);
    if (mode === 'cockpit') {
      Cesium.Cartesian3.multiplyByScalar(upv, COCKPIT_UP_M, eye);
      Cesium.Cartesian3.add(camPos, eye, eye);
      Cesium.Cartesian3.clone(fwd, look);
    } else {
      Cesium.Cartesian3.multiplyByScalar(fwd, -CHASE_BACK_M, eye);
      Cesium.Cartesian3.multiplyByScalar(upv, CHASE_UP_M, look);
      Cesium.Cartesian3.add(eye, look, eye);
      Cesium.Cartesian3.add(camPos, eye, eye);
      Cesium.Cartesian3.multiplyByScalar(fwd, CHASE_LOOK_AHEAD_M, look);
      Cesium.Cartesian3.add(camPos, look, look);
      Cesium.Cartesian3.subtract(look, eye, look);
    }
    Cesium.Cartesian3.normalize(look, look);
    Cesium.Cartesian3.cross(look, upv, right);
    Cesium.Cartesian3.normalize(right, right);
    Cesium.Cartesian3.cross(right, look, upv);
    camera.setView({ destination: eye, orientation: { direction: look, up: upv } });
  };
  const removePreRender = viewer.scene.preRender.addEventListener(() => {
    if (mode !== 'free') placeCamera();
  });

  clock.startTime = start.clone();
  clock.stopTime = stop.clone();
  clock.currentTime = start.clone();
  clock.clockRange = Cesium.ClockRange.CLAMPED;
  clock.multiplier = Math.max(1, Math.round(durationS / 120));
  clock.shouldAnimate = false;
  viewer.timeline.zoomTo(start, stop);

  const sphere = Cesium.BoundingSphere.fromPoints(cart);
  viewer.camera.flyToBoundingSphere(sphere, {
    duration: 1.5,
    offset: new Cesium.HeadingPitchRange(0, Cesium.Math.toRadians(-35), Math.max(sphere.radius * 2.5, 500)),
  });

  const emit = () => {
    const ms = Cesium.JulianDate.toDate(clock.currentTime).getTime();
    const { lo, hi, f } = locate(ms);
    const a = pts[lo];
    const b = pts[hi];
    const dt = (b.t - a.t) / 1000;
    const speed = a.speed !== undefined && b.speed !== undefined
      ? a.speed + (b.speed - a.speed) * f
      : Cesium.Cartesian3.distance(cart[lo], cart[hi]) / dt;
    const bank = pose(lo, hi, f)?.bank ?? 0;
    const hr = a.hr !== undefined && b.hr !== undefined ? a.hr + (b.hr - a.hr) * f : (a.hr ?? b.hr);
    onSample({ time: new Date(ms), alt: a.alt + (b.alt - a.alt) * f, speedKmh: speed * 3.6, bankDeg: bank, hr });
  };
  const removeTick = clock.onTick.addEventListener(emit);
  emit();

  return {
    setView(next: ViewMode) {
      if (next === mode) return;
      mode = next;
      camera.cancelFlight();
      const free = next === 'free';
      camCtrl.enableInputs = free;
      camCtrl.enableCollisionDetection = free;
      marker.show = next !== 'cockpit';
      if (free) {
        const here = position.getValue(clock.currentTime);
        if (here) {
          camera.flyToBoundingSphere(new Cesium.BoundingSphere(here, 50), {
            duration: 0.8,
            offset: new Cesium.HeadingPitchRange(camera.heading, Cesium.Math.toRadians(-30), FREE_RANGE_M),
          });
        }
      } else {
        placeCamera();
      }
    },
    jumpTo(ms: number) {
      const clamped = Math.min(pts[pts.length - 1].t, Math.max(pts[0].t, ms));
      clock.currentTime = Cesium.JulianDate.fromDate(new Date(clamped));
      clock.shouldAnimate = false;
      emit();
    },
    dispose() {
      removeTick();
      removePreRender();
      camCtrl.enableInputs = true;
      camCtrl.enableCollisionDetection = true;
      viewer.scene.primitives.remove(trackPrimitive);
      viewer.entities.remove(wall);
      viewer.entities.remove(shadow);
      viewer.entities.remove(marker);
    },
  };
}
