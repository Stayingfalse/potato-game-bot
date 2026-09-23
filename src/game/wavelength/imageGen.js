'use strict';

const { createCanvas, loadImage } = require('@napi-rs/canvas');
const https = require('https');

const W = 800;
const H = 460;
const TITLE_Y = 8;
const PIVOT_X = W / 2;
const PIVOT_Y = 310;
const RADIUS = 150;
const BAR_H = 40;
const LABEL_Y = 364;
const LABEL_MARGIN_X = 56;
const LABEL_MAX_W = 190;
const CATEGORY_Y = LABEL_Y + 24;
const TOP_CARD = {
  x: 40,
  y: 38,
  width: W - 80,
  height: 66,
};
const BOTTOM_CARD = {
  x: 40,
  y: CATEGORY_Y,
  width: W - 80,
  height: 50,
};
const WEDGE_RADIUS = RADIUS - BAR_H / 2; // scoring wedges run pivot → band's inner edge
const MAX_VISIBLE_STACK = 4;
const STACK_BUCKET_PX = 12;

const TIER_WITHIN_FIVE = 5;
const TIER_WITHIN_TEN = 10;
const TIER_WITHIN_TWENTY = 20;

function clampPosition(pos) {
  return Math.max(0, Math.min(100, pos));
}

function posToPoint(pos, radius = RADIUS) {
  const clamped = clampPosition(pos);
  const angle = Math.PI - (clamped / 100) * Math.PI;
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

function wrapText(ctx, text, maxWidth, maxLines = 2) {
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

function drawCard(ctx, x, y, width, height, title, value, accentColor, options = {}) {
  const {
    valueFont = 'bold 20px sans-serif',
    maxLines = 2,
    titleInsetX = 16,
    valueMaxWidth = width - 32,
  } = options;

  ctx.save();
  ctx.fillStyle = 'rgba(17, 24, 39, 0.92)';
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 14);
  ctx.fill();

  ctx.strokeStyle = accentColor;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 14);
  ctx.stroke();

  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = accentColor;
  ctx.fillText(title.toUpperCase(), x + titleInsetX, y + 12);

  ctx.font = valueFont;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';

  const lines = wrapText(ctx, value, valueMaxWidth, maxLines);
  const lineHeight = 22;
  const startY = y + height / 2 + 4 - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, idx) => {
    ctx.fillText(line, x + width / 2, startY + idx * lineHeight);
  });
  ctx.restore();
}

function drawTitle(ctx, text) {
  ctx.font = 'bold 15px sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillStyle = 'rgba(255,255,255,0.6)';
  ctx.fillText(text, 10, TITLE_Y);
}

function drawArc(ctx) {
  ctx.beginPath();
  ctx.arc(PIVOT_X, PIVOT_Y, RADIUS, Math.PI, 0);
  ctx.lineWidth = BAR_H;
  ctx.strokeStyle = '#D9C9A3';
  ctx.stroke();

  ctx.strokeStyle = 'rgba(255,255,255,0.25)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(PIVOT_X, PIVOT_Y, RADIUS, Math.PI, 0);
  ctx.stroke();

  for (const pos of [0, 25, 50, 75, 100]) {
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

function drawLabels(ctx, spectrum) {
  ctx.save();
  ctx.font = 'bold 18px sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#FFFFFF';

  ctx.textAlign = 'left';
  ctx.fillText(
    truncateToWidth(ctx, spectrum.left, LABEL_MAX_W),
    LABEL_MARGIN_X,
    LABEL_Y,
  );

  ctx.textAlign = 'right';
  ctx.fillText(
    truncateToWidth(ctx, spectrum.right, LABEL_MAX_W),
    W - LABEL_MARGIN_X,
    LABEL_Y,
  );
  ctx.restore();
}

async function drawAvatar(ctx, avatarURL, username, point, radius, badgeText = null) {
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

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();

  if (badgeText != null) {
    const badgeX = x + radius * 0.7;
    const badgeY = y + radius * 0.7;
    ctx.beginPath();
    ctx.arc(badgeX, badgeY, 10, 0, Math.PI * 2);
    ctx.fillStyle = '#111827';
    ctx.fill();
    ctx.strokeStyle = '#FFFFFF';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#FFFFFF';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(badgeText), badgeX, badgeY);
  }
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
  ctx.arc(PIVOT_X, PIVOT_Y, 16, 0, Math.PI * 2);
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

function drawOverflowChip(ctx, point, remainingCount) {
  const label = `+${remainingCount}`;
  const width = Math.max(28, 18 + ctx.measureText(label).width);
  const height = 24;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(point.x - width / 2, point.y - height / 2, width, height, 12);
  ctx.fillStyle = '#111827';
  ctx.fill();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#FFFFFF';
  ctx.font = 'bold 12px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, point.x, point.y);
  ctx.restore();
}

function fillWedge(ctx, startPos, endPos, color) {
  const clampedStart = clampPosition(startPos);
  const clampedEnd = clampPosition(endPos);
  if (clampedStart === clampedEnd) return;

  const startAngle = posToCanvasAngle(clampedStart);
  const endAngle = posToCanvasAngle(clampedEnd);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(PIVOT_X, PIVOT_Y);
  ctx.arc(PIVOT_X, PIVOT_Y, WEDGE_RADIUS, startAngle, endAngle);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
}

function drawBandBoundary(ctx, pos, lineWidth = 2) {
  const outer = posToPoint(pos, WEDGE_RADIUS + 2);

  ctx.save();
  ctx.beginPath();
  ctx.moveTo(PIVOT_X, PIVOT_Y);
  ctx.lineTo(outer.x, outer.y);
  ctx.strokeStyle = 'rgba(255,255,255,0.9)';
  ctx.lineWidth = lineWidth;
  ctx.stroke();
  ctx.restore();
}

function drawScoringBands(ctx, targetPosition) {
  const bands = [
    { dist: TIER_WITHIN_TWENTY, color: 'rgba(243, 156, 18, 0.90)' },
    { dist: TIER_WITHIN_TEN, color: 'rgba(142, 68, 173, 0.92)' },
    { dist: TIER_WITHIN_FIVE, color: 'rgba(46, 204, 113, 0.95)' },
  ].sort((a, b) => b.dist - a.dist);

  for (const { dist, color } of bands) {
    const startPos = targetPosition - dist;
    const endPos = targetPosition + dist;
    fillWedge(ctx, startPos, endPos, color);
    if (startPos >= 0) drawBandBoundary(ctx, startPos, dist === TIER_WITHIN_FIVE ? 3 : 2);
    if (endPos <= 100) drawBandBoundary(ctx, endPos, dist === TIER_WITHIN_FIVE ? 3 : 2);
  }
}

function drawClueCard(ctx, clue) {
  drawCard(ctx, TOP_CARD.x, TOP_CARD.y, TOP_CARD.width, TOP_CARD.height, 'Clue', clue ? `“${clue}”` : '—', '#58A6FF');
}

function drawCategoryCard(ctx, spectrum) {
  drawCard(
    ctx,
    BOTTOM_CARD.x,
    BOTTOM_CARD.y,
    BOTTOM_CARD.width,
    BOTTOM_CARD.height,
    'Category',
    `${spectrum.left} ↔ ${spectrum.right}`,
    '#F1C40F',
    { valueFont: 'bold 18px sans-serif', maxLines: 1, valueMaxWidth: BOTTOM_CARD.width - 32 },
  );
}

async function generateClueGiverImage(spectrum, targetPosition) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);
  drawClueCard(ctx, null);
  drawArc(ctx);
  drawScoringBands(ctx, targetPosition);

  const targetMarkerPoint = posToPoint(targetPosition);
  drawPivotHubAndNeedle(ctx, targetMarkerPoint, '#FFD700');

  drawLabels(ctx, spectrum);
  drawCategoryCard(ctx, spectrum);
  drawTitle(ctx, 'Your hidden target');

  return canvas.toBuffer('image/png');
}

async function generateGuesserImage(avatarURL, username, spectrum, position, clue) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);
  drawClueCard(ctx, clue);
  drawArc(ctx);

  const guessPoint = posToPoint(position);
  drawPivotHubAndNeedle(ctx, guessPoint);
  await drawAvatar(ctx, avatarURL, username, guessPoint, 20, position);

  drawLabels(ctx, spectrum);
  drawCategoryCard(ctx, spectrum);
  drawTitle(ctx, 'Your guess');

  return canvas.toBuffer('image/png');
}

