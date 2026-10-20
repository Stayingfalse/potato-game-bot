'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const https = require('https');
const { ROWS, COLS, ROW_LABELS, cellColor, formatCell } = require('./board');

const CELL = 30;
const LABEL_W = 30;
const LABEL_H = 24;
const PAD = 14;
const TITLE_H = 70;
/** Background showing between squares, so neighbouring colours are easy to tell apart. */
const CELL_GAP = 2;
const BOARD_X = PAD + LABEL_W;
const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;
const W = BOARD_X + BOARD_W + PAD;
const SCORE_ROW_H = 34;
const SWATCH = { w: 58, h: 24, gap: 10 };

const BACKGROUND = '#14151f';
const TEXT = '#FFFFFF';
const MUTED = '#9AA0B4';
/** Ring colours: first token, second token, and the square you're still lining up. */
const RING = { 1: '#FFFFFF', 2: '#F1C40F', draft: '#FF4FD8' };

// ── Avatars ────────────────────────────────────────────────────────────────────

/** Avatars are fetched once per URL; failures are remembered too, so a bad URL isn't retried on every nudge. */
const avatarCache = new Map();
const AVATAR_CACHE_LIMIT = 200;

function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(3_000, () => req.destroy(new Error(`Timed out fetching ${url}`)));
    req.on('error', reject);
  });
}

function loadAvatar(url) {
  if (!url) return Promise.resolve(null);
  if (!avatarCache.has(url)) {
    if (avatarCache.size >= AVATAR_CACHE_LIMIT) avatarCache.delete(avatarCache.keys().next().value);
    avatarCache.set(url, fetchBuffer(url).then(loadImage).catch(() => null));
  }
  return avatarCache.get(url);
}

/** A stable colour per name, for avatars that couldn't be loaded. */
function fallbackColor(name) {
  let hash = 0;
  for (const ch of String(name)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360}, 55%, 45%)`;
}

async function drawAvatar(ctx, { avatarURL, username }, x, y, radius, ringColor) {
  const img = await loadAvatar(avatarURL);
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (img) {
    ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
  } else {
    ctx.fillStyle = fallbackColor(username);
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.fillStyle = TEXT;
    ctx.font = `bold ${Math.round(radius * 1.1)}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(username ?? '?').charAt(0).toUpperCase(), x, y + 1);
  }
  ctx.restore();

  if (ringColor) {
    ctx.beginPath();
    ctx.arc(x, y, radius + 1.5, 0, Math.PI * 2);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#000000';
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = ringColor;
    ctx.stroke();
  }
}

// ── Board ──────────────────────────────────────────────────────────────────────

function cellOrigin({ row, col }, boardY) {
  return { x: BOARD_X + col * CELL, y: boardY + row * CELL };
}

function drawBoard(ctx, boardY) {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const { x, y } = cellOrigin({ row, col }, boardY);
      ctx.fillStyle = cellColor({ row, col });
      ctx.fillRect(x + CELL_GAP / 2, y + CELL_GAP / 2, CELL - CELL_GAP, CELL - CELL_GAP);
    }
  }

  ctx.fillStyle = MUTED;
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (let col = 0; col < COLS; col++) {
    ctx.fillText(String(col + 1), BOARD_X + col * CELL + CELL / 2, boardY - LABEL_H / 2);
  }
  for (let row = 0; row < ROWS; row++) {
    ctx.fillText(ROW_LABELS[row], PAD + LABEL_W / 2, boardY + row * CELL + CELL / 2);
  }
}

/**
 * The header: who's giving the clues and what they are, big, with the turn
 * details and the token legend on a smaller line underneath.
 */
function drawTitle(ctx, { heading, subtitle }, legend) {
  const headingY = PAD + 16;
  const subtitleY = PAD + 50;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = TEXT;
  ctx.font = 'bold 24px sans-serif';
  ctx.fillText(truncate(ctx, heading ?? '', W - BOARD_X - PAD), BOARD_X, headingY);
  ctx.fillStyle = MUTED;
  ctx.font = '15px sans-serif';
  ctx.fillText(truncate(ctx, subtitle ?? '', BOARD_W * 0.55), BOARD_X, subtitleY);

  if (!legend) return;
  ctx.font = '13px sans-serif';
  let x = W - PAD;
  for (const [label, color] of [...legend].reverse()) {
    ctx.textAlign = 'right';
    ctx.fillStyle = MUTED;
    ctx.fillText(label, x, subtitleY);
    x -= ctx.measureText(label).width + 16;
    ctx.beginPath();
    ctx.arc(x + 6, subtitleY, 6, 0, Math.PI * 2);
    ctx.lineWidth = 2;
    ctx.strokeStyle = color;
    ctx.stroke();
    x -= 18;
  }
}

