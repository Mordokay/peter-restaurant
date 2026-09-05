import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { join, resolve } from "node:path";

// Visual regression capture routine: one command refreshes the canonical set of
// asset and gameplay-scene screenshots used to compare builds by eye.
// Usage: npm run capture:regression -- [port]   (dev server must be running)
//
// Frames are near-deterministic (fixed camera params, virtual-time budget,
// growth frozen where pinned), but particles use Math.random(), so expect tiny
// sparkle differences between runs. Compare silhouettes and layout, not pixels.
const port = Number(process.argv[2] ?? 5173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Usage: npm run capture:regression -- [port]");

const stamp = new Date().toISOString().replaceAll(":", "").replaceAll("-", "").slice(0, 13);
const outDir = resolve(".art-captures", "regression", stamp);
mkdirSync(outDir, { recursive: true });

// The canonical set. Keep angles stable once introduced — the routine's value
// is comparing the same framing across builds, not beauty.
const modelShots = [
  { model: "cabbage", file: "cabbage-hero.png", angle: "-0.6,1.0" },
  { model: "cabbage", file: "cabbage-top.png", angle: "-0.785,0.35" },
  { model: "tomato_plant", file: "tomato-plant-lab.png", angle: "" },
  { model: "tomato", file: "tomato-fruit.png", angle: "" },
  { model: "tofu", file: "tofu.png", angle: "" },
  { model: "wheat_scan", file: "wheat-scan.png", angle: "0.5,1.2,1.9" },
  { model: "tomato_ripe_scan", file: "tomato-ripe-scan.png", angle: "0.5,1.2,2.4" },
];
const sceneShots = [
  { file: "scene-overview.png", query: "" },
  { file: "scene-plot-mature.png", query: "playerX=-4.2&playerZ=-5.5&camRadius=15" },
  { file: "scene-plot-sparse.png", query: "playerX=-4.2&playerZ=-5.5&camRadius=15&proofStage=1&freeze=1" },
  { file: "scene-wheat-band.png", query: "playerX=0&playerZ=-6.4&camRadius=10" },
  { file: "scene-dinner.png", query: "playerX=0&playerZ=1.8&camRadius=17&proofPhase=dinner" },
  { file: "scene-close.png", query: "playerX=0&playerZ=1.8&camRadius=17&proofPhase=close" },
];

let failures = 0;
for (const shot of modelShots) {
  const args = ["run", "capture:model", "--", shot.model, String(port), join(outDir, shot.file)];
  if (shot.angle) args.push(shot.angle);
  const { status } = spawnSync("npm", args, { stdio: "inherit" });
  if (status !== 0) failures++;
}
for (const shot of sceneShots) {
  const args = ["run", "capture:scene", "--", String(port), join(outDir, shot.file)];
  if (shot.query) args.push(shot.query);
  const { status } = spawnSync("npm", args, { stdio: "inherit" });
  if (status !== 0) failures++;
}

console.log(`\n${failures === 0 ? "Complete" : `${failures} capture(s) failed`} → ${outDir}`);
process.exit(failures === 0 ? 0 : 1);
