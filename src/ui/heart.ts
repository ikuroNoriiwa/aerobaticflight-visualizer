const el = <T extends HTMLElement | SVGElement>(id: string) => document.getElementById(id) as unknown as T;

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

let bpm: number | undefined;
let phase = 0;
let last = 0;
let running = false;

const bump = (p: number, center: number, width: number) => Math.exp(-(((p - center) / width) ** 2));

function frame(now: number) {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  const icon = el<SVGElement>('heart-icon');
  if (bpm === undefined || reducedMotion) {
    icon.style.transform = '';
  } else {
    phase = (phase + (dt * bpm) / 60) % 1;
    const scale = 1 + 0.22 * bump(phase, 0.08, 0.05) + 0.14 * bump(phase, 0.3, 0.06);
    icon.style.transform = `scale(${scale.toFixed(3)})`;
  }
  requestAnimationFrame(frame);
}

export function showHeart(visible: boolean) {
  el<HTMLElement>('heart').hidden = !visible;
  if (visible && !running) {
    running = true;
    last = performance.now();
    requestAnimationFrame(frame);
  }
  if (!visible) setHeartRate(undefined);
}

export function setHeartRate(value: number | undefined) {
  bpm = value;
  el<HTMLElement>('heart').classList.toggle('idle', value === undefined);
  el<HTMLElement>('heart-value').textContent = value === undefined ? '--' : String(Math.round(value));
}
