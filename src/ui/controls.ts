import type { Maneuver } from '../analysis/maneuvers';
import type { Sample, ViewMode } from '../viewer/flightLayer';
import { setHeartRate } from './heart';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export function setupControls(onFile: (file: File) => void) {
  const input = $<HTMLInputElement>('file');
  input.addEventListener('change', () => {
    const f = input.files?.[0];
    if (f) onFile(f);
    input.value = '';
  });

  const mask = $('dropmask');
  let depth = 0;
  window.addEventListener('dragenter', (e) => { e.preventDefault(); depth++; mask.hidden = false; });
  window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; mask.hidden = true; } });
  window.addEventListener('dragover', (e) => e.preventDefault());
  window.addEventListener('drop', (e) => {
    e.preventDefault();
    depth = 0;
    mask.hidden = true;
    const f = e.dataTransfer?.files?.[0];
    if (f) onFile(f);
  });
}

let errorTimer: number | undefined;
export function showError(message: string) {
  const el = $('error');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(errorTimer);
  errorTimer = window.setTimeout(() => (el.hidden = true), 8000);
}

export function setLoaded(name: string, pointCount: number, notes: string[]) {
  $('error').hidden = true;
  $('filename').textContent = `${name} (${pointCount.toLocaleString()} points)`;
  $('readout').hidden = false;
  setNotes(notes);
}

export function setNotes(notes: string[]) {
  const el = $('notes');
  el.replaceChildren(...notes.map((n) => Object.assign(document.createElement('p'), { textContent: n })));
}

export function updateReadout(s: Sample) {
  $('r-time').textContent = s.time.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  $('r-alt').textContent = `${Math.round(s.alt).toLocaleString()} m`;
  $('r-speed').textContent = `${Math.round(s.speedKmh)} km/h`;
  const b = Math.round(s.bankDeg);
  $('r-bank').textContent = b === 0 ? '0°' : `${Math.abs(b)}° ${b < 0 ? 'L' : 'R'}`;
  setHeartRate(s.hr);
}

export function setManeuvers(list: Maneuver[], startMs: number, onPick: (m: Maneuver) => void) {
  const box = $('maneuvers');
  const ul = $('maneuver-list');
  box.hidden = list.length === 0;
  ul.replaceChildren(
    ...list.map((m) => {
      const li = document.createElement('li');
      const what = document.createElement('span');
      what.className = 'what';
      what.append(Object.assign(document.createElement('span'), { textContent: m.label }));
      what.append(Object.assign(document.createElement('small'), { textContent: m.detail }));
      const secs = Math.round((m.startMs - startMs) / 1000);
      const when = Object.assign(document.createElement('span'), {
        className: 'when',
        textContent: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`,
      });
      li.append(what, when);
      li.addEventListener('click', () => onPick(m));
      return li;
    }),
  );
}

export function setupViews(onView: (mode: ViewMode) => void) {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('#views button'));
  for (const b of buttons) {
    b.addEventListener('click', () => {
      setActiveView(b.dataset.view as ViewMode);
      onView(b.dataset.view as ViewMode);
    });
  }
}

export function setActiveView(mode: ViewMode) {
  for (const b of document.querySelectorAll<HTMLButtonElement>('#views button')) {
    b.classList.toggle('active', b.dataset.view === mode);
  }
}

export function showViews(visible: boolean) {
  $('views').hidden = !visible;
}
