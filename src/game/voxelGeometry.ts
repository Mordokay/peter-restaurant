import { Color4, Mesh, Scene, StandardMaterial, VertexData } from "@babylonjs/core";

export interface VoxelCell {
  x: number;
  y: number;
  z: number;
  color: string;
}

const faceDefinitions = [
  { neighbor: [1, 0, 0], normal: [1, 0, 0], corners: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]] },
  { neighbor: [-1, 0, 0], normal: [-1, 0, 0], corners: [[0, 0, 1], [0, 1, 1], [0, 1, 0], [0, 0, 0]] },
  { neighbor: [0, 1, 0], normal: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]] },
  { neighbor: [0, -1, 0], normal: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]] },
  { neighbor: [0, 0, 1], normal: [0, 0, 1], corners: [[1, 0, 1], [1, 1, 1], [0, 1, 1], [0, 0, 1]] },
  { neighbor: [0, 0, -1], normal: [0, 0, -1], corners: [[0, 0, 0], [0, 1, 0], [1, 1, 0], [1, 0, 0]] },
] as const;

export function visibleVoxelFaceCount(cells: readonly VoxelCell[]): number {
  const occupied = new Set(cells.map((cell) => `${cell.x},${cell.y},${cell.z}`));
  let faces = 0;
  for (const cell of cells) {
    for (const face of faceDefinitions) {
      const [dx, dy, dz] = face.neighbor;
      if (!occupied.has(`${cell.x + dx},${cell.y + dy},${cell.z + dz}`)) faces++;
    }
  }
  return faces;
}

/** Babylon's default left-handed scenes treat clockwise triangles as front-facing. */
export function clockwiseQuadIndices(vertexStart: number): number[] {
  return [
    vertexStart,
    vertexStart + 2,
    vertexStart + 1,
    vertexStart,
    vertexStart + 3,
    vertexStart + 2,
  ];
}

/** One exposed rectangle of same-colored, coplanar voxel faces. `face` indexes
 * faceDefinitions; `slice` is the cell coordinate along the face normal axis;
 * u/v are inclusive cell ranges along the two in-plane axes (ascending axis order). */
export interface VoxelQuad {
  face: number;
  slice: number;
  u0: number;
  u1: number;
  v0: number;
  v1: number;
  color: string;
}

/** Greedy meshing: exposed faces are grouped per plane and merged into the
 * largest same-color rectangles. Flat surfaces and coarse voxel blocks (boxes
 * of identical fine cells) collapse to a handful of quads, which keeps the
 * triangle budget honest without changing the rendered picture — every quad is
 * flat-shaded with one color and the same normal it had as separate faces. */
export function mergedVoxelQuads(cells: readonly VoxelCell[], solid?: (x: number, y: number, z: number) => boolean): VoxelQuad[] {
  // `solid` answers "is there a voxel here?" for the exposure test; it lets a
  // chunk of a larger body hide the faces that touch neighbouring chunks.
  const occupied = solid ? null : new Set(cells.map((cell) => `${cell.x},${cell.y},${cell.z}`));
  const isSolid = solid ?? ((x: number, y: number, z: number) => occupied!.has(`${x},${y},${z}`));
  const quads: VoxelQuad[] = [];
  for (const [faceIndex, face] of faceDefinitions.entries()) {
    const [dx, dy, dz] = face.neighbor;
    const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
    const [axisU, axisV] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    // slice -> "u,v" -> color, for every exposed face in this direction.
    const planes = new Map<number, Map<string, { u: number; v: number; color: string }>>();
    for (const cell of cells) {
      if (isSolid(cell.x + dx, cell.y + dy, cell.z + dz)) continue;
      const coordinates = [cell.x, cell.y, cell.z];
      const slice = coordinates[axis]!;
      let plane = planes.get(slice);
      if (!plane) planes.set(slice, (plane = new Map()));
      const u = coordinates[axisU]!;
      const v = coordinates[axisV]!;
      plane.set(`${u},${v}`, { u, v, color: cell.color });
    }
    for (const [slice, plane] of [...planes.entries()].sort((a, b) => a[0] - b[0])) {
      const done = new Set<string>();
      const entries = [...plane.values()].sort((a, b) => (a.v - b.v) || (a.u - b.u));
      const matches = (u: number, v: number, color: string): boolean => {
        const key = `${u},${v}`;
        return !done.has(key) && plane.get(key)?.color === color;
      };
      for (const start of entries) {
        if (done.has(`${start.u},${start.v}`)) continue;
        let width = 1;
        while (matches(start.u + width, start.v, start.color)) width++;
        let height = 1;
        let growing = true;
        while (growing) {
          for (let du = 0; du < width; du++) {
            if (!matches(start.u + du, start.v + height, start.color)) { growing = false; break; }
          }
          if (growing) height++;
        }
        for (let dv = 0; dv < height; dv++) for (let du = 0; du < width; du++) done.add(`${start.u + du},${start.v + dv}`);
        quads.push({ face: faceIndex, slice, u0: start.u, u1: start.u + width - 1, v0: start.v, v1: start.v + height - 1, color: start.color });
      }
    }
  }
  return quads;
}

