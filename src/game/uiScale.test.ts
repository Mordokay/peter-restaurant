import { test } from "node:test";
import assert from "node:assert/strict";
import {
  clampUiScale, onUiScale, setUiScale, uiScale,
  UI_SCALE_DEFAULT, UI_SCALE_MAX, UI_SCALE_MIN,
} from "./uiScale.ts";

test("the scale starts at the default", () => {
  assert.equal(uiScale(), UI_SCALE_DEFAULT);
});

test("a scale outside the range is pulled back into it", () => {
  assert.equal(clampUiScale(9), UI_SCALE_MAX);
  assert.equal(clampUiScale(0.01), UI_SCALE_MIN);
  // A slider that has lost its value must not take the UI with it.
  assert.equal(clampUiScale(Number.NaN), UI_SCALE_DEFAULT);
});

test("setting the scale reports what it actually became", () => {
  assert.equal(setUiScale(1.6), 1.6);
  assert.equal(uiScale(), 1.6);
  assert.equal(setUiScale(99), UI_SCALE_MAX);
});

test("listeners hear changes, and stop when they are done", () => {
  const heard: number[] = [];
  const stop = onUiScale((scale) => heard.push(scale));
  setUiScale(1.2);
  // Setting it to what it already is is not a change, and must not redraw.
  setUiScale(1.2);
  stop();
  setUiScale(1.4);
  assert.deepEqual(heard, [1.2]);
  setUiScale(UI_SCALE_DEFAULT);
});
