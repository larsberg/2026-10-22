import { DataTexture, DoubleSide, Float32BufferAttribute, FloatType, Mesh, NearestFilter, NoBlending, OrthographicCamera, PlaneGeometry, RGBAFormat, Scene, ShaderMaterial, UnsignedByteType, Vector2, Vector3, Vector4, WebGLRenderTarget } from 'three';
import { pinNoiseDefaults, validatePinNoise } from './pin-noise-settings.js';
import { noiseVolumeGLSL } from './noise-volume.js';

export const pinNoiseFragmentShader = /* glsl */`
uniform sampler2D restPositions;
uniform vec2 atlasSize;
uniform vec3 offset;
uniform vec3 scale;
uniform float amount;
uniform float bassOffset;
uniform sampler2D forceTexture;
uniform vec4 restBounds;
${noiseVolumeGLSL}
void main() {
  vec4 rest = texture2D(restPositions, gl_FragCoord.xy / atlasSize);
  vec3 p = rest.xyz * scale + offset;
  p.z += bassOffset;
  float noise = volumeNoise(p);
  vec2 forceUv = (rest.xy-restBounds.xy)*restBounds.zw;
  vec3 forcePixel = texture2D(forceTexture,forceUv).rgb;
  vec3 product = forcePixel * vec3(noise);
  // RGB is the optional force image × noise image. A retains unmasked noise.
  gl_FragColor = vec4(product,noise);
}
`;

