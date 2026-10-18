'use strict';

/**
 * The Hues & Clues colour board: 16 rows (A–P, top to bottom) × 30 columns
 * (1–30, left to right). Cells are `{ row, col }`, both 0-based; players see
 * them as grid refs like "F12".
 *
 * The colours are generated, not stored: hue sweeps across the columns and
 * lightness falls down the rows, so a cell's colour is always the same.
 */

const ROWS = 16;
const COLS = 30;
const ROW_LABELS = 'ABCDEFGHIJKLMNOP';
const CARD_SIZE = 4;
/** Card colours are at least this far apart (in cells), so they look different. */
const CARD_MIN_SPREAD = 3;

/** The board centre, where a fresh token starts. */
const CENTRE = Object.freeze({ row: Math.floor(ROWS / 2) - 1, col: Math.floor(COLS / 2) - 1 });

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const hex = x => Math.round(x * 255).toString(16).padStart(2, '0');
  return `#${hex(f(0))}${hex(f(8))}${hex(f(4))}`;
}

/** The colour of a cell, as a #rrggbb string. */
function cellColor({ row, col }) {
  const hue = (col / COLS) * 360;
  const lightness = 80 - row * (62 / (ROWS - 1)); // 80% at the top → 18% at the bottom
  const saturation = 90 - Math.abs(row - (ROWS - 1) / 2) * 2;
  return hslToHex(hue, saturation, lightness);
}

function isOnBoard(cell) {
  return Number.isInteger(cell?.row) && Number.isInteger(cell?.col)
    && cell.row >= 0 && cell.row < ROWS && cell.col >= 0 && cell.col < COLS;
}

function clampCell({ row, col }) {
  return {
    row: Math.max(0, Math.min(ROWS - 1, row)),
    col: Math.max(0, Math.min(COLS - 1, col)),
  };
}

/** "F12" for `{ row: 5, col: 11 }`. */
function formatCell(cell) {
  return isOnBoard(cell) ? `${ROW_LABELS[cell.row]}${cell.col + 1}` : '?';
}

/** Reads a grid ref such as "F12", "f 12" or "12F". Returns null if it isn't on the board. */
function parseCell(text) {
  const clean = String(text ?? '').toUpperCase().replace(/[\s\-,]/g, '');
  let letter, number;
  const letterFirst = clean.match(/^([A-Z])(\d{1,2})$/);
  const numberFirst = clean.match(/^(\d{1,2})([A-Z])$/);
  if (letterFirst) [, letter, number] = letterFirst;
  else if (numberFirst) [, number, letter] = numberFirst;
  else return null;

  const cell = { row: ROW_LABELS.indexOf(letter), col: Number(number) - 1 };
  return isOnBoard(cell) ? cell : null;
}

/** Steps between two cells, counting diagonals as one (so the 3×3 frame is distance ≤ 1). */
function distance(a, b) {
  return Math.max(Math.abs(a.row - b.row), Math.abs(a.col - b.col));
}

function sameCell(a, b) {
  return !!a && !!b && a.row === b.row && a.col === b.col;
}

/** Draws a card of four well-spread colours. */
function drawCard(random = Math.random) {
  const card = [];
  while (card.length < CARD_SIZE) {
    const cell = { row: Math.floor(random() * ROWS), col: Math.floor(random() * COLS) };
    if (card.every(other => distance(other, cell) >= CARD_MIN_SPREAD)) card.push(cell);
  }
  return card;
}

module.exports = {
  ROWS,
  COLS,
  ROW_LABELS,
  CARD_SIZE,
  CENTRE,
  cellColor,
  isOnBoard,
  clampCell,
  formatCell,
  parseCell,
  distance,
  sameCell,
  drawCard,
};
