import test from 'node:test';
import assert from 'node:assert/strict';
import { Matrix4, Scene, Vector3 } from 'three';
import { createMeshSoftBody, GROUND_CLEARANCE } from '../src/mesh-soft-body.js';
import { createPlaneMesh } from '../src/plane-mesh.js';
import { createMeshView } from '../src/mesh-view.js';
import { defaultMeshSetup, mergeMeshSetup } from '../src/mesh-settings.js';

const stress = {gravity:30,cameraPull:30,pinWidth:.05,pinStrength:0,restStiffness:0,bending:0,softness:1,damping:.2};
const floor = {normal:[0,1,0],constant:3-GROUND_CLEARANCE};
function pinned(body) {
  body.boundary.forEach((fixed,i)=>{if(fixed)for(let axis=0;axis<3;axis++){
    assert.equal(body.positions[i*3+axis],body.rest[i*3+axis]);assert.equal(body.velocities[i*3+axis],0);
  }});
}
function aboveFloor(body,height) {
  body.boundary.forEach((fixed,i)=>{if(!fixed)assert.ok(body.positions[i*3+1]>=height-1e-10);});
  assert.ok(body.positions.every(Number.isFinite));pinned(body);
}
function horizontal() {
  const mesh=createPlaneMesh({width:4,height:4,widthSegments:6,heightSegments:6});
  mesh.vertices=mesh.vertices.map(([x,y])=>[x,0,y]);return mesh;
}

test('floor contact prevents penetration under sustained maximum gravity and downward pull',()=>{
  const mesh=createPlaneMesh({widthSegments:12,heightSegments:9}),body=createMeshSoftBody(mesh,stress),free=createMeshSoftBody(mesh,stress);
  for(let frame=0;frame<300;frame++){
    body.step(1/60,[0,-12,12],[0,-1,0],floor);aboveFloor(body,-3+GROUND_CLEARANCE);
    free.step(1/60,[0,-12,12]);
  }
  const ys=Array.from(body.boundary.keys()).filter(i=>!body.boundary[i]).map(i=>body.positions[i*3+1]);
  assert.ok(Math.min(...ys)<-3+GROUND_CLEARANCE+.001,'the cloth should make contact');
  assert.ok(Math.min(...free.positions.filter((_,i)=>i%3===1))<-3.1,'the same forces should penetrate without a collider');
});

test('contact handles fast impacts and recovers old penetrations without launching vertices',()=>{
  const body=createMeshSoftBody(horizontal(),{cameraPull:0,gravity:30,pinWidth:.05,pinStrength:0,restStiffness:0});
  for(let i=0;i<body.boundary.length;i++)if(!body.boundary[i]){body.positions[i*3+1]=-1;body.velocities[i*3+1]=-1000;}
  body.step(1/60,[0,14,0],[0,-1,0],{normal:[0,1,0],constant:0});aboveFloor(body,0);
  for(let i=0;i<body.boundary.length;i++)if(!body.boundary[i]&&body.positions[i*3+1]<1e-8)assert.ok(Math.abs(body.velocities[i*3+1])<1e-8);
  for(let frame=0;frame<60;frame++){body.step(1/30,[0,14,0],[0,-1,0],{normal:[0,1,0],constant:0});aboveFloor(body,0);}
});

test('Coulomb friction reduces sliding while preserving zero-friction motion',()=>{
  const speeds=[];
  for(const groundFriction of [0,1]){
    const body=createMeshSoftBody(horizontal(),{gravity:9.8,cameraPull:0,pinWidth:.05,pinStrength:0,restStiffness:0,bending:0,softness:1,damping:0,groundFriction});
    for(let i=0;i<body.boundary.length;i++)if(!body.boundary[i])body.velocities[i*3]=2;
    body.step(1/120,[0,14,0],[0,-1,0],{normal:[0,1,0],constant:0});aboveFloor(body,0);
    speeds.push(Array.from(body.boundary.keys()).filter(i=>!body.boundary[i]).reduce((sum,i)=>sum+body.velocities[i*3],0));
  }
  assert.ok(speeds[0]>0);assert.ok(speeds[1]<speeds[0]-1);
});

test('contact is deterministic across frame rates and rejects invalid planes',()=>{
  const mesh=createPlaneMesh({widthSegments:8,heightSegments:6}),a=createMeshSoftBody(mesh,stress),b=createMeshSoftBody(mesh,stress);
  for(let i=0;i<120;i++)a.step(1/60,[0,-12,12],[0,-1,0],floor);
  for(let i=0;i<60;i++)b.step(1/30,[0,-12,12],[0,-1,0],floor);
  assert.deepEqual(a.positions,b.positions);aboveFloor(a,-3+GROUND_CLEARANCE);
  for(const ground of [{normal:[0,0,0],constant:0},{normal:[0,NaN,0],constant:0},{normal:[0,1,0],constant:Infinity}])assert.throws(()=>a.step(1/60,[0,0,14],[0,-1,0],ground),/Ground plane/);
});

test('world-space floor contact follows translated and rotated mesh transforms',()=>{
  const setup=mergeMeshSetup(defaultMeshSetup(),{pipeline:{enabled:false},softBody:stress});
  const view=createMeshView(new Scene());view.configure(setup);view.setMesh(createPlaneMesh({widthSegments:8,heightSegments:6}),setup);
  view.object.rotation.set(.2,.4,.1);view.object.position.set(1,.5,-2);view.object.updateWorldMatrix(true,false);
  const inverse=new Matrix4().copy(view.object.matrixWorld).invert(),groundY=-4;
  for(let i=0;i<view.softBody.boundary.length;i++)if(!view.softBody.boundary[i]){
    const p=new Vector3().fromArray(view.softBody.positions,i*3).applyMatrix4(view.object.matrixWorld);p.y=groundY-1;
    p.applyMatrix4(inverse).toArray(view.softBody.positions,i*3);
  }
  view.stepSoftBody(1/60,new Vector3(0,-12,12),groundY);
  for(let i=0;i<view.softBody.boundary.length;i++)if(!view.softBody.boundary[i]){
    const p=new Vector3().fromArray(view.softBody.positions,i*3).applyMatrix4(view.object.matrixWorld);
    assert.ok(p.y>=groundY+GROUND_CLEARANCE-1e-10);
  }
  pinned(view.softBody);view.dispose();
});
