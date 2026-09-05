// Minimal GLB → OBJ converter: extracts the first mesh primitive, applies the
// full node transform chain, and writes normalized OBJ text (Y up, base at y=0,
// centered on origin, longest horizontal extent mapped to [-1, 1]).
// Usage: node scripts/glb-to-obj.mjs input.glb output.obj
import { readFileSync, writeFileSync } from "node:fs";

const [input, output] = process.argv.slice(2);
if (!input || !output) throw new Error("Usage: node scripts/glb-to-obj.mjs input.glb output.obj");

const buffer = readFileSync(input);
// Copy into a private ArrayBuffer: readFileSync Buffers can sit at a nonzero
// offset inside a shared pool, and typed-array views over .buffer would then
// read a random pool region (garbage indices, run-to-run nondeterminism).
const arrayBuffer = buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
if (new DataView(arrayBuffer).getUint32(0, true) !== 0x46546c67) throw new Error("Not a GLB (bad magic)");
const jsonLength = new DataView(arrayBuffer).getUint32(12, true);
const json = JSON.parse(new TextDecoder().decode(new Uint8Array(arrayBuffer, 20, jsonLength)));
const binaryOffset = 20 + jsonLength + 8;

function view(accessorIndex) {
  const accessor = json.accessors[accessorIndex];
  const bufferView = json.bufferViews[accessor.bufferView];
  const byteOffset = binaryOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const componentType = accessor.componentType; // 5126 = float
  const type = accessor.type;
  const components = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[type];
  const count = accessor.count;
  const floats = new Float32Array(arrayBuffer, byteOffset, count * components);
  return { floats, components, count };
}

// Collect node matrices.
function nodeMatrix(node) {
  const m = new Float32Array(16);
  if (node.matrix) {
    for (let i = 0; i < 16; i++) m[i] = node.matrix[i];
    return m;
  }
  const { scale = [1, 1, 1], rotation = [0, 0, 0, 1], translation = [0, 0, 0] } = node;
  const [x, y, z, w] = rotation;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2, yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const r = [
    1 - (yy + zz), xy - wz, xz + wy,
    xy + wz, 1 - (xx + zz), yz - wx,
    xz - wy, yz + wx, 1 - (xx + yy),
  ];
  // m = T * R * S (column-major, glTF convention)
  m[0] = r[0] * scale[0]; m[1] = r[3] * scale[0]; m[2] = r[6] * scale[0]; m[3] = 0;
  m[4] = r[1] * scale[1]; m[5] = r[4] * scale[1]; m[6] = r[7] * scale[1]; m[7] = 0;
  m[8] = r[2] * scale[2]; m[9] = r[5] * scale[2]; m[10] = r[8] * scale[2]; m[11] = 0;
  m[12] = translation[0]; m[13] = translation[1]; m[14] = translation[2]; m[15] = 1;
  return m;
}

function multiply(a, b) { // a * b, column-major
  const out = new Float32Array(16);
  for (let column = 0; column < 4; column++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[column * 4 + k];
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

const parents = new Map();
(json.nodes ?? []).forEach((node, index) => { for (const child of node.children ?? []) parents.set(child, index); });
function chainMatrix(nodeIndex) {
  const node = json.nodes[nodeIndex];
  const local = nodeMatrix(node);
  const parent = parents.get(nodeIndex);
  return parent === undefined ? local : multiply(chainMatrix(parent), local);
}

// Find the first node with a mesh, following the scene default. An optional
// third CLI arg filters by node-name substring and merges every primitive of
// every matching node (e.g. multi-part staged models: "SM_Tomato_Lv3").
const sceneNodes = (json.scenes ?? [])[json.scene ?? 0]?.nodes ?? (json.nodes ?? []).map((_, i) => i);
const filter = process.argv[4];
const meshNodeIndices = [];
const walk = (indices) => {
  for (const index of indices) {
    const node = json.nodes[index];
    const match = !filter || (node.name ?? "").includes(filter);
    if (match && node.mesh !== undefined) {
      meshNodeIndices.push(index);
    } else {
      // A matching transform node without its own mesh still owns the subtree
      // (staged packs name the stage on the parent, mesh on the child).
      walk(node.children ?? []);
    }
  }
};
walk(sceneNodes);
if (meshNodeIndices.length === 0) throw new Error(filter ? `No mesh node matches "${filter}"` : "No mesh found");

// Transform, then normalize: center x/z, base y at 0, scale so max horizontal extent = 2.
let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
const transformed = [];
const triangleIndices = [];
for (const meshNodeIndex of meshNodeIndices) {
  const world = chainMatrix(meshNodeIndex);
  for (const primitive of json.meshes[json.nodes[meshNodeIndex].mesh].primitives) {
    if (primitive.mode !== undefined && primitive.mode !== 4) throw new Error("Only triangle primitives supported");
    const positions = view(primitive.attributes.POSITION);
    const vertexBase = transformed.length / 3;
    for (let i = 0; i < positions.count; i++) {
      const px = positions.floats[i * 3], py = positions.floats[i * 3 + 1], pz = positions.floats[i * 3 + 2];
      const x = world[0] * px + world[4] * py + world[8] * pz + world[12];
      const y = world[1] * px + world[5] * py + world[9] * pz + world[13];
      const z = world[2] * px + world[6] * py + world[10] * pz + world[14];
      transformed.push(x, y, z);
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
    }
    if (primitive.indices !== undefined) {
      const accessor = json.accessors[primitive.indices];
      const bufferView = json.bufferViews[accessor.bufferView];
      const byteOffset = binaryOffset + (bufferView.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
      const typed = accessor.componentType === 5123
        ? new Uint16Array(arrayBuffer, byteOffset, accessor.count)
        : new Uint32Array(arrayBuffer, byteOffset, accessor.count);
      for (let i = 0; i < typed.length; i++) triangleIndices.push(typed[i] + vertexBase);
    } else {
      for (let i = 0; i < positions.count; i++) triangleIndices.push(i + vertexBase);
    }
  }
}
const horizontal = Math.max(maxX - minX, maxZ - minZ, 0.001);
const scale = 2 / horizontal;
const centerX = (minX + maxX) / 2, centerZ = (minZ + maxZ) / 2;
const vertices = [];
for (let i = 0; i < transformed.length; i += 3) {
  vertices.push([(transformed[i] - centerX) * scale, (transformed[i + 1] - minY) * scale, (transformed[i + 2] - centerZ) * scale]);
}
const indices = triangleIndices;

const lines = ["# converted by scripts/glb-to-obj.mjs", `o ${input.replace(/\.glb$/, "")}`];
for (const [x, y, z] of vertices) lines.push(`v ${x.toFixed(6)} ${y.toFixed(6)} ${z.toFixed(6)}`);
for (let i = 0; i < indices.length; i += 3) {
  lines.push(`f ${indices[i] + 1} ${indices[i + 1] + 1} ${indices[i + 2] + 1}`);
}
writeFileSync(output, lines.join("\n") + "\n");
console.log(`${input} → ${output}: ${vertices.length} vertices, ${indices.length / 3} triangles, height ${(maxY - minY) * scale > 0 ? ((maxY - minY) * scale).toFixed(2) : "0"} units`);
