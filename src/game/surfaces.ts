// Surfaces: what a wall or a floor is made of, answered at the point where you are standing.
//
// A material here is not a picture that repeats. It is a function of world coordinates, which buys three
// things at once: there is no tile to copy and paste, so there is no seam and nothing reads as repetitive;
// coursing runs unbroken out of one room and into the next instead of restarting at every rect corner;
// and two materials meeting along an edge can simply be asked, cell by cell, which of them owns it.
//
// Two rules keep it cheap, and they are the same rule twice. Tone is drawn **per feature** — per board,
// per tile, per block — never per cell, because `createVoxelMesh` merges coplanar faces of equal colour
// and per-cell variation defeats the merger completely: the old noise floors cost 2.46 triangles a cell
// and were 70% of the compound's geometry for 26% of its cells. And texture is **sparse salted clusters**,
// never static, which is what ART_DIRECTION.md asks for in as many words: "never a noisy texture".
//
// Everything is measured in METRES and point-sampled at a cell's centre, never in cells. That is what lets
// one material serve a room meshed at 5 cm and the site grounds meshed at 50 cm: the big features survive
// both, and the fine ones simply fall below the sampling and vanish, which is the right thing for a
// surface you are looking at from sixty metres away.

/** Which way a run of boards, courses or furrows travels. */
export type Axis = "u" | "v";

export type Lattice =
  /** One unbroken field: soil, plaster, grass. */
  | { kind: "none" }
  /** Square features: tiles, flags, setts. */
  | { kind: "grid"; size: number }
  /** Runs of features: floorboards, brick courses, stone coursing. `stagger` shifts each row along by
   *  that fraction of a feature's length — 0.5 is a running bond, 0 stacks the joints. */
  | { kind: "rows"; width: number; length: number; stagger?: number; along?: Axis }
  /** Parallel ridges with no joint: a tilled field, a corrugated sheet. */
  | { kind: "corduroy"; pitch: number; along?: Axis }
  /** Irregular cells packed edge to edge, each grown from a jittered seed — flagstones, cobble setts,
   *  crazy paving, and gravel, which is the same thing at 5 cm instead of 40.
   *
   *  Gravel taught this one. Scattering pebbles ON a bed gives you boulders sitting on grey paint,
   *  because a stone big enough to mesh is far bigger than a stone; but gravel is not stones on a
   *  surface, it IS the surface — packed, touching, every one its own shape. A Voronoi cell is exactly
   *  that, and it merges, because each stone is a single colour. `spacing` is the rough size of one. */
  | { kind: "voronoi"; spacing: number; jitter?: number };

/** A scatter layer: lichen on stone, knots in a board, grit between setts, wear on a walking line. */
export interface Scatter {
  color: string;
  /** Share of the surface it takes, 0..1. Keep it sparse — the freezer's frost sits at 0.10 to 0.26. */
  coverage: number;
  /** Size of one blotch in metres; bigger than a cell, so it clusters instead of speckling. */
  cluster?: number;
  /** Confine it to the joints (moss in mortar) or to the features (a knot in a board). */
  where?: "any" | "joint" | "feature";
  /** Give every layer its own salt or two scatters will land in exactly the same places. */
  salt: number;
}

