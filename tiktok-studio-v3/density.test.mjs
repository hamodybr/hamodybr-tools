import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { test } from 'node:test';

// Load the standalone browser module in Node without altering the repository package type.
const source = await readFile(new URL('./hamodybr-density.js', import.meta.url), 'utf8');
const { inspectNormalizedMp4, buildDensity } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const U = (n) => { const b = new Uint8Array(4); new DataView(b.buffer).setUint32(0, n); return b; };
const A = (s) => Uint8Array.from([...s].map((c) => c.charCodeAt(0)));
const C = (...parts) => { const b = new Uint8Array(parts.reduce((n, p) => n + p.length, 0)); let at = 0; for (const p of parts) { b.set(p, at); at += p.length; } return b; };
const B = (t, p) => C(U(p.length + 8), A(t), p);
const F = (t, rows) => B(t, C(new Uint8Array(4), U(rows.length), ...rows.map((r) => C(...r.map(U)))));
function fixture() {
  const ftyp = B('ftyp', C(A('isom'), U(0), A('isom')));
  const stsd = B('stsd', C(new Uint8Array(4), U(1), U(16), A('avc1'), new Uint8Array(8)));
  const video = (offsets) => B('stbl', C(stsd, F('stts', [[2, 1000]]),
    B('stsz', C(new Uint8Array(4), U(0), U(2), U(4), U(4))),
    F('stsc', [[1, 1, 1]]), F('stco', offsets.map((n) => [n]))));
  const moov = (offsets) => B('moov', B('trak', B('mdia', C(
    B('hdlr', C(new Uint8Array(8), A('vide'), new Uint8Array(4))),
    B('minf', video(offsets))))));
  const sample = Uint8Array.from([0, 0, 0, 0, 1, 2, 3, 4]);
  const start = ftyp.length + moov([0, 0]).length + 8;
  return C(ftyp, moov([start, start + 4]), B('mdat', sample));
}
test('reads a canonical MP4 sample map', () => {
  const parsed = inspectNormalizedMp4(fixture());
  assert.equal(parsed.video.count, 2);
  assert.equal(parsed.video.codec, 'avc1');
});
test('factor 2 preserves all source payload bytes and declares 4 samples', () => {
  const result = buildDensity(fixture(), 2);
  assert.equal(result.report.originalSamples, 2);
  assert.equal(result.report.declaredSamples, 4);
  assert.equal(result.report.pseudoSamples, 2);
  assert.equal(result.report.realPayloadIdentical, true);
});
test('factor 10 declares 20 samples while preserving source payload', () => {
  const result = buildDensity(fixture(), 10);
  assert.equal(result.report.declaredSamples, 20);
  assert.equal(result.report.pseudoSamples, 18);
  assert.equal(result.report.realPayloadIdentical, true);
});
test('rejects unsupported sample density and bad input', () => {
  assert.throws(() => buildDensity(fixture(), 3), /Density factor/);
  assert.throws(() => buildDensity(new Uint8Array(16), 10));
});