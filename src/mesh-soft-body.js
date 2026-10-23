import { triangulateFace, validatePolygonMesh } from './mesh-operations.js';

export const softBodyFields = [
  ['enabled', 'Enable soft body', true],
  ['cameraPull', 'Pull toward camera', 6, 0, 30, 0.1],
  ['gravity', 'Gravity', 0, 0, 30, 0.1],
  ['groundFriction', 'Ground friction', 0.45, 0, 1, 0.01],
  ['pinWidth', 'Pin transition width', 1.5, 0.05, 10, 0.05],
  ['pinStrength', 'Edge pin stiffness', 80, 0, 500, 1],
  ['softness', 'Stretch softness', 0.55, 0, 1, 0.01],
  ['bending', 'Bending stiffness', 0.5, 0, 1, 0.01],
  ['restStiffness', 'Rest shape stiffness', 1, 0, 30, 0.1],
  ['damping', 'Motion damping', 3, 0, 20, 0.1],
];
export const softBodyDefaults = Object.fromEntries(softBodyFields.map(([key, , initial]) => [key, initial]));
const STEP = 1 / 120, ITERATIONS = 6;
export const GROUND_CLEARANCE = 0.01;
const keyFor = (a, b) => a < b ? `${a}:${b}` : `${b}:${a}`;

