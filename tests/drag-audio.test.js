import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarchAudio } from '../src/march-audio.js';
import { createReferenceScore } from '../src/reference-score.js';
import { defaultMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';
import { createSeededRandom } from '../src/mesh-layers.js';

test('drag improvisation schedules many random notes, cancels them on release and resumes the existing song clock',()=>{
  const param=()=>({value:0,setValueAtTime(){},setTargetAtTime(){},cancelScheduledValues(){}});
  const node=()=>({connect(next){return next;},disconnect(){},gain:param(),threshold:param(),knee:param(),ratio:param(),attack:param(),release:param()});
  const context=new EventTarget();Object.assign(context,{state:'running',currentTime:0,createGain:node,createDynamicsCompressor:node,createWaveShaper:node,destination:{},close(){this.state='closed';return Promise.resolve();}});
  const history=[],live=[];let timer,stops=0;
  const audio=createMarchAudio({pattern:createReferenceScore(),random:createSeededRandom(23),createContext:()=>context,
    createVoices:()=>({trigger(value,at,duration){history.push({value,at,duration});live.push(value);},configure(){},stop(){stops++;live.length=0;},dispose(){}}),
    setTimer:fn=>(timer=fn,1),clearTimer:()=>{timer=undefined;}});
  const tick=count=>{for(let i=0;i<count;i++){context.currentTime+=.025;timer?.();audio.drainEvents();}};
  try {
    audio.configure({...defaultMeshSetup().audio,enabled:true});audio.play();tick(250);
    const beat=audio.beat,before=history.length;audio.setDragging(true);tick(80);
    const chaotic=history.slice(before);assert.ok(chaotic.length>=48);assert.ok(chaotic.every(event=>event.value.chaos));
    assert.ok(new Set(chaotic.map(event=>event.value.layer)).size>=5);
    assert.ok(new Set(chaotic.map(event=>event.value.note).filter(Boolean)).size>10);
    assert.ok(audio.beat>beat+1);assert.equal(audio.diagnostics.chaos,true);
    const atRelease=history.length,stopCount=stops,releaseBeat=audio.beat;
    audio.setDragging(false);assert.ok(stops>stopCount);assert.ok(live.every(value=>!value.chaos));tick(80);
    assert.ok(history.length>atRelease);assert.ok(history.slice(atRelease).every(event=>!event.value.chaos));
    assert.ok(audio.beat>releaseBeat);assert.equal(audio.diagnostics.chaos,false);
    audio.setDragging(true);audio.pause();const pausedCount=history.length;tick(40);
    assert.equal(history.length,pausedCount);assert.equal(audio.diagnostics.dragging,false);
  }finally{audio.dispose();}
});

test('older settings retain drag audio controls',()=>{
  const old=defaultMeshSetup();delete old.audio.dragChaosEnabled;delete old.audio.dragChaosRate;
  for(const key of Object.keys(old.lighting.environment))if(key.startsWith('noteBrightness'))delete old.lighting.environment[key];
  const settings=validateMeshSetup(old);
  assert.equal(settings.audio.dragChaosEnabled,true);assert.equal(settings.audio.dragChaosRate,32);
  assert.equal(settings.lighting.environment.noteBrightnessEnabled,undefined);
});
