import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

// Deterministic screenshot of the live gameplay scene (not Model Lab).
// Usage: npm run capture:scene -- [port] [output.png] ["camAlpha=-0.785&playerX=0&playerZ=2"] [virtualTimeMs]
const port = Number(process.argv[2] ?? 5173);
const output = resolve(process.argv[3] ?? "/private/tmp/restaurant-scene.png");
const query = process.argv[4] ?? "";
const budget = Number(process.argv[5] ?? 6000);
if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(budget) || budget < 500 || budget > 60000) {
  throw new Error("Usage: npm run capture:scene -- [port] [output.png] [query] [virtualTimeMs]");
}
const url = `http://127.0.0.1:${port}/${query ? `?${query}` : ""}`;

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const child = spawn(chrome, [
  "--headless", "--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
  "--disable-background-networking", "--disable-component-update", "--no-first-run",
  `--user-data-dir=/private/tmp/farming-unlimited-scene-capture-${process.pid}`,
  "--hide-scrollbars", "--window-size=1600,1000", `--virtual-time-budget=${budget}`,
  `--screenshot=${output}`, url,
], { stdio: "ignore" });

const deadline = Date.now() + 20_000;
while (!existsSync(output) && Date.now() < deadline) await new Promise((resolveWait) => setTimeout(resolveWait, 200));
child.kill("SIGTERM");
if (!existsSync(output)) throw new Error(`Chrome did not create ${output}`);
console.log(output);
