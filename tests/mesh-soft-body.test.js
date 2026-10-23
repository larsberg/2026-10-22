import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { createMeshSoftBody, softBodyDefaults } from '../src/mesh-soft-body.js';
import { createPlaneMesh } from '../src/plane-mesh.js';
import { createMeshLayers } from '../src/mesh-layers.js';
import { averageVertices } from '../src/mesh-operations.js';
import { createMeshView } from '../src/mesh-view.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';

const near = (a,b,tolerance=1e-9) => assert.ok(Math.abs(a-b)<tolerance, `${a} != ${b}`);
function pinned(body) {
  body.boundary.forEach((fixed, i) => {
    if (fixed) for (let axis=0;axis<3;axis++) { assert.equal(body.positions[i*3+axis],body.rest[i*3+axis]); assert.equal(body.velocities[i*3+axis],0); }
  });
}
function advance(body, seconds=3, camera=[0,0,14], fps=60) {
  for (let frame=0;frame<seconds*fps;frame++) body.step(1/fps,camera);
}
const wall = () => createMeshLayers(createPlaneMesh(), defaultMeshSetup().pipeline).mesh;

test('smoothing blends simultaneous neighbor averages on each pass and preserves the boundary exactly',()=>{
  const mesh=createPlaneMesh({widthSegments:4,heightSegments:4});
  mesh.vertices[12][2]=2;
  const before=structuredClone(mesh), actual=averageVertices(mesh,undefined,{iterations:3,strength:.5}).mesh;
  let expected=mesh;
  for(let i=0;i<3;i++) {
    const average=averageVertices(expected).mesh;
    expected={...expected,vertices:expected.vertices.map((p,id)=>p.map((v,axis)=>(v+average.vertices[id][axis])/2))};
  }
  assert.deepEqual(actual,expected);assert.deepEqual(actual.faces,mesh.faces);assert.deepEqual(mesh,before);
  assert.ok(actual.vertices[12][2]>0&&actual.vertices[12][2]<2);
  const body=createMeshSoftBody(mesh);
  body.boundary.forEach((fixed,i)=>{if(fixed)assert.deepEqual(actual.vertices[i],mesh.vertices[i]);});
  for(const options of [{iterations:0},{iterations:1.5},{iterations:21},{strength:0},{strength:1.01}]) assert.throws(()=>averageVertices(mesh,undefined,options));
});

test('pin weights use a smooth physical distance gradient, independent of grid resolution',()=>{
  const a=createMeshSoftBody(createPlaneMesh({width:4,height:4,widthSegments:8,heightSegments:8}),{pinWidth:2});
  const b=createMeshSoftBody(createPlaneMesh({width:4,height:4,widthSegments:16,heightSegments:16}),{pinWidth:2});
  for(const [x, expected] of [[2,1],[1.5,.84375],[1,.5],[.5,.15625],[0,0]]) {
    for(const body of [a,b]) {
      const id=Array.from({length:body.rest.length/3},(_,i)=>i).find(i=>body.rest[i*3]===x&&body.rest[i*3+1]===0);
      near(body.edgeDistance[id],2-x);near(body.pinWeights[id],expected);near(body.mobility[id],1-expected);
    }
  }
  assert.ok(a.mobility.every(w=>w>=0&&w<=1));pinned(a);
});

test('camera pull bows the smoothed wall with a gradual edge transition and an immovable rim',()=>{
  const mesh=wall(), before=structuredClone(mesh), body=createMeshSoftBody(mesh);
  advance(body,5);
  pinned(body);assert.deepEqual(mesh,before);
  let middle=0,nearEdge=0,middleCount=0,edgeCount=0;
  body.edgeDistance.forEach((d,i)=>{
    if(d>2){middle+=body.positions[i*3+2];middleCount++;}
    else if(d>.1&&d<.4){nearEdge+=body.positions[i*3+2];edgeCount++;}
  });
  assert.ok(middle/middleCount>1);assert.ok(nearEdge/edgeCount>0);assert.ok(nearEdge/edgeCount<middle/middleCount*.25);
  assert.ok(body.positions.every(Number.isFinite));assert.ok(body.bends.length>0);
});

test('the force follows the current camera position and zero force leaves the rest mesh still',()=>{
  const mesh=createPlaneMesh({widthSegments:8,heightSegments:6}), body=createMeshSoftBody(mesh,{cameraPull:0});
  advance(body);assert.deepEqual(body.positions,body.rest);
  body.configure({cameraPull:6});advance(body,3,[14,0,0]);
  assert.ok(body.positions.filter((_,i)=>i%3===0).reduce((sum,x,i)=>sum+x-body.rest[i*3],0)>0);
  near(Math.max(...body.positions.filter((_,i)=>i%3===2)),0);pinned(body);
  body.reset();advance(body,3,[0,0,14]);assert.ok(Math.max(...body.positions.filter((_,i)=>i%3===2))>.1);
  advance(body,5,[0,0,-14]);assert.ok(Math.min(...body.positions.filter((_,i)=>i%3===2))<-.1);pinned(body);
});

