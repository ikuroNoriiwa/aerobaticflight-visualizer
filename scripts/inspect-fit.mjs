import { readFileSync } from 'node:fs';
import FitParser from 'fit-file-parser';

const path = process.argv[2];
if (!path) {
  console.error('Usage: node scripts/inspect-fit.mjs <file.fit>');
  process.exit(1);
}

const buf = readFileSync(path);
const data = await new FitParser({ includeRawMessages: true, includeUnmappedMessages: true }).parseAsync(
  buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
);

console.log('Decoded message lists:');
for (const [key, value] of Object.entries(data)) {
  if (Array.isArray(value) && value.length) console.log(`  ${key}: ${value.length}`);
}

const NAMES = loadMessageNames();
function loadMessageNames() {
  const src = readFileSync(new URL('../node_modules/fit-file-parser/dist/profile.js', import.meta.url), 'utf8');
  const block = src.match(/mesg_num:\s*\{([^}]*)\}/)?.[1] ?? '';
  return Object.fromEntries([...block.matchAll(/(\d+):\s*'([^']+)'/g)].map((m) => [m[1], m[2]]));
}
const counts = new Map();
for (const [src, list] of [['raw', data.raw_messages], ['unmapped', data.unmapped_messages]]) {
  for (const m of list ?? []) {
    const k = `${m.global_message_number}|${src}`;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
}
if (counts.size) {
  console.log('\nMessage types by global message number (raw = all, unmapped = not decoded by the parser):');
  for (const [k, n] of [...counts].sort((a, b) => b[1] - a[1])) {
    const [num, src] = k.split('|');
    console.log(`  #${num} ${NAMES[num] ?? ''} [${src}]: ${n}`);
  }
}

const fields = new Map();
for (const r of data.records ?? []) {
  for (const [k, v] of Object.entries(r)) if (v !== undefined && v !== null) fields.set(k, (fields.get(k) ?? 0) + 1);
}
console.log(`\nFields present in ${data.records?.length ?? 0} record messages:`);
for (const [k, n] of [...fields].sort((a, b) => b[1] - a[1])) console.log(`  ${k}: ${n}`);

const ts = (data.records ?? []).map((r) => new Date(r.timestamp).getTime()).filter(Number.isFinite);
if (ts.length > 1) {
  const dts = ts.slice(1).map((t, i) => (t - ts[i]) / 1000).sort((a, b) => a - b);
  console.log(`\nSampling interval: median ${dts[Math.floor(dts.length / 2)]} s, max ${dts[dts.length - 1]} s`);
}
