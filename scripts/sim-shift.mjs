import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

// Headless balance-sim runner: drives the autopilot through whole days over a
// CDP connection and harvests window.__farmTelemetry() when the sim reports
// done. Real-time at simSpeed (no virtual-time tricks — the rAF loop keeps
// Chrome alive, so we poll and exit explicitly).
// Usage: npm run sim:shift -- [port] [out.jsonl] [days] [simSpeed]
const port = Number(process.argv[2] ?? 5173);
const output = resolve(process.argv[3] ?? `.art-captures/sim/sim-${new Date().toISOString().slice(0, 13)}.jsonl`);
const days = Number(process.argv[4] ?? 3);
const simSpeed = Number(process.argv[5] ?? 20);
if (![port, days, simSpeed].every(Number.isFinite)) throw new Error("Usage: npm run sim:shift -- [port] [out.jsonl] [days] [simSpeed]");

const chrome = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const child = spawn(chrome, [
  "--headless", "--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader",
  "--disable-background-networking", "--disable-component-update", "--no-first-run",
  `--user-data-dir=/private/tmp/farming-unlimited-sim-${process.pid}`,
  "--remote-debugging-port=0", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });

let wsUrl = "";
child.stderr.setEncoding("utf8");
child.stderr.on("data", (chunk) => {
  const match = chunk.match(/DevTools listening on (ws:\/\/\S+)/);
  if (match) wsUrl = match[1];
});
await new Promise((resolveWait, reject) => {
  const started = Date.now();
  const timer = setInterval(() => {
    if (wsUrl) { clearInterval(timer); resolveWait(); }
    else if (Date.now() - started > 15000) { clearInterval(timer); reject(new Error("Chrome never exposed CDP")); }
  }, 50);
});

let nextId = 0;
const pending = new Map();
const ws = new WebSocket(wsUrl);
let sessionId = "";
const send = (method, params = {}) => new Promise((resolveWait, reject) => {
  const id = ++nextId;
  pending.set(id, { resolveWait, reject });
  ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
});
ws.addEventListener("message", (event) => {
  const message = JSON.parse(event.data);
  if (message.id && pending.has(message.id)) {
    if (message.error) pending.get(message.id).rejectWait(new Error(message.error.message));
    else pending.get(message.id).resolveWait(message.result);
    pending.delete(message.id);
  }
});
await new Promise((resolveWait) => ws.addEventListener("open", resolveWait));

// The stderr endpoint is browser-level: open the sim in its own target and
// attach so Page/Runtime commands reach the page.
const target = await send("Target.createTarget", { url: `http://127.0.0.1:${port}/?autopilot=1&days=${days}&simSpeed=${simSpeed}&noRender=1` });
const attached = await send("Target.attachToTarget", { targetId: target.targetId, flatten: true });
sessionId = attached.sessionId;
await send("Page.enable");
await send("Runtime.enable");

// Poll for the autopilot's done flag; real time at simSpeed (≈1s game per
// frame at speed 20 ⇒ a 10-minute day takes ≈30 s wall clock).
const deadline = Date.now() + 1000 * (90 * days + 60);
let jsonl = "";
while (Date.now() < deadline) {
  await new Promise((sleep) => setTimeout(sleep, 2000));
  const done = await send("Runtime.evaluate", { expression: "String(window.__simDone === true)" });
  if (done?.result?.value === "true") {
    const telemetry = await send("Runtime.evaluate", { expression: "window.__farmTelemetry ? window.__farmTelemetry() : ''" });
    jsonl = telemetry?.result?.value ?? "";
    break;
  }
}
child.kill("SIGTERM");
if (!jsonl) throw new Error("Sim never reported done (or telemetry missing)");

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, jsonl + "\n");

// ── Per-day summary ──
const events = jsonl.split("\n").map((line) => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
const dayNumbers = [...new Set(events.filter((e) => e.ev === "guest_seated" || e.ev === "shift_close").map((e) => e.day))].sort((a, b) => a - b);
console.log(`sim → ${output} (${events.length} events, ${dayNumbers.length} days)\n`);
console.log("day | seated served missed | fulfill | avgWait | waste | coins | serverServes");
console.log("----|------- ------ -------|---------|---------|------|------|-------------");
for (const day of dayNumbers) {
  const seated = events.filter((e) => e.day === day && e.ev === "guest_seated").length;
  const served = events.filter((e) => e.day === day && e.ev === "served").length;
  const byServer = events.filter((e) => e.day === day && e.ev === "served" && e.by === "server").length;
  const missed = events.filter((e) => e.day === day && e.ev === "walkout").length;
  const waits = events.filter((e) => e.day === day && e.ev === "served").map((e) => e.waitSeconds ?? 0);
  const avgWait = waits.length ? (waits.reduce((s, w) => s + w, 0) / waits.length).toFixed(1) : "—";
  const close = events.find((e) => e.day === day && e.ev === "shift_close");
  const fulfill = seated ? `${Math.round((served / Math.max(1, served + missed)) * 100)}%` : "—";
  console.log(`${String(day).padStart(3)} | ${String(seated).padStart(6)} ${String(served).padStart(6)} ${String(missed).padStart(7)} | ${fulfill.padStart(7)} | ${String(avgWait).padStart(7)} | ${String(close?.wastedServings ?? "—").padStart(4)} | ${String(close?.coinsEarned ?? "—").padStart(4)} | ${String(byServer).padStart(4)}`);
}
