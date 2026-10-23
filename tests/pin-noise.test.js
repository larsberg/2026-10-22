import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, DataTexture, Mesh, MeshBasicMaterial, Vector4 } from 'three';
import { createMeshSoftBody } from '../src/mesh-soft-body.js';
import { createPlaneMesh } from '../src/plane-mesh.js';
import { createPinNoise } from '../src/pin-noise.js';
import { pinNoiseDefaults, validatePinNoise } from '../src/pin-noise-settings.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';

function fixture() {
  const topology=createPlaneMesh({widthSegments:6,heightSegments:6}),body=createMeshSoftBody(topology,{restStiffness:20});
  return {topology,body};
}
function rendererFixture() {
  const originalTarget={name:'existing target'},viewport=new Vector4(7,11,640,480),scissor=new Vector4(13,17,300,200);
  const renderer={target:originalTarget,viewport:viewport.clone(),scissor:scissor.clone(),scissorTest:true,renders:0,fail:false,
    getRenderTarget(){return this.target;},getActiveCubeFace(){return 0;},getActiveMipmapLevel(){return 0;},
    getViewport(out){return out.copy(this.viewport);},getScissor(out){return out.copy(this.scissor);},getScissorTest(){return this.scissorTest;},
    setRenderTarget(value){this.target=value;},setViewport(...values){this.viewport=values[0]?.isVector4?values[0].clone():new Vector4(...values);},
    setScissor(value){this.scissor.copy(value);},setScissorTest(value){this.scissorTest=value;},
    render(scene){this.renders++;this.generatedTarget=this.target;this.generatedAmount=scene.children[0].material.uniforms.amount.value;},
    readRenderTargetPixels(target,x,y,w,h,pixels){if(this.fail)throw new Error('Readback failed');for(let i=0;i<w*h;i++){const noise=i%2?64:192;pixels.set(this.productPixel??[noise,noise,noise,noise],i*4);}},
  };
  return {renderer,originalTarget,viewport,scissor};
}

test('pin multipliers control point-anchor stiffness without changing mass, pose, velocity, or boundary pins',()=>{
  const {body}=fixture();for(let i=0;i<30;i++)body.step(1/60);
  const pose=body.positions.slice(),velocity=body.velocities.slice(),mass=body.mobility.slice(),weights=body.pinWeights.slice(),time=body.time;
  body.setPinMultipliers(new Float32Array(body.boundary.length).fill(.2));
  assert.deepEqual(body.positions,pose);assert.deepEqual(body.velocities,velocity);assert.deepEqual(body.mobility,mass);assert.deepEqual(body.pinWeights,weights);assert.equal(body.time,time);
  body.boundary.forEach((fixed,i)=>assert.equal(body.pinMultipliers[i],fixed?1:Math.fround(.2)));
  const saved=body.pinMultipliers.slice();
  for(const values of [[],new Float32Array(body.boundary.length).fill(NaN),new Float32Array(body.boundary.length).fill(-.1),new Float32Array(body.boundary.length).fill(1.1)])assert.throws(()=>body.setPinMultipliers(values),/Pin multipliers/);
  assert.deepEqual(body.pinMultipliers,saved);
});

test('darker multipliers allow greater deformation while white reproduces the original solver',()=>{
  const results=[];
  for(const multiplier of [0,.2,1]){
    const {body}=fixture();body.setPinMultipliers(new Float32Array(body.boundary.length).fill(multiplier));
    for(let i=0;i<180;i++)body.step(1/60);
    results.push(Math.max(...body.positions.filter((_,i)=>i%3===2)));
    body.boundary.forEach((fixed,i)=>{if(fixed)for(let a=0;a<3;a++)assert.equal(body.positions[i*3+a],body.rest[i*3+a]);});
  }
  assert.ok(results[0]>results[1]&&results[1]>results[2]);
  const {body:a}=fixture(),{body:b}=fixture();b.setPinMultipliers(new Float32Array(b.boundary.length).fill(1));
  for(let i=0;i<60;i++){a.step(1/60);b.step(1/60);}assert.deepEqual(a.positions,b.positions);
});

