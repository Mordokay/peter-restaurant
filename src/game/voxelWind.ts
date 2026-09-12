// Wind. The project's first shader, and deliberately its smallest.
//
// Grass blades are built as straight columns, which is not a compromise — it is the setup. A blade bent
// in its geometry is bent for ever, is a staircase of detached cubes at voxel resolution, and costs five
// times as much to draw. A blade bent by the vertex shader is a smooth continuous curve that also MOVES,
// and costs nothing at all: the bend lives in the GPU, not in the mesh.
//
// How it is wired, and why each choice:
//
//   * `MaterialPluginBase` rather than a hand-written `ShaderMaterial`. It patches Babylon's own `default`
//     shader, so vertex colours, eight simultaneous lights, shadow RECEIVING, fog and the glow layer all
//     keep working untouched. A ShaderMaterial would mean reimplementing all of that.
//   * The offset is injected at `CUSTOM_VERTEX_UPDATE_WORLDPOS`, after the world transform and before
//     `gl_Position` and the shadow lookups. Injecting at `UPDATE_POSITION` would bend in LOCAL space, and
//     a wall rotated to run east-west would lean the wrong way.
//   * The weight rides in vertex colour ALPHA (stored inverted: 1 = anchored). It is already a float we
//     pay for, and the fragment shader discards it unless `hasVertexAlpha` is set — which must stay off,
//     or every surface would be pushed into the sorted transparent pass and lose early-Z.
//   * The phase comes from WORLD position, so the wind crosses a field as one travelling wave rather than
//     every tuft bobbing on its own clock. That is the same trick `wheatPlant.ts` uses on the CPU.
//
// One honest limitation: the shadow map and the glow layer render with their own shaders, which this does
// not patch. Swaying geometry therefore casts a still shadow. For grass that is invisible, and the crust
// is kept out of the shadow caster list anyway, where it also saves a draw per mesh.
import { Material, MaterialPluginBase, Scene, UniformBuffer, type MaterialDefines } from "@babylonjs/core";
import { createVoxelMaterial } from "./voxelGeometry.ts";
import type { StandardMaterial } from "@babylonjs/core";

/** Speed, the two spatial frequencies that shape the travelling wave, and how far a free tip moves. */
export interface WindSettings {
  speed: number;
  /** Metres per radian across x and z: bigger numbers make a longer, lazier wave. */
  wavelength: [number, number];
  /** Metres a fully free vertex travels at full lean. */
  amplitude: number;
}

export const CALM_BREEZE: WindSettings = { speed: 1.35, wavelength: [3.1, 4.7], amplitude: 0.055 };

class VoxelWindPlugin extends MaterialPluginBase {
  time = 0;
  settings: WindSettings = CALM_BREEZE;

  constructor(material: Material) {
    super(material, "VoxelWind", 200, { VOXELWIND: false });
    this._enable(true);
  }

  override getClassName(): string { return "VoxelWindPlugin"; }

  override prepareDefines(defines: MaterialDefines): void {
    defines.VOXELWIND = true;
  }

  override getUniforms(): { ubo: { name: string; size: number; type: string }[]; vertex: string } {
    // StandardMaterial uses a uniform buffer on WebGL2, so the uniforms are declared in both places.
    return {
      ubo: [
        { name: "windTime", size: 1, type: "float" },
        { name: "windParams", size: 4, type: "vec4" },
      ],
      vertex: "uniform float windTime;\nuniform vec4 windParams;\n",
    };
  }

  override bindForSubMesh(uniformBuffer: UniformBuffer): void {
    uniformBuffer.updateFloat("windTime", this.time);
    uniformBuffer.updateFloat4(
      "windParams",
      this.settings.speed,
      1 / Math.max(0.01, this.settings.wavelength[0]),
      1 / Math.max(0.01, this.settings.wavelength[1]),
      this.settings.amplitude,
    );
  }

  override getCustomCode(shaderType: string): Record<string, string> | null {
    if (shaderType !== "vertex") return null;
    return {
      CUSTOM_VERTEX_UPDATE_WORLDPOS: `
        #if defined(VOXELWIND) && defined(VERTEXCOLOR)
          // colorUpdated.a is 1 where the voxel is anchored and 0 where it is free to move.
          float freedom = 1.0 - colorUpdated.a;
          if (freedom > 0.001) {
            float px = worldPos.x * windParams.y;
            float pz = worldPos.z * windParams.z;
            float t = windTime * windParams.x;

            // The gust, as a wave crossing the ground. Two frequencies, so the field breathes instead
            // of ticking: one long swell and one shorter cross-running ripple.
            float gust = sin(t + px + pz) * 0.7 + sin(t * 0.41 + px * 1.9 - pz * 1.3) * 0.3;

            // Wind is not one direction. It turns, slowly, and it is turning differently over there
            // than it is here — so the angle is a low-frequency field in BOTH time and space. Blades a
            // few metres apart lean different ways; blades side by side lean together, which is what
            // real grass does. Everything is a continuous function of world position, so no two corners
            // of the same quad can ever disagree and tear the blade apart.
            float angle = sin(t * 0.17 + px * 0.31) * 1.15
                        + sin(t * 0.11 - pz * 0.23) * 0.85
                        + sin(t * 0.29 + (px + pz) * 0.09) * 0.4;
            vec2 heading = vec2(cos(angle), sin(angle));

            // Squared, so a blade bends from its root in a curve rather than shearing over as a block.
            float bend = freedom * freedom * windParams.w;
            worldPos.xz += heading * (gust * bend);
            // What leans over also drops a little, or the tip appears to slide along a rail.
            worldPos.y -= abs(gust) * bend * 0.22;
          }
        #endif`,
    };
  }
}

const plugins = new WeakMap<StandardMaterial, VoxelWindPlugin>();

/** A voxel material whose geometry bends in the wind. Never put this on the shared material: it is used
 *  by props, particles, the lab and the level, and none of those want to move. */
export function createWindMaterial(name: string, scene: Scene, settings: WindSettings = CALM_BREEZE): StandardMaterial {
  const material = createVoxelMaterial(name, scene);
  const plugin = new VoxelWindPlugin(material);
  plugin.settings = settings;
  plugins.set(material, plugin);
  // One observer drives every wind material in the scene, the way the light pool already does.
  const observer = scene.onBeforeRenderObservable.add(() => {
    plugin.time += scene.getEngine().getDeltaTime() / 1000;
  });
  material.onDisposeObservable.add(() => scene.onBeforeRenderObservable.remove(observer));
  return material;
}

/** Change the weather on a wind material after the fact. */
export function setWind(material: StandardMaterial, settings: WindSettings): void {
  const plugin = plugins.get(material);
  if (plugin) plugin.settings = settings;
}
