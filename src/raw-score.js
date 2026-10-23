import { Hap, Pattern, TimeSpan } from '@strudel/core';

export const rawScoreInfo = Object.freeze({ title: 'More / Less · endless study', bpm: 120, bars: 72 });
// The thirds and sevenths are ratios of the bass, rather than tempered chords.
export const rawHarmony = [
  { name: 'Dbmaj7', note: 'c#2', hz: 69.295657744, ratios: [2, 5/2, 3, 15/4] },
  { name: 'F7', note: 'f2', hz: 87.307057858, ratios: [2, 5/2, 3, 7/2] },
  { name: 'Gbmaj7', note: 'f#2', hz: 92.498605678, ratios: [2, 5/2, 3, 15/4] },
  { name: 'Gbm', note: 'f#2', hz: 92.498605678, ratios: [2, 12/5, 3, 4] },
];
const sections = [
  [0, 'Open fifths', 'open', .45], [4, 'Full harmony', 'full', .8],
  [8, 'First six-step gate', 'gate', 1],
  [16, 'Rising contours', 'glide', 1], [24, 'Sub / cuts', 'low', .72],
  [32, 'Filtered suspension', 'bridge', .24], [36, 'Rebuild', 'build', .65],
  [40, 'Six-step gate', 'gate', 1], [48, 'Fragments', 'fragment', .82],
  [56, 'Low-end return', 'return', .9], [64, 'Gate / release', 'final', .92],
].map(([start, name, kind, brightness]) => ({ start, name, kind, brightness }));
export function rawSectionAt(bar) {
  const position = ((Math.floor(bar) % 72) + 72) % 72, lap = Math.floor(bar / 72);
  const section = sections.findLast(s => position >= s.start);
  return { ...section, position, lap, name: `${section.name} · pass ${lap + 1}` };
}
function randomFor(seed, bar) {
  let state = (seed ^ Math.imul(bar + 1, 0x9e3779b9)) >>> 0 || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}

// A real Strudel Pattern: whole events retain their exact rational positions
// when the scheduler queries partial cycles or resumes a held note.
export function createRawScore({ seed = 221026 } = {}) {
  const cache = new Map();
  function eventsAt(bar) {
    if (cache.has(bar)) return cache.get(bar);
    const s = rawSectionAt(bar), chord = rawHarmony[bar % 4], random = randomFor(seed, bar), events = [];
    const gate = ['gate', 'fragment', 'final'].includes(s.kind);
    const low = ['low', 'return'].includes(s.kind) || (s.kind === 'fragment' && bar % 8 >= 6);
    const sparse = s.kind === 'open' || s.kind === 'bridge';
    const brightness = s.brightness * (.94 + random() * .12);
    const energy = s.kind === 'bridge' ? .38 : s.kind === 'open' ? .85 : s.kind === 'build' ? .62 + .1 * (s.position - 36) : 1;
    function add(layer, step, steps, note, freq, gain, extra = {}) {
      const whole = new TimeSpan(`${bar * 16 + step}/16`, `${bar * 16 + step + steps}/16`);
      if (freq) {
        const midi = Math.round(69 + 12 * Math.log2(freq / 440));
        note = ['c','c#','d','d#','e','f','f#','g','g#','a','a#','b'][midi % 12] + (Math.floor(midi / 12) - 1);
      }
      events.push({ whole, value: { layer, note, freq, gain: gain * energy, sustained: true, detune: 0,
        cycle: bar + step / 16, brightness, gateMode: gate ? 'six' : s.kind === 'low' ? 'cuts' : 'flow',
        gateDepth: gate ? 1 : s.kind === 'low' ? .82 : .13, ...extra } });
    }
    add('bass', 0, 16, chord.note, chord.hz * (low ? .5 : 1), sparse ? .64 : .82,
      { gateDepth: gate ? .88 : s.kind === 'low' ? .7 : .07, sub: low });
    const voicing = sparse ? [0, 2] : [0, 1, 2, 3];
    for (const voice of voicing) {
      // Seventh colours stay quiet; invert a fifth occasionally on later passes.
      const octave = s.lap > 0 && bar % 8 === 6 && voice === 2 ? 2 : 1;
      add('keys', 0, 16, chord.note, chord.hz * chord.ratios[voice] * octave,
        (voice === 3 ? .28 : .52) * (s.kind === 'bridge' ? .72 : 1), { pan: [-.55, .45, .6, -.5][voice] });
    }
    if (['glide', 'build', 'gate', 'fragment', 'return', 'final'].includes(s.kind)) {
      const contour = [[3, 4, 3], [6, 5, 5/2], [2, 6, 15/4], [8, 6, 12/5]][bar % 4];
      const [step, steps, ratio] = contour;
      const octave = s.lap % 3 === 2 ? 2 : 1;
      add('melody', step, steps, chord.note, chord.hz * ratio * 2 * octave, .4 + random() * .08,
        { fromFreq: chord.hz * ratio * 2 * octave * (bar % 2 ? .75 : 1.125), glideTime: .3 + random() * .3,
          pan: bar % 2 ? -.4 : .4, gateDepth: gate ? .8 : .1 });
      if (s.kind === 'fragment' && random() < .65)
        add('melody', 13, 2, chord.note, chord.hz * 6, .28, { gateDepth: .9, pan: -.16 });
    }
    // Half-time pocket: one main kick, a beat-three brush snare, and just a
    // few offbeat hats. The bridge breathes; phrase endings leave a full gap.
    const drum = (layer, step, gain) => add(layer, step, 1, undefined, undefined, gain, { sustained: false });
    if (s.kind !== 'bridge' && bar % 8 !== 7) {
      if (!sparse || bar % 2 === 0) drum('kick', 0, .62);
      if (!sparse || bar % 2 === 1) drum('snare', 8, .5);
      const hatSteps = sparse ? [10] : [2, 10];
      for (const step of hatSteps) drum('hat', step, .22 + random() * .06);
      if (!sparse && bar % 2 === 1 && random() > .35) drum('hat', 14, .15);
      if ((gate || s.kind === 'return') && bar % 4 === 2) drum('kick', 11, .32);
    }
    cache.set(bar, events); if (cache.size > 96) cache.delete(cache.keys().next().value);
    return events;
  }
  const pattern = new Pattern(state => {
    const events = [];
    for (let bar = Math.max(0, Math.floor(Number(state.span.begin)) - 1); bar < Math.ceil(Number(state.span.end)); bar++)
      for (const event of eventsAt(bar)) {
        const part = event.whole.intersection(state.span);
        if (part) events.push(new Hap(event.whole, part, event.value));
      }
    return events;
  });
  pattern.title = rawScoreInfo.title; pattern.sectionAt = rawSectionAt;
  return pattern;
}
