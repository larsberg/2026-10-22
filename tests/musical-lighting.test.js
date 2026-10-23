import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicalLighting, compositionLightCues, musicalPanelKeys } from '../src/musical-lighting.js';
import { createRawScore } from '../src/raw-score.js';
import { rawAudioSettings } from '../src/raw-audio-settings.js';
import { defaultLighting, validateLighting } from '../src/lighting-settings.js';

const fixture=()=>{
  const calls=[],environment={setPanelLevels(value){calls.push({...value});}};
  const settings=defaultLighting().environment;
  return {controller:createMusicalLighting(environment,settings),calls,settings};
};

test('panel cues follow harmony density, lead entries and actual gate settings',()=>{
  const score=createRawScore(),settings=rawAudioSettings();
  const open=compositionLightCues(score,.5,settings),full=compositionLightCues(score,8.5,settings);
  assert.ok(full.keys>open.keys);assert.ok(full.brightness>open.brightness);
  const gated=compositionLightCues(score,40.3,settings);assert.equal(gated.gate,1);assert.ok(gated.melody>0);
  assert.equal(compositionLightCues(score,32.5,settings).melody,0);
  assert.equal(compositionLightCues(score,40.3,{...settings,keys:0}).gate,0);
  assert.equal(compositionLightCues(score,40.3,{...settings,volume:0}).brightness,0);
});

test('fades reach each cue within 0.3 seconds and planes respond independently',()=>{
  const {controller,settings}=fixture(),initial=controller.levels;
  controller.update(.15,{keys:1,brightness:1});
  assert.ok(controller.levels.keyColor>initial.keyColor);
  assert.equal(controller.levels.bounceColor,settings.buildFloor);
  controller.update(.15,{keys:1,brightness:1});
  const expected=settings.buildFloor+(settings.buildPeak-settings.buildFloor)*.9*.08;
  assert.ok(Math.abs(controller.levels.keyColor-expected)<1e-12);
  controller.update(.3,{keys:1,brightness:1,gate:1,melody:1});
  assert.equal(controller.levels.stripColor,settings.buildPeak);
  assert.equal(controller.levels.rimColor,settings.buildPeak);
  controller.update(.3,{});
  for(const level of Object.values(controller.levels))assert.ok(Math.abs(level-settings.buildFloor)<1e-12);
});

test('pause holds levels, disabling restores steady panels, and reset starts at the floor',()=>{
  const {controller,settings}=fixture();controller.update(.3,{bass:1,keys:1,gate:1});
  const levels=controller.levels;controller.update(0,{});assert.deepEqual(controller.levels,levels);
  controller.configure({...settings,musicBuild:false});assert.ok(Object.values(controller.levels).every(v=>v===1));
  controller.update(.3,{gate:1});assert.ok(Object.values(controller.levels).every(v=>v===1));
  controller.configure(settings);controller.reset();assert.ok(Object.values(controller.levels).every(v=>v===settings.buildFloor));
  assert.equal(Object.keys(controller.levels).length,musicalPanelKeys.length);
});

test('chord and bass onsets create strong accents that go dim between sustained notes',()=>{
  const {controller}=fixture(),cues={keys:1,bass:1,brightness:1};
  controller.update(.08,cues,[{layer:'keys'},{layer:'bass'}]);
  const attack=controller.levels;
  controller.update(.3,cues);
  assert.ok(attack.keyColor>controller.levels.keyColor*5);
  assert.ok(attack.bounceColor>controller.levels.bounceColor*5);
  assert.equal(controller.levels.stripColor,0);
  assert.equal(controller.levels.rimColor,0);
});

test('the highlight strip follows the synth gate rests instead of staying lit for a whole section',()=>{
  const score=createRawScore(),settings=rawAudioSettings(),{controller}=fixture();
  const on=compositionLightCues(score,40+.4/16,settings);
  const rest=compositionLightCues(score,40+5.4/16,settings); // absolute tick 645: rest slot 3
  assert.equal(on.gateLevel,1);assert.equal(rest.gateLevel,0);
  controller.update(.08,on);assert.ok(controller.levels.stripColor>0);
  controller.update(.12,rest);assert.equal(controller.levels.stripColor,0);
});

test('moving targets continue to move the lights on every frame',()=>{
  const {controller}=fixture();
  for(let i=0;i<10;i++)controller.update(.01,{keys:.5+i*.01,brightness:1});
  assert.ok(controller.levels.keyColor>.02);
});

test('older lighting migrates the build controls and fades longer than 0.3 seconds are rejected',()=>{
  const settings=defaultLighting();for(const key of ['musicBuild','buildFloor','buildPeak','buildRise','buildFall'])delete settings.environment[key];
  const migrated=validateLighting(settings);assert.equal(migrated.environment.buildRise,.08);assert.equal(migrated.environment.musicBuild,true);
  for(const key of ['buildRise','buildFall'])assert.throws(()=>validateLighting({...migrated,environment:{...migrated.environment,[key]:.31}}));
});
