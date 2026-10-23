import { createSeededRandom } from './mesh-layers.js';
import { fitMeshShadows } from './mesh-shadows.js';
import { createMeshView } from './mesh-view.js';
import { createPinNoise } from './pin-noise.js';
import { createPlaneMesh } from './plane-mesh.js';
import { createStartupGate } from "./startup.js";
import { bindThumbnailCapture } from "./thumbnail-controls.js";
import { bindRecordingControls } from './recording-controls.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFaceMetal, createStudioEnvironment } from './face-metal.js';
import { bindFocusPlayback } from './focus-playback.js';
import { createMarchAudio } from './march-audio.js';
import { createBassHitDetector } from './bass-hits.js';
import { createRawScore } from './raw-score.js';
import { bindAudioAutoplay } from './audio-autoplay.js';
import { createCompositionPalette } from './composition-palette.js';
import { createMusicalLighting } from './musical-lighting.js';
import Stats from 'three/addons/libs/stats.module.js';
import { meshControlsMarkup, bindMeshControls } from './mesh-controls.js';
import { defaultMeshSetup, mergeMeshSetup, requestMeshSetup } from './mesh-settings.js';
import { bindMaterialControls } from './material-controls.js';
import { bindLightingControls } from './lighting-controls.js';
import { bindInfoControls } from './info-controls.js';
import { createTextProp } from './materials.js';
import { createSceneEffects, configureSceneFog } from './scene-effects.js';
import { createTileFloor } from './tile-floor.js';
import { createCafeSetting } from './cafe-setting.js';
import { createCafePhysics } from './cafe-physics.js';
import { bindCafeGrab } from './cafe-grab.js';
import { applyCameraView, captureCameraOrbit, captureCameraView, configureOrbitInputs, stopCameraMotion, createCameraFollow, constrainCameraToFloor } from './camera.js';
import './style.css';
import './mesh-style.css';

