import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { createPlaneMesh } from '../src/plane-mesh.js';
import { createMeshLayers, createSeededRandom } from '../src/mesh-layers.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';
import { applyCameraView } from '../src/camera.js';
import { averageVertices, dualDiamond, dualNSided, faceFrame, triangulateFace, triangulateFaces } from '../src/mesh-operations.js';
import { polygonEdges } from '../src/polygon-mesh.js';
import { createMeshView } from '../src/mesh-view.js';

function checkWall(mesh, width, height) {
  const edges = new Map();
  for (const face of mesh.faces) {
    assert.ok(faceFrame(mesh, face).normal.z > .999999);
    assert.equal(triangulateFace(mesh, face).length, face.length - 2);
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length], key = a < b ? `${a}:${b}` : `${b}:${a}`;
      const list = edges.get(key) ?? []; list.push([a, b]); edges.set(key, list);
    });
  }
  let perimeter = 0;
  for (const list of edges.values()) {
    assert.ok(list.length <= 2);
    if (list.length === 2) { assert.deepEqual(list[0], [...list[1]].reverse()); continue; }
    const [a, b] = list[0].map(id => mesh.vertices[id]);
    assert.ok([[0, -width/2], [0, width/2], [1, -height/2], [1, height/2]].some(([axis, value]) => Math.abs(a[axis]-value)<1e-10 && Math.abs(b[axis]-value)<1e-10));
    perimeter += new Vector3(...a).distanceTo(new Vector3(...b));
  }
  assert.ok(Math.abs(perimeter - 2*(width+height)) < 1e-9);
  assert.equal(mesh.vertices.length - edges.size + mesh.faces.length, 1);
  for (const [x, y, z] of mesh.vertices) {
    assert.equal(z, 0); assert.ok(Math.abs(x) <= width/2 + 1e-10); assert.ok(Math.abs(y) <= height/2 + 1e-10);
  }
}

test('the wall is centered in XY, shares grid vertices, and faces the starting camera', () => {
  const mesh = createPlaneMesh(), setup = defaultMeshSetup();
  assert.equal(mesh.vertices.length, 130); assert.equal(mesh.faces.length, 108);
  assert.equal(new Set(mesh.vertices.map(point => JSON.stringify(point))).size, 130);
  const camera = new PerspectiveCamera(), controls = { target: new Vector3(), update() {} };
  applyCameraView(setup.camera, camera, controls, new Vector3());
  assert.ok(camera.position.distanceTo(new Vector3(0,0,14)) < 1e-10);
  assert.ok(camera.getWorldDirection(new Vector3()).dot(new Vector3(0,0,-1)) > .999999);
  checkWall(mesh, 8, 6);
});

test('the three wall operations run in order and Hexelate produces a majority of hexagons', () => {
  const base = createPlaneMesh(), before = structuredClone(base), setup = defaultMeshSetup();
  const triangles = triangulateFaces(base, undefined, { random: createSeededRandom(setup.pipeline.seed) }).mesh;
  const diamonds = dualDiamond(triangles).mesh;
  const hexagons = dualNSided(triangulateFaces(diamonds, undefined, { shortestDiagonal: true }).mesh).mesh;
  const result = createMeshLayers(base, setup.pipeline);
  assert.deepEqual(result.stages.map(stage => stage.name), ['Random triangulate','Dialate · diamond dual · keep boundary','Hexelate · face-center dual','Smooth mesh · fixed boundary']);
  assert.deepEqual(result.mesh, averageVertices(hexagons, undefined, {iterations:setup.pipeline.smoothingIterations,strength:setup.pipeline.smoothingStrength}).mesh); assert.deepEqual(base, before);
  assert.ok(result.mesh.faces.filter(face => face.length === 6).length / result.mesh.faces.length > .6);
  for (const mesh of [base, triangles, diamonds, hexagons]) checkWall(mesh, 8, 6);
  const oldEdges = new Set(polygonEdges(base.faces).map(edge => [...edge].sort((a,b)=>a-b).join(':')));
  assert.equal(polygonEdges(triangles.faces).filter(edge => !oldEdges.has([...edge].sort((a,b)=>a-b).join(':'))).length, base.faces.length);
});

test('every primary operation combination stays flat and keeps the wall boundary across seeds and sizes', () => {
  for (const dimensions of [{}, {width:3,height:8,widthSegments:3,heightSegments:8}, {width:10,height:3,widthSegments:8,heightSegments:3}, {widthSegments:1,heightSegments:1}]) {
    const base = createPlaneMesh(dimensions);
    for (const seed of [0,1,42,1000000]) for (let mask = 0; mask < 8; mask++) {
      const options = { ...defaultMeshSetup().pipeline, seed, triangulateEnabled: !!(mask&1), initialDiamondDualEnabled: !!(mask&2), hexelateEnabled: !!(mask&4) };
      const first = createMeshLayers(base, options);
      checkWall(first.mesh, base.width, base.height);
      assert.deepEqual(first, createMeshLayers(base, options));
    }
  }
});

test('wall dimensions roundtrip and invalid subdivisions are rejected', () => {
  const setup = mergeMeshSetup(defaultMeshSetup(), {mesh:{width:10,height:4,widthSegments:20,heightSegments:8}});
  assert.deepEqual(validateMeshSetup(setup), setup);
  assert.equal(createPlaneMesh(setup.mesh).faces.length, 160);
  for (const mesh of [{width:0},{height:-1},{widthSegments:0},{widthSegments:65},{heightSegments:1.5}]) {
    assert.throws(() => createPlaneMesh(mesh)); assert.throws(() => mergeMeshSetup(setup, {mesh}));
  }
});

test('manual wall operations undo as a single edit and resetting restores the saved pipeline', () => {
  const setup = defaultMeshSetup(), view = createMeshView(new Scene());
  view.configure(setup); view.setMesh(createPlaneMesh(), setup);
  const original = structuredClone(view.topology);
  view.hexelate(); assert.equal(view.canUndo, true); view.undo(); assert.deepEqual(view.topology, original);
  const plain = mergeMeshSetup(setup, {pipeline:{enabled:false}});
  view.setMesh(createPlaneMesh(), plain); view.dualDiamond(); view.undo(); assert.equal(view.topology.faces.length, 108);
  view.triangulate([0], {random:createSeededRandom(1)}); assert.equal(view.topology.faces.length, 109);
  view.setMesh(createPlaneMesh(), setup); assert.deepEqual(view.topology, original); assert.equal(view.canUndo, false);
  view.dispose();
});
