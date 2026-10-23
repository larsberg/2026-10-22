// A shared-vertex wall in XY, centered at the origin and facing +Z.
export function createPlaneMesh({ width = 8, height = 6, widthSegments = 12, heightSegments = 9 } = {}) {
  if (![width, height].every(value => Number.isFinite(value) && value > 0))
    throw new Error('Plane width and height must be positive finite numbers.');
  for (const [label, value] of [['Width', widthSegments], ['Height', heightSegments]])
    if (!Number.isInteger(value) || value < 1 || value > 64)
      throw new Error(`${label} subdivisions must be an integer from 1 to 64.`);
  const vertices = [], faces = [];
  for (let row = 0; row <= heightSegments; row++) for (let column = 0; column <= widthSegments; column++)
    vertices.push([-width / 2 + width * column / widthSegments, -height / 2 + height * row / heightSegments, 0]);
  for (let row = 0; row < heightSegments; row++) for (let column = 0; column < widthSegments; column++) {
    const a = row * (widthSegments + 1) + column;
    faces.push([a, a + 1, a + widthSegments + 2, a + widthSegments + 1]);
  }
  return { vertices, faces, kind: 'plane', width, height, widthSegments, heightSegments };
}
