import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene,Vector3,PerspectiveCamera } from 'three';
import { createCafeSetting } from '../src/cafe-setting.js';
import { createCafePhysics,CAFE_STEP } from '../src/cafe-physics.js';
import { bindCafeGrab } from '../src/cafe-grab.js';
import { createMeshView } from '../src/mesh-view.js';
import { createPlaneMesh } from '../src/plane-mesh.js';
import { defaultMeshSetup } from '../src/mesh-settings.js';

const light={enabled:true,intensity:1,rotation:0};
function fixture(options){const cafe=createCafeSetting(null);cafe.configure(-3,light);const physics=createCafePhysics(cafe,options);return {cafe,physics,dispose(){physics.dispose();cafe.dispose();}};}
function advance(p,frames=240,views){for(let i=0;i<frames;i++)p.step(CAFE_STEP,views,new Vector3(0,0,14),-3);}

test('five independent compounds settle on the floor with plates supported by the table',()=>{
  const f=fixture(),p=f.physics;
  try{
    assert.equal(p.entries.length,5);assert.ok(p.entries.every(e=>e.body.shapes.length>1));
    assert.ok(f.cafe.plates.every(plate=>plate.parent===f.cafe.group));
    advance(p,1200);
    for(const e of p.entries){e.body.updateAABB();assert.ok(e.body.aabb.lowerBound.y>=-3.025);assert.ok(e.body.position.toArray().every(Number.isFinite));assert.ok(e.body.velocity.length()<.02);}
    const plate=p.entries[3],table=p.entries[0],tableStart=table.body.position.clone();
    const plateHeight=plate.body.position.y;assert.ok(plateHeight>-.7);
    plate.body.position.x+=4;plate.body.wakeUp();advance(p,360);
    assert.ok(plate.body.position.y<plateHeight-1);assert.ok(table.body.position.distanceTo(tableStart)<.02);
    p.reset();assert.ok(p.entries.every(e=>e.body.velocity.length()===0));assert.ok(Math.abs(p.entries[3].body.position.x+.77)<1e-6);
  }finally{f.dispose();}
});

test('point grabs lift and rotate props, release retains motion, cancel clears it',()=>{
  const f=fixture(),p=f.physics,e=p.entries[3];
  try{
    const start=new Vector3(...e.body.position.toArray());assert.equal(p.grab(e.id,start.clone().add(new Vector3(.3,0,0))),true);
    for(let i=0;i<120;i++){p.moveGrab(start.clone().add(new Vector3(.3+i*.012,1,-1)));p.step(CAFE_STEP);}
    assert.ok(e.body.position.y>start.y+.5);assert.ok(e.body.position.x>start.x+.5);
    const velocity=e.body.velocity.toArray();p.release();assert.deepEqual(e.body.velocity.toArray(),velocity);assert.equal(p.world.constraints.length,0);
    p.grab(e.id,new Vector3(...e.body.position.toArray()));p.release(true);assert.equal(e.body.velocity.length(),0);assert.equal(e.body.angularVelocity.length(),0);
    assert.equal(p.world.bodies.length,6);
  }finally{f.dispose();}
});

test('rigid impacts deform free membrane vertices while preserving every boundary pin',()=>{
  const f=fixture({gravity:0}),p=f.physics,views=createMeshView(new Scene());
  try{
    const settings=defaultMeshSetup();settings.pipeline.enabled=false;Object.assign(settings.softBody,{cameraPull:0,gravity:0,bending:.1,restStiffness:1});
    views.setMesh(createPlaneMesh({width:6,height:6,widthSegments:12,heightSegments:12}),settings);
    const e=p.entries[0];e.body.position.set(0,0,.8);e.body.velocity.set(0,0,-3);e.body.wakeUp();
    let contacts=0;for(let i=0;i<240;i++){p.step(CAFE_STEP,views,new Vector3(0,0,14),-3);contacts=Math.max(contacts,p.diagnostics.softContacts);}
    assert.ok(contacts>0);const soft=views.softBody;
    assert.ok(soft.positions.some((v,i)=>Math.abs(v-soft.rest[i])>.1));assert.ok(soft.positions.every(v=>Number.isFinite(v)&&Math.abs(v)<20));
    soft.boundary.forEach((fixed,i)=>{if(fixed)for(let a=0;a<3;a++)assert.equal(soft.positions[i*3+a],soft.rest[i*3+a]);});
    assert.ok(e.body.velocity.z>-3*.7,'the cloth must push back on the rigid body');
    views.regenerate();p.step(CAFE_STEP,views,new Vector3(0,0,14),-3);assert.ok(p.diagnostics.proxies>=0);
    views.configure({...settings,softBody:{...settings.softBody,enabled:false}});advance(p,10,views);
    assert.deepEqual(views.softBody.positions,views.softBody.rest);
  }finally{f.dispose();views.dispose();}
});

