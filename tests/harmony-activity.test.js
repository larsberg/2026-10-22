import test from 'node:test';
import assert from 'node:assert/strict';
import { harmonyGateActivity } from '../src/harmony-activity.js';
import { createRawScore } from '../src/raw-score.js';
import { rawAudioSettings } from '../src/raw-audio-settings.js';

test('harmony gate activity follows sounding synth effects across held notes and later passes',()=>{
  const score=createRawScore(),settings=rawAudioSettings();
  for(const bar of [0,4,7,16,24,32,36,56,72,76])assert.equal(harmonyGateActivity(score,bar+.3,settings),0);
  for(const bar of [8,15,40,48,64,80,87,112,120,136]){
    for(const phase of [.01,.2,.75,.99])assert.equal(harmonyGateActivity(score,bar+phase,settings),1);
  }
});

test('harmony mute, instrument changes and absent notes remove gate activity',()=>{
  const score=createRawScore(),base=rawAudioSettings();
  for(const settings of [{...base,volume:0},{...base,keys:0},
    {...base,instruments:{...base.instruments,keys:{...base.instruments.keys,level:0}}},
    {...base,instruments:{...base.instruments,keys:{...base.instruments.keys,sound:'pad'}}}])
    assert.equal(harmonyGateActivity(score,40.5,settings),0);
  assert.equal(harmonyGateActivity({queryArc:()=>[]},40.5,base),0);
  const partial={queryArc:()=>[{value:{layer:'keys',gain:1,gateMode:'six',gateDepth:.5}}]};
  assert.equal(harmonyGateActivity(partial,0,base),.5);
});
