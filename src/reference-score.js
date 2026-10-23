import { Hap, Pattern, TimeSpan } from '@strudel/core';
import { referenceScoreInfo } from './reference-audio-settings.js';
export { referenceScoreInfo, referenceAudioSettings } from './reference-audio-settings.js';

const sections = [
  [0, 'Intro', 'intro'], [2, 'First groove', 'high'], [8, 'Low-register groove', 'low'],
  [16, 'Upper bass returns', 'high'], [20, 'Low-register variation', 'low'],
  [28, 'G/A contrast', 'contrast'], [32, 'E/B colour', 'colour'],
  [36, 'Upper groove', 'high'], [40, 'Low groove', 'low'], [48, 'Upper variation', 'high'],
  [52, 'Low groove builds', 'low'], [60, 'G/A contrast returns', 'contrast'],
  [64, 'E/B colour returns', 'colour'], [68, 'Final groove', 'final'], [78, 'Outro', 'outro'],
].map(([bar, name, kind]) => ({ bar, name, kind }));
export function referenceSectionAt(bar) {
  const position = ((Math.floor(bar) % referenceScoreInfo.bars) + referenceScoreInfo.bars) % referenceScoreInfo.bars;
  return { ...sections.findLast(section => position >= section.bar), position };
}
// Stateless random choices make repeated/narrow scheduler queries agree.
function randomFor(seed, bar) {
  let state = (seed ^ Math.imul(bar + 1, 0x9e3779b9)) >>> 0;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
export function createReferenceScore({ seed = 161026 } = {}) {
  const cache = new Map();
  function barEvents(bar) {
    if (cache.has(bar)) return cache.get(bar);
    const section = referenceSectionAt(bar), random = randomFor(seed, bar), result = [];
    const outro = section.kind === 'outro', intro = section.kind === 'intro';
    const energy = outro ? (80 - section.position) / 3 : 1;
    function add(layer, step, duration, note, gain, extra = {}) {
      // The separated drums put the snare about 70 ms behind the straight grid.
      const late = layer === 'snare' || (layer === 'hat' && step % 8 === 4) ? 24 : 0;
      const begin = bar * 1024 + Math.round(step * 64) + late;
      const end = begin + Math.max(1, Math.round(duration * 64));
      const whole = new TimeSpan(`${begin}/1024`, `${end}/1024`);
      result.push({ whole, value: { layer, note, gain: gain * energy, detune: 0, wow: .2, timbreSeed: Math.floor(random() * 0xffffffff), ...extra } });
    }
    if (intro) {
      if (section.position === 0) add('keys', 0, 12, 'c3', .06);
      if (section.position === 1) {
        for (const step of [12, 14]) {
          add('kick', step, 1, undefined, .7);
          add('bass', step, 1.9, 'd1', .72, { glideFrom: 'f1', glideTime: .65, detune: 28 });
        }
      }
    } else {
      // Two-bar kick/bass figure measured from the separated opening break.
      const kicks = bar % 2 ? [[0, .92], [8, .98], [12, .43]] : [[0, .9], [7.25, .65], [8, .95], [10, .86]];
      for (const [step, gain] of kicks) {
        if (!outro || step < 8) add('kick', step, 1, undefined, gain);
      }
      if (!outro) {
        add('snare', 4, 1, undefined, .9); add('snare', 12, 1, undefined, bar % 2 ? .78 : .89);
        if (bar % 8 === 7 && random() < .35) add('snare', 15, .5, undefined, .1);
        for (let step = 0; step < 16; step += 2) {
          if (!(bar % 2 && [2, 6].includes(step))) add('hat', step, .5, undefined, (step % 4 ? .62 : .35) * (.94 + random() * .12));
        }
        if (bar % 8 === 7) add('hat', 15, .5, undefined, .28, { s: 'oh' });
      }
      const low = ['low', 'colour'].includes(section.kind), contrast = section.kind === 'contrast';
      const target = contrast ? 'g1' : low ? 'd1' : 'd2';
      const from = contrast ? 'a1' : low ? 'f1' : 'f2';
      const bassSteps = outro ? [0] : bar % 2 ? [0, 8, 12] : [0, 7.25, 10];
      for (let i = 0; i < bassSteps.length; i++) {
        const step = bassSteps[i], duration = (bassSteps[i + 1] ?? 16) - step - .1;
        add('bass', step, duration, target, .8 * (.98 + random() * .04),
          { glideFrom: from, glideTime: .65, detune: contrast ? 12 : 28 });
      }
      if (!outro) {
        const colour = ['colour', 'final'].includes(section.kind);
        // The bright guitar is mostly a single E4 figure, not low block chords.
        if (section.position >= 4) {
          const notes = contrast ? ['g#4', 'a4', 'g#4'] : low && !colour ? ['c#4', 'd4', 'g#4'] : ['e4', 'e4', 'e4'];
          const steps = bar % 2 ? [5.5, 11.5] : [3.5, 5.5, 13.5];
          steps.forEach((step, i) => add('keys', step, 1.8, notes[(i + bar) % notes.length], .54 * (.92 + random() * .16), { detune: -5 }));
        }
        const vocalActive = section.kind === 'low' || (section.position >= 46 && section.position < 52);
        if (vocalActive) {
          const phrases = [
            [[3, 1.35, 'f3'], [4.7, 2.4, 'f3'], [8.8, 1.5, 'f3'], [11.3, 1.3, 'e3'], [14, 1.8, 'c4']],
            [[.5, 2, 'c4'], [3.5, 2.2, 'd#3'], [6.5, 1.5, 'd#3'], [9, 2.8, 'd#3']],
            [[2, 2, 'c4'], [5, 1.8, 'f3'], [8, 1.8, 'f3'], [11, 2, 'c4']],
            [[0, 2.5, 'c4'], [4, 1.5, 'c4'], [7, 2.8, 'c4']],
          ];
          for (const [step, duration, note] of phrases[bar % 4]) {
            add('melody', step, duration, note, .68 * (.95 + random() * .1), { vowel: Math.floor(step / 4) % 3 });
          }
        }
      } else add('keys', 0, 6, 'e4', .12);
    }
    cache.set(bar, result); if (cache.size > 160) cache.delete(cache.keys().next().value);
    return result;
  }
  const pattern = new Pattern(state => {
    const events = [], begin = Number(state.span.begin), end = Number(state.span.end);
    for (let bar = Math.max(0, Math.floor(begin) - 1); bar < Math.ceil(end); bar++) {
      for (const event of barEvents(bar)) {
        const part = event.whole.intersection(state.span);
        if (part) events.push(new Hap(event.whole, part, event.value));
      }
    }
    return events;
  });
  pattern.title = referenceScoreInfo.title; pattern.sectionAt = referenceSectionAt;
  return pattern;
}
