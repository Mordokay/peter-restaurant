// Isolated real-GPU smoke check; does not touch the user's Chrome or saved decor.
// node scripts/verify-rig-cache.mjs [port=5199]
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";

const output = mkdtempSync("/private/tmp/rig-cache-check-");
const port = Number(process.argv[2] ?? 5199);
const child = spawn("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", [
  `--user-data-dir=${join(output, "profile")}`, "--remote-debugging-port=0", "--no-first-run",
  "--no-default-browser-check", "--disable-background-networking", "--window-size=1600,1000", "about:blank",
], { stdio: ["ignore", "ignore", "pipe"] });
let socket;
let sessionId;
let id = 0;
const pending = new Map();
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Chrome CDP startup timed out")), 15000);
    child.on("error", (error) => { clearTimeout(timeout); reject(error); });
    child.stderr.on("data", (chunk) => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`Chrome exited: ${code}`)); });
  });
  socket = new WebSocket(endpoint);
  await new Promise((resolve, reject) => { socket.addEventListener("open", resolve); socket.addEventListener("error", reject); });
  socket.addEventListener("message", ({ data }) => {
    const message = JSON.parse(data);
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timeout);
    if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const requestId = ++id;
    const timeout = setTimeout(() => { pending.delete(requestId); reject(new Error(`${method} timed out`)); }, 60000);
    pending.set(requestId, { resolve, reject, timeout });
    socket.send(JSON.stringify({ id: requestId, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
  const target = await send("Target.createTarget", { url: `http://localhost:${port}/world.html?hour=12` });
  sessionId = (await send("Target.attachToTarget", { targetId: target.targetId, flatten: true })).sessionId;
  await send("Page.enable");
  const evaluate = async (expression) => {
    const value = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (value.exceptionDetails) throw new Error(value.exceptionDetails.exception?.description ?? value.exceptionDetails.text);
    return value.result.value;
  };
  const ready = async () => {
    const deadline = Date.now() + 60000;
    while (Date.now() < deadline) {
      if (await evaluate("Boolean(window.__world)")) return;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error("Compound did not finish loading");
  };
  await ready();
  const gl = await evaluate("__world.scene.getEngine().getGlInfo()");
  assert.ok(!/swiftshader/i.test(gl.renderer), JSON.stringify(gl));
  const setup = `async () => {
    const w = __world;
    await w.ensureModels(['savoy_cabbage', 'freezer_upright']);
    const {warmRigCache} = await import('/src/game/voxelRig.ts');
    await warmRigCache([w.catalog.models.savoy_cabbage, w.catalog.models.freezer_upright], w.scene, () => 991);
    return true;
  }`;
  await evaluate(`(${setup})()`);
  // A reload drops the JS memory cache while preserving this isolated profile's IndexedDB.
  await evaluate("delete window.__world");
  await send("Page.reload");
  await ready();
  const persistence = await evaluate(`(async () => {
    await __world.ensureModels(['savoy_cabbage', 'freezer_upright']);
    const {rigCacheKeys} = await import('/src/game/voxelRig.ts');
    const {warmSourceCache,sourceCacheKey} = await import('/src/game/sourceCache.ts');
    const keys = ['savoy_cabbage','freezer_upright'].flatMap(id => rigCacheKeys(__world.catalog.models[id],991));
    // Loading a merged-source namespace must preserve sibling rig entries on disk.
    await warmSourceCache([sourceCacheKey('savoy_cabbage',991,0.02)]);
    return {expected:keys.length, found:await warmSourceCache(keys)};
  })()`);
  assert.equal(persistence.found, persistence.expected);
  const result = await evaluate(`(async () => {
    const w = __world;
    const {createDecorScene} = await import('/src/game/decor.ts');
    const layout = {version:1,props:[]};
    const x=w.player.position.x,z=w.player.position.z;
    for(let i=0;i<6;i++) layout.props.push({id:'check-plant-'+i,model:'savoy_cabbage',position:[x-2+i*0.7,0,z-1]});
    layout.props.push({id:'check-freezer',model:'freezer_upright',position:[x+2,0,z-1],interactClip:'open'});
    const decor=createDecorScene(w.scene,w.catalog,layout,{cacheRev:()=>991,animation:{focus:()=>w.player.position,maxRigs:3,promotionsPerFrame:1}});
    window.__rigCheck=decor;
    const loaded=decor.stats();
    decor.update(1/60); const first=decor.stats();
    for(let i=0;i<5;i++) decor.update(1/60);
    const active=decor.stats();
    const start=performance.now(); decor.trigger('check-freezer'); const triggerMs=performance.now()-start;
    for(let i=0;i<80;i++) decor.update(1/60);
    const open=decor.stats();
    w.scene.onBeforeRenderObservable.add(()=>decor.update(1/60));
    return {loaded,first,active,open,triggerMs,doorYaw:decor.placed.get('check-freezer').rig.parts.get('door').node.rotation.y};
  })()`);
  assert.equal(result.loaded.rigs, 0);
  assert.equal(result.first.rigs, 1);
  assert.equal(result.active.ambientRigs, 3);
  assert.equal(result.open.protectedRigs, 1);
  assert.equal(result.open.rigCacheMisses, 0);
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const capture = await send("Page.captureScreenshot", { format: "png" });
  const screenshot = join(output, "compound.png");
  writeFileSync(screenshot, Buffer.from(capture.data, "base64"));
  const report = { gl, persistence, ...result, screenshot };
  writeFileSync(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  for (const request of pending.values()) clearTimeout(request.timeout);
  socket?.close();
  child.kill("SIGTERM");
}