function truncate(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && ctx.measureText(`${cut}…`).width > maxWidth) cut = cut.slice(0, -1);
  return `${cut}…`;
}

/** Positions (relative to the cell centre) and radius for `count` tokens sharing a cell. */
function tokenLayout(count) {
  if (count === 1) return { radius: 12, offsets: [[0, 0]] };
  if (count === 2) return { radius: 8, offsets: [[-7, 0], [7, 0]] };
  return { radius: 7, offsets: [[-7, -7], [7, -7], [-7, 7], [7, 7]] };
}

/** Draws tokens, grouping any that share a cell. Each token: { cell, avatarURL, username, ring }. */
async function drawTokens(ctx, tokens, boardY) {
  const byCell = new Map();
  for (const token of tokens) {
    if (!token.cell) continue;
    const key = formatCell(token.cell);
    if (!byCell.has(key)) byCell.set(key, []);
    byCell.get(key).push(token);
  }

  for (const group of byCell.values()) {
    const { x, y } = cellOrigin(group[0].cell, boardY);
    const cx = x + CELL / 2;
    const cy = y + CELL / 2;
    const { radius, offsets } = tokenLayout(group.length);
    const shown = group.length > 4 ? group.slice(0, 3) : group;
    for (const [i, token] of shown.entries()) {
      await drawAvatar(ctx, token, cx + offsets[i][0], cy + offsets[i][1], radius, RING[token.ring]);
    }
    if (group.length > 4) {
      const [ox, oy] = offsets[3];
      ctx.beginPath();
      ctx.arc(cx + ox, cy + oy, radius, 0, Math.PI * 2);
      ctx.fillStyle = '#000000';
      ctx.fill();
      ctx.fillStyle = TEXT;
      ctx.font = 'bold 8px sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(`+${group.length - 3}`, cx + ox, cy + oy);
    }
  }
}

function strokeCells(ctx, target, reach, boardY, style) {
  const top = Math.max(0, target.row - reach);
  const left = Math.max(0, target.col - reach);
  const bottom = Math.min(ROWS - 1, target.row + reach);
  const right = Math.min(COLS - 1, target.col + reach);
  const { x, y } = cellOrigin({ row: top, col: left }, boardY);
  ctx.save();
  ctx.lineWidth = style.width;
  ctx.strokeStyle = style.color;
  ctx.setLineDash(style.dash ?? []);
  ctx.strokeRect(x, y, (right - left + 1) * CELL, (bottom - top + 1) * CELL);
  ctx.restore();
}

/** The official scoring frame: the target, the 3×3 frame and the ring touching it. */
function drawScoringFrame(ctx, target, boardY) {
  strokeCells(ctx, target, 2, boardY, { width: 2, color: '#FFFFFF', dash: [5, 4] });
  strokeCells(ctx, target, 1, boardY, { width: 4, color: '#000000' });
  strokeCells(ctx, target, 1, boardY, { width: 2, color: '#FFFFFF' });
  strokeCells(ctx, target, 0, boardY, { width: 3, color: '#F1C40F' });
}

function newCanvas(extraHeight = 0) {
  const height = PAD + TITLE_H + LABEL_H + BOARD_H + PAD + extraHeight;
  const canvas = createCanvas(W, height);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, W, height);
  return { canvas, ctx, boardY: PAD + TITLE_H + LABEL_H };
}

const TOKEN_LEGEND = [['1st token', RING[1]], ['2nd token', RING[2]]];

/**
 * The board with tokens on it: a guesser's preview, or everyone's first tokens.
 * @param {object} options
 * @param {string} options.heading   the cue giver and their clues
 * @param {string} options.subtitle
 * @param {Array<{cell, avatarURL, username, ring: 1|2|'draft'}>} options.tokens
 */
