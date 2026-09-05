// Compact JSONL balance telemetry, following the project's diagnostics rules:
// one schema header record, stable short event names, game-time seconds, a
// hard event cap, and a full snapshot exported with the event history.

export interface TelemetryEvent {
  /** Game-time seconds since session start. */
  t: number;
  day: number;
  /** Stable short event name. */
  ev: string;
  [payload: string]: unknown;
}

export interface TelemetrySnapshot {
  ev: "shift_close";
  day: number;
  phase: string;
  served: number;
  missed: number;
  wastedServings: number;
  coinsEarned: number;
  avgWaitSeconds: number | null;
  fulfillment: number | null;
  shelfServingsAtClose: number;
}

const SCHEMA_HEADER = {
  ev: "schema",
  v: 1,
  fields: "t=game-seconds, day, ev, +payload",
  events: "phase, guest_seated, served, walkout, cook_done, stock, take, close snapshot as shift_close",
  note: "Farm to Table shift telemetry; local game state only",
} as const;

export class TelemetryLog {
  private events: TelemetryEvent[] = [];
  private clockSeconds = 0;
  private readonly maxEvents: number;

  constructor(maxEvents = 5000) {
    this.maxEvents = maxEvents;
  }

  /** Game clock advance; call once per simulation step. */
  tick(dtSeconds: number): void {
    this.clockSeconds += Math.max(0, dtSeconds);
  }

  record(day: number, ev: string, payload: Record<string, unknown> = {}): void {
    if (this.events.length >= this.maxEvents) return;
    this.events.push({ t: Number(this.clockSeconds.toFixed(1)), day, ev, ...payload });
  }

  /** Close snapshots always land: at cap, the oldest ordinary event is evicted
   * rather than the day's summary — the summary is the record you tune from. */
  snapshot(entry: TelemetrySnapshot): void {
    if (this.events.length >= this.maxEvents) this.events.shift();
    this.events.push({ ...entry, t: Number(this.clockSeconds.toFixed(1)), day: entry.day, ev: "shift_close" });
  }

  /** Derived per-day fulfillment: served / (served + missed). */
  fulfillment(day: number): number | null {
    let served = 0;
    let missed = 0;
    for (const event of this.events) {
      if (event.day !== day) continue;
      if (event.ev === "served") served++;
      if (event.ev === "walkout") missed++;
    }
    return served + missed === 0 ? null : served / (served + missed);
  }

  averageWait(day: number): number | null {
    const waits: number[] = [];
    for (const event of this.events) {
      if (event.day === day && event.ev === "served" && typeof event.waitSeconds === "number") {
        waits.push(event.waitSeconds);
      }
    }
    return waits.length === 0 ? null : waits.reduce((sum, wait) => sum + wait, 0) / waits.length;
  }

  count(day: number, ev: string): number {
    return this.events.filter((event) => event.day === day && event.ev === ev).length;
  }

  dayNumbers(): number[] {
    return [...new Set(this.events.map((event) => event.day))].sort((a, b) => a - b);
  }

  get size(): number {
    return this.events.length;
  }

  jsonl(): string {
    return [JSON.stringify(SCHEMA_HEADER), ...this.events.map((event) => JSON.stringify(event))].join("\n");
  }
}