test('GPU field caches stable uniforms, restores renderer state, and releases its resources',()=>{
  const {renderer,originalTarget,viewport,scissor}=rendererFixture(),field=createPinNoise(renderer),{body,topology}=fixture();
  const originalMaterial=new MeshBasicMaterial(),mesh=new Mesh(new BufferGeometry(),originalMaterial);
  field.bind(topology,mesh,body);assert.equal(renderer.renders,1);assert.equal(field.update(),false);
  assert.equal(mesh.geometry.attributes.pinNoiseUv.count,topology.faces.flat().length);
  field.uniforms.offset.value.z+=.3;assert.equal(field.update(),true);assert.equal(renderer.renders,2);assert.equal(field.getSettings().offsetZ,.3);
  field.uniforms.scale.value.set(.2,.8,1.3);field.update();assert.equal(renderer.renders,3);assert.equal(field.update(),false);
  assert.equal(renderer.target,originalTarget);assert.deepEqual(renderer.viewport,viewport);assert.deepEqual(renderer.scissor,scissor);assert.equal(renderer.scissorTest,true);
  field.configure({...field.getSettings(),preview:true});assert.equal(mesh.material.name,'Pin multiplier preview');
  const source=field.uniforms.restPositions.value,target=renderer.generatedTarget;let disposedSource=0,disposedTarget=0;
  source.addEventListener('dispose',()=>disposedSource++);target.addEventListener('dispose',()=>disposedTarget++);
  field.configure({...field.getSettings(),enabled:false});assert.equal(mesh.material,originalMaterial);assert.ok(body.pinMultipliers.every(v=>v===1));assert.equal(renderer.renders,3);
  field.dispose();assert.equal(disposedSource,1);assert.equal(disposedTarget,1);assert.equal(field.update(),false);assert.equal(mesh.material,originalMaterial);
  mesh.geometry.dispose();originalMaterial.dispose();
});

test('failed GPU readback restores the render target, viewport, and scissor atomically',()=>{
  const {renderer,originalTarget,viewport,scissor}=rendererFixture(),field=createPinNoise(renderer),{body,topology}=fixture();
  const material=new MeshBasicMaterial(),mesh=new Mesh(new BufferGeometry(),material);field.bind(topology,mesh,body);
  const weights=body.pinMultipliers.slice(),forces=body.normalForces.slice();renderer.fail=true;field.uniforms.offset.value.x+=1;
  assert.throws(()=>field.update(),/Readback failed/);assert.equal(renderer.target,originalTarget);assert.deepEqual(renderer.viewport,viewport);assert.deepEqual(renderer.scissor,scissor);assert.equal(renderer.scissorTest,true);assert.deepEqual(body.pinMultipliers,weights);
  assert.deepEqual(body.normalForces,forces);
  field.dispose();mesh.geometry.dispose();material.dispose();
});