// Surface particles with compliant stretch, bending, and rest-position springs.
// Rendering keeps the original polygon edges; triangulation is internal here.
export function createMeshSoftBody(topology, options = {}) {
  validatePolygonMesh(topology);
  const rest = new Float64Array(topology.vertices.flat()), positions = rest.slice(), previous = rest.slice();
  const velocities = new Float64Array(rest.length), anchorLambda = new Float64Array(rest.length);
  const pinMultipliers = new Float32Array(rest.length/3).fill(1);
  const normalForces = new Float64Array(rest.length/3), restNormals = new Float64Array(rest.length);
  const contactCorrections = new Float64Array(rest.length / 3), groundNormal = [0,1,0];
  const count = topology.vertices.length, boundary = new Uint8Array(count);
  const edgeDistance = new Float64Array(count).fill(Infinity), pinWeights = new Float64Array(count), mobility = new Float64Array(count);
  const polygonEdges = new Map(), triangleEdges = new Map();
  for (const face of topology.faces) {
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length], key = keyFor(a, b), edge = polygonEdges.get(key);
      if (edge) edge.count++;
      else polygonEdges.set(key, { a, b, count: 1 });
    });
    for (const triangle of triangulateFace(topology, face)) {
      const [a,b,c] = triangle.map(id=>id*3);
      const ux=rest[b]-rest[a],uy=rest[b+1]-rest[a+1],uz=rest[b+2]-rest[a+2];
      const vx=rest[c]-rest[a],vy=rest[c+1]-rest[a+1],vz=rest[c+2]-rest[a+2];
      const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      for (const id of triangle) { restNormals[id*3]+=nx;restNormals[id*3+1]+=ny;restNormals[id*3+2]+=nz; }
      triangle.forEach((a, i) => {
        const b = triangle[(i + 1) % 3], opposite = triangle[(i + 2) % 3], key = keyFor(a, b), edge = triangleEdges.get(key);
        if (edge) edge.opposite.push(opposite);
        else triangleEdges.set(key, { a, b, opposite: [opposite] });
      });
    }
  }
  for (let i=0;i<count;i++) {
    const j=i*3,length=Math.hypot(restNormals[j],restNormals[j+1],restNormals[j+2]);
    if (length>1e-12) for (let axis=0;axis<3;axis++) restNormals[j+axis]/=length;
  }
  const rim = [...polygonEdges.values()].filter(edge => edge.count === 1);
  for (const { a, b } of rim) boundary[a] = boundary[b] = 1;
  // Physical distance to the actual rim gives the same gradient at every mesh
  // density, including holes and boundaries on supplied nonrectangular meshes.
  topology.vertices.forEach(([x, y, z], id) => {
    if (boundary[id]) { edgeDistance[id] = 0; return; }
    let nearest = Infinity;
    for (const { a, b } of rim) {
      const [ax, ay, az] = topology.vertices[a], [bx, by, bz] = topology.vertices[b];
      const dx = bx-ax, dy = by-ay, dz = bz-az, lengthSq = dx*dx+dy*dy+dz*dz;
      const t = lengthSq ? Math.max(0, Math.min(1, ((x-ax)*dx+(y-ay)*dy+(z-az)*dz)/lengthSq)) : 0;
      nearest = Math.min(nearest, (x-ax-t*dx)**2+(y-ay-t*dy)**2+(z-az-t*dz)**2);
    }
    edgeDistance[id] = Math.sqrt(nearest);
  });
  const spring = (a, b) => ({ a, b, length: Math.hypot(...[0,1,2].map(axis => rest[a*3+axis]-rest[b*3+axis])), lambda: 0 });
  const edges = [...triangleEdges.values()].map(({ a, b }) => spring(a, b)), bends = [], bendKeys = new Set();
  for (const edge of triangleEdges.values()) if (edge.opposite.length === 2) {
    const [a, b] = edge.opposite, key = keyFor(a, b);
    if (a !== b && !triangleEdges.has(key) && !bendKeys.has(key)) { bends.push(spring(a, b)); bendKeys.add(key); }
  }
  let settings = { ...softBodyDefaults }, accumulator = 0, time = 0, weightsInitialized = false, groundEnabled = false, groundConstant = 0, collisionHandler;
  function reset() {
    positions.set(rest); previous.set(rest); velocities.fill(0); accumulator = time = 0;
  }
  function configure(patch) {
    const next = { ...settings, ...patch };
    for (const [key, label, initial, min, max] of softBodyFields) {
      const value = next[key];
      if (typeof initial === 'boolean' ? typeof value !== 'boolean' : !Number.isFinite(value) || value < min || value > max)
        throw new Error(`Invalid ${label}.`);
    }
    if (next.pinWidth !== settings.pinWidth || !weightsInitialized) {
      for (let i = 0; i < count; i++) {
        const t = Math.min(1, edgeDistance[i] / next.pinWidth);
        mobility[i] = t*t*(3-2*t); pinWeights[i] = 1-mobility[i];
      }
      weightsInitialized = true;
    }
    if (next.enabled !== settings.enabled) reset();
    settings = next;
  }
  function solveDistance(link, compliance) {
    const a = link.a*3, b = link.b*3, wa = mobility[link.a], wb = mobility[link.b];
    if (wa+wb === 0) return;
    const dx = positions[b]-positions[a], dy = positions[b+1]-positions[a+1], dz = positions[b+2]-positions[a+2];
    const length = Math.hypot(dx, dy, dz);
    if (length < 1e-12) return;
    const alpha = compliance / (STEP*STEP), delta = (-(length-link.length)-alpha*link.lambda)/(wa+wb+alpha);
    link.lambda += delta;
    const scale = delta/length;
    positions[a] -= wa*scale*dx; positions[a+1] -= wa*scale*dy; positions[a+2] -= wa*scale*dz;
    positions[b] += wb*scale*dx; positions[b+1] += wb*scale*dy; positions[b+2] += wb*scale*dz;
  }
  function solveGround() {
    if (!groundEnabled) return;
    const [nx,ny,nz] = groundNormal;
    for (let i = 0; i < count; i++) {
      if (!mobility[i]) continue;
      const j = i*3, distance = nx*positions[j]+ny*positions[j+1]+nz*positions[j+2]+groundConstant;
      if (distance >= 0) continue;
      positions[j] -= nx*distance; positions[j+1] -= ny*distance; positions[j+2] -= nz*distance;
      contactCorrections[i] -= distance;
    }
  }
  function substep(camera, gravityDirection) {
    previous.set(positions);
    const decay = Math.exp(-settings.damping*STEP);
    for (let i = 0; i < count; i++) {
      const offset = i*3, w = mobility[i];
      if (!w) continue;
      const dx = camera[0]-positions[offset], dy = camera[1]-positions[offset+1], dz = camera[2]-positions[offset+2];
      const distance = Math.hypot(dx,dy,dz), acceleration = distance > 1e-8 ? settings.cameraPull*w/distance : 0;
      for (let axis = 0; axis < 3; axis++) {
        const direction = axis === 0 ? dx : axis === 1 ? dy : dz;
        const gravity = gravityDirection[axis]*settings.gravity*w;
        const noiseForce = restNormals[offset+axis]*normalForces[i]*w;
        velocities[offset+axis] = velocities[offset+axis]*decay + (direction*acceleration+gravity+noiseForce)*STEP;
        positions[offset+axis] += velocities[offset+axis]*STEP;
      }
    }
    for (const edge of edges) edge.lambda = 0;
    for (const bend of bends) bend.lambda = 0;
    anchorLambda.fill(0);
    contactCorrections.fill(0);
    const stretchCompliance = 0.00001+settings.softness**2*0.002;
    for (let iteration = 0; iteration < ITERATIONS; iteration++) {
      for (const edge of edges) solveDistance(edge, stretchCompliance);
      if (settings.bending > 0) for (const bend of bends) solveDistance(bend, 0.02/settings.bending);
      for (let i = 0; i < count; i++) {
        const w = mobility[i], stiffness = (settings.restStiffness + settings.pinStrength*pinWeights[i]**2)*pinMultipliers[i];
        if (!w || !stiffness) continue;
        const alpha = 1/(stiffness*STEP*STEP);
        for (let axis = 0; axis < 3; axis++) {
          const j = i*3+axis, delta = (-(positions[j]-rest[j])-alpha*anchorLambda[j])/(w+alpha);
          anchorLambda[j] += delta; positions[j] += w*delta;
        }
      }
      // Contact runs last so springs and graded anchors cannot undo it.
      solveGround();
    }
    for (let i = 0; i < count; i++) {
      const j = i*3;
      if (contactCorrections[i] > 0) {
        // Correct a pre-existing penetration without turning recovery into a bounce.
        const distance = groundNormal.reduce((sum,n,axis)=>sum+n*previous[j+axis],groundConstant);
        if (distance < 0) for (let axis=0;axis<3;axis++) previous[j+axis] -= groundNormal[axis]*distance;
      }
      for (let axis = 0; axis < 3; axis++) {
        if (boundary[i]) { positions[j+axis] = rest[j+axis]; velocities[j+axis] = 0; }
        else velocities[j+axis] = (positions[j+axis]-previous[j+axis])/STEP;
      }
      if (contactCorrections[i] > 0) {
        let normalSpeed = groundNormal.reduce((sum,n,axis)=>sum+n*velocities[j+axis],0);
        if (normalSpeed < 0) {
          for (let axis=0;axis<3;axis++) velocities[j+axis] -= groundNormal[axis]*normalSpeed;
          normalSpeed = 0;
        }
        const tangent = [0,1,2].map(axis=>velocities[j+axis]-groundNormal[axis]*normalSpeed), speed = Math.hypot(...tangent);
        const friction = speed > 0 ? Math.min(1,settings.groundFriction*contactCorrections[i]/(STEP*speed)) : 0;
        for (let axis=0;axis<3;axis++) velocities[j+axis] -= tangent[axis]*friction;
      }
    }
    collisionHandler?.(STEP);
    // Rigid contacts run after the internal constraints. Retain exact pins and
    // the floor even when a rigid prop presses down on the membrane.
    if(collisionHandler&&groundEnabled)for(let i=0;i<count;i++){
      if(!mobility[i])continue;
      const j=i*3,distance=groundNormal.reduce((sum,n,a)=>sum+n*positions[j+a],groundConstant);
      if(distance<0){
        const speed=groundNormal.reduce((sum,n,a)=>sum+n*velocities[j+a],0);
        for(let a=0;a<3;a++){positions[j+a]-=groundNormal[a]*distance;if(speed<0)velocities[j+a]-=groundNormal[a]*speed;}
      }
    }
    time += STEP;
  }
  configure(options);
  return { positions, velocities, rest, restNormals, normalForces, boundary, edgeDistance, pinWeights, pinMultipliers, mobility, edges, bends, reset, configure,
    setCollisionHandler(handler){if(handler!==null&&typeof handler!=='function')throw new Error('Expected a collision handler.');collisionHandler=handler;},
    setNormalForces(values) {
      if (values?.length !== count) throw new Error('Normal forces must match the vertex count.');
      for (const value of values) if (!Number.isFinite(value)) throw new Error('Normal forces must be finite.');
      normalForces.set(values);
      for (let i=0;i<count;i++) if (boundary[i]) normalForces[i] = 0;
    },
    setPinMultipliers(values) {
      if (values?.length !== count) throw new Error('Pin multipliers must match the vertex count.');
      for (const value of values) if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Pin multipliers must be finite values from zero to one.');
      pinMultipliers.set(values);
      for (let i=0;i<count;i++) if (boundary[i]) pinMultipliers[i] = 1;
    },
    get settings() { return { ...settings }; },
    get time() { return time; },
    step(dt, camera = [0,0,14], gravityDirection = [0,-1,0], ground = null) {
      if (!settings.enabled || !Number.isFinite(dt) || dt <= 0) return false;
      if (camera.length !== 3 || !camera.every(Number.isFinite)) throw new Error('Camera position must contain three finite coordinates.');
      if (gravityDirection.length !== 3 || !gravityDirection.every(Number.isFinite)) throw new Error('Gravity direction must contain three finite coordinates.');
      groundEnabled = ground !== null;
      if (groundEnabled) {
        if (ground.normal?.length !== 3 || !ground.normal.every(Number.isFinite) || !Number.isFinite(ground.constant)) throw new Error('Ground plane must have a finite normal and constant.');
        const length = Math.hypot(...ground.normal);
        if (!(length > 1e-12)) throw new Error('Ground plane normal must be nonzero.');
        for (let axis=0;axis<3;axis++) groundNormal[axis] = ground.normal[axis]/length;
        groundConstant = ground.constant/length;
      }
      accumulator += Math.min(dt, STEP*8);
      let steps = 0;
      while (accumulator+1e-12 >= STEP && steps < 8) { substep(camera, gravityDirection); accumulator -= STEP; steps++; }
      return steps > 0;
    },
  };
}
