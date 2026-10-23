import test from 'node:test';
import assert from 'node:assert/strict';
import { noteToMidi } from '@strudel/core';
import { createReferenceScore, referenceAudioSettings, referenceScoreInfo, referenceSectionAt } from '../src/reference-score.js';
import { defaultMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';

const onsetEvents=(pattern,a,b)=>pattern.queryArc(a,b).filter(h=>h.hasOnset()).map(h=>({begin:Number(h.whole.begin),end:Number(h.whole.end),value:h.value})).sort((a,b)=>a.begin-b.begin||a.value.layer.localeCompare(b.value.layer)||String(a.value.note).localeCompare(String(b.value.note)));
test('reference score is deterministic across scheduler windows, restarts and random seeds',()=>{
  const score=createReferenceScore(),whole=onsetEvents(score,0,80),pieces=[];
  for(let i=0;i<80*16;i++)pieces.push(...onsetEvents(score,i/16,(i+1)/16));
  const canonical=events=>events.map(event=>JSON.stringify(event)).sort();
  assert.deepEqual(canonical(pieces),canonical(whole));
  assert.deepEqual(whole,onsetEvents(createReferenceScore(),0,80));
  assert.notDeepEqual(whole,onsetEvents(createReferenceScore({seed:17}),0,80));
  assert.ok(whole.length>1000&&whole.length<2500);
});
test('score keeps descending bass contours and intended contrasting registers',()=>{
  const score=createReferenceScore(),layers=new Set();
  for(const hap of score.queryArc(0,80)){
    const v=hap.value;layers.add(v.layer);
    assert.ok(v.gain>0&&v.gain<=1);assert.ok(Number(hap.whole.end)>Number(hap.whole.begin));
    if(v.note)assert.ok(Number.isFinite(noteToMidi(v.note)));
    if(v.layer==='bass'){assert.ok(noteToMidi(v.glideFrom)>noteToMidi(v.note));assert.ok(v.glideTime>0);}
  }
  assert.deepEqual([...layers].sort(),['bass','hat','keys','kick','melody','snare']);
  for(const [bar,note]of[[2,'d2'],[8,'d1'],[28,'g1'],[60,'g1'],[68,'d2']]){
    assert.ok(score.queryArc(bar,bar+1).filter(h=>h.value.layer==='bass').every(h=>h.value.note===note));
  }
  assert.equal(referenceSectionAt(80).kind,'intro');assert.equal(referenceSectionAt(28).kind,'contrast');
  assert.ok(score.queryArc(80,81).length>0); // The form loops with fresh seeded detail.
});
test('reference audio preset validates and retains explicit opt-in audio',()=>{
  const setup=defaultMeshSetup();setup.audio={...setup.audio,...referenceAudioSettings()};assert.equal(setup.audio.enabled,false);
  assert.equal(setup.audio.bpm,referenceScoreInfo.bpm);assert.deepEqual(validateMeshSetup(setup),setup);
  for(const [layer,sound] of Object.entries({kick:'suuns-kick',snare:'suuns-snare',hat:'suuns-hat',bass:'suuns-bass',keys:'suuns-guitar',melody:'suuns-voice'})) assert.equal(referenceAudioSettings().instruments[layer].sound,sound);
});

test('guitar and voice enter in their reference sections instead of covering the opening break',()=>{
  const score=createReferenceScore();
  assert.equal(score.queryArc(2,4).filter(h=>['keys','melody'].includes(h.value.layer)).length,0);
  assert.ok(score.queryArc(4,8).some(h=>h.value.layer==='keys'&&h.value.note==='e4'));
  assert.equal(score.queryArc(0,8).filter(h=>h.value.layer==='melody').length,0);
  assert.ok(score.queryArc(8,9).some(h=>h.value.layer==='melody'&&h.value.note==='f3'));
  assert.equal(score.queryArc(16,20).filter(h=>h.value.layer==='melody').length,0);
});
