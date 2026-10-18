'use strict';

const { createCanvas } = require('@napi-rs/canvas');
const { CATEGORIES, CATEGORY_ORDER, FINISH, SQUARES, SPINNER } = require('./board');

const W = 760;
const HEADER_H = 54;
const LEGEND_H = 46;
const H = HEADER_H + W + LEGEND_H;
const CX = W / 2;
const CY = HEADER_H + W / 2;
const OUTER_R = 350;
const INNER_R = 262;
/** Spin squares reach further into the middle, as on the real board. */
const SPIN_INNER_R = 205;
const SPINNER_R = 150;
const SEGMENT = (Math.PI * 2) / SQUARES.length;
const GAP = 0.012;

const BACKGROUND = '#14151f';
const TEXT = '#FFFFFF';
const MUTED = '#9AA0B4';
const SPINNER_COLORS = { red: '#D93A2F', orange: '#F0882A', wide: '#2E9E55', narrow: '#1F7A3E' };

/** Angle (radians, canvas) of the start of square `i`: square 0 is at the top, going clockwise. */
function squareAngle(i) {
  return -Math.PI / 2 - SEGMENT / 2 + i * SEGMENT;
}

function annularSector(ctx, startAngle, endAngle, inner, outer) {
  ctx.beginPath();
  ctx.arc(CX, CY, outer, startAngle, endAngle);
  ctx.arc(CX, CY, inner, endAngle, startAngle, true);
  ctx.closePath();
}

function polar(angle, radius) {
  return { x: CX + Math.cos(angle) * radius, y: CY + Math.sin(angle) * radius };
}

function drawSquares(ctx) {
  for (const [i, square] of SQUARES.entries()) {
    const start = squareAngle(i) + GAP;
    const end = squareAngle(i + 1) - GAP;
    const mid = (start + end) / 2;
    let fill = '#FFFFFF';
    let inner = INNER_R;
    if (square.kind === 'category' || square.kind === 'start') {
      const category = CATEGORIES[square.category];
      fill = category.color;
      if (square.kind === 'category' && category.spin) inner = SPIN_INNER_R;
    } else if (square.kind === 'finish') {
      fill = '#111111';
    }
    annularSector(ctx, start, end, inner, OUTER_R);
    ctx.fillStyle = fill;
    ctx.fill();

    if (square.kind === 'control') {
      label(ctx, '♠', polar(mid, (INNER_R + OUTER_R) / 2), 'bold 20px sans-serif', '#111111');
    } else if (square.kind === 'finish') {
      // A chequered finish square.
      ctx.save();
      annularSector(ctx, start, end, INNER_R, OUTER_R);
      ctx.clip();
      ctx.fillStyle = '#FFFFFF';
      for (let r = INNER_R; r < OUTER_R; r += 11) {
        for (let k = 0; k < 2; k++) {
          const a = start + (k * (end - start)) / 2;
          if ((Math.round((r - INNER_R) / 11) + k) % 2 === 0) {
            annularSector(ctx, a, a + (end - start) / 2, r, r + 11);
            ctx.fill();
          }
        }
      }
      ctx.restore();
    }
  }

  label(ctx, 'START', polar(squareAngle(0) + SEGMENT / 2, OUTER_R + 16), 'bold 12px sans-serif', TEXT);
  label(ctx, 'FINISH', polar(squareAngle(FINISH) + SEGMENT / 2, OUTER_R + 16), 'bold 12px sans-serif', TEXT);
}

function label(ctx, text, { x, y }, font, color) {
  ctx.font = font;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
}

/** Team pieces: a disc in the team's colour with its initial. Teams sharing a square stack inwards. */
function drawPieces(ctx, teams, currentTeam) {
  const stacked = new Map();
  for (const [i, team] of teams.entries()) {
    const position = Math.min(team.position, FINISH);
    const slot = stacked.get(position) ?? 0;
    stacked.set(position, slot + 1);
    const { x, y } = polar(squareAngle(position) + SEGMENT / 2, OUTER_R - 16 - slot * 24);
    ctx.beginPath();
    ctx.arc(x, y, 12, 0, Math.PI * 2);
    ctx.fillStyle = team.color;
    ctx.fill();
    ctx.lineWidth = i === currentTeam ? 4 : 2;
    ctx.strokeStyle = i === currentTeam ? '#FFFFFF' : '#000000';
    ctx.stroke();
    label(ctx, team.name.charAt(0), { x, y: y + 1 }, 'bold 13px sans-serif', '#000000');
  }
}

/** The spinner in the middle of the board, with the arrow at `angle` degrees (clockwise from the top). */
function drawSpinner(ctx, angle) {
  let start = -Math.PI / 2;
  for (const section of SPINNER) {
    const end = start + (section.sweep * Math.PI) / 180;
    ctx.beginPath();
    ctx.moveTo(CX, CY);
    ctx.arc(CX, CY, SPINNER_R, start, end);
    ctx.closePath();
    ctx.fillStyle = SPINNER_COLORS[section.key];
    ctx.fill();
    if (section.steps) {
      const mid = (start + end) / 2;
      label(ctx, String(section.steps), polar(mid, SPINNER_R * 0.72), 'bold 18px sans-serif', TEXT);
    }
    start = end;
  }
  ctx.beginPath();
  ctx.arc(CX, CY, SPINNER_R, 0, Math.PI * 2);
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#000000';
  ctx.stroke();

  if (angle === null || angle === undefined) {
    label(ctx, 'ARTICULATE', { x: CX, y: CY }, 'bold 22px sans-serif', TEXT);
    return;
  }
  const a = -Math.PI / 2 + (angle * Math.PI) / 180;
  const tip = polar(a, SPINNER_R - 10);
  const left = polar(a + Math.PI / 2, 9);
  const right = polar(a - Math.PI / 2, 9);
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(left.x, left.y);
  ctx.lineTo(right.x, right.y);
  ctx.closePath();
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(CX, CY, 12, 0, Math.PI * 2);
  ctx.fillStyle = '#FFFFFF';
  ctx.fill();
  ctx.stroke();
}

function drawLegend(ctx) {
  const items = [...CATEGORY_ORDER.map(key => [CATEGORIES[key].name, CATEGORIES[key].color]), ['Control ♠', '#FFFFFF']];
  ctx.font = '14px sans-serif';
  const widths = items.map(([name]) => ctx.measureText(name).width + 30);
  let x = CX - widths.reduce((sum, w) => sum + w, 0) / 2;
  const y = H - LEGEND_H / 2;
  for (const [i, [name, color]] of items.entries()) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y - 7, 14, 14);
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(name, x + 19, y + 1);
    x += widths[i];
  }
}

/**
 * The board with every team's piece.
 * @param {object} options
 * @param {string} options.heading
 * @param {Array<{name, color, position}>} options.teams
 * @param {number} [options.currentTeam]  outlined in white
 * @param {number|null} [options.spinAngle]  where the spinner's arrow points, if it has just been spun
 */
async function generateBoardImage({ heading, teams, currentTeam = null, spinAngle = null }) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, W, H);
  label(ctx, heading, { x: CX, y: HEADER_H / 2 + 4 }, 'bold 22px sans-serif', TEXT);
  drawSquares(ctx);
  drawSpinner(ctx, spinAngle);
  drawPieces(ctx, teams, currentTeam);
  drawLegend(ctx);
  return canvas.toBuffer('image/png');
}

module.exports = { generateBoardImage };
