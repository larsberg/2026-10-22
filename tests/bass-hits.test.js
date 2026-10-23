import test from 'node:test';
import assert from 'node:assert/strict';
import { createBassHitDetector } from '../src/bass-hits.js';
import { rawGateAt } from '../src/raw-voices.js';

const sample = (time, level = .2, epoch = 0) => ({ time, level, epoch, playing: true });
const event = time => ({ layer: 'bass', time });

test('audible bass onsets step once, ignore other parts, and never run ahead of the audio clock', () => {
  const bass = createBassHitDetector();
  assert.equal(bass.update(sample(0), [event(.1), {layer:'kick',time:0}]), 0);
  assert.equal(bass.update(sample(.1), [event(.1), event(.1)]), 1);
  assert.equal(bass.update(sample(.12), [event(.1)]), 0);
  for (let i = 1; i < 100; i++) assert.equal(bass.update(sample(.12+i/60)), 0);
  assert.equal(bass.update(sample(2), [event(2)]), 1);
});

test('a held bass does not retrigger on oscillator RMS fluctuations or elapsed time', () => {
  const bass = createBassHitDetector();
  assert.equal(bass.update(sample(0), [event(0)]), 1);
  for (let i = 1; i < 600; i++) assert.equal(bass.update(sample(i/60, .2+.018*Math.sin(i*2.6))), 0);
});

test('gated bass reattacks are detected from audio level and deduplicated against note onsets', () => {
  const bass = createBassHitDetector();
  assert.equal(bass.update(sample(0,.01), [event(0)]), 1);
  assert.equal(bass.update(sample(.02,.2)), 0);
  assert.equal(bass.update(sample(.1,.03)), 0);
  assert.equal(bass.update(sample(.125,.18), [event(.125)]), 1);
  assert.equal(bass.update(sample(.14,.22)), 0);
  assert.equal(bass.update(sample(.23,.025)), 0);
  assert.equal(bass.update(sample(.25,.17)), 1);
  assert.equal(bass.update(sample(.27,.2)), 0);
});

test('silence, pauses, held-note resumes and long stalls do not manufacture attacks', () => {
  const bass = createBassHitDetector();
  bass.update(sample(0), [event(0)]);
  for (let i = 1; i < 100; i++) assert.equal(bass.update(sample(i/60,0)),0);
  assert.equal(bass.update({...sample(2),playing:false}, [event(2)]),0);
  assert.equal(bass.update(sample(3,.01,1)),0);
  for(let i=1;i<20;i++)assert.equal(bass.update(sample(3+i/60,.2,1)),0);
  assert.equal(bass.update(sample(6,.2,1)),0);
  assert.equal(bass.update(sample(6.1,.2,1), [event(6.1)]),1);
});

test('six-step gates of the actual bass envelope produce pulses while its flow section holds', () => {
  for (const [mode,depth,expected] of [['flow',.07,1],['six',.88,8]]) {
    const bass = createBassHitDetector();let hits = 0;
    for (let i = 0; i < 60; i++) {
      const time = i/60, level = .2*rawGateAt(time*8,mode,depth);
      hits += bass.update(sample(time,level), i===0?[event(0)]:[]);
    }
    if (mode==='flow') assert.equal(hits,expected);
    else assert.ok(hits>=5 && hits<=expected, `${hits} gated hits`);
  }
});