test('bass hits accumulate Z offset, hold between hits, and preserve the manual base offset',()=>{
  const {renderer}=rendererFixture(),field=createPinNoise(renderer),{body,topology}=fixture();
  const material=new MeshBasicMaterial(),mesh=new Mesh(new BufferGeometry(),material);
  field.configure({offsetZ:3,bassStep:.5,forceStrength:0});field.bind(topology,mesh,body);
  assert.equal(field.addBassHits(2),true);assert.equal(field.uniforms.bassOffset.value,1);assert.equal(field.bassHits,2);
  assert.equal(field.update(),true);assert.equal(renderer.renders,2);assert.equal(field.getSettings().offsetZ,3);
  for(let i=0;i<120;i++)assert.equal(field.update(),false); // Frames cannot move the field.
  field.configure({...field.getSettings(),bassStep:0,preview:true});
  assert.equal(field.uniforms.bassOffset.value,1);assert.equal(field.addBassHits(2),false);
  assert.equal(field.update(),false);assert.equal(renderer.renders,2);
  field.configure({...field.getSettings(),bassStep:-.5});
  assert.equal(field.uniforms.bassOffset.value,1);assert.equal(renderer.renders,2);
  field.addBassHits(2);field.update();assert.equal(field.uniforms.bassOffset.value,0);assert.equal(renderer.renders,3);
  assert.equal(field.getSettings().offsetZ,3);assert.equal(field.getSettings().bassStep,-.5);
  field.configure({...field.getSettings(),enabled:false});assert.equal(field.addBassHits(2),false);
  field.configure({...field.getSettings(),enabled:true,amount:0});assert.equal(field.addBassHits(2),false);
  field.configure({...field.getSettings(),amount:1,bassStep:.1});
  for(const count of [0,-1,.5,NaN,Infinity])assert.equal(field.addBassHits(count),false);
  field.addBassHits();assert.equal(field.uniforms.bassOffset.value,.1);
  field.resetBassOffset();assert.equal(field.uniforms.bassOffset.value,0);assert.equal(field.bassHits,0);
  assert.equal(field.getSettings().offsetZ,3);
  field.dispose();assert.equal(field.addBassHits(1),false);mesh.geometry.dispose();material.dispose();
});

test('noise settings migrate older setups and preserve vector controls through validation',()=>{
  const old=defaultMeshSetup();delete old.pinNoise;assert.deepEqual(validateMeshSetup(old).pinNoise,pinNoiseDefaults);
  const previous=defaultMeshSetup();delete previous.pinNoise.bassStep;delete previous.pinNoise.forceStrength;previous.pinNoise.speed=-1.63;
  previous.pinNoise.amount=100;const migrated=validateMeshSetup(previous).pinNoise;
  assert.equal(migrated.bassStep,.35);assert.equal(migrated.speed,undefined);assert.equal(migrated.forceStrength,20);assert.equal(migrated.amount,1);
  assert.equal(validatePinNoise({amount:100}).amount,1);
  const setup=mergeMeshSetup(defaultMeshSetup(),{pinNoise:{offsetX:1.3,offsetY:-2,offsetZ:.8,scaleX:.2,scaleY:0,scaleZ:-.7,amount:.6,preview:true,bassStep:-.3,forceStrength:35}});
  assert.deepEqual(validateMeshSetup(setup),setup);assert.deepEqual(validatePinNoise(setup.pinNoise),setup.pinNoise);
  for(const pinNoise of [{offsetX:NaN},{scaleZ:21},{scaleY:Infinity},{amount:-1},{amount:1.1},{enabled:1},{preview:'yes'},{bassStep:NaN},{bassStep:5.1},{bassStep:-5.1},{forceStrength:-1},{forceStrength:100.1},{forceStrength:Infinity}]){
    assert.throws(()=>mergeMeshSetup(setup,{pinNoise}));assert.throws(()=>validatePinNoise({forceStrength:20,...pinNoise}));
  }
  assert.throws(()=>validateMeshSetup({...setup,pinNoise:null}));
});

test('harmony scale eases all three shader axes between saved limits without overwriting manual axes',()=>{
  const {renderer}=rendererFixture(),field=createPinNoise(renderer),{body,topology}=fixture();
  const material=new MeshBasicMaterial(),mesh=new Mesh(new BufferGeometry(),material);
  field.configure({audioScale:true,audioScaleMin:.4,audioScaleMax:2,scaleX:3,scaleY:4,scaleZ:5});field.bind(topology,mesh,body);
  assert.deepEqual(field.uniforms.scale.value.toArray(),[.4,.4,.4]);
  assert.equal(field.updateAudioScale(1,1/60),true);assert.equal(field.update(),true);
  const rise=field.uniforms.scale.value.x;assert.ok(rise>.4&&rise<2);
  field.updateAudioScale(1,10);assert.deepEqual(field.uniforms.scale.value.toArray(),[2,2,2]);
  field.configure(field.getSettings());assert.equal(field.uniforms.scale.value.x,2);
  assert.equal(field.getSettings().scaleX,3);assert.equal(field.getSettings().scaleY,4);
  field.updateAudioScale(0,1/60);assert.ok(field.uniforms.scale.value.x<2&&field.uniforms.scale.value.x>.4);
  field.updateAudioScale(0,10);assert.deepEqual(field.uniforms.scale.value.toArray(),[.4,.4,.4]);
  field.configure({...field.getSettings(),audioScale:false});assert.deepEqual(field.uniforms.scale.value.toArray(),[3,4,5]);
  assert.equal(field.updateAudioScale(1,1),false);
  field.dispose();mesh.geometry.dispose();material.dispose();
});

