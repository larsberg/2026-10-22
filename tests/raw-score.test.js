import test from 'node:test';
import assert from 'node:assert/strict';
import { createRawScore, rawHarmony } from '../src/raw-score.js';
import { rawGateAt } from '../src/raw-voices.js';
import { rawAudioSettings } from '../src/raw-audio-settings.js';
import { validateInstruments } from '../src/instrument-settings.js';

const onsets = (score, a, b) => score.queryArc(a, b).filter(h => h.hasOnset());
const signature = events => events.map(h => JSON.stringify([Number(h.whole.begin), Number(h.whole.end), h.value])).sort();

test('endless ratio-tuned score is invariant to scheduler windows, resumes, and cache eviction', () => {
  const score = createRawScore(), whole = onsets(score, 0, 80), pieces = [];
  for (let tick = 0; tick < 80 * 32; tick++) pieces.push(...onsets(score, tick / 32, (tick + 1) / 32));
  assert.deepEqual(signature(pieces), signature(whole));
  for (const start of [0, 71, 72, 143, 144, 999999]) {
    const events = score.queryArc(start + .1, start + .2);
    assert.ok(events.some(h => h.value.layer === 'bass' && h.value.sustained && !h.hasOnset()));
    assert.ok(onsets(score, start, start + 1).some(h => h.value.layer === 'keys'));
  }
  assert.deepEqual(signature(onsets(score, 0, 80)), signature(whole));
  const local = start => onsets(score, start, start + 8).map(h => h.value);
  assert.notDeepEqual(local(16), local(88));
});

test('the core harmony retains its major/minor thirds and low octave returns', () => {
  const score = createRawScore();
  for (let i = 0; i < 4; i++) {
    const keys = onsets(score, 8 + i, 9 + i).filter(h => h.value.layer === 'keys');
    keys.forEach((h, voice) => assert.ok(Math.abs(h.value.freq / rawHarmony[i].hz - rawHarmony[i].ratios[voice]) < 1e-12));
  }
  const bassAt = bar => onsets(score, bar, bar + 1).find(h => h.value.layer === 'bass').value.freq;
  assert.equal(bassAt(24), bassAt(8) / 2);
  assert.equal(bassAt(56), bassAt(8) / 2);
  assert.doesNotThrow(() => validateInstruments(rawAudioSettings().instruments));
});

test('six-step amplitude gate runs against the sixteen-step bar without restarting', () => {
  const active = Array.from({ length: 48 }, (_, tick) => rawGateAt(tick + .4, 'six', 1) > .9);
  assert.equal(active.filter(Boolean).length, 40);
  active.forEach((on, tick) => assert.equal(on, tick % 6 !== 3));
  // The first note of bar two begins on a different motif slot than bar one.
  assert.equal(rawGateAt(3.4, 'six', 1), 0);
  assert.equal(rawGateAt(19.4, 'six', 1), 1);
  assert.equal(rawGateAt(3.4, 'six', 0), 1);
});

test('sparse drums leave phrase and bridge gaps, with an audible half-time snare', () => {
  const score=createRawScore(),isDrum=h=>['kick','snare','hat'].includes(h.value.layer);
  for(let bar=0;bar<72;bar++){
    const drums=onsets(score,bar,bar+1).filter(isDrum);
    assert.ok(drums.length<=6);
    assert.ok(drums.every(h=>!h.value.sustained&&h.value.gain>0));
    if(bar%8===7||(bar>=32&&bar<36))assert.equal(drums.length,0);
  }
  const full=onsets(score,8,9).filter(isDrum);
  for(const layer of ['kick','snare','hat'])assert.ok(full.some(h=>h.value.layer===layer));
  assert.equal(Number(full.find(h=>h.value.layer==='snare').whole.begin),8.5);
  const settings=rawAudioSettings();
  assert.ok(settings.drums>0&&settings.instruments.snare.level>0);
});
