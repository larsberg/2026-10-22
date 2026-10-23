import { Hap, Pattern, TimeSpan } from '@strudel/core';
import { createReferenceScore, referenceSectionAt } from './reference-score.js';

// Whole ensemble phrases from the existing study. Moving a phrase preserves
// every note, instrument, onset, duration, gain and procedural timbre seed.
const sources = {
  groove: { 2: [2, 4, 6, 16, 18, 36, 38, 48, 50, 68, 70, 72, 74, 76], 4: [4, 16, 36, 48, 68, 72] },
  low: { 2: [8, 10, 12, 14, 20, 22, 24, 26, 40, 42, 44, 46, 52, 54, 56, 58], 4: [8, 12, 20, 24, 40, 44, 52, 56] },
  contrast: { 2: [28, 30, 60, 62], 4: [28, 60] },
  colour: { 2: [32, 34, 64, 66], 4: [32, 64] },
};
function randomFor(seed, index) {
  let state = ((seed ^ Math.imul(index + 1, 0x9e3779b9)) >>> 0) || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
const pick = (random, values) => values[Math.floor(random() * values.length)];

export function createArrangedScore({ seed = 171026, source = createReferenceScore() } = {}) {
  const cache = new Map();
  function phraseAt(bar) {
    if (bar < 2) return { id: -1, start: 0, length: 2, sourceStart: 0, name: 'Intro' };
    const block = Math.floor((bar - 2) / 8), offset = (bar - 2) % 8;
    // Alternate 4+2+2 and 2+2+4, so section lengths themselves vary.
    const lengths = block % 2 ? [2, 2, 4] : [4, 2, 2];
    const slot = offset < lengths[0] ? 0 : offset < lengths[0] + lengths[1] ? 1 : 2;
    const id = block * 3 + slot, start = 2 + block * 8 + lengths.slice(0, slot).reduce((a, b) => a + b, 0);
    const length = lengths[slot], random = randomFor(seed, id);
    // Alternating banks prevent adjacent phrases from the same section type.
    const family = pick(random, id % 2 ? ['low', 'contrast'] : ['groove', 'colour']);
    const sourceStart = id === 0 ? 2 : pick(random, sources[family][length]);
    return { id, start, length, sourceStart, name: referenceSectionAt(sourceStart).name };
  }
  function phraseEvents(phrase) {
    if (cache.has(phrase.id)) return cache.get(phrase.id);
    const events = source.queryArc(phrase.sourceStart, phrase.sourceStart + phrase.length)
      .filter(hap => hap.hasOnset()).map(hap => {
        const shift = phrase.start - phrase.sourceStart;
        // Source times are fractions: retain that precision across scheduling windows.
        return { whole: new TimeSpan(hap.whole.begin.add(shift), hap.whole.end.add(shift)), value: hap.value };
      });
    cache.set(phrase.id, events); if (cache.size > 64) cache.delete(cache.keys().next().value);
    return events;
  }
  const pattern = new Pattern(state => {
    const events = [], end = Number(state.span.end);
    // Preserve the tail of the preceding phrase, including notes across a splice.
    let cursor = Math.max(0, Number(state.span.begin) - 1);
    while (cursor < end) {
      const phrase = phraseAt(cursor);
      for (const event of phraseEvents(phrase)) {
        const part = event.whole.intersection(state.span);
        if (part) events.push(new Hap(event.whole, part, event.value));
      }
      cursor = phrase.start + phrase.length;
    }
    return events;
  });
  pattern.title = 'Look No Further · evolving arrangement';
  pattern.sectionAt = phraseAt;
  return pattern;
}