test('signed normal forces move a resting wall without camera pull or gravity and preserve every boundary pin',()=>{
  const mesh=createPlaneMesh({widthSegments:6,heightSegments:6});
  const bodies=[-20,0,20].map(force=>{
    const body=createMeshSoftBody(mesh,{cameraPull:0,gravity:0,restStiffness:6});
    body.setNormalForces(new Float64Array(mesh.vertices.length).fill(force));advance(body,2);pinned(body);return body;
  });
  assert.deepEqual(bodies[1].positions,bodies[1].rest);
  assert.ok(Math.min(...bodies[0].positions.filter((_,i)=>i%3===2))<-.1);
  assert.ok(Math.max(...bodies[2].positions.filter((_,i)=>i%3===2))>.1);
  bodies[0].positions.forEach((v,i)=>near(v,i%3===2?-bodies[2].positions[i]:bodies[2].positions[i]));
  const positive=bodies[2];positive.setNormalForces(new Float64Array(mesh.vertices.length).fill(100));
  advance(positive,5);assert.ok(positive.positions.every(v=>Number.isFinite(v)&&Math.abs(v)<50));pinned(positive);
});

test('normal forces follow the rest surface orientation and invalid updates leave motion and forces intact',()=>{
  const mesh=createPlaneMesh({widthSegments:6,heightSegments:6});
  mesh.vertices=mesh.vertices.map(([x,y,z])=>[x,-z,y]);
  const body=createMeshSoftBody(mesh,{cameraPull:0,gravity:0});
  body.setNormalForces(new Float64Array(mesh.vertices.length).fill(10));advance(body,1);
  assert.ok(Math.min(...body.positions.filter((_,i)=>i%3===1))<-.1);pinned(body);
  const forces=body.normalForces.slice(),pose=body.positions.slice(),velocity=body.velocities.slice(),time=body.time;
  for(const values of [[],new Float64Array(mesh.vertices.length).fill(NaN),new Float64Array(mesh.vertices.length).fill(Infinity)])assert.throws(()=>body.setNormalForces(values),/Normal forces/);
  assert.deepEqual(body.normalForces,forces);assert.deepEqual(body.positions,pose);assert.deepEqual(body.velocities,velocity);assert.equal(body.time,time);
  const ground={normal:[0,1,0],constant:0};
  for(let frame=0;frame<120;frame++)body.step(1/60,[0,0,14],[0,-1,0],ground);
  body.boundary.forEach((fixed,i)=>{if(!fixed)assert.ok(body.positions[i*3+1]>=-1e-10);});pinned(body);
});

test('fixed timesteps give matching results across render rates and cap long-frame catchup',()=>{
  const mesh=createPlaneMesh({widthSegments:8,heightSegments:6}), a=createMeshSoftBody(mesh),b=createMeshSoftBody(mesh),c=createMeshSoftBody(mesh);
  advance(a,2,[0,0,14],120);advance(b,2,[0,0,14],60);advance(c,2,[0,0,14],30);
  assert.deepEqual(a.positions,b.positions);assert.deepEqual(a.positions,c.positions);
  const before=a.time;a.step(20);near(a.time-before,8/120);pinned(a);
  assert.equal(a.step(0),false);assert.equal(a.step(NaN),false);
});

test('pin tuning preserves motion, disable restores rest, and reset clears velocity and time',()=>{
  const body=createMeshSoftBody(wall());advance(body,1);
  const before=body.positions.slice(), time=body.time, weights=body.pinWeights.slice();
  body.configure({pinWidth:2.5,cameraPull:10});assert.deepEqual(body.positions,before);assert.equal(body.time,time);assert.notDeepEqual(body.pinWeights,weights);
  body.configure({enabled:false});assert.deepEqual(body.positions,body.rest);assert.equal(body.step(1/60),false);
  body.configure({enabled:true});advance(body,1);body.reset();assert.deepEqual(body.positions,body.rest);assert.ok(body.velocities.every(v=>v===0));assert.equal(body.time,0);pinned(body);
});

test('maximum pull stays finite over sustained motion with soft springs and no damping',()=>{
  const body=createMeshSoftBody(createPlaneMesh({widthSegments:8,heightSegments:6}),{cameraPull:30,softness:1,bending:0,damping:0,restStiffness:0});
  advance(body,12);assert.ok(body.positions.every(v=>Number.isFinite(v)&&Math.abs(v)<50));pinned(body);
});