async function generateBoardImage({ heading, subtitle, tokens }) {
  const { canvas, ctx, boardY } = newCanvas();
  drawTitle(ctx, { heading, subtitle }, tokens.some(t => t.ring === 'draft') ? [...TOKEN_LEGEND, ['yours', RING.draft]] : TOKEN_LEGEND);
  drawBoard(ctx, boardY);
  await drawTokens(ctx, tokens, boardY);
  return canvas.toBuffer('image/png');
}

/**
 * The reveal: every token, the scoring frame around the target, and the score box.
 * @param {object} options
 * @param {string} options.heading   the cue giver and their clues
 * @param {string} options.subtitle
 * @param {{row, col}} options.target
 * @param {Array<{cell, avatarURL, username, ring: 1|2}>} options.tokens
 * @param {Array<{avatarURL, username, cells: Array<{row, col}|null>, turnPoints: number, total: number, isCueGiver: boolean}>} options.scoreRows
 *   `cells` are the player's 1st and 2nd tokens this turn (empty for the cue giver)
 *   in standings order
 */
async function generateRevealImage({ heading, subtitle, target, tokens, scoreRows }) {
  const scoreBoxH = 44 + scoreRows.length * SCORE_ROW_H + PAD;
  const { canvas, ctx, boardY } = newCanvas(scoreBoxH);
  drawTitle(ctx, { heading, subtitle }, TOKEN_LEGEND);
  drawBoard(ctx, boardY);
  drawScoringFrame(ctx, target, boardY);
  await drawTokens(ctx, tokens, boardY);
  await drawScoreBox(ctx, boardY + BOARD_H + PAD, scoreRows, target);
  return canvas.toBuffer('image/png');
}

/** A small square filled with a board colour and labelled with its grid ref; a dash if there's no token. */
function drawCellSwatch(ctx, cell, x, cy) {
  const y = cy - SWATCH.h / 2;
  roundRect(ctx, x, y, SWATCH.w, SWATCH.h, 5);
  if (!cell) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = '#3a3d55';
    ctx.stroke();
  } else {
    const color = cellColor(cell);
    ctx.fillStyle = color;
    ctx.fill();
  }
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = cell ? (isLight(cellColor(cell)) ? '#000000' : '#FFFFFF') : MUTED;
  ctx.fillText(cell ? formatCell(cell) : '—', x + SWATCH.w / 2, cy + 1);
}

/** Whether dark text reads better than white on this colour. */
function isLight(hex) {
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 150;
}

