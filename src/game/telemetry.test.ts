import test from "node:test";
import assert from "node:assert/strict";
import { TelemetryLog } from "./telemetry.ts";

test("telemetry records game-time seconds and stable event names", () => {
  const log = new TelemetryLog();
  log.tick(1.25);
  log.tick(0.75);
  log.record(1, "guest_seated", { ticketId: 3, tableId: 2 });
  const lines = log.jsonl().split("\n");
  assert.equal(lines.length, 2);
  const header = JSON.parse(lines[0]!);
  assert.equal(header.ev, "schema");
  const event = JSON.parse(lines[1]!);
  assert.equal(event.t, 2);
  assert.equal(event.day, 1);
  assert.equal(event.ev, "guest_seated");
  assert.equal(event.tableId, 2);
});

test("derived fulfillment and average wait aggregate per day", () => {
  const log = new TelemetryLog();
  log.record(1, "served", { waitSeconds: 10 });
  log.record(1, "served", { waitSeconds: 20 });
  log.record(1, "walkout", {});
  log.record(2, "served", { waitSeconds: 5 });
  assert.equal(log.fulfillment(1), 2 / 3);
  assert.equal(log.fulfillment(2), 1);
  assert.equal(log.fulfillment(3), null);
  assert.equal(log.averageWait(1), 15);
  assert.equal(log.count(1, "walkout"), 1);
  assert.deepEqual(log.dayNumbers(), [1, 2]);
});

test("the event cap holds and snapshots land as shift_close records", () => {
  const log = new TelemetryLog(5);
  for (let index = 0; index < 12; index++) log.record(1, "served", {});
  assert.equal(log.size, 5);
  log.snapshot({
    ev: "shift_close", day: 1, phase: "close", served: 3, missed: 1, wastedServings: 1,
    coinsEarned: 30, avgWaitSeconds: 12.5, fulfillment: 0.75, shelfServingsAtClose: 0,
  });
  const last = log.jsonl().split("\n").pop()!;
  assert.equal(JSON.parse(last).ev, "shift_close");
  assert.equal(JSON.parse(last).fulfillment, 0.75);
});
