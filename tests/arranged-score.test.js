import test from 'node:test';
import assert from 'node:assert/strict';
import { createArrangedScore } from '../src/arranged-score.js';
import { createReferenceScore } from '../src/reference-score.js';

const onsets = (pattern, a, b) => pattern.queryArc(a, b).filter(h => h.hasOnset());
const signature = events => events.map(h => JSON.stringify({ begin: Number(h.whole.begin), end: Number(h.whole.end), value: h.value })).sort();

test('every arranged phrase preserves the original ensemble notes, timings and sounds exactly', () => {
  const source = createReferenceScore(), score = createArrangedScore({ source });
  const sourceSections = new Set(), durations = new Set();
  for (let bar = 0; bar < 160;) {
    const phrase = score.sectionAt(bar), shift = phrase.start - phrase.sourceStart;
    const originals = onsets(source, phrase.sourceStart, phrase.sourceStart + phrase.length);
    const expected = originals.map(h => JSON.stringify({ begin: Number(h.whole.begin) + shift, end: Number(h.whole.end) + shift, value: h.value })).sort();
    assert.deepEqual(signature(onsets(score, bar, bar + phrase.length)), expected);
    sourceSections.add(phrase.name); durations.add(phrase.length); bar += phrase.length;
  }
  assert.ok(sourceSections.size >= 6); assert.deepEqual([...durations].sort(), [2, 4]);
});

test('the arrangement evolves beyond the old loop and stays identical across scheduler window sizes', () => {
  const score = createArrangedScore(), events = onsets(score, 0, 96), pieces = [];
  for (let i = 0; i < 96 * 16; i++) pieces.push(...onsets(score, i / 16, (i + 1) / 16));
  assert.deepEqual(signature(pieces), signature(events));
  assert.deepEqual(signature(onsets(createArrangedScore(), 0, 96)), signature(events));
  assert.notDeepEqual(signature(onsets(createArrangedScore({ seed: 21 }), 0, 96)), signature(events));
  const arrangement = start => Array.from({ length: 40 }, (_, i) => score.sectionAt(start + i).sourceStart);
  assert.notDeepEqual(arrangement(2), arrangement(82));
  // Source cache eviction must not change a revisited phrase.
  score.queryArc(500, 510); assert.deepEqual(signature(onsets(score, 0, 96)), signature(events));
});