async function drawScoreBox(ctx, top, rows, target) {
  const x = BOARD_X;
  const width = BOARD_W;
  ctx.fillStyle = '#1f2133';
  roundRect(ctx, x, top, width, 36 + rows.length * SCORE_ROW_H, 10);
  ctx.fill();

  const colTurn = x + width - 150;
  const colTotal = x + width - 24;
  ctx.font = 'bold 13px sans-serif';
  ctx.fillStyle = MUTED;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillText('SCORES', x + 16, top + 18);
  ctx.textAlign = 'right';
  ctx.fillText('THIS TURN', colTurn, top + 18);
  ctx.fillText('TOTAL', colTotal, top + 18);
  const swatchX = colTurn - 110 - 3 * SWATCH.w - 2 * SWATCH.gap;
  const swatchCol = n => swatchX + n * (SWATCH.w + SWATCH.gap);
  ctx.textAlign = 'center';
  for (const [n, label] of ['1ST', '2ND', 'ACTUAL'].entries()) ctx.fillText(label, swatchCol(n) + SWATCH.w / 2, top + 18);

  for (const [i, row] of rows.entries()) {
    const cy = top + 36 + i * SCORE_ROW_H + SCORE_ROW_H / 2;
    ctx.font = 'bold 15px sans-serif';
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'left';
    ctx.fillText(`${i + 1}.`, x + 16, cy);
    await drawAvatar(ctx, row, x + 58, cy, 12, null);
    ctx.fillStyle = TEXT;
    ctx.textAlign = 'left';
    const name = row.isCueGiver ? `${row.username}  (cue giver)` : row.username;
    ctx.fillText(truncate(ctx, name, swatchX - x - 96), x + 80, cy);
    for (const [n, cell] of [row.cells[0] ?? null, row.cells[1] ?? null, target].entries()) {
      if (row.isCueGiver && n < 2) continue; // the cue giver places no tokens
      drawCellSwatch(ctx, cell, swatchCol(n), cy);
    }
    ctx.font = 'bold 15px sans-serif';
    ctx.textAlign = 'right';
    ctx.fillStyle = row.turnPoints > 0 ? '#2ECC71' : MUTED;
    ctx.fillText(`+${row.turnPoints}`, colTurn, cy);
    ctx.fillStyle = TEXT;
    ctx.font = 'bold 17px sans-serif';
    ctx.fillText(String(row.total), colTotal, cy);
  }
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// ── The cue giver's card ───────────────────────────────────────────────────────

const CARD_SWATCH_H = 120;
const CARD_SWATCH_GAP = 18;
const CARD_LABEL_H = 56;
const CHOSEN = '#F1C40F';

/** A numbered box around one of the card's squares on the board. */
function drawCardBox(ctx, cell, number, boardY, chosen) {
  strokeCells(ctx, cell, 0, boardY, { width: chosen ? 6 : 5, color: '#000000' });
  strokeCells(ctx, cell, 0, boardY, { width: chosen ? 4 : 3, color: chosen ? CHOSEN : '#FFFFFF' });

  // The number sits in a badge at the box's top-left corner.
  const { x, y } = cellOrigin(cell, boardY);
  ctx.beginPath();
  ctx.arc(x, y, 10, 0, Math.PI * 2);
  ctx.fillStyle = chosen ? CHOSEN : '#FFFFFF';
  ctx.fill();
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#000000';
  ctx.stroke();
  ctx.fillStyle = '#000000';
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(number), x, y + 1);
}

/**
 * The cue giver's card: the board with a numbered box around each of the four
 * colours, and the four colours large underneath with their grid refs. The
 * chosen one (if any) is gold and the others fade.
 */
async function generateCardImage(card, targetIndex = null) {
  const { canvas, ctx, boardY } = newCanvas(CARD_SWATCH_H + CARD_LABEL_H + PAD);
  const chosen = targetIndex === null ? null : card[targetIndex];
  drawTitle(ctx, {
    heading: 'Your card',
    subtitle: chosen ? `You're describing colour ${targetIndex + 1} · ${formatCell(chosen)}` : 'Pick one of these four colours to describe',
  });
  drawBoard(ctx, boardY);
  for (const [i, cell] of card.entries()) {
    if (i !== targetIndex) drawCardBox(ctx, cell, i + 1, boardY, false);
  }
  if (chosen) drawCardBox(ctx, chosen, targetIndex + 1, boardY, true); // on top of the others

  const swatchW = (BOARD_W - (card.length - 1) * CARD_SWATCH_GAP) / card.length;
  const y = boardY + BOARD_H + PAD + 8;
  for (const [i, cell] of card.entries()) {
    const x = BOARD_X + i * (swatchW + CARD_SWATCH_GAP);
    const isChosen = i === targetIndex;
    ctx.globalAlpha = targetIndex === null || isChosen ? 1 : 0.35;
    ctx.fillStyle = cellColor(cell);
    roundRect(ctx, x, y, swatchW, CARD_SWATCH_H, 14);
    ctx.fill();
    if (isChosen) {
      ctx.lineWidth = 5;
      ctx.strokeStyle = CHOSEN;
      ctx.stroke();
    }
    ctx.fillStyle = TEXT;
    ctx.font = 'bold 22px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${i + 1} · ${formatCell(cell)}`, x + swatchW / 2, y + CARD_SWATCH_H + 22);
    if (isChosen) {
      ctx.font = 'bold 13px sans-serif';
      ctx.fillStyle = CHOSEN;
      ctx.fillText('YOUR COLOUR', x + swatchW / 2, y + CARD_SWATCH_H + 44);
    }
    ctx.globalAlpha = 1;
  }
  return canvas.toBuffer('image/png');
}

module.exports = { generateBoardImage, generateRevealImage, generateCardImage };
