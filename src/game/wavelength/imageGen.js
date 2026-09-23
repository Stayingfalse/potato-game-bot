'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const https = require('https');

// ── Canvas layout constants ────────────────────────────────────────────────────
const W          = 800;
const H          = 320;
const PIVOT_X    = W / 2;
const PIVOT_Y    = 270;
const RADIUS     = 150;
const BAR_H      = 40;   // arc thickness
const LABEL_X_INSET = Math.round(RADIUS * 0.36);
const LABEL_Y    = 298;  // concept labels baseline
const INFO_Y     = 38;
const INFO_H     = 78;
const INFO_GAP   = 18;
const INFO_W     = (W - 80 - INFO_GAP) / 2;

// Visible scoring bands (the exact bullseye is represented by the target marker itself).
const TIER_WITHIN_FIVE   = 5;
const TIER_WITHIN_TEN    = 10;
const TIER_WITHIN_TWENTY = 20;

// ── Helpers ────────────────────────────────────────────────────────────────────

function clampPosition(pos) {
  return Math.max(0, Math.min(100, pos));
}

/** Convert a 0–100 position value to a point on the semi-circular dial. */
function posToPoint(pos, radius = RADIUS) {
  const clamped = clampPosition(pos);
  const angle = Math.PI - (clamped / 100) * Math.PI; // 180°→0°
  return {
    x: PIVOT_X + radius * Math.cos(angle),
    y: PIVOT_Y - radius * Math.sin(angle),
  };
}

function posToCanvasAngle(pos) {
  return Math.PI + (clampPosition(pos) / 100) * Math.PI;
}

function offsetFromPivot(point, distance) {
  const dx = point.x - PIVOT_X;
  const dy = point.y - PIVOT_Y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: point.x + (dx / length) * distance,
    y: point.y + (dy / length) * distance,
  };
}

/**
 * Fetch an image URL and return a Buffer.
 * Uses Node's built-in https so no extra dep is needed.
 */
function fetchBuffer(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} fetching ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    }).on('error', reject);
  });
}

/**
 * Draw the gradient spectrum arc onto a canvas context.
 * Left side is warm orange, right side is cool blue — generic enough for any pair.
 */