test('rigid fixed steps are independent of display frame rate',()=>{
  const a=fixture(),b=fixture();try{
    for(let i=0;i<120;i++)a.physics.step(1/60);
    for(let i=0;i<240;i++)b.physics.step(1/120);
    a.physics.entries.forEach((e,i)=>assert.ok(e.body.position.distanceTo(b.physics.entries[i].body.position)<1e-8));
  }finally{a.dispose();b.dispose();}
});

class Pointer extends Event{constructor(type,values){super(type,{cancelable:true});Object.assign(this,values);}}
function canvas(){const target=new EventTarget(),captured=new Set();Object.assign(target,{style:{},ownerDocument:new EventTarget(),getBoundingClientRect:()=>({left:0,top:0,width:800,height:600}),setPointerCapture:id=>captured.add(id),hasPointerCapture:id=>captured.has(id),releasePointerCapture:id=>captured.delete(id)});return target;}

test('touch picks individual plates, second finger changes depth, cancel restores orbit and empty space passes through',()=>{
  const f=fixture(),p=f.physics,element=canvas(),controls={enabled:true},windowTarget=new EventTarget();
  const camera=new PerspectiveCamera(45,800/600,.1,100);camera.position.set(0,3,12);camera.lookAt(0,-.5,5.4);camera.updateMatrixWorld();f.cafe.group.updateWorldMatrix(true,true);
  const plate=f.cafe.plates[0],point=plate.getWorldPosition(new Vector3());point.y+=.075;point.project(camera);
  const x=(point.x+1)*400,y=(1-point.y)*300,handler=bindCafeGrab(element,{camera,controls,physics:p,windowTarget});
  const dispatch=(type,id,cx,cy)=>{const event=new Pointer(type,{pointerId:id,pointerType:'touch',button:0,clientX:cx,clientY:cy});element.dispatchEvent(event);return event;};
  try{
    assert.equal(dispatch('pointerdown',9,5,5).defaultPrevented,false);assert.equal(handler.active,false);
    assert.equal(dispatch('pointerdown',1,x,y).defaultPrevented,true);assert.equal(p.grabbed.kind,'plate');assert.equal(controls.enabled,false);
    const anchorBefore=p.world.constraints[0].bodyB.position.clone();
    dispatch('pointermove',1,x+30,y-20);dispatch('pointerdown',2,x+60,y);dispatch('pointermove',2,x+60,y+60);
    advance(p,60);const anchorAfter=p.world.constraints[0].bodyB.position,view=camera.getWorldDirection(new Vector3());
    assert.ok((anchorAfter.x-anchorBefore.x)*view.x+(anchorAfter.y-anchorBefore.y)*view.y+(anchorAfter.z-anchorBefore.z)*view.z>1);
    assert.ok(handler.active);dispatch('pointerup',2,x+60,y+60);assert.ok(handler.active);
    dispatch('pointercancel',1,x+30,y-20);assert.equal(handler.active,false);assert.equal(controls.enabled,true);assert.equal(p.world.constraints.length,0);
  }finally{handler.dispose();f.dispose();}
});


test('rigid gravity changes free fall immediately without resetting pose or velocity',()=>{
  const f=fixture({gravity:9.8}),p=f.physics,e=p.entries[1];
  try{
    e.body.position.set(0,20,20);e.body.velocity.set(1,0,0);e.body.wakeUp();
    const before=e.body.position.clone();p.setGravity(98);assert.deepEqual(e.body.position,before);assert.equal(e.body.velocity.x,1);
    p.step(CAFE_STEP);assert.ok(Math.abs(e.body.velocity.y+98*CAFE_STEP)<1e-8);
    p.setGravity(980);e.body.velocity.setZero();p.step(CAFE_STEP);assert.ok(Math.abs(e.body.velocity.y+980*CAFE_STEP)<.01);
    p.setGravity(0);e.body.velocity.setZero();p.step(CAFE_STEP);assert.equal(e.body.velocity.y,0);
  }finally{f.dispose();}
});