export async function mountMesh(root,{ui=false}={}) {
  const startup = createStartupGate(root);
  const shell=document.createElement('section');shell.className='sketch';
  shell.innerHTML=meshControlsMarkup();
  root.append(shell);
  let settings=defaultMeshSetup(),startupError;
  const ready = startup.load(async () => {
    try{settings=await requestMeshSetup('GET',undefined,AbortSignal.timeout(5000));}
    catch(error){startupError=error.message;}
  });
  await ready;
  const renderer=new THREE.WebGLRenderer({antialias:false,alpha:false});
  renderer.setPixelRatio(Math.min(devicePixelRatio,matchMedia('(pointer: coarse)').matches?1.5:2));renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
  renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.1;
  renderer.domElement.className='scene-canvas';renderer.domElement.tabIndex=0;
  renderer.domElement.setAttribute('aria-label','Surface study. Drag to orbit; scroll or pinch to zoom.');
  shell.prepend(renderer.domElement);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#000000');
  const camera=new THREE.PerspectiveCamera(42,1,0.1,1000);camera.position.set(6.2,4.9,9.2);
  const controls=new OrbitControls(camera,renderer.domElement);controls.target.set(0,1.9,0);controls.enableDamping=true;controls.maxDistance=400;controls.minPolarAngle=THREE.MathUtils.degToRad(0.1);controls.maxPolarAngle=THREE.MathUtils.degToRad(179.9);configureOrbitInputs(controls);
  let orbitDragging=false;
  // Wheel zoom also emits start/end, but has no active pointer-drag state.
  const startOrbit=()=>{orbitDragging=controls.state>=0;if(orbitDragging)stopCameraForDrag();},endOrbit=()=>{orbitDragging=false;};
  controls.addEventListener('start',startOrbit);controls.addEventListener('end',endOrbit);
  const environment=createStudioEnvironment(renderer,settings.lighting.environment);
  const hemisphere=new THREE.HemisphereLight('#fffbee','#a1a99c',2);scene.add(hemisphere);
  const sun=new THREE.DirectionalLight('#fff5dc',3.3);sun.position.set(-3,7,4);sun.castShadow=true;sun.shadow.mapSize.set(2048,2048);Object.assign(sun.shadow.camera,{left:-6,right:6,top:7,bottom:-5,near:0.5,far:100});sun.shadow.bias=-0.0003;sun.shadow.normalBias=0.025;sun.shadow.radius=3;scene.add(sun,sun.target);
  const spotlight=new THREE.SpotLight();spotlight.name='Following spotlight';spotlight.castShadow=true;spotlight.shadow.mapSize.set(2048,2048);spotlight.shadow.camera.near=.1;spotlight.shadow.camera.far=100;scene.add(spotlight,spotlight.target);
  const tileFloor=createTileFloor(settings.floor),floor=tileFloor.mesh;scene.add(floor);
  const cafeSetting=createCafeSetting(environment.texture);scene.add(cafeSetting.group);
  cafeSetting.configure(-settings.mesh.height/2,settings.lighting.environment);
  const cafePhysics=createCafePhysics(cafeSetting,settings.rigidBody);
  const meshMaterial=createFaceMetal();meshMaterial.envMap=environment.texture;
  const pinNoise=createPinNoise(renderer),views=createMeshView(scene,meshMaterial,pinNoise);
  pinNoise.configure(settings.pinNoise);
  const textProp=createTextProp(Math.min(4,renderer.capabilities.getMaxAnisotropy()),1024);
  textProp.material.envMap=environment.texture;
  textProp.mesh.rotation.x=-Math.PI/2;textProp.mesh.position.set(0,0.015,0);scene.add(textProp.mesh);
  const effects=createSceneEffects(renderer,scene,camera,{clampBeauty:false});
  function renderScene(){constrainCameraToFloor(camera,controls,floor.position.y);effects.render();}
  let running=true,disposed=false,last=0,dirty=true,statsTime=0,frameMs=16.67;
  let panel,lightingControls,stats,focus,cafeGrab,applyingCamera=false,setupBusy=false;
  const audioStatus=shell.querySelector('.march-audio-status');
  const composition=createRawScore();
  const marchAudio=createMarchAudio({pattern:composition,canPlay:()=>running&&!document.hidden,onStatus:message=>{audioStatus.textContent=message;}});
  const bassHits=createBassHitDetector();
  const recording=bindRecordingControls(shell,renderer.domElement,marchAudio);
  const paletteMotion=createCompositionPalette({environment,scene,sun,hemisphere,spotlight,lighting:settings.lighting});
  const musicalLighting=createMusicalLighting(environment,settings.lighting.environment);
  const setupAbort=new AbortController(),followTarget=new THREE.Vector3(),worldOrigin=new THREE.Vector3();
  const groupCenter=()=>views.getCenter(followTarget);
  const cameraFollow=createCameraFollow(groupCenter()),follow=cameraFollow.position;
  const markChanged=()=>panel?.status('Unsaved changes');
  const materialControls=bindMaterialControls(shell,{mesh:meshMaterial,text:textProp.material},()=>{
    lightingControls?.refreshEnvironment();dirty=true;markChanged();
  });
  lightingControls=bindLightingControls(shell,sun,hemisphere,{mesh:meshMaterial,text:textProp.material},materialControls.get,markChanged,effects.configure,
    lighting=>{
      paletteMotion.configure(lighting);
      musicalLighting.configure(lighting.environment);
      settings.fog.color=lighting.environment.backgroundColor;panel?.set(settings,'fog');
      meshMaterial.envMap=textProp.material.envMap=environment.texture;
      cafeSetting.configure(floor.position.y,lighting.environment);
      cafePhysics.setFloor(floor.position.y);
      settings.pinNoise=pinNoise.getSettings();
      views.configure(settings);
    },settings.lighting,spotlight);
  const infoControls=bindInfoControls(shell,info=>{textProp.setInfo(info);markChanged();},message=>panel?.status(message,true));
  const followSuspended=()=>orbitDragging;
  function stopCameraForDrag() {
    applyingCamera=true;
    try{stopCameraMotion(camera,controls);}
    finally{applyingCamera=false;}
  }
  function getSetup() {
    return {...structuredClone(settings),pinNoise:pinNoise.getSettings(),materials:materialControls.get(),lighting:lightingControls.get(),info:infoControls.get(),
      camera:{...settings.camera,...captureCameraOrbit(camera,controls)}};
  }
  function updateCameraControls() {
    constrainCameraToFloor(camera,controls,floor.position.y);
    if(applyingCamera||setupBusy)return;
    const view=captureCameraOrbit(camera,controls);
    if(Object.entries(view).every(([key,value])=>Math.abs(settings.camera[key]-value)<1e-7))return;
    Object.assign(settings.camera,view);
    panel?.set(settings,'camera');markChanged();
  }
  controls.addEventListener('change',updateCameraControls);
  function apply(value) {
    const next=mergeMeshSetup(getSetup(),value);
    if(value.version===undefined&&value.fog?.color!==undefined)next.lighting.environment.backgroundColor=next.fog.color;
    const currentCamera=getSetup().camera;
    const restoringView=value.version!==undefined,followChanged=next.camera.follow!==currentCamera.follow;
    const cameraChanged=restoringView||followChanged||['yaw','elevation','distance','offsetX','offsetY','offsetZ'].some(key=>next.camera[key]!==currentCamera[key]);
    const meshChanged=JSON.stringify(next.mesh)!==JSON.stringify(settings.mesh)||JSON.stringify(next.pipeline)!==JSON.stringify(settings.pipeline);
    settings=next;
    cafePhysics.setGravity(settings.rigidBody.gravity);
    cafePhysics.setFriction(settings.rigidBody.friction);
    pinNoise.configure(settings.pinNoise);
    if(cameraChanged){cameraFollow.reset(groupCenter());}
    if(followChanged&&!restoringView){
      // Switching follow modes keeps the current framing. Only explicit
      // offset edits move the focal point in the newly selected space.
      const view=captureCameraView(camera,controls,settings.camera.follow?follow:worldOrigin);
      for(const key of ['offsetX','offsetY','offsetZ'])
        if(value.camera?.[key]===undefined)settings.camera[key]=view[key];
    }
    marchAudio.configure(settings.audio);
    if(!settings.audio.enabled)audioStatus.textContent='Music paused · enable audio to listen.';
    floor.visible=settings.visibility.ground;
    tileFloor.configure(settings.floor);
    floor.position.y=-settings.mesh.height/2;
    configureSceneFog(scene,settings.fog);
    textProp.alignToTiles(settings.floor.tileSize,settings.infoLayout);
    textProp.mesh.position.y=floor.position.y+0.015;
    textProp.mesh.visible=settings.visibility.text;
    materialControls.set(settings.materials);lightingControls.set(settings.lighting);
    views.configure(settings);
    infoControls.set(settings.info);textProp.setInfo(settings.info);
    if(settings.visibility.fps&&!stats){stats=new Stats();stats.dom.className='frame-rate-meter';stats.dom.style.cssText='position:absolute;top:16px;left:16px;z-index:4;cursor:pointer;opacity:0.9';shell.append(stats.dom);}
    if(!settings.visibility.fps&&stats){stats.dom.remove();stats=undefined;}
    if(cameraChanged){applyingCamera=true;applyCameraView(settings.camera,camera,controls,settings.camera.follow?follow:worldOrigin);applyingCamera=false;}
    camera.fov=settings.camera.fov;camera.updateProjectionMatrix();
    const optimized=settings.camera.optimizedTextures,filtering=optimized?Math.min(4,renderer.capabilities.getMaxAnisotropy()):renderer.capabilities.getMaxAnisotropy();
    textProp.setTextureQuality(Math.min(optimized?1024:4096,renderer.capabilities.maxTextureSize),filtering);
    const shadowSize=Math.min(optimized?1024:4096,renderer.capabilities.maxTextureSize);
    for(const light of [sun,spotlight])if(light.shadow.mapSize.x!==shadowSize){light.shadow.mapSize.set(shadowSize,shadowSize);light.shadow.dispose();light.shadow.map=null;light.shadow.mapPass=null;light.shadow.needsUpdate=true;}
    if(meshChanged||restoringView)regenerate();
    panel?.set(settings);markChanged();dirty=true;return getSetup();
  }
  function play(){if(disposed||focus?.deferPlay())return;running=true;last=0;marchAudio.play();panel?.running(true);}
  function pause(){running=false;marchAudio.pause();panel?.running(false);endDrag();}
  function togglePlayback(){focus.cancelResume();if(running)pause();else play();}
  function reset(){endDrag();cafeGrab.cancel();cafePhysics.reset();pinNoise.resetBassOffset();bassHits.reset();musicalLighting.reset();regenerate();marchAudio.restart();dirty=true;play();}
  async function transferSetup(method) {
    if(disposed)throw new Error('The sketch has been closed.');
    if(setupBusy)throw new Error('A settings request is already in progress.');
    endDrag();
    // Stop pending orbit inertia before capturing the view being saved.
    const damping=controls.enableDamping;controls.enableDamping=false;controls.update();controls.enableDamping=damping;
    const value=method==='PUT'?getSetup():undefined;
    setupBusy=true;controls.enabled=false;panel.busy(true);infoControls.setDisabled(true);
    panel.status(method==='PUT'?'Saving settings…':'Loading settings…');
    try {
      const saved=await requestMeshSetup(method,value,AbortSignal.any([setupAbort.signal,AbortSignal.timeout(5000)]));
      if(disposed)return saved;
      if(method==='GET')apply(saved);
      panel.status(method==='PUT'?(import.meta.env.PROD?'Saved on this device':'Settings saved'):'Settings loaded');
      return saved;
    } catch(error) {
      if(!disposed)panel.status(error.message,true);
      throw error;
    } finally {
      setupBusy=false;
      if(!disposed){controls.enabled=true;panel.busy(false);infoControls.setDisabled(false);}
    }
  }
  function syncMeshStatus() {
    const faceSides = {};
    for (const face of views.topology?.faces ?? []) faceSides[face.length] = (faceSides[face.length] ?? 0) + 1;
    panel?.meshState({ faces: views.topology?.faces.length ?? 0, canUndo: views.canUndo, layers: views.layers.stages, faceSides });
  }
  function meshAction(action) {
    if(setupBusy)return;
    try {
      if(action==='randomize')return apply({pipeline:{seed:(settings.pipeline.seed+1+Math.floor(Math.random()*1000000))%1000001}});
      if(!views.topology)throw new Error('No surface loaded.');
      if(action==='undo')views.undo();
      else if(action==='triangulate')views.triangulate(undefined,{random:createSeededRandom(settings.pipeline.seed)});
      else if(action==='dualDiamond')views.dualDiamond();
      else if(action==='hexelate')views.hexelate({triangulate:settings.pipeline.hexelateTriangulateEnabled});
      else if(action==='dualNSided')views.dualNSided();
      else if(action==='smooth')views.smooth({iterations:settings.pipeline.smoothingIterations,strength:settings.pipeline.smoothingStrength});
      else if(action==='resetSoftBody')views.resetSoftBody();
      else if(action==='resetProps'){cafeGrab.cancel();cafePhysics.reset();}
      else throw new Error('Unknown mesh operation.');
      dirty=true;syncMeshStatus();
      const labels={triangulate:'Faces triangulated',dualDiamond:'Dialate applied',hexelate:'Hexelate applied',dualNSided:'Face-center dual applied',smooth:'Mesh smoothed',resetSoftBody:'Motion reset',resetProps:'Café setting reset',undo:'Mesh edit undone'};
      panel.status(`${labels[action]} · ${views.topology.faces.length} faces`);
      return views.topology;
    }catch(error){panel.status(error.message,true);return null;}
  }
  const saveSetup=()=>transferSetup('PUT'),loadSetup=()=>transferSetup('GET');
  panel=bindMeshControls(shell,{ui,change(value){const previous=getSetup();try{apply(value);}catch(error){apply(previous);panel.status(error.message,true);}},playPause:togglePlayback,reset,
    resetCamera(){apply({camera:defaultMeshSetup().camera});},save:saveSetup,load:loadSetup,meshAction});
  function endDrag(){orbitDragging=false;cafeGrab?.cancel();}
  focus=bindFocusPlayback({isRunning:()=>running,pause,play});
  cafeGrab=bindCafeGrab(renderer.domElement,{camera,controls,physics:cafePhysics,onGrab:()=>{focus.interact();if(!running)play();}});
  const unbindAudio=bindAudioAutoplay({audio:marchAudio,target:document,shouldEnable:()=>false,beforeRetry:()=>focus.interact()});
  let viewportWidth=0,viewportHeight=0;
  function regenerate() {
    endDrag();
    camera.updateMatrixWorld();
    views.setMesh(createPlaneMesh(settings.mesh),settings);dirty=true;syncMeshStatus();
    // Keep the saved orbit centered on the installed surface.
    if(settings.camera.follow){
      const delta=groupCenter().clone().sub(follow);camera.position.add(delta);controls.target.add(delta);
      cameraFollow.reset(groupCenter());controls.update();
    }
    lightingControls.updatePosition(groupCenter());
    for(const light of [sun,spotlight])if(light.visible&&light.castShadow)fitMeshShadows(light,views.surface?.mesh,floor.position.y,cafeSetting.group);
  }
  function resizeViewport(){
    const w=shell.clientWidth,h=shell.clientHeight;
    if(w<=0||h<=0||(w===viewportWidth&&h===viewportHeight))return;
    viewportWidth=w;viewportHeight=h;
    renderer.setSize(w,h);effects.resize(w,h);
    camera.aspect=w/h;camera.zoom=Math.min(1,w/h);camera.updateProjectionMatrix();
    regenerate();
    // Resizing clears the canvas and postprocessing buffers. Repaint before
    // the browser composites this resized frame.
    renderScene();startup.reveal();
  }
  const resize=new ResizeObserver(resizeViewport);resize.observe(shell);
  apply(settings);panel.running(running);
  // Paint the initial wall immediately, even when the shared preview suspends
  // animation frames and ResizeObserver until its editor becomes active.
  resizeViewport();
  if(running)marchAudio.play();
  panel.status(startupError??'Settings loaded',!!startupError);
  renderer.setAnimationLoop(time=>{
    if(disposed)return;
    if(last)frameMs+=(time-last-frameMs)*0.06;
    const dt=last?Math.min((time-last)/1000,0.05):0;last=time;
    if(dirty||time-statsTime>400) {
      const mesh=views.topology;
      panel.stats(mesh?`${Math.round(1000/frameMs)} fps · ${mesh.vertices.length} vertices · ${mesh.faces.length} faces · ${views.edges.length} edges`:'No surface loaded');
      syncMeshStatus();dirty=false;statsTime=time;
      settings.pinNoise=pinNoise.getSettings();panel.set(settings,'pinNoise');
      panel.bassState(pinNoise.bassHits,pinNoise.uniforms.bassOffset.value);
      panel.noiseScaleState(pinNoise.uniforms.scale.value,settings.pinNoise.audioScale);
      lightingControls.musicalState(musicalLighting.levels);
    }
    cameraFollow.update(camera,controls,groupCenter(),settings.camera.follow,followSuspended(),dt,settings.camera.followSmoothing);
    controls.update();
    if(running&&!setupBusy){
      const events=marchAudio.drainEvents();
      const hits=bassHits.update(marchAudio.readBass(),events);
      if(pinNoise.addBassHits(hits))dirty=true;
      pinNoise.updateAudioScale(marchAudio.readHarmonyActivity(),dt);
      musicalLighting.update(dt,marchAudio.readLightingCues(),events);
    }
    pinNoise.update();
    if(running&&!setupBusy)cafePhysics.step(dt,views,camera.position,floor.position.y);
    paletteMotion.update(dt);
    lightingControls.updatePosition(groupCenter());
    for(const light of [sun,spotlight])if(light.visible&&light.castShadow)fitMeshShadows(light,views.surface?.mesh,floor.position.y,cafeSetting.group);
    renderScene();recording.recorder.captureFrame();startup.reveal();stats?.update();
  });
  const thumbnailCapture = import.meta.env.DEV ? bindThumbnailCapture(shell, renderer.domElement, renderScene) : null;
  const api={play,pause(){focus.cancelResume();pause();},reset,setup:apply,getSetup,saveSetup,loadSetup,getState:()=>({running,audio:marchAudio.playing,faces:views.topology?.faces.length??0}),
    editMesh:meshAction,audio:marchAudio,setComposition(pattern){return marchAudio.setPattern(pattern);},paletteMotion,musicalLighting,scene,
    get mesh(){return views;},pinNoise,environment,cafeSetting,cafePhysics,cafeGrab,renderer,camera,controls,recording:recording.recorder,render(){pinNoise.update();renderScene();},
    dispose(){disposed=true;startup.dispose();renderer.setAnimationLoop(null);setupAbort.abort();unbindAudio();recording.dispose();marchAudio.dispose();focus.dispose();resize.disconnect();controls.removeEventListener('start',startOrbit);controls.removeEventListener('end',endOrbit);controls.dispose();panel.dispose();infoControls.dispose();thumbnailCapture?.dispose(); effects.dispose();stats?.dom.remove();
      cafeGrab.dispose();cafePhysics.dispose();views.dispose();pinNoise.dispose();meshMaterial.dispose();tileFloor.dispose();cafeSetting.dispose();
      const geometries=new Set(),materials=new Set();scene.traverse(object=>{if(object.geometry)geometries.add(object.geometry);if(object.material)materials.add(object.material);});
      geometries.delete(textProp.mesh.geometry);materials.delete(textProp.material);textProp.dispose();geometries.forEach(g=>g.dispose());materials.forEach(m=>m.dispose());environment.dispose();sun.shadow.dispose();spotlight.shadow.dispose();renderer.dispose();shell.remove();if(window.__meshSketch===api)delete window.__meshSketch;
    }};
  window.__meshSketch=api;
  api.ready=ready;
  return api;
}
