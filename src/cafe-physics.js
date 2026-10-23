import * as C from 'cannon-es';
import { RIGID_BODY_GRAVITY, RIGID_BODY_FRICTION, validateRigidBody } from './rigid-body-settings.js';
import { Box3, Matrix4, Quaternion, Vector3 } from 'three';

export const CAFE_STEP=1/120;
const PROP=1,FLOOR=2,CLOTH=4,RADIUS=.12;
const cv=v=>new C.Vec3(v.x,v.y,v.z);

// Each visual prop maps to one body. Open chairs use boxes for individual
// members; lathed table parts and plates use cylinders; curved feet use boxes.
export function createCafePhysics(cafe,{gravity=RIGID_BODY_GRAVITY,friction=RIGID_BODY_FRICTION}={}){
  validateRigidBody({gravity,friction});
  const world=new C.World({gravity:new C.Vec3(0,-gravity,0),allowSleep:true});
  world.broadphase=new C.SAPBroadphase(world);world.solver.iterations=18;world.solver.tolerance=1e-7;
  world.defaultContactMaterial.friction=friction;world.defaultContactMaterial.restitution=.02;
  world.defaultContactMaterial.contactEquationStiffness=1e7;
  const floor=new C.Body({mass:0,shape:new C.Plane(),collisionFilterGroup:FLOOR,collisionFilterMask:PROP});
  floor.quaternion.setFromEuler(-Math.PI/2,0,0);world.addBody(floor);
  const entries=[],byObject=new Map(),active=new Map(),sphere=new C.Sphere(RADIUS);
  let floorY=NaN,accumulator=0,boundSoft,samples=[],drag,disposed=false,contacts=0;
  const position=new Vector3(),rotation=new Quaternion(),scale=new Vector3(),local=new Matrix4(),inverse=new Matrix4();
  const samplePosition=new Vector3(),sampleVelocity=new Vector3(),softRotation=new Quaternion();
  const localOffset=new Vector3(),worldOrigin=new Vector3(),parentRotation=new Quaternion();
  cafe.group.updateWorldMatrix(true,true);
  function add(object,kind,mass){
    object.updateWorldMatrix(true,true);inverse.copy(object.matrixWorld).invert();
    const bounds=new Box3();
    const pieces=[];
    object.traverse(mesh=>{
      if(!mesh.isMesh||mesh.geometry.type==='TorusGeometry')return;
      mesh.geometry.computeBoundingBox();local.multiplyMatrices(inverse,mesh.matrixWorld);
      const box=mesh.geometry.boundingBox.clone(),center=box.getCenter(new Vector3()).applyMatrix4(local);
      const size=box.getSize(new Vector3());local.decompose(position,rotation,scale);size.multiply(scale);
      bounds.union(box.clone().applyMatrix4(local));
      pieces.push({mesh,center,size,quaternion:rotation.clone()});
    });
    const com=bounds.getCenter(new Vector3());
    const body=new C.Body({mass,linearDamping:.15,angularDamping:.3,allowSleep:true,sleepSpeedLimit:.06,sleepTimeLimit:.7,
      collisionFilterGroup:PROP,collisionFilterMask:PROP|FLOOR|CLOTH});
    if(kind==='plate'){
      for(const [radius,height,y] of [[.29,.03,.033],[.5,.075,.1]])body.addShape(new C.Cylinder(radius,radius,height,20),new C.Vec3(0,y-com.y,0));
    }else for(const {mesh,center,size,quaternion} of pieces){
      const shape=mesh.geometry.type==='LatheGeometry'||mesh.geometry.type==='CylinderGeometry'
        ?new C.Cylinder(Math.max(size.x,size.z)/2,Math.max(size.x,size.z)/2,size.y,20)
        :new C.Box(new C.Vec3(Math.max(.015,size.x/2),Math.max(.015,size.y/2),Math.max(.015,size.z/2)));
      body.addShape(shape,cv(center.sub(com)),new C.Quaternion(quaternion.x,quaternion.y,quaternion.z,quaternion.w));
    }
    const entry={id:entries.length,object,body,com,kind,initialPosition:object.position.clone(),initialQuaternion:object.quaternion.clone()};
    entries.push(entry);byObject.set(object,entry);object.traverse(child=>{child.userData.cafeBody=entry.id;});
    world.addBody(body);return entry;
  }
  add(cafe.table,'table',14);cafe.chairs.forEach(o=>add(o,'chair',3.5));cafe.plates.forEach(o=>add(o,'plate',.4));
  function clearProxies(){for(const proxy of active.values())world.removeBody(proxy.body);active.clear();contacts=0;}
  function reset(){
    release(true);clearProxies();accumulator=0;
    cafe.group.updateWorldMatrix(true,false);
    for(const e of entries){
      e.object.position.copy(e.initialPosition);e.object.quaternion.copy(e.initialQuaternion);e.object.updateWorldMatrix(true,false);
      e.object.getWorldQuaternion(rotation);const p=e.com.clone().applyMatrix4(e.object.matrixWorld);
      e.body.position.copy(cv(p));e.body.quaternion.set(rotation.x,rotation.y,rotation.z,rotation.w);
      e.body.previousPosition.copy(e.body.position);e.body.interpolatedPosition.copy(e.body.position);
      e.body.previousQuaternion.copy(e.body.quaternion);e.body.interpolatedQuaternion.copy(e.body.quaternion);
      e.body.velocity.setZero();e.body.angularVelocity.setZero();e.body.force.setZero();e.body.torque.setZero();
      e.body.aabbNeedsUpdate=true;e.body.updateInertiaWorld(true);e.body.wakeUp();
    }
    sync();
  }
  function setFloor(y){if(!Number.isFinite(y))throw new Error('Invalid café ground height.');if(y===floorY)return;
    floorY=y;floor.position.y=y;floor.aabbNeedsUpdate=true;reset();}
  function bindSoft(views){
    if(boundSoft===views?.softBody)return;
    boundSoft?.setCollisionHandler(null);clearProxies();boundSoft=views?.softBody;samples=[];
    if(!boundSoft)return;
    for(let i=0;i<boundSoft.mobility.length;i++)samples.push({ids:[i]});
    // Face-centre samples close the gaps between vertices for thin chair legs
    // and plate rims. Corrections distribute back through barycentric weights.
    for(const face of views.topology.faces)samples.push({ids:face});
    boundSoft.setCollisionHandler(()=>runWorld(views,false));
  }
  function readSample(sample,soft,matrix,staticSoft){
    samplePosition.set(0,0,0);sampleVelocity.set(0,0,0);let sum=0;
    for(const id of sample.ids){const j=id*3;samplePosition.x+=soft.positions[j];samplePosition.y+=soft.positions[j+1];samplePosition.z+=soft.positions[j+2];
      sampleVelocity.x+=soft.velocities[j];sampleVelocity.y+=soft.velocities[j+1];sampleVelocity.z+=soft.velocities[j+2];sum+=staticSoft?0:soft.mobility[id];}
    const n=sample.ids.length;samplePosition.multiplyScalar(1/n).applyMatrix4(matrix);sampleVelocity.multiplyScalar(1/n).applyQuaternion(softRotation);
    return sum/(n*n);
  }
  function runWorld(views,staticSoft){
    const soft=views?.softBody,matrix=views?.object.matrixWorld;
    if(drag){const d=drag.target.vsub(drag.anchor.position),length=d.length();if(length>18*CAFE_STEP)d.scale(18*CAFE_STEP/length,d);drag.anchor.position.vadd(d,drag.anchor.position);drag.anchor.aabbNeedsUpdate=true;drag.entry.body.wakeUp();}
    const boxes=entries.map(({body})=>{body.updateAABB();const a=body.aabb;return {min:[a.lowerBound.x-.35,a.lowerBound.y-.35,a.lowerBound.z-.35],max:[a.upperBound.x+.35,a.upperBound.y+.35,a.upperBound.z+.35]};});
    const wanted=new Set();
    if(soft){
      views.object.getWorldQuaternion(softRotation);
      const particleMass=18/soft.mobility.length;
      for(let index=0;index<samples.length;index++){
        const sample=samples[index],weight=readSample(sample,soft,matrix,staticSoft),p=samplePosition;
        if(!boxes.some(box=>p.x>=box.min[0]&&p.x<=box.max[0]&&p.y>=box.min[1]&&p.y<=box.max[1]&&p.z>=box.min[2]&&p.z<=box.max[2]))continue;
        wanted.add(index);let proxy=active.get(index);
        if(!proxy){const body=new C.Body({mass:weight?particleMass/weight:0,shape:sphere,linearDamping:0,angularDamping:0,allowSleep:false,
          collisionFilterGroup:CLOTH,collisionFilterMask:PROP});body.fixedRotation=true;body.updateMassProperties();proxy={body,sample,position:new Vector3(),velocity:new Vector3(),weight};active.set(index,proxy);world.addBody(body);}
        const b=proxy.body,mass=weight?particleMass/weight:0;
        if(b.mass!==mass){b.mass=mass;b.type=mass?C.Body.DYNAMIC:C.Body.STATIC;b.updateMassProperties();}
        proxy.position.copy(p);proxy.velocity.copy(sampleVelocity);proxy.weight=weight;
        // XPBD has already advanced the membrane. Rewind its proxy by one
        // velocity step so Cannon advances it exactly once, adding contacts.
        b.position.set(p.x-sampleVelocity.x*CAFE_STEP,p.y-sampleVelocity.y*CAFE_STEP,p.z-sampleVelocity.z*CAFE_STEP);
        b.velocity.copy(cv(sampleVelocity));b.force.set(0,-mass*world.gravity.y,0);b.angularVelocity.setZero();b.aabbNeedsUpdate=true;
      }
    }
    for(const [key,proxy] of active)if(!wanted.has(key)){world.removeBody(proxy.body);active.delete(key);}
    world.broadphase.autoDetectAxis();
    for(const {body} of entries){const speed=body.velocity.length();if(speed>18)body.velocity.scale(18/speed,body.velocity);const spin=body.angularVelocity.length();if(spin>16)body.angularVelocity.scale(16/spin,body.angularVelocity);}
    // Strong gravity needs shorter rigid steps to keep thin plates stable.
    // The membrane still advances once at its original fixed timestep.
    const substeps=Math.max(1,Math.ceil(Math.sqrt(-world.gravity.y/RIGID_BODY_GRAVITY)));
    world.solver.iterations=18*substeps;
    for(let i=0;i<substeps;i++){
      for(const {body} of active.values())body.force.set(0,-body.mass*world.gravity.y,0);
      world.step(CAFE_STEP/substeps);
    }
    contacts=world.contacts.filter(c=>(c.bi.collisionFilterGroup|c.bj.collisionFilterGroup)&CLOTH).length;
    if(soft&&!staticSoft){
      const invRotation=softRotation.clone().invert();
      for(const proxy of active.values()){
        if(!proxy.weight)continue;
        const {body,sample}=proxy;
        samplePosition.set(body.position.x,body.position.y,body.position.z).sub(proxy.position).applyQuaternion(invRotation);
        sampleVelocity.set(body.velocity.x,body.velocity.y,body.velocity.z).sub(proxy.velocity).applyQuaternion(invRotation);
        for(const id of sample.ids){
          const factor=soft.mobility[id]/(sample.ids.length*proxy.weight),j=id*3;
          soft.positions[j]+=samplePosition.x*factor;soft.positions[j+1]+=samplePosition.y*factor;soft.positions[j+2]+=samplePosition.z*factor;
          soft.velocities[j]+=sampleVelocity.x*factor;soft.velocities[j+1]+=sampleVelocity.y*factor;soft.velocities[j+2]+=sampleVelocity.z*factor;
        }
      }
    }
  }
  function sync(){
    cafe.group.updateWorldMatrix(true,false);cafe.group.getWorldQuaternion(parentRotation);parentRotation.invert();
    for(const e of entries){
      rotation.set(e.body.quaternion.x,e.body.quaternion.y,e.body.quaternion.z,e.body.quaternion.w);
      localOffset.copy(e.com).applyQuaternion(rotation);worldOrigin.set(e.body.position.x,e.body.position.y,e.body.position.z).sub(localOffset);
      cafe.group.worldToLocal(worldOrigin);e.object.position.copy(worldOrigin);e.object.quaternion.copy(parentRotation).multiply(rotation);e.object.updateMatrixWorld(true);
    }
    for(const {mesh,owner} of cafe.contactShadows??[]){const e=byObject.get(owner);e.body.updateAABB();mesh.position.set(owner.position.x,.006,owner.position.z);mesh.visible=e.body.aabb.lowerBound.y-floorY<.2;}
  }
  function setFriction(value){
    const {friction}=validateRigidBody({friction:value});
    if(world.defaultContactMaterial.friction===friction)return;
    world.defaultContactMaterial.friction=friction;
    for(const {body} of entries)body.wakeUp();
  }
  function grabForce(entry){return entry.body.mass*Math.max(180,-world.gravity.y*4);}
  function setGravity(value){
    validateRigidBody({gravity:value});if(world.gravity.y===-value)return;
    world.gravity.set(0,-value,0);
    for(const {body} of entries)body.wakeUp();
    if(drag)for(const equation of drag.constraint.equations){equation.maxForce=grabForce(drag.entry);equation.minForce=-equation.maxForce;}
  }
  function grab(id,point){
    release();const entry=entries[id];if(!entry)return false;
    const anchor=new C.Body({mass:0,collisionFilterGroup:0,collisionFilterMask:0});anchor.position.copy(cv(point));world.addBody(anchor);
    const pivot=entry.body.pointToLocalFrame(cv(point));
    const constraint=new C.PointToPointConstraint(entry.body,pivot,anchor,new C.Vec3(),grabForce(entry));
    constraint.collideConnected=false;for(const equation of constraint.equations)equation.setSpookParams(1e6,4,CAFE_STEP);
    world.addConstraint(constraint);entry.body.wakeUp();drag={entry,anchor,constraint,target:cv(point)};return true;
  }
  function release(cancel=false){if(!drag)return;world.removeConstraint(drag.constraint);world.removeBody(drag.anchor);
    if(cancel){drag.entry.body.velocity.setZero();drag.entry.body.angularVelocity.setZero();}drag=undefined;}
  setFloor(cafe.group.position.y);
  return {world,entries,grab,release,reset,setFloor,setGravity,setFriction,sync,
    moveGrab(point){if(drag)drag.target.copy(cv(point));},
    get grabbed(){return drag?.entry??null;},get diagnostics(){return {bodies:entries.length,colliders:entries.map(e=>e.body.shapes.length),proxies:active.size,softContacts:contacts};},
    step(dt,views,camera,groundY){if(disposed||!Number.isFinite(dt)||dt<=0)return false;bindSoft(views);accumulator+=Math.min(dt,CAFE_STEP*8);let count=0;
      while(accumulator+1e-12>=CAFE_STEP&&count<8){
        if(views?.softBody?.settings.enabled)views.stepSoftBody(CAFE_STEP,camera,groundY,true);else runWorld(views,true);
        accumulator-=CAFE_STEP;count++;
      }
      if(count){sync();views?.syncSoftBody();}return count>0;
    },
    dispose(){if(disposed)return;disposed=true;release(true);boundSoft?.setCollisionHandler(null);clearProxies();for(const body of [...world.bodies])world.removeBody(body);},
  };
}
