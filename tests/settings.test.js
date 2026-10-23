import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { createSetupHandler } from '../server/setup-api.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';
import { requestStaticSetup } from '../src/static-setup.js';

test('local Save/Reload roundtrips mesh settings and rejects invalid writes atomically', async () => {
  const directory=await mkdtemp(join(tmpdir(),'mesh-settings-')), file=join(directory,'setup.json');
  const handler=createSetupHandler(file);
  async function request(method,value) {
    const req=Readable.from(value ? [JSON.stringify(value)] : []);
    req.url='/api/setup';req.method=method;req.headers={'content-type':'application/json',host:'localhost:1234',origin:'http://localhost:1234'};
    const res={statusCode:0,setHeader(){},end(body){this.body=JSON.parse(body);}};
    await handler(req,res,()=>assert.fail('Unexpected route fallback'));
    return res;
  }
  try {
    const setup=mergeMeshSetup(defaultMeshSetup(),{pipeline:{seed:42,insetScale:.75,triangulateEnabled:false,faceCenterDualEnabled:false,averageVerticesEnabled:false,insetEnabled:false,excludeInitialBorderTriangles:false},rigidBody:{gravity:780.5,friction:1.25},softBody:{cameraPull:9,gravity:9.8,groundFriction:.8,pinWidth:2.5,damping:4},pinNoise:{offsetX:1.2,offsetY:-.4,offsetZ:.7,scaleX:.2,scaleY:.8,scaleZ:1.1,amount:.75,bassStep:-.4},appearance:{wireframeColor:'#aabbcc'},camera:{yaw:30},audio:{bpm:128}});
    assert.equal((await request('PUT',setup)).statusCode,200);
    assert.deepEqual((await request('GET')).body,setup);
    const editedSetup=mergeMeshSetup(setup,{pinNoise:{forceStrength:100,amount:0},pipeline:{hexelateEnabled:false,insetScale:.25},materials:{mesh:{normalMix:.8,roughness:.6,color:'#aabbcc'}},visibility:{surface:true,wireframe:true}});
    assert.equal((await request('PUT',editedSetup)).statusCode,200);
    assert.deepEqual((await request('GET')).body,editedSetup);
    assert.equal((await request('PUT',{...setup,pipeline:{...setup.pipeline,insetScale:0}})).statusCode,400);
    assert.deepEqual(JSON.parse(await readFile(file,'utf8')),editedSetup);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('production settings use the embedded setup and isolate device saves by URL',async()=>{
  const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const bundledSetup=defaultMeshSetup(),url='https://example.test/2026-10-22/setup.json';
  const options={url,storage,bundledSetup,validate:validateMeshSetup,fetcher:()=>assert.fail('Unexpected setup fetch')};
  assert.deepEqual(await requestStaticSetup(options),bundledSetup);
  const saved=mergeMeshSetup(bundledSetup,{appearance:{wireframeColor:'#00aaff'}});
  await requestStaticSetup({...options,method:'PUT',value:saved});
  assert.deepEqual(await requestStaticSetup(options),saved);
  assert.deepEqual(await requestStaticSetup({...options,url:'https://example.test/another/setup.json'}),bundledSetup);
});

test('spotlight settings migrate once and retain independent saved controls',()=>{
  const old=defaultMeshSetup();delete old.lighting.spotlight;
  old.lighting.directional.enabled=true;old.lighting.directional.color='#123456';
  const migrated=validateMeshSetup(old);
  assert.equal(migrated.lighting.spotlight.enabled,true);assert.equal(migrated.lighting.spotlight.color,'#123456');
  assert.equal(migrated.lighting.directional.enabled,false);
  const custom=mergeMeshSetup(migrated,{lighting:{spotlight:{enabled:false,angle:65},directional:{enabled:true}}});
  assert.deepEqual(validateMeshSetup(custom),custom);
  assert.throws(()=>mergeMeshSetup(custom,{lighting:{spotlight:{angle:90}}}));
});

test('the default study starts with audio off and the editable bundled setup validates',async()=>{
  const bundled=JSON.parse(await readFile(new URL('../public/setup.json',import.meta.url),'utf8'));
  assert.equal(bundled.sketch,'2026-10-22');assert.equal(typeof bundled.audio.enabled,'boolean');
  const defaults=defaultMeshSetup();assert.equal(defaults.audio.enabled,false);
  assert.equal(defaults.audio.bpm,120);assert.equal(defaults.audio.instruments.keys.sound,'raw-chord');
  assert.equal(bundled.rig,undefined);
  // Saved rich text is editable and may differ from the reset defaults.
  assert.deepEqual(validateMeshSetup(bundled),bundled);
});


test('rigid gravity migrates separately, persists independently, and drops retired spectrum settings',()=>{
  const old=defaultMeshSetup();delete old.rigidBody;old.fft={preview:true,multiplyNoise:true};old.softBody.gravity=3.3;
  const migrated=validateMeshSetup(old);assert.equal(migrated.rigidBody.gravity,98);assert.equal(migrated.softBody.gravity,3.3);assert.equal('fft' in migrated,false);
  const edited=mergeMeshSetup(migrated,{rigidBody:{gravity:980}});
  assert.equal(edited.rigidBody.gravity,980);assert.deepEqual(edited.softBody,migrated.softBody);assert.deepEqual(edited.pinNoise,migrated.pinNoise);
  assert.deepEqual(validateMeshSetup(JSON.parse(JSON.stringify(edited))),edited);
  for(const rigidBody of [null,[],{gravity:-1},{gravity:981},{gravity:NaN},{gravity:'98'}])assert.throws(()=>mergeMeshSetup(edited,{rigidBody}));
});


test('rigid friction migrates older saves and roundtrips without changing gravity or membrane friction',()=>{
  const old=defaultMeshSetup();delete old.rigidBody.friction;old.rigidBody.gravity=196;old.softBody.groundFriction=.45;
  const migrated=validateMeshSetup(old);assert.equal(migrated.rigidBody.friction,.55);
  const edited=mergeMeshSetup(migrated,{rigidBody:{friction:2}});
  assert.deepEqual(edited.rigidBody,{gravity:196,friction:2});assert.deepEqual(edited.softBody,migrated.softBody);
  assert.deepEqual(validateMeshSetup(JSON.parse(JSON.stringify(edited))),edited);
  for(const friction of [-1,2.01,NaN,null,'1'])assert.throws(()=>mergeMeshSetup(edited,{rigidBody:{friction}}));
});
