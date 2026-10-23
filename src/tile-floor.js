import { BufferGeometry, Color, DataTexture, Float32BufferAttribute, InstancedMesh, LinearFilter, LinearMipmapLinearFilter, Matrix4, Mesh, MeshPhysicalMaterial, PlaneGeometry, RepeatWrapping, SRGBColorSpace } from 'three';

const FLOOR_SIZE = 200, TEXTURE_SIZE = 128, MAX_TILES_PER_SIDE = 128;
const TILE_LUMINANCE = new Color('#f8f8f8').r;

// One flat tile top and four bevels: ten triangles, shared by every instance.
// The unit-height relief is scaled by the saved depth. Tile tops stay at Y=0
// in floor-local coordinates, matching the physical ground; grout is recessed.
function createTileGeometry() {
  const positions = [], indices = [], gap = 1 / TEXTURE_SIZE, bevel = 0.03;
  const corners = (inset, height) => [[inset,inset,height],[1-inset,inset,height],[1-inset,1-inset,height],[inset,1-inset,height]];
  const outer = corners(gap, -1), inner = corners(bevel, 0);
  function face(points) {
    const first = positions.length / 3;
    for (const point of points) positions.push(...point);
    indices.push(first, first+1, first+2, first, first+2, first+3);
  }
  face(inner);
  for (let i=0;i<4;i++) { const j=(i+1)%4;face([outer[i],outer[j],inner[j],inner[i]]); }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));geometry.setIndex(indices);
  geometry.computeVertexNormals();geometry.computeBoundingBox();geometry.computeBoundingSphere();
  return geometry;
}

// A repeating glazed tile with narrow, matte grout. Data textures keep this
// deterministic and require no canvas, image download, or browser to construct.
export function createTileFloor(settings) {
  const textures = Array.from({ length: 2 }, () => {
    const texture = new DataTexture(new Uint8Array(TEXTURE_SIZE * TEXTURE_SIZE * 4), TEXTURE_SIZE, TEXTURE_SIZE);
    texture.wrapS = texture.wrapT = RepeatWrapping;
    texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter;
    texture.generateMipmaps = true; texture.anisotropy = 4;
    return texture;
  });
  const [colorMap, roughnessMap] = textures;
  colorMap.colorSpace = SRGBColorSpace;
  const material = new MeshPhysicalMaterial({ map: colorMap, roughnessMap, roughness: 1, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 1, clearcoatRoughnessMap: roughnessMap, envMapIntensity: 0 });
  const mesh = new Mesh(new PlaneGeometry(FLOOR_SIZE, FLOOR_SIZE), material);
  mesh.rotation.x = -Math.PI / 2; mesh.receiveShadow = true; mesh.name = 'Tile floor'; mesh.layers.enable(1);
  const tileGeometry = createTileGeometry();
  const tileMaterial = new MeshPhysicalMaterial({ metalness: 0, clearcoat: 1, envMapIntensity: 0 });
  const tiles = new InstancedMesh(tileGeometry, tileMaterial, MAX_TILES_PER_SIDE ** 2);
  tiles.name = 'Beveled tile relief';tiles.receiveShadow = true;tiles.layers.enable(1);mesh.add(tiles);
  const transform = new Matrix4();
  let tileSize, roughness, depth, placement = '';
  function updatePosition(position = mesh.position) {
    mesh.position.copy(position);
    const origin = -tileSize / 2;
    // Align tile UVs with world X/Z even when the plane moves in 20-unit steps.
    for (const texture of textures) {
      texture.repeat.set(FLOOR_SIZE / tileSize, FLOOR_SIZE / tileSize);
      texture.offset.set(((position.x - origin - FLOOR_SIZE / 2) / tileSize) % 1, ((-position.z + origin - FLOOR_SIZE / 2) / tileSize) % 1);
      texture.updateMatrix();
    }
    const nextPlacement = `${position.x},${position.z},${tileSize},${depth}`;
    if (placement === nextPlacement) return;
    placement = nextPlacement;
    // Bound the detail cost at 164k triangles. Outside this patch the textured
    // base continues to the edge of the 200-unit ground plane.
    const side = Math.min(MAX_TILES_PER_SIDE, Math.floor(FLOOR_SIZE / tileSize));
    // Center a tile at the world origin, matching the info frame's half-tile offset.
    const startX = Math.floor((position.x - origin) / tileSize) - Math.floor(side / 2);
    const startY = Math.floor((-position.z + origin) / tileSize) - Math.floor(side / 2);
    tiles.count = side * side;tiles.visible = depth > 0;
    transform.makeScale(tileSize, tileSize, depth);
    for (let y=0;y<side;y++) for (let x=0;x<side;x++) {
      transform.setPosition((startX+x)*tileSize+origin-position.x, (startY+y)*tileSize-origin+position.z, 0);
      tiles.setMatrixAt(y*side+x, transform);
    }
    tiles.instanceMatrix.needsUpdate = true;tiles.computeBoundingBox();tiles.computeBoundingSphere();
  }
  function configure(value) {
    const depthChanged = depth !== value.depth;
    material.color.set(value.color); tileSize = value.tileSize;
    tileMaterial.color.copy(material.color).multiplyScalar(TILE_LUMINANCE);
    tileMaterial.roughness = tileMaterial.clearcoatRoughness = value.roughness;
    if (depth !== value.depth) {
      depth = value.depth;
      const position = mesh.geometry.attributes.position;
      for (let i=0;i<position.count;i++) position.setZ(i, -depth);
      position.needsUpdate = true;mesh.geometry.computeBoundingBox();mesh.geometry.computeBoundingSphere();
    }
    if (roughness !== value.roughness || depthChanged) {
      roughness = value.roughness;
      for (let y = 0; y < TEXTURE_SIZE; y++) for (let x = 0; x < TEXTURE_SIZE; x++) {
        const grout = depth > 0 && Math.min(x, y, TEXTURE_SIZE - 1 - x, TEXTURE_SIZE - 1 - y) < 1;
        const colors = [grout ? 170 : 248, Math.round(255 * (grout ? 0.95 : roughness))];
        for (let i = 0; i < textures.length; i++) {
          const at = (y * TEXTURE_SIZE + x) * 4, data = textures[i].image.data;
          data[at] = data[at + 1] = data[at + 2] = colors[i]; data[at + 3] = 255;
        }
      }
      for (const texture of textures) texture.needsUpdate = true;
    }
    updatePosition();
  }
  configure(settings);
  return { mesh, configure, updatePosition,
    dispose() { mesh.removeFromParent();tiles.dispose();tileGeometry.dispose();tileMaterial.dispose();mesh.geometry.dispose(); material.dispose(); for (const texture of textures) texture.dispose(); },
  };
}
