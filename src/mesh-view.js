import { createMeshLayers } from './mesh-layers.js';
import { createMeshSurface } from './mesh-surface.js';
import { createFaceMetal } from './face-metal.js';
import { createMeshSoftBody, GROUND_CLEARANCE } from './mesh-soft-body.js';
import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, LineBasicMaterial, LineSegments, Matrix4, Plane } from 'three';
import { polygonEdges } from './polygon-mesh.js';
import { averageVertices, dualDiamond, dualNSided, triangulateFaces, validatePolygonMesh } from './mesh-operations.js';

export function createMeshView(scene, sharedSurfaceMaterial, pinNoise) {
  const surfaceMaterial = sharedSurfaceMaterial ?? createFaceMetal(); surfaceMaterial.side = DoubleSide;
  surfaceMaterial.polygonOffset = true; surfaceMaterial.polygonOffsetFactor = surfaceMaterial.polygonOffsetUnits = 1;
  let surface, softBody;
  const material = new LineBasicMaterial({ color: '#ffffff' });
  const object = new LineSegments(new BufferGeometry(), material);
  object.name = 'Polygon mesh wireframe'; scene.add(object);
  let base, configured;
  const bounds = new Box3();
  const localCamera = object.position.clone(), localGravity = object.position.clone(), inverseWorld = new Matrix4();
  const cameraCoordinates = [0,0,0], gravityCoordinates = [0,-1,0];
  const groundPlane = new Plane(), groundCoordinates = {normal:[0,1,0],constant:0};
  object.frustumCulled = false;
  let topology, edges = [], generation = 0, layers = { stages: [] };
  const history = [];
  const geometryForEdges = (mesh, values) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(values.flatMap(edge => edge.flatMap(id => mesh.vertices[id])), 3));
    if (values.length) geometry.computeBoundingSphere();
    return geometry;
  };
  function install(next) {
    validatePolygonMesh(next);
    const nextEdges = polygonEdges(next.faces);
    bounds.makeEmpty();
    for (const vertex of next.vertices) bounds.expandByPoint(localCamera.fromArray(vertex));
    const wireframe = geometryForEdges(next, nextEdges);
    pinNoise?.unbind();
    surface?.dispose(); surface = undefined;
    object.geometry.dispose(); object.geometry = wireframe;
    topology = next; edges = nextEdges;
    surface = createMeshSurface(next, surfaceMaterial); object.add(surface.mesh);
    surface.mesh.visible = configured?.visibility.surface !== false;
    softBody = createMeshSoftBody(topology, configured?.softBody ?? { enabled: false });
    pinNoise?.bind(topology,surface.mesh,softBody);
  }
  function updatePositions(positions) {
    surface.update(positions);
    const writeEdges = (geometry, values) => {
      const attribute = geometry.attributes.position;
      let offset = 0;
      for (const edge of values) for (const id of edge) for (let axis = 0; axis < 3; axis++) attribute.array[offset++] = positions[id*3+axis];
      attribute.needsUpdate = true;
    };
    writeEdges(object.geometry, edges);
  }
  function operate(operation) {
    if (!topology) throw new Error('No surface loaded.');
    const result = operation();
    if (result.mesh.faces.length > 50000) throw new Error('This operation exceeds the 50,000-face editing limit.');
    const previous = structuredClone(topology);
    install(result.mesh);
    history.push(previous); if (history.length > 20) history.shift();
    return topology;
  }
  return {
    object,
    getCenter(target) {
      // Follow the pinned frame, avoiding feedback between deformation and pull.
      object.updateWorldMatrix(true, false); return object.localToWorld(bounds.getCenter(target));
    },
    get surface() { return surface; },
    get topology() { return topology; },
    get softBody() { return softBody; },
    get edges() { return edges; },
    get generation() { return generation; },
    get layers() { return layers; },
    get canUndo() { return history.length > 0; },
    setMesh(mesh, settings = configured) {
      validatePolygonMesh(mesh);
      const previous = base;
      base = structuredClone(mesh);
      try { return this.regenerate(undefined, settings); }
      catch (error) { base = previous; throw error; }
    },
    regenerate(camera, settings = configured) {
      if (!base) return;
      const next = createMeshLayers(base, settings?.pipeline ?? { enabled: false });
      configured = settings;
      install(next.mesh); layers = { stages: next.stages };
      history.length = 0; generation++;
      return topology;
    },
    refresh() { if (topology) install(topology); },
    triangulate(ids, options) { return operate(() => triangulateFaces(topology, ids, options)); },
    dualDiamond() { return operate(() => dualDiamond(topology)); },
    hexelate({ triangulate = true } = {}) { return operate(() => dualNSided(triangulate ? triangulateFaces(topology, undefined, { shortestDiagonal: true }).mesh : topology)); },
    dualNSided() { return operate(() => dualNSided(topology)); },
    smooth(options) { return operate(() => averageVertices(topology, undefined, options)); },
    resetSoftBody() { if (softBody) { softBody.reset(); updatePositions(softBody.positions); } },
    syncSoftBody() { if(softBody)updatePositions(softBody.positions); },
    stepSoftBody(dt, cameraPosition, groundY = null, deferRender = false) {
      if (!softBody) return false;
      pinNoise?.update();
      object.updateWorldMatrix(true, false);
      object.worldToLocal(localCamera.copy(cameraPosition)).toArray(cameraCoordinates);
      localGravity.set(0,-1,0).transformDirection(inverseWorld.copy(object.matrixWorld).invert()).toArray(gravityCoordinates);
      if (groundY !== null) {
        if (!Number.isFinite(groundY)) throw new Error('Ground height must be finite.');
        groundPlane.normal.set(0,1,0);groundPlane.constant = -(groundY+GROUND_CLEARANCE);
        groundPlane.applyMatrix4(inverseWorld);groundPlane.normal.toArray(groundCoordinates.normal);groundCoordinates.constant = groundPlane.constant;
      }
      if (!softBody.step(dt, cameraCoordinates, gravityCoordinates, groundY === null ? null : groundCoordinates)) return false;
      if(!deferRender)updatePositions(softBody.positions); return true;
    },
    undo() {
      const previous = history.at(-1); if (!previous) return false;
      install(previous); history.pop(); return true;
    },
    configure(settings) {
      configured = settings;
      pinNoise?.configure(settings.pinNoise);
      material.color.set(settings.appearance.wireframeColor);
      material.visible = settings.visibility.wireframe;
      object.visible = settings.visibility.surface || settings.visibility.wireframe;
      if (surface) { surface.mesh.visible = settings.visibility.surface; surface.configure(); }
      if (softBody) { softBody.configure(settings.softBody ?? { enabled: false }); updatePositions(softBody.positions); }
    },
    dispose() {
      pinNoise?.unbind();
      surface?.dispose(); if (!sharedSurfaceMaterial) surfaceMaterial.dispose();
      object.removeFromParent(); object.geometry.dispose(); material.dispose();
    },
  };
}