test('gravity adds downward acceleration without changing the hard boundary or resetting motion',()=>{
  const mesh=createPlaneMesh({widthSegments:8,heightSegments:6}),body=createMeshSoftBody(mesh,{cameraPull:0});
  advance(body,1);assert.deepEqual(body.positions,body.rest);
  const time=body.time;body.configure({gravity:9.8});assert.equal(body.time,time);
  advance(body,3);pinned(body);
  let vertical=0;
  for(let i=0;i<body.boundary.length;i++)vertical+=body.positions[i*3+1]-body.rest[i*3+1];
  assert.ok(vertical<-.1);assert.ok(body.positions.every(Number.isFinite));
  near(Math.max(...body.positions.filter((_,i)=>i%3===2)),0);
  const pose=body.positions.slice();body.configure({gravity:0});assert.deepEqual(body.positions,pose);
  assert.throws(()=>body.configure({gravity:-1}));assert.throws(()=>body.configure({gravity:31}));
});

test('gravity remains world-down on a rotated mesh, independently of camera direction',()=>{
  const setup=mergeMeshSetup(defaultMeshSetup(),{pipeline:{enabled:false},softBody:{cameraPull:0,gravity:9.8}});
  const view=createMeshView(new Scene());view.configure(setup);view.setMesh(createPlaneMesh({widthSegments:8,heightSegments:6}),setup);
  const reference=createMeshSoftBody(view.topology,setup.softBody);
  view.object.rotation.z=Math.PI/2;
  for(let i=0;i<180;i++){
    view.stepSoftBody(1/60,new Vector3(14,0,0));
    reference.step(1/60,[0,0,14],[-1,0,0]);
  }
  view.softBody.positions.forEach((value,i)=>near(value,reference.positions[i]));
  let y=0;
  for(let i=0;i<view.softBody.boundary.length;i++){
    const p=new Vector3().fromArray(view.softBody.positions,i*3).applyMatrix4(view.object.matrixWorld);
    const rest=new Vector3().fromArray(view.softBody.rest,i*3).applyMatrix4(view.object.matrixWorld);
    y+=p.y-rest.y;
  }
  assert.ok(y<-.1);pinned(view.softBody);view.dispose();
});

test('deformation updates surface and wireframe while the camera anchor stays fixed',()=>{
  const view=createMeshView(new Scene()),setup=defaultMeshSetup();
  view.configure(setup);view.setMesh(wall(),mergeMeshSetup(setup,{pipeline:{enabled:false}}));
  const rest=structuredClone(view.topology), center=view.getCenter(new Vector3()).clone(),camera=new PerspectiveCamera(42,1,.1,1000);
  camera.position.set(0,0,14);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  for(let i=0;i<180;i++)view.stepSoftBody(1/60,camera.position);
  assert.deepEqual(view.topology,rest);assert.deepEqual(view.getCenter(new Vector3()),center);pinned(view.softBody);
  const positions=view.softBody.positions,wire=view.object.geometry.attributes.position.array;
  view.edges.forEach((edge,i)=>edge.forEach((id,j)=>{for(let axis=0;axis<3;axis++)near(wire[i*6+j*3+axis],positions[id*3+axis],1e-6);}));
  const corners=rest.faces.flat(),surface=view.surface.mesh.geometry.attributes.position.array;
  corners.forEach((id,i)=>{for(let axis=0;axis<3;axis++)near(surface[i*3+axis],positions[id*3+axis],1e-6);});
  view.resetSoftBody();assert.deepEqual(view.softBody.positions,view.softBody.rest);
  view.smooth({iterations:2,strength:.5});const body=view.softBody;view.undo();assert.notEqual(view.softBody,body);assert.deepEqual(view.topology,rest);
  view.dispose();
});

test('settings migrate older saves and validate soft-body and smoothing controls',()=>{
  const setup=defaultMeshSetup(),old=structuredClone(setup);delete old.softBody;delete old.pipeline.smoothingIterations;delete old.pipeline.smoothingStrength;
  const migrated=validateMeshSetup(old);assert.deepEqual(migrated.softBody,softBodyDefaults);assert.equal(migrated.pipeline.smoothingIterations,4);
  const edited=mergeMeshSetup(migrated,{softBody:{cameraPull:12,pinWidth:2,softness:.7},pipeline:{smoothingIterations:8,smoothingStrength:.7}});
  assert.deepEqual(validateMeshSetup(edited),edited);
  for(const softBody of [{cameraPull:-1},{cameraPull:31},{gravity:-1},{gravity:31},{enabled:1},{pinWidth:0},{pinStrength:501},{damping:NaN}]) assert.throws(()=>mergeMeshSetup(setup,{softBody}));
  for(const pipeline of [{smoothingIterations:0},{smoothingIterations:1.5},{smoothingStrength:0},{smoothingStrength:null}])assert.throws(()=>mergeMeshSetup(setup,{pipeline}));
  assert.throws(()=>validateMeshSetup({...setup,softBody:false}));
});