function drawArc(ctx) {
  const grad = ctx.createLinearGradient(PIVOT_X - RADIUS, 0, PIVOT_X + RADIUS, 0);
  grad.addColorStop(0,    '#E74C3C'); // red-orange (left)
  grad.addColorStop(0.5,  '#F1C40F'); // yellow (centre)
  grad.addColorStop(1,    '#3498DB'); // blue (right)

  ctx.beginPath();
  ctx.arc(PIVOT_X, PIVOT_Y, RADIUS, Math.PI, 0);
  ctx.lineWidth = BAR_H;
  ctx.strokeStyle = grad;
  ctx.stroke();

  // Border
  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(PIVOT_X, PIVOT_Y, RADIUS, Math.PI, 0);
  ctx.stroke();

  const tickPositions = [0, 25, 50, 75, 100];
  for (const pos of tickPositions) {
    const point = posToPoint(pos);
    const inner = offsetFromPivot(point, pos === 50 ? -14 : -10);
    const outer = offsetFromPivot(point, pos === 50 ? 16 : 10);
    ctx.beginPath();
    ctx.moveTo(inner.x, inner.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = pos === 50 ? 3 : 2;
    ctx.stroke();
  }
}

/**
 * Draw concept labels centred at each end of the bar.
 */
function drawLabels(ctx, spectrum) {
  ctx.font = 'bold 18px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';

  // Left label
  ctx.fillText(spectrum.left,  PIVOT_X - RADIUS + LABEL_X_INSET, LABEL_Y);
  // Right label
  ctx.fillText(spectrum.right, PIVOT_X + RADIUS - LABEL_X_INSET, LABEL_Y);
}

/**
 * Draw a circular-clipped avatar at a given point.
 * Falls back to a solid circle with the user's initial if the avatar fails.
 */
async function drawAvatar(ctx, avatarURL, username, point, radius) {
  const { x, y } = point;
  ctx.save();
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.clip();

  try {
    const buf = await fetchBuffer(avatarURL);
    const img = await loadImage(buf);
    ctx.drawImage(img, x - radius, y - radius, radius * 2, radius * 2);
  } catch {
    // Fallback: solid colour + initial
    ctx.fillStyle = '#7289DA';
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
    ctx.restore();
    ctx.save();
    ctx.font = `bold ${radius}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText((username ?? '?')[0].toUpperCase(), x, y);
  }

  ctx.restore();

  // White ring
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();
}

/**
 * Draw a diamond shape at a point on the dial (used for the target marker).
 */
function drawDiamond(ctx, point, color = '#FFD700', size = 14) {
  const { x: xPos, y: yPos } = point;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(xPos,        yPos - size);
  ctx.lineTo(xPos + size, yPos);
  ctx.lineTo(xPos,        yPos + size);
  ctx.lineTo(xPos - size, yPos);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

/** Fill the canvas background. */
function drawBackground(ctx) {
  ctx.fillStyle = '#2C2F33';
  ctx.fillRect(0, 0, W, H);
}

function truncateToWidth(ctx, text, maxWidth) {
  if (ctx.measureText(text).width <= maxWidth) return text;
  let trimmed = text;
  while (trimmed.length > 1 && ctx.measureText(`${trimmed}…`).width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return `${trimmed}…`;
}

function wrapCardText(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  if (!words.length) return ['—'];

  const lines = [];
  let current = '';

  for (let i = 0; i < words.length; i++) {
    const rawWord = words[i];
    const word = ctx.measureText(rawWord).width <= maxWidth ? rawWord : truncateToWidth(ctx, rawWord, maxWidth);
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
      continue;
    }

    if (!current) current = word;
    if (lines.length === maxLines - 1) {
      lines.push(truncateToWidth(ctx, `${current} ${words.slice(i + 1).join(' ')}`.trim(), maxWidth));
      return lines;
    }
    lines.push(current);
    current = word;
  }

  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

function drawInfoCard(ctx, x, y, title, value, accentColor) {
  ctx.save();
  ctx.fillStyle = 'rgba(17, 24, 39, 0.92)';
  ctx.beginPath();
  ctx.roundRect(x, y, INFO_W, INFO_H, 14);
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, INFO_W, INFO_H, 14);
  ctx.stroke();

  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = accentColor;
  ctx.fillText(title.toUpperCase(), x + 16, y + 12);

  ctx.font = 'bold 20px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';

  const lines = wrapCardText(ctx, value, INFO_W - 32, 2);
  const lineHeight = 22;
  const startY = y + 46 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, idx) => {
    ctx.fillText(line, x + INFO_W / 2, startY + idx * lineHeight);
  });
  ctx.restore();
}

function drawPivotHubAndNeedle(ctx, point, color = '#FFFFFF') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(PIVOT_X, PIVOT_Y);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(PIVOT_X, PIVOT_Y, 9, 0, Math.PI * 2);
  ctx.fillStyle = '#111827';
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.restore();
}

function drawRadialTriangle(ctx, point, color = '#E91E63', size = 10) {
  const dx = point.x - PIVOT_X;
  const dy = point.y - PIVOT_Y;
  const length = Math.hypot(dx, dy) || 1;
  const ux = dx / length;
  const uy = dy / length;
  const tx = -uy;
  const ty = ux;

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(point.x + ux * size, point.y + uy * size);
  ctx.lineTo(point.x - ux * size + tx * size * 0.85, point.y - uy * size + ty * size * 0.85);
  ctx.lineTo(point.x - ux * size - tx * size * 0.85, point.y - uy * size - ty * size * 0.85);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

function fillWedge(ctx, startPos, endPos, color) {
  const clampedStart = clampPosition(startPos);
  const clampedEnd = clampPosition(endPos);
  if (clampedStart === clampedEnd) return;

  const innerRadius = RADIUS - BAR_H / 2;
  const outerRadius = RADIUS + BAR_H / 2;
  const startAngle = posToCanvasAngle(clampedStart);
  const endAngle = posToCanvasAngle(clampedEnd);

  ctx.save();
  ctx.beginPath();
  ctx.arc(PIVOT_X, PIVOT_Y, outerRadius, startAngle, endAngle);
  ctx.arc(PIVOT_X, PIVOT_Y, innerRadius, endAngle, startAngle, true);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

// ── Scoring bands (drawn as scoring wedges on reveal) ─────────────────────────
function drawScoringBands(ctx, targetPosition) {
  const bands = [
    { dist: TIER_WITHIN_TWENTY, color: 'rgba(243, 156, 18, 0.90)' }, // orange outer
    { dist: TIER_WITHIN_TEN, color: 'rgba(142, 68, 173, 0.92)' },    // purple mid
    { dist: TIER_WITHIN_FIVE, color: 'rgba(46, 204, 113, 0.95)' },   // green bullseye
  ].sort((a, b) => b.dist - a.dist);

  for (const { dist, color } of bands) {
    fillWedge(ctx, targetPosition - dist, targetPosition + dist, color);
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Generate the image shown (ephemerally) to the Clue Giver.
 * Shows the spectrum bar and the hidden target marked with a diamond.
 *
 * @param {{ left: string, right: string }} spectrum
 * @param {number} targetPosition  0–100
 * @returns {Promise<Buffer>}
 */
async function generateClueGiverImage(spectrum, targetPosition) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  drawBackground(ctx);
  drawArc(ctx);

  const targetPoint = posToPoint(targetPosition);
  drawPivotHubAndNeedle(ctx, targetPoint, '#FFD700');
  drawDiamond(ctx, targetPoint, '#FFD700', 16);

  // Label above the diamond
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#FFD700';
  const targetLabelPoint = offsetFromPivot(targetPoint, 28);
  ctx.fillText('TARGET', targetLabelPoint.x, targetLabelPoint.y - 6);

  drawLabels(ctx, spectrum);

  // Title
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('🎯 Your hidden target', 10, 8);

  return canvas.toBuffer('image/png');
}

/**
 * Generate the per-guesser nudge panel image.
 * Shows the spectrum bar with the guesser's avatar at their current position.
 *
 * @param {string} avatarURL
 * @param {string} username
 * @param {{ left: string, right: string }} spectrum
 * @param {number} position  0–100
 * @param {string} clue
 * @returns {Promise<Buffer>}
 */
async function generateGuesserImage(avatarURL, username, spectrum, position, clue) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  drawBackground(ctx);
  drawInfoCard(ctx, 40, INFO_Y, 'Clue', clue ? `“${clue}”` : '—', '#58A6FF');
  drawInfoCard(ctx, 40 + INFO_W + INFO_GAP, INFO_Y, 'Category', `${spectrum.left} ↔ ${spectrum.right}`, '#F1C40F');
  drawArc(ctx);

  const guessPoint = posToPoint(position);
  drawPivotHubAndNeedle(ctx, guessPoint);
  await drawAvatar(ctx, avatarURL, username, offsetFromPivot(guessPoint, 28), 20);

  // Position label
  ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  ctx.fillStyle = '#FFFFFF';
  const labelPoint = offsetFromPivot(guessPoint, 54);
  ctx.fillText(`${position}`, labelPoint.x, labelPoint.y + 4);

  drawLabels(ctx, spectrum);

  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('📍 Your guess', 10, 8);

  return canvas.toBuffer('image/png');
}

/**
 * Generate the public reveal image posted in the thread.
 * Shows all guesser avatars, the target diamond, the group-average marker,
 * and semi-transparent tier-band overlays.
 *
 * @param {{ left: string, right: string }} spectrum
 * @param {number} targetPosition
 * @param {Array<{ userId: string, username: string, avatarURL: string, position: number }>} playerGuesses
 * @param {string} clue
 * @returns {Promise<Buffer>}
 */
async function generateRevealImage(spectrum, targetPosition, playerGuesses, clue) {
  const canvas = createCanvas(W, H);
  const ctx    = canvas.getContext('2d');

  drawBackground(ctx);
  drawInfoCard(ctx, 40, INFO_Y, 'Clue', clue ? `“${clue}”` : '—', '#58A6FF');
  drawInfoCard(ctx, 40 + INFO_W + INFO_GAP, INFO_Y, 'Category', `${spectrum.left} ↔ ${spectrum.right}`, '#F1C40F');
  drawArc(ctx);

  const targetPoint = posToPoint(targetPosition);
  drawScoringBands(ctx, targetPosition);
  drawPivotHubAndNeedle(ctx, targetPoint, '#FFD700');

  // Group average
  if (playerGuesses.length > 0) {
    const avg = playerGuesses.reduce((s, g) => s + g.position, 0) / playerGuesses.length;
    const avgPoint = posToPoint(avg);
    const markerPoint = offsetFromPivot(avgPoint, 20);

    // Triangle marker for average
    const sz = 10;
    drawRadialTriangle(ctx, markerPoint, '#E91E63', sz);

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#E91E63';
    const avgLabelPoint = offsetFromPivot(markerPoint, sz + 10);
    ctx.fillText('AVG', avgLabelPoint.x, avgLabelPoint.y + 2);
  }

  // Target diamond
  drawDiamond(ctx, targetPoint, '#FFD700', 16);
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillStyle = '#FFD700';
  const targetLabelPoint = offsetFromPivot(targetPoint, 28);
  ctx.fillText('TARGET', targetLabelPoint.x, targetLabelPoint.y - 6);

  // Player avatars — stack them radially outward if they cluster at the same point.
  const BUCKET = 6;
  const buckets = new Map(); // point bucket → radial stack index
  const AVATAR_R = 18;

  for (const g of playerGuesses) {
    const point = posToPoint(g.position);
    const key = `${Math.round(point.x / BUCKET)}:${Math.round(point.y / BUCKET)}`;
    const idx = buckets.has(key) ? buckets.get(key) : 0;
    buckets.set(key, idx + 1);
    const avatarPoint = offsetFromPivot(point, 26 + idx * (AVATAR_R * 2 + 6));
    await drawAvatar(ctx, g.avatarURL, g.username, avatarPoint, AVATAR_R);
  }

  drawLabels(ctx, spectrum);

  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText('🏁 Results', 10, 8);

  return canvas.toBuffer('image/png');
}

module.exports = { generateClueGiverImage, generateGuesserImage, generateRevealImage };