export function createTomatoCells(): VoxelCell[] {
  const cells: VoxelCell[] = [];
  for (let y = -7; y <= 7; y++) {
    const vertical = (y + 0.55) / 7.55;
    if (Math.abs(vertical) > 1) continue;
    for (let x = -10; x <= 10; x++) {
      for (let z = -10; z <= 10; z++) {
        const angle = Math.atan2(z, x);
        const lobeRadius = 9.15 * (1 + 0.055 * Math.cos(angle * 6));
        const horizontal = Math.hypot(x, z) / Math.max(0.01, lobeRadius);
        const topDimple = y >= 5 ? Math.max(0, 2.2 - Math.hypot(x, z)) * 0.045 : 0;
        const shoulder = y >= 2 && y <= 5 ? -0.035 : 0;
        if (horizontal * horizontal + vertical * vertical + topDimple + shoulder > 1) continue;
        const light = x - z + y * 0.65;
        const color = light > 6 ? "#f16a57" : light < -6 ? "#a72e29" : light > 1 ? "#df4f40" : "#c83d35";
        cells.push({ x, y, z, color });
      }
    }
  }
  const leaf = "#4f863d";
  const leafLight = "#6ba64f";
  const crown = [
    [0, 0], [1, 0], [-1, 0], [0, 1], [0, -1],
    [2, 0], [3, 0], [-2, 0], [-3, 0], [0, 2], [0, 3], [0, -2], [0, -3],
    [1, 1], [-1, -1], [2, 2], [-2, -2], [1, -1], [-1, 1], [2, -2], [-2, 2],
  ] as const;
  for (const [x, z] of crown) {
    cells.push({ x, y: 7, z, color: Math.abs(x) + Math.abs(z) > 2 ? leafLight : leaf });
  }
  cells.push({ x: 0, y: 8, z: 0, color: leaf });
  cells.push({ x: 0, y: 9, z: 0, color: leaf });
  cells.push({ x: 0, y: 10, z: 0, color: leafLight });
  return cells;
}

/** `inflate` grows every cube around its own center (0.03 = 3%) without
 * moving cell centers — for overlays that must sit exactly on the model. */
