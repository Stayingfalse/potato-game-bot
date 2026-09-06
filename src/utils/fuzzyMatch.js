'use strict';

/**
 * Lightweight fuzzy string matching — no external dependencies.
 * Used to match a player's free-text "which category does this violate?"
 * challenge input against the game's stored (hidden) category list.
 */

function normalize(str) {
  return String(str ?? '')
    .toLowerCase()
    .replace(/^no more[.\u2026]*\s*/i, '')
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Classic Levenshtein edit-distance. */
function levenshtein(a, b) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;

  const prevRow = new Array(n + 1);
  const curRow = new Array(n + 1);
  for (let j = 0; j <= n; j++) prevRow[j] = j;

  for (let i = 1; i <= m; i++) {
    curRow[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curRow[j] = Math.min(
        prevRow[j] + 1,      // deletion
        curRow[j - 1] + 1,   // insertion
        prevRow[j - 1] + cost, // substitution
      );
    }
    for (let j = 0; j <= n; j++) prevRow[j] = curRow[j];
  }
  return prevRow[n];
}

/** Similarity score in [0, 1], 1 = identical (after normalization). */
function similarity(a, b) {
  const na = normalize(a);
  const nb = normalize(b);
  if (!na && !nb) return 1;
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.includes(nb) || nb.includes(na)) return 0.9;
  const dist = levenshtein(na, nb);
  const maxLen = Math.max(na.length, nb.length);
  return 1 - dist / maxLen;
}

/**
 * Find the best matching category for a free-text claim.
 * @param {string} claimText
 * @param {string[]} categories
 * @param {number} threshold minimum similarity score to count as a match (default 0.55)
 * @returns {{ category: string|null, score: number }}
 */
function findBestCategoryMatch(claimText, categories, threshold = 0.55) {
  let best = { category: null, score: 0 };
  for (const category of categories ?? []) {
    const score = similarity(claimText, category);
    if (score > best.score) best = { category, score };
  }
  if (best.score < threshold) return { category: null, score: best.score };
  return best;
}

module.exports = { normalize, levenshtein, similarity, findBestCategoryMatch };