test('maximum rigid gravity keeps plates on the table and allows live grabs',()=>{
  const f=fixture(),p=f.physics,e=p.entries[3];
  try{
    const start=new Vector3(...e.body.position.toArray());p.grab(e.id,start);p.setGravity(980);
    for(let i=0;i<120;i++){p.moveGrab(start.clone().add(new Vector3(0,1,0)));p.step(CAFE_STEP);}
    assert.ok(e.body.position.y>start.y+.7);p.release();p.reset();advance(p,1200);
    for(const {body} of p.entries){body.updateAABB();assert.ok(body.aabb.lowerBound.y>=-3.025);assert.ok(body.velocity.length()<.03);}
    assert.ok(p.entries[3].body.position.y>-.7);assert.ok(p.entries[4].body.position.y>-.7);
  }finally{f.dispose();}
});

test('rigid gravity is cancelled on membrane proxies and never changes its free motion',()=>{
  const f=fixture({gravity:0}),p=f.physics,views=createMeshView(new Scene());
  try{
    const settings=defaultMeshSetup();settings.pipeline.enabled=false;Object.assign(settings.softBody,{gravity:3.3,cameraPull:0});
    views.setMesh(createPlaneMesh({width:6,height:6,widthSegments:6,heightSegments:6}),settings);
    // Nearby but non-solving prop creates proxy particles without imparting contact impulses.
    for(const {body} of p.entries)body.collisionResponse=false;
    p.entries[0].body.position.set(0,0,0);
    p.step(CAFE_STEP,views,new Vector3(0,0,14),-3);assert.ok(p.diagnostics.proxies>0);
    const proxies=p.world.bodies.filter(b=>b.collisionFilterGroup===4&&b.mass>0);assert.ok(proxies.length>0);
    p.setGravity(980);
    // Direct callback compares the same membrane state with zero and high rigid gravity.
    const positions=views.softBody.positions.slice(),velocities=views.softBody.velocities.slice();
    p.entries[0].body.position.set(0,0,0);p.entries[0].body.velocity.setZero();
    p.step(CAFE_STEP,views,new Vector3(0,0,14),-3);
    assert.equal(views.softBody.settings.gravity,3.3);
    // A second independent solver advances the exact pre-step state without props.
    const reference=createMeshView(new Scene());
    try{reference.setMesh(views.topology,settings);reference.softBody.positions.set(positions);reference.softBody.velocities.set(velocities);
      reference.stepSoftBody(CAFE_STEP,new Vector3(0,0,14),-3,true);
      views.softBody.positions.forEach((v,i)=>assert.ok(Math.abs(v-reference.softBody.positions[i])<1e-6));
      views.softBody.velocities.forEach((v,i)=>assert.ok(Math.abs(v-reference.softBody.velocities[i])<1e-5));
    }finally{reference.dispose();}
  }finally{f.dispose();views.dispose();}
});


test('rigid friction adjusts contact grip without resetting bodies or changing gravity',()=>{
  const slippery=fixture({gravity:9.8,friction:0}),grippy=fixture({gravity:9.8,friction:1});
  try{
    for(const f of [slippery,grippy]){
      const p=f.physics,e=p.entries[3];e.body.position.set(10,-2.9,10);e.body.quaternion.set(0,0,0,1);e.body.velocity.setZero();e.body.angularVelocity.setZero();e.body.wakeUp();advance(p,240);
      e.body.velocity.set(3,0,0);e.body.wakeUp();
    }
    const p=grippy.physics,e=p.entries[3],pose=e.body.position.clone(),velocity=e.body.velocity.clone();
    p.setFriction(2);assert.deepEqual(e.body.position,pose);assert.deepEqual(e.body.velocity,velocity);assert.equal(p.world.gravity.y,-9.8);
    advance(slippery.physics,60);advance(grippy.physics,60);
    assert.ok(slippery.physics.entries[3].body.velocity.x>2);
    assert.ok(Math.abs(e.body.velocity.x)<.1,'grip should stop the sliding plate');
    assert.equal(p.world.defaultContactMaterial.friction,2);
    for(const value of [-.1,2.1,NaN])assert.throws(()=>p.setFriction(value));
  }finally{slippery.dispose();grippy.dispose();}
});