export interface SurfaceMaterial {
  id: string;
  name: string;
  /** The cell size this material wants to be meshed at, metres. Materials do not all want the same one:
   *  a 30 cm quarry tile needs 2.5 cm cells before its grout stops aliasing away, while a 2 m oak board
   *  is happier at 5 cm, where the mesher merges whole boards and the grain stays calm. Default 0.05. */
  pitch?: number;
  /** Tones of the material itself. One is drawn per feature, so a floor of boards is a floor of boards
   *  that differ, not a floor of noise. */
  tones: string[];
  lattice?: Lattice;
  /** The gap between features: grout, mortar, the space between two boards. `depth` recesses it. */
  joint?: { color: string; width: number; depth?: number };
  /** How far the body of a feature stands above the walking surface, and how much it domes toward its
   *  centre — a cobble sett, the crown of a ploughed ridge. Metres. */
  relief?: { height?: number; crown?: number };
  /** Tone ACROSS a feature, from its centre (0) to its edge (1), each band starting at `from`.
   *
   *  This is what makes shape read at the game camera. Realistic relief is sub-cell at every pitch we
   *  can afford — a 1.2 cm grout recess rounds to nothing even at 2.5 cm cells — so a ploughed field
   *  whose only ridge is geometric is a flat brown field. Give the crown a dry pale tone and the furrow
   *  a damp dark one and the corduroy reads from twenty-six metres with no geometry at all. It also
   *  merges, because a band is a contiguous region and not a speckle. */
  bands?: { from: number; color: string }[];
  scatter?: Scatter[];
  /** Broad, slow variation laid over everything: a lush corner, a sun-bleached patch, a damp strip.
   *  `scale` is the size of one patch in metres. */
  patch?: { scale: number; tones: string[] };
  /** Things that stand up out of the surface — tufts, pebbles, chips. Built only near the camera, because
   *  scattered geometry is what breaks the mesher's merging. See surfaceCrust.ts. */
  crust?: import("./surfaceCrust.ts").Crust;
}

export interface SurfaceSample {
  color: string;
  /** Metres relative to the walking surface: 0 is the surface, negative is cut into it, positive stands
   *  proud of it. The floor and wall adapters turn this into cells at whatever pitch they mesh. */
  relief: number;
}

/** Which feature of a lattice a point falls in, and where in it. */
export interface LatticeHit {
  /** Integer address of the feature — the key every per-feature choice hashes on. */
  fu: number;
  fv: number;
  /** Metres to the feature's nearest edge. Zero on the edge itself. */
  inset: number;
  /** 0 at the feature's centre, 1 at its edge. Shapes a dome or a ridge. */
  fromCentre: number;
}