test('audio scale bounds validate and roundtrip through mesh settings',()=>{
  const setup=mergeMeshSetup(defaultMeshSetup(),{pinNoise:{audioScale:true,audioScaleMin:.7,audioScaleMax:3}});
  assert.deepEqual(validateMeshSetup(setup),setup);
  for(const value of [{audioScaleMin:3,audioScaleMax:2},{audioScaleMin:-1},{audioScaleMax:21},{audioScale:true,audioScaleMin:NaN}])
    assert.throws(()=>validatePinNoise(value));
  assert.equal(validatePinNoise({}).audioScale,false);
});

test('noise forces use signed raw noise independently of pin variation and scale up to strength 100',()=>{
  const {renderer}=rendererFixture(),field=createPinNoise(renderer),{body,topology}=fixture();
  const material=new MeshBasicMaterial(),mesh=new Mesh(new BufferGeometry(),material);
  field.configure({amount:0,forceStrength:20});field.bind(topology,mesh,body);
  assert.ok(body.pinMultipliers.every(v=>v===1));
  assert.ok(body.normalForces.some(v=>v>0));assert.ok(body.normalForces.some(v=>v<0));
  body.boundary.forEach((fixed,i)=>{if(fixed)assert.equal(body.normalForces[i],0);});
  const forces=body.normalForces.slice(),pose=body.positions.slice(),time=body.time;
  field.configure({...field.getSettings(),forceStrength:100});
  body.normalForces.forEach((v,i)=>assert.ok(Math.abs(v-forces[i]*5)<1e-5));
  assert.deepEqual(body.positions,pose);assert.equal(body.time,time);
  assert.equal(field.addBassHits(1),true);assert.equal(field.update(),true);
  field.configure({...field.getSettings(),enabled:false});
  assert.ok(body.normalForces.every(v=>v===0));assert.ok(body.pinMultipliers.every(v=>v===1));
  field.configure({...field.getSettings(),enabled:true,forceStrength:0});
  assert.equal(field.addBassHits(1),false);assert.ok(body.normalForces.every(v=>v===0));
  field.dispose();mesh.geometry.dispose();material.dispose();
});

test('optional texture multiplication drives force from product RGB and can restore signed noise',()=>{
  const {renderer}=rendererFixture(),texture=new DataTexture(new Uint8Array([255,255,255,255]),1,1);
  const field=createPinNoise(renderer),{body,topology}=fixture(),material=new MeshBasicMaterial(),mesh=new Mesh(new BufferGeometry(),material);
  field.setForceTexture(texture);renderer.productPixel=[128,0,0,255];field.configure({amount:0,forceStrength:20,bassStep:0});field.bind(topology,mesh,body);
  body.boundary.forEach((fixed,i)=>assert.ok(Math.abs(body.normalForces[i]-(fixed?0:128/255*.2126*20))<1e-6));
  renderer.productPixel=[0,0,0,255];assert.equal(field.invalidateForceTexture(),true);
  assert.ok(body.normalForces.every(v=>v===0));assert.ok(body.pinMultipliers.every(v=>v===1));
  field.setForceTexture(null);body.boundary.forEach((fixed,i)=>assert.equal(body.normalForces[i],fixed?0:20));
  texture.dispose();field.dispose();mesh.geometry.dispose();material.dispose();
});