// One GPU texel per rest vertex, read back only when the field changes.
// The resulting atlas feeds CPU anchors, normal forces, and the grayscale preview.
export function createPinNoise(renderer) {
  const uniforms = {
    restPositions: { value: null }, atlasSize: { value: new Vector2(1,1) },
    offset: { value: new Vector3() }, scale: { value: new Vector3(.6,.6,.6) }, amount: { value: 1 },
    bassOffset: { value: 0 },
    forceTexture:{value:null},restBounds:{value:new Vector4(0,0,1,1)},
  };
  const material = new ShaderMaterial({ uniforms, fragmentShader: pinNoiseFragmentShader,
    vertexShader: 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }',
    depthTest: false, depthWrite: false, blending: NoBlending, toneMapped: false });
  const scene = new Scene(), camera = new OrthographicCamera(-1,1,1,-1,0,1), quad = new Mesh(new PlaneGeometry(2,2),material);
  quad.frustumCulled = false;scene.add(quad);
  const white = new DataTexture(new Uint8Array([255,255,255,255]),1,1,RGBAFormat,UnsignedByteType);white.needsUpdate = true;
  uniforms.forceTexture.value=white;
  const preview = new ShaderMaterial({ uniforms: { pinMultiplierTexture: { value: white },restPositions:uniforms.restPositions,amount:uniforms.amount },
    vertexShader: `attribute vec2 pinNoiseUv;uniform sampler2D pinMultiplierTexture;uniform sampler2D restPositions;uniform float amount;varying float pinMultiplier;
      void main(){float fixedBoundary=texture2D(restPositions,pinNoiseUv).a;float rawNoise=texture2D(pinMultiplierTexture,pinNoiseUv).a;pinMultiplier=fixedBoundary>.5?1.:mix(1.,rawNoise,amount);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
    fragmentShader: 'varying float pinMultiplier;void main(){gl_FragColor=vec4(vec3(pinMultiplier),1.0);}',
    side: DoubleSide, toneMapped: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  preview.name = 'Pin multiplier preview';
  const viewport = new Vector4(), scissor = new Vector4();
  let settings = { ...pinNoiseDefaults }, target, source, body, surface, originalMaterial;
  let forceInfluence = 0, textureRevision = 0;
  let audioScaleValue = pinNoiseDefaults.audioScaleMin;
  let pixels = new Uint8Array(), multipliers = new Float32Array(), forces = new Float32Array(), lastKey = '', revision = 0, bassHits = 0, disposed = false;
  function applyPreview() {
    if (surface) surface.material = settings.preview && settings.enabled ? preview : originalMaterial;
  }
  function getSettings() {
    return { ...settings, amount: uniforms.amount.value,
      offsetX: uniforms.offset.value.x, offsetY: uniforms.offset.value.y, offsetZ: uniforms.offset.value.z,
      scaleX: settings.audioScale ? settings.scaleX : uniforms.scale.value.x,
      scaleY: settings.audioScale ? settings.scaleY : uniforms.scale.value.y,
      scaleZ: settings.audioScale ? settings.scaleZ : uniforms.scale.value.z };
  }
  function update(force = false) {
    if (disposed || !body) return false;
    const value = getSettings();validatePinNoise(value);
    const influence=forceInfluence;
    const key = [value.enabled,value.amount,value.forceStrength,value.offsetX,value.offsetY,value.offsetZ,...uniforms.scale.value.toArray(),uniforms.bassOffset.value,textureRevision,uniforms.forceTexture.value.version,forceInfluence].join(',');
    if (!force && key === lastKey) return false;
    if (!value.enabled || (value.amount === 0 && value.forceStrength === 0)) {
      multipliers.fill(1);forces.fill(0);preview.uniforms.pinMultiplierTexture.value = white;
    } else {
      const previousTarget = renderer.getRenderTarget(), cubeFace = renderer.getActiveCubeFace(), mip = renderer.getActiveMipmapLevel();
      const scissorTest = renderer.getScissorTest();renderer.getViewport(viewport);renderer.getScissor(scissor);
      try {
        renderer.setRenderTarget(target);renderer.setViewport(0,0,target.width,target.height);renderer.setScissorTest(false);
        renderer.render(scene,camera);renderer.readRenderTargetPixels(target,0,0,target.width,target.height,pixels);
      } finally {
        renderer.setRenderTarget(previousTarget,cubeFace,mip);renderer.setViewport(viewport);renderer.setScissor(scissor);renderer.setScissorTest(scissorTest);
      }
      for (let i=0;i<multipliers.length;i++) {
        const rawNoise=pixels[i*4+3]/255;
        const product=(pixels[i*4]*.2126+pixels[i*4+1]*.7152+pixels[i*4+2]*.0722)/255;
        multipliers[i] = body.boundary[i]?1:1-value.amount+value.amount*rawNoise;
        forces[i] = body.boundary[i]?0:((1-influence)*(rawNoise*2-1)+influence*product)*value.forceStrength;
      }
      preview.uniforms.pinMultiplierTexture.value = target.texture;
    }
    body.setPinMultipliers(multipliers);body.setNormalForces(forces);lastKey = key;revision++;applyPreview();return true;
  }
  // Caller owns the texture; invalidate after rendering new pixels into it.
  function setForceTexture(texture, influence = 1) {
    if (texture != null && !texture.isTexture) throw new Error('Expected a force texture.');
    if (!Number.isFinite(influence) || influence < 0 || influence > 1) throw new Error('Invalid texture influence.');
    uniforms.forceTexture.value = texture ?? white;forceInfluence = texture == null ? 0 : influence;
    return invalidateForceTexture();
  }
  function invalidateForceTexture() { textureRevision++;return update(true); }
  function addBassHits(count = 1) {
    if (disposed || !Number.isSafeInteger(count) || count <= 0 || !settings.enabled || (uniforms.amount.value === 0 && settings.forceStrength === 0) || settings.bassStep === 0) return false;
    uniforms.bassOffset.value += count * settings.bassStep;bassHits += count;return true;
  }
  function resetBassOffset() { uniforms.bassOffset.value = 0;bassHits = 0; }
  function updateAudioScale(activity, dt) {
    if (disposed || !settings.enabled || !settings.audioScale || !Number.isFinite(dt) || dt <= 0) return false;
    const target = settings.audioScaleMin + (settings.audioScaleMax-settings.audioScaleMin)*Math.max(0,Math.min(1,activity || 0));
    const previous = audioScaleValue;
    audioScaleValue += (target-audioScaleValue)*(1-Math.exp(-dt/(target > audioScaleValue ? .2 : .45)));
    if(Math.abs(target-audioScaleValue)<.0001)audioScaleValue=target;
    uniforms.scale.value.setScalar(audioScaleValue);
    return audioScaleValue !== previous;
  }
  function configure(value) {
    const wasAuto = settings.audioScale;
    settings = validatePinNoise(value);
    uniforms.offset.value.set(settings.offsetX,settings.offsetY,settings.offsetZ);
    if(settings.audioScale){
      audioScaleValue = wasAuto ? Math.max(settings.audioScaleMin,Math.min(settings.audioScaleMax,audioScaleValue)) : settings.audioScaleMin;
      uniforms.scale.value.setScalar(audioScaleValue);
    }else uniforms.scale.value.set(settings.scaleX,settings.scaleY,settings.scaleZ);
    uniforms.amount.value = settings.amount;
    update();applyPreview();
  }
  function unbind() {
    if (surface) surface.material = originalMaterial;
    if (body) body.setNormalForces(new Float32Array(body.normalForces.length));
    body = surface = originalMaterial = undefined;lastKey = '';
  }
  function bind(topology, mesh, softBody) {
    unbind();body = softBody;surface = mesh;originalMaterial = mesh.material;
    const count = body.rest.length/3, width = Math.max(1,Math.ceil(Math.sqrt(count))), height = Math.max(1,Math.ceil(count/width));
    const data = new Float32Array(width*height*4);
    for (let i=0;i<count;i++) { data.set(body.rest.subarray(i*3,i*3+3),i*4);data[i*4+3] = body.boundary[i]; }
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(let i=0;i<count;i++){minX=Math.min(minX,body.rest[i*3]);maxX=Math.max(maxX,body.rest[i*3]);minY=Math.min(minY,body.rest[i*3+1]);maxY=Math.max(maxY,body.rest[i*3+1]);}
    uniforms.restBounds.value.set(minX,minY,1/Math.max(.0001,maxX-minX),1/Math.max(.0001,maxY-minY));
    source?.dispose();source = new DataTexture(data,width,height,RGBAFormat,FloatType);source.minFilter = source.magFilter = NearestFilter;source.needsUpdate = true;
    uniforms.restPositions.value = source;uniforms.atlasSize.value.set(width,height);
    if (!target || target.width !== width || target.height !== height) {
      target?.dispose();target = new WebGLRenderTarget(width,height,{type:UnsignedByteType,format:RGBAFormat,minFilter:NearestFilter,magFilter:NearestFilter,depthBuffer:false,stencilBuffer:false});
      target.texture.generateMipmaps = false;pixels = new Uint8Array(width*height*4);
    }
    multipliers = new Float32Array(count);forces = new Float32Array(count);
    const uvs = topology.faces.flatMap(face=>face.flatMap(id=>[(id%width+.5)/width,(Math.floor(id/width)+.5)/height]));
    mesh.geometry.setAttribute('pinNoiseUv',new Float32BufferAttribute(uvs,2));update(true);
  }
  return { uniforms, setForceTexture, invalidateForceTexture, configure, getSettings, bind, unbind, update, addBassHits, resetBassOffset, updateAudioScale,
    get bassHits() { return bassHits; },
    get texture() { return preview.uniforms.pinMultiplierTexture.value; },
    get multipliers() { return multipliers; },
    get forces() { return forces; },
    get revision() { return revision; },
    dispose() {
      if (disposed) return;disposed = true;unbind();source?.dispose();target?.dispose();white.dispose();material.dispose();preview.dispose();quad.geometry.dispose();
    },
  };
}