export function createVoxelMesh(name: string, cells: readonly VoxelCell[], pitch: number, scene: Scene, options: { inflate?: number; material?: StandardMaterial; solid?: (x: number, y: number, z: number) => boolean } = {}): Mesh {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const colors: number[] = [];
  const half = pitch * 0.5;
  const grow = pitch * 0.5 * (options.inflate ?? 0);

  for (const quad of mergedVoxelQuads(cells, options.solid)) {
    const face = faceDefinitions[quad.face]!;
    const [dx, dy] = face.neighbor;
    const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
    const [axisU, axisV] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    const color = Color4.FromHexString(`${quad.color}ff`);
    const vertexStart = positions.length / 3;
    for (const corner of face.corners) {
      // Same corner pattern as a single cell, stretched over the merged
      // rectangle: a 0 picks the low edge, a 1 the high edge (+1 cell).
      const coordinate = [0, 0, 0];
      coordinate[axis] = quad.slice + corner[axis];
      coordinate[axisU] = corner[axisU] ? quad.u1 + 1 : quad.u0;
      coordinate[axisV] = corner[axisV] ? quad.v1 + 1 : quad.v0;
      // Each corner moves outward by `grow` along the axes where it sits on
      // the high (1) or low (0) side of the merged rectangle.
      const outward = [corner[0] ? grow : -grow, corner[1] ? grow : -grow, corner[2] ? grow : -grow];
      positions.push(
        coordinate[0]! * pitch - half + outward[0]!,
        coordinate[1]! * pitch - half + outward[1]!,
        coordinate[2]! * pitch - half + outward[2]!,
      );
      normals.push(...face.normal);
      colors.push(color.r, color.g, color.b, color.a);
    }
    indices.push(...clockwiseQuadIndices(vertexStart));
  }

  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.indices = indices;
  vertexData.colors = colors;
  vertexData.applyToMesh(mesh);
  mesh.material = options.material ?? createVoxelMaterial(`${name} vertex material`, scene);
  mesh.useVertexColors = true;
  return mesh;
}

/** The flat vertex-colored material every voxel mesh uses; share one instance
 * across meshes that are rebuilt often so no shader has to be re-prepared. */
export function createVoxelMaterial(name: string, scene: Scene): StandardMaterial {
  const material = new StandardMaterial(name, scene);
  material.diffuseColor.set(1, 1, 1);
  material.specularColor.set(0.08, 0.08, 0.08);
  return material;
}

export interface BlendCell { x: number; y: number; z: number; colorA: string; colorB: string }

/** Mesh for voxels that exist in two states with (possibly) different colours:
 * quads merge where BOTH colours agree, the colour buffer is updatable, and
 * the two colour arrays let the caller lerp between them every frame. */
export function createBlendVoxelMesh(name: string, cells: readonly BlendCell[], pitch: number, scene: Scene, options: { material?: StandardMaterial; solid?: (x: number, y: number, z: number) => boolean } = {}): { mesh: Mesh; colorsA: Float32Array; colorsB: Float32Array } {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  const colorsA: number[] = [];
  const colorsB: number[] = [];
  const half = pitch * 0.5;
  const keyed = cells.map((cell) => ({ x: cell.x, y: cell.y, z: cell.z, color: `${cell.colorA}|${cell.colorB}` }));
  for (const quad of mergedVoxelQuads(keyed, options.solid)) {
    const face = faceDefinitions[quad.face]!;
    const [dx, dy] = face.neighbor;
    const axis = dx !== 0 ? 0 : dy !== 0 ? 1 : 2;
    const [axisU, axisV] = axis === 0 ? [1, 2] : axis === 1 ? [0, 2] : [0, 1];
    const [hexA, hexB] = quad.color.split("|");
    const a = Color4.FromHexString(`${hexA}ff`);
    const b = Color4.FromHexString(`${hexB}ff`);
    const vertexStart = positions.length / 3;
    for (const corner of face.corners) {
      const coordinate = [0, 0, 0];
      coordinate[axis] = quad.slice + corner[axis];
      coordinate[axisU] = corner[axisU] ? quad.u1 + 1 : quad.u0;
      coordinate[axisV] = corner[axisV] ? quad.v1 + 1 : quad.v0;
      positions.push(coordinate[0]! * pitch - half, coordinate[1]! * pitch - half, coordinate[2]! * pitch - half);
      normals.push(...face.normal);
      colorsA.push(a.r, a.g, a.b, 1);
      colorsB.push(b.r, b.g, b.b, 1);
    }
    indices.push(...clockwiseQuadIndices(vertexStart));
  }
  const mesh = new Mesh(name, scene);
  const vertexData = new VertexData();
  vertexData.positions = positions;
  vertexData.normals = normals;
  vertexData.indices = indices;
  vertexData.colors = colorsA.slice();
  vertexData.applyToMesh(mesh, true);
  mesh.material = options.material ?? createVoxelMaterial(`${name} vertex material`, scene);
  mesh.useVertexColors = true;
  return { mesh, colorsA: new Float32Array(colorsA), colorsB: new Float32Array(colorsB) };
}
