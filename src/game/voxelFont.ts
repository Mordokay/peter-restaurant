// Letters made of cubes.
//
// The rulebook says the whole UI ends up as voxels — fonts included — and this
// is that font. It is a 5x7 bitmap, which is the smallest grid that holds a
// legible Latin alphabet, drawn as strings because a glyph you can read in the
// source is a glyph you can fix in the source.
//
// Text comes back as voxel CELLS, so it goes through the same mesher, the same
// material and the same instancing as everything else in the game. A word is a
// mesh; a label is a word standing in the world.
import type { VoxelCell } from "./voxelGeometry.ts";

const GLYPHS: Record<string, string[]> = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#..##", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "#####"],
  J: ["..###", "....#", "....#", "....#", "#...#", "#...#", ".###."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#...#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#...#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", "#...#", ".#.#.", "..#..", ".#.#.", "#...#", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["#..#.", "#..#.", "#..#.", "#####", "...#.", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "....#", ".###."],
  "/": ["....#", "....#", "...#.", "..#..", ".#...", "#....", "#...."],
  "-": [".....", ".....", ".....", ".###.", ".....", ".....", "....."],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ":": [".....", ".##..", ".##..", ".....", ".##..", ".##..", "....."],
  "(": ["..##.", ".#...", "#....", "#....", "#....", ".#...", "..##."],
  ")": [".##..", "...#.", "....#", "....#", "....#", "...#.", ".##.."],
  "%": ["##..#", "##.#.", "...#.", "..#..", ".#...", "#.###", "..###"],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
};

export const GLYPH_WIDTH = 5;
export const GLYPH_HEIGHT = 7;
/** Blank columns between letters. One, like every bitmap font ever drawn. */
const TRACKING = 1;
/** Width of a space, in cells. */
const SPACE = 3;

/** How wide a string will be, in cells. */
export function textWidth(text: string): number {
  let width = 0;
  for (const character of text.toUpperCase()) {
    width += character === " " ? SPACE + TRACKING : GLYPH_WIDTH + TRACKING;
  }
  return Math.max(0, width - TRACKING);
}

export interface TextOptions {
  colour: string;
  /** "left" starts at x = 0; "centre" straddles it. */
  align?: "left" | "centre";
  /** Cells to leave between the baseline and y = 0. */
  baseline?: number;
}

/** A line of text as voxel cells, one cell per lit pixel of the bitmap.
 *
 *  Unknown characters are skipped rather than drawn as a box: a missing glyph
 *  should look like a missing glyph, not like a mistake in the text. */
export function textCells(text: string, options: TextOptions): VoxelCell[] {
  const cells: VoxelCell[] = [];
  const start = options.align === "centre" ? -Math.floor(textWidth(text) / 2) : 0;
  const baseline = options.baseline ?? 0;
  let x = start;
  for (const character of text.toUpperCase()) {
    if (character === " ") { x += SPACE + TRACKING; continue; }
    const glyph = GLYPHS[character];
    if (!glyph) { x += GLYPH_WIDTH + TRACKING; continue; }
    for (const [line, row] of glyph.entries()) {
      for (let column = 0; column < row.length; column++) {
        if (row[column] !== "#") continue;
        cells.push({ x: x + column, y: baseline + (GLYPH_HEIGHT - 1 - line), z: 0, color: options.colour });
      }
    }
    x += GLYPH_WIDTH + TRACKING;
  }
  return cells;
}