async function generateRevealImage(spectrum, targetPosition, playerGuesses, clue) {
  const canvas = createCanvas(W, H);
  const ctx = canvas.getContext('2d');

  drawBackground(ctx);
  drawClueCard(ctx, clue);
  drawArc(ctx);

  const targetMarkerPoint = posToPoint(targetPosition);
  drawScoringBands(ctx, targetPosition);
  drawPivotHubAndNeedle(ctx, targetMarkerPoint, '#FFD700');

  const buckets = new Map();
  const AVATAR_R = 18;

  for (const guess of playerGuesses) {
    const point = posToPoint(guess.position);
    const arcOffsetPx = (clampPosition(guess.position) / 100) * Math.PI * RADIUS;
    const key = String(Math.round(arcOffsetPx / STACK_BUCKET_PX));
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ ...guess, point });
  }

  ctx.font = 'bold 12px sans-serif';
  for (const guesses of buckets.values()) {
    const visibleSlotCount = Math.min(guesses.length, MAX_VISIBLE_STACK);
    const hasOverflow = guesses.length > MAX_VISIBLE_STACK;
    const visibleAvatarCount = hasOverflow ? visibleSlotCount - 1 : visibleSlotCount;

    for (let idx = 0; idx < visibleAvatarCount; idx++) {
      const { avatarURL, username, point } = guesses[idx];
      const avatarPoint = offsetFromPivot(point, idx * (AVATAR_R * 2 + 6));
      await drawAvatar(ctx, avatarURL, username, avatarPoint, AVATAR_R);
    }

    if (hasOverflow) {
      const overflowPoint = offsetFromPivot(
        guesses[visibleAvatarCount].point,
        visibleAvatarCount * (AVATAR_R * 2 + 6),
      );
      drawOverflowChip(ctx, overflowPoint, guesses.length - visibleAvatarCount);
    }
  }

  if (playerGuesses.length > 0) {
    const avg = playerGuesses.reduce((sum, guess) => sum + guess.position, 0) / playerGuesses.length;
    const avgPoint = posToPoint(avg);
    const markerPoint = offsetFromPivot(avgPoint, 30);

    drawRadialTriangle(ctx, markerPoint, '#E91E63', 10);

    ctx.font = '11px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const avgLabelPoint = offsetFromPivot(markerPoint, 20);
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#111827';
    ctx.strokeText('AVG', avgLabelPoint.x, avgLabelPoint.y + 2);
    ctx.fillStyle = '#E91E63';
    ctx.fillText('AVG', avgLabelPoint.x, avgLabelPoint.y + 2);
  }

  drawLabels(ctx, spectrum);
  drawCategoryCard(ctx, spectrum);
  drawTitle(ctx, 'Results');

  return canvas.toBuffer('image/png');
}

module.exports = { generateClueGiverImage, generateGuesserImage, generateRevealImage };