/** Deterministic 0..1 noise. Same input, same answer, on every machine and every run. */
export function hash2(x: number, y: number, salt = 0): number {
  let h = Math.imul(x + 0x9e37 + salt * 0x2545, 0x85ebca6b) ^ Math.imul(y + 0x79b9 - salt, 0xc2b2ae35);
  h ^= h >>> 13;
  h = Math.imul(h, 0x165667b1);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const pick = <T>(list: readonly T[], t: number): T => list[Math.min(list.length - 1, Math.floor(t * list.length))]!;

/** Where a world point sits in a lattice. */
export function latticeAt(lattice: Lattice, u: number, v: number): LatticeHit {
  switch (lattice.kind) {
    case "grid": {
      const size = Math.max(1e-6, lattice.size);
      const fu = Math.floor(u / size), fv = Math.floor(v / size);
      const du = u - fu * size, dv = v - fv * size;
      const inset = Math.min(du, size - du, dv, size - dv);
      const fromCentre = Math.max(Math.abs(du / size - 0.5), Math.abs(dv / size - 0.5)) * 2;
      return { fu, fv, inset, fromCentre };
    }
    case "rows": {
      // Rows run along `along`; the other axis counts them off. Each row slides along by `stagger`, so
      // the butt joints of one course never line up with its neighbour's.
      const along = lattice.along ?? "u";
      const [a, b] = along === "u" ? [u, v] : [v, u];
      const width = Math.max(1e-6, lattice.width), length = Math.max(1e-6, lattice.length);
      const row = Math.floor(b / width);
      const shifted = a + row * (lattice.stagger ?? 0.5) * length;
      const column = Math.floor(shifted / length);
      const da = shifted - column * length, db = b - row * width;
      const inset = Math.min(da, length - da, db, width - db);
      const fromCentre = Math.max(Math.abs(da / length - 0.5), Math.abs(db / width - 0.5)) * 2;
      return { fu: column, fv: row, inset, fromCentre };
    }
    case "voronoi": {
      // Nearest of the jittered seeds in the 3x3 lattice cells around this point. The runner-up gives
      // the edge: where the two are equally close, you are on the boundary between two stones.
      const spacing = Math.max(1e-6, lattice.spacing);
      const jitter = lattice.jitter ?? 0.42;
      const cu = Math.floor(u / spacing), cv = Math.floor(v / spacing);
      let bestD = Infinity, nextD = Infinity, bu = cu, bv = cv;
      for (let du = -1; du <= 1; du++) {
        for (let dv = -1; dv <= 1; dv++) {
          const su = cu + du, sv = cv + dv;
          const px = (su + 0.5 + (hash2(su, sv, 5) - 0.5) * 2 * jitter) * spacing;
          const pz = (sv + 0.5 + (hash2(su, sv, 6) - 0.5) * 2 * jitter) * spacing;
          const d = Math.hypot(u - px, v - pz);
          if (d < bestD) { nextD = bestD; bestD = d; bu = su; bv = sv; }
          else if (d < nextD) nextD = d;
        }
      }
      // Half the gap between nearest and runner-up is how far inside this stone you stand.
      const inset = (nextD - bestD) / 2;
      return { fu: bu, fv: bv, inset, fromCentre: Math.min(1, bestD / (spacing * 0.62)) };
    }
    case "corduroy": {
      const along = lattice.along ?? "u";
      const across = along === "u" ? v : u;
      const pitch = Math.max(1e-6, lattice.pitch);
      const row = Math.floor(across / pitch);
      const d = across - row * pitch;
      // A furrow has no joint: it is all ridge, so every point is "inside" its feature.
      return { fu: 0, fv: row, inset: Math.min(d, pitch - d), fromCentre: Math.abs(d / pitch - 0.5) * 2 };
    }
    default:
      return { fu: 0, fv: 0, inset: Infinity, fromCentre: 0 };
  }
}

/** What the material looks like at a world point. Metres in, colour and height out. */
export function sampleSurface(material: SurfaceMaterial, u: number, v: number): SurfaceSample {
  const hit = latticeAt(material.lattice ?? { kind: "none" }, u, v);
  const inJoint = material.joint !== undefined && hit.inset < material.joint.width / 2;

  // Tone. A broad patch field wins where there is one, because it is the thing the eye reads first;
  // otherwise every feature draws its own from its own address, which keeps a whole board one colour.
  let color = material.patch
    ? pick(material.patch.tones, hash2(Math.floor(u / material.patch.scale), Math.floor(v / material.patch.scale), 7))
    : pick(material.tones, hash2(hit.fu, hit.fv, 1));

  // Shading across the feature wins over the per-feature tone: it is the thing that carries the form.
  if (material.bands) {
    for (const band of material.bands) if (hit.fromCentre >= band.from) color = band.color;
  }

  let relief = material.relief?.height ?? 0;
  if (material.relief?.crown) relief += material.relief.crown * (1 - hit.fromCentre * hit.fromCentre);
  if (inJoint) {
    color = material.joint!.color;
    relief = -(material.joint!.depth ?? 0);
  }

  for (const layer of material.scatter ?? []) {
    if (layer.where === "joint" && !inJoint) continue;
    if (layer.where === "feature" && inJoint) continue;
    const size = Math.max(1e-6, layer.cluster ?? 0.1);
    if (hash2(Math.floor(u / size), Math.floor(v / size), layer.salt) < layer.coverage) color = layer.color;
  }
  return { color, relief };
}

/** The deepest a material cuts below its walking surface — how thick a slab has to be to carry it. */
export function reliefFloor(material: SurfaceMaterial): number {
  return -(material.joint?.depth ?? 0);
}

/** The highest it stands above it. */
export function reliefCeiling(material: SurfaceMaterial): number {
  return (material.relief?.height ?? 0) + (material.relief?.crown ?? 0);
}
