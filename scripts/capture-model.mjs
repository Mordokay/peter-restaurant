import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

const model = (process.argv[2] ?? "tomato_plant").replace(/[^a-z0-9_-]/gi, "");
const port = Number(process.argv[3] ?? 5173);
const output = resolve(process.argv[4] ?? `/private/tmp/model-lab-${model}.png`);
// Optional "alpha,beta[,radius]" in radians/meters for deterministic angle shots.
const angle = (process.argv[5] ?? "").split(",").map(Number);
if (!model || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Usage: npm run capture:model -- <model> [port] [output.png] [alpha,beta,radius]");
const view = new URLSearchParams({ model });
if (angle.length >= 2 && angle.slice(0, 2).every(Number.isFinite)) {
  view.set("alpha", String(angle[0]));
  view.set("beta", String(angle[1]));
  const requestedRadius = angle.length >= 3 ? angle[2] : Number.NaN;
  if (Number.isFinite(requestedRadius)) view.set("radius", String(requestedRadius));
}

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const child = spawn(chrome, [
  "--headless", "--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
  "--disable-background-networking", "--disable-component-update", "--no-first-run",
  `--user-data-dir=/private/tmp/farming-unlimited-model-capture-${process.pid}`,
  "--hide-scrollbars", "--window-size=1600,1000", "--virtual-time-budget=6000",
  `--screenshot=${output}`, `http://127.0.0.1:${port}/model-lab.html?${view.toString()}`,
], { stdio: "ignore" });

const deadline = Date.now() + 20_000;
while (!existsSync(output) && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 200));
child.kill("SIGTERM");
if (!existsSync(output)) throw new Error(`Chrome did not create ${output}`);
console.log(output);
