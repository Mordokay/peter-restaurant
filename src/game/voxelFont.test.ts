import test from "node:test";
import assert from "node:assert/strict";
import { GLYPH_HEIGHT, GLYPH_WIDTH, textCells, textWidth } from "./voxelFont.ts";

test("a glyph is five by seven and a word is as wide as its letters plus tracking", () => {
  const one = textCells("A", { colour: "#fff" });
  assert.ok(one.length > 0);
  assert.equal(Math.max(...one.map((cell) => cell.x)) - Math.min(...one.map((cell) => cell.x)) + 1, GLYPH_WIDTH);
  assert.equal(Math.max(...one.map((cell) => cell.y)) - Math.min(...one.map((cell) => cell.y)) + 1, GLYPH_HEIGHT);

  assert.equal(textWidth("A"), GLYPH_WIDTH);
  assert.equal(textWidth("AB"), GLYPH_WIDTH * 2 + 1);
  assert.equal(textWidth(""), 0);
});

test("text is laid out left to right, and centring straddles the origin", () => {
  const left = textCells("AB", { colour: "#fff" });
  assert.equal(Math.min(...left.map((cell) => cell.x)), 0);

  const centred = textCells("AB", { colour: "#fff", align: "centre" });
  const min = Math.min(...centred.map((cell) => cell.x));
  const max = Math.max(...centred.map((cell) => cell.x));
  assert.ok(Math.abs(min + max) <= 1, `centred text straddles x = 0 (${min}..${max})`);
});

test("lower case reads as upper case, and an unknown character leaves a gap rather than a box", () => {
  assert.equal(textCells("a", { colour: "#fff" }).length, textCells("A", { colour: "#fff" }).length);
  // A tilde has no glyph: it takes its space and draws nothing.
  assert.equal(textCells("~", { colour: "#fff" }).length, 0);
  assert.equal(textCells("A~B", { colour: "#fff" }).length, textCells("AB", { colour: "#fff" }).length);
});

test("a space is narrower than a letter but still takes room", () => {
  assert.ok(textWidth("A B") > textWidth("AB"));
  assert.ok(textWidth("A B") < textWidth("AXB"));
});
