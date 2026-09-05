import { Mesh, MeshBuilder, Scene, ShadowGenerator, StandardMaterial, TransformNode, Vector3 } from "@babylonjs/core";

export interface TomatoFruitRig {
  mesh: Mesh;
  basePosition: Vector3;
  baseScale: number;
  phase: number;
  growth: number;
  sparkleIn: number;
}

export interface TomatoPlantRig {
  root: TransformNode;
  phase: number;
  fruits: TomatoFruitRig[];
}

export const tomatoFruitSites = [
  new Vector3(-0.36, 1.38, -0.05), new Vector3(0.39, 1.21, 0.05),
  new Vector3(-0.5, 1.02, 0.1), new Vector3(0.52, 0.83, -0.1),
  new Vector3(-0.31, 0.65, -0.13), new Vector3(0.33, 0.51, 0.13),
] as const;

function branchBetween(name: string, start: Vector3, end: Vector3, thickness: number, material: StandardMaterial, scene: Scene): Mesh {
  const direction = end.subtract(start);
  const mesh = MeshBuilder.CreateBox(name, { width: thickness, height: thickness, depth: direction.length() }, scene);
  mesh.position.copyFrom(start.add(end).scale(0.5));
  mesh.lookAt(end);
  mesh.material = material;
  return mesh;
}

/** Builds one reusable foliage mesh. Its topology is explicitly authored around
 * six fruit sites; repeated plot plants clone this geometry. */
export function createTomatoFoliageSource(scene: Scene, material: StandardMaterial): Mesh {
  const pieces: Mesh[] = [];
  const stemPoints = [
    new Vector3(0, 0, 0), new Vector3(0.025, 0.3, 0.012), new Vector3(-0.018, 0.59, -0.01),
    new Vector3(0.028, 0.88, 0.014), new Vector3(-0.015, 1.17, -0.008), new Vector3(0.018, 1.52, 0),
  ];
  for (let index = 1; index < stemPoints.length; index++) {
    pieces.push(branchBetween("segmented tomato vine", stemPoints[index - 1]!, stemPoints[index]!, 0.075 - index * 0.006, material, scene));
  }

  const leafBranches = [
    [new Vector3(0, 0.39, 0), new Vector3(-0.58, 0.48, 0.16)],
    [new Vector3(0, 0.61, 0), new Vector3(0.6, 0.69, -0.13)],
    [new Vector3(0, 0.84, 0), new Vector3(-0.62, 0.91, -0.1)],
    [new Vector3(0, 1.07, 0), new Vector3(0.58, 1.14, 0.16)],
    [new Vector3(0, 1.3, 0), new Vector3(-0.48, 1.38, 0.1)],
    [new Vector3(0, 1.48, 0), new Vector3(0.38, 1.56, -0.06)],
  ] as const;
  for (const [start, end] of leafBranches) {
    const middle = Vector3.Lerp(start, end, 0.52).add(new Vector3(0, 0.035, 0));
    pieces.push(branchBetween("curved compound leaf stem", start, middle, 0.032, material, scene));
    pieces.push(branchBetween("curved compound leaf stem", middle, end, 0.027, material, scene));
    const flatDirection = end.subtract(start);
    const yaw = Math.atan2(flatDirection.x, flatDirection.z);
    for (const progress of [0.42, 0.68, 0.91]) {
      const center = Vector3.Lerp(start, end, progress);
      for (const side of [-1, 1]) {
        const leafletYaw = yaw + side * (0.88 + progress * 0.08);
        const forward = new Vector3(Math.sin(leafletYaw), 0, Math.cos(leafletYaw));
        const leafletStart = center.add(forward.scale(0.035));
        for (let segment = 0; segment < 3; segment++) {
          const segmentProgress = (segment + 0.5) / 3;
          const leaf = MeshBuilder.CreateBox("stepped curved tomato leaflet", {
            width: (0.115 - segment * 0.018) * (1.05 - progress * 0.12),
            height: 0.022,
            depth: 0.072,
          }, scene);
          leaf.position.copyFrom(leafletStart.add(forward.scale(segmentProgress * 0.22)));
          leaf.position.y += Math.sin(segmentProgress * Math.PI) * 0.026 + segment * 0.006;
          leaf.rotation.y = leafletYaw + side * (segment - 1) * 0.045;
          leaf.rotation.z = side * (0.04 + segment * 0.035);
          leaf.material = material;
          pieces.push(leaf);
        }
      }
    }
    for (let segment = 0; segment < 3; segment++) {
      const tip = MeshBuilder.CreateBox("curved terminal tomato leaflet", {
        width: 0.17 - segment * 0.035,
        height: 0.024,
        depth: 0.075,
      }, scene);
      const forward = new Vector3(Math.sin(yaw), 0, Math.cos(yaw));
      tip.position.copyFrom(end.add(forward.scale(0.035 + segment * 0.065)));
      tip.position.y += 0.018 + segment * 0.012;
      tip.rotation.y = yaw + (segment - 1) * 0.025;
      tip.rotation.z = (segment - 1) * 0.035;
      tip.material = material;
      pieces.push(tip);
    }
  }

  for (const site of tomatoFruitSites) {
    const attachment = site.add(new Vector3(0, 0.2, 0));
    pieces.push(branchBetween("tomato fruit stem", new Vector3(0, Math.min(1.5, site.y + 0.12), 0), attachment, 0.032, material, scene));
  }

  const merged = Mesh.MergeMeshes(pieces, true, true, undefined, false, true);
  if (!merged) throw new Error("Could not merge authored tomato foliage");
  merged.name = "authored tomato foliage source";
  merged.receiveShadows = true;
  merged.setEnabled(false);
  return merged;
}

export function createTomatoPlantRig(options: {
  index: number;
  position: Vector3;
  parent: TransformNode;
  foliageSource: Mesh;
  fruitSource: Mesh;
  fruitCount: number;
  shadows?: ShadowGenerator;
}): TomatoPlantRig {
  const { index, position, parent, foliageSource, fruitSource, fruitCount, shadows } = options;
  const root = new TransformNode(`tomato plant ${index + 1}`, parent.getScene());
  root.parent = parent;
  root.position.copyFrom(position);
  const foliage = foliageSource.clone(`tomato plant ${index + 1} foliage`)!;
  foliage.parent = root;
  foliage.setEnabled(true);
  shadows?.addShadowCaster(foliage);
  const fruits: TomatoFruitRig[] = [];
  for (let fruitIndex = 0; fruitIndex < fruitCount; fruitIndex++) {
    const site = tomatoFruitSites[fruitIndex]!;
    const fruit = fruitSource.clone(`plant ${index + 1} tomato ${fruitIndex + 1}`)!;
    fruit.parent = root;
    fruit.position.copyFrom(site);
    const scale = 0.82 + (fruitIndex % 3) * 0.035;
    fruit.scaling.setAll(scale);
    fruit.setEnabled(true);
    shadows?.addShadowCaster(fruit);
    fruits.push({ mesh: fruit, basePosition: site.clone(), baseScale: scale, phase: index * 1.7 + fruitIndex * 0.83, growth: index === 0 && fruitIndex === fruitCount - 1 ? -0.8 : 1, sparkleIn: 9 + index * 4 + fruitIndex * 2.3 });
  }
  return { root, phase: index * 1.9, fruits };
}
