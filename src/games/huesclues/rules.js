'use strict';

/**
 * Hues & Clues rules that don't touch Discord: clue checks, scoring, session
 * totals and the end-of-session goal.
 */

const { distance } = require('./board');

// ── Clues ──────────────────────────────────────────────────────────────────────

/** Most words allowed in the first and second clue (official rules). */
const CLUE_WORD_LIMITS = [1, 2];

/** Basic colour names can't be used in a clue, nor forms of them like "reddish" or "blues". */
const BANNED_COLOUR_WORDS = [
  'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'violet', 'indigo', 'pink',
  'brown', 'black', 'white', 'grey', 'gray',
];
const COLOUR_WORD = new RegExp(`^(${BANNED_COLOUR_WORDS.join('|')})(s|ish|y|ey|er|est|ness)?$`, 'i');
/** Anything that reads as a grid ref, e.g. "F12", "12F". */
const GRID_REF = /^([a-p]\d{1,2}|\d{1,2}[a-p])$/i;

/**
 * Checks a clue against the rules for the given clue number (1 or 2).
 * @returns {{ ok: true, clue: string } | { ok: false, error: string }}
 */
function validateClue(raw, clueNumber) {
  const clue = String(raw ?? '').trim().replace(/\s+/g, ' ');
  const limit = CLUE_WORD_LIMITS[clueNumber - 1];
  if (!clue) return { ok: false, error: 'Your clue can\'t be blank.' };

  const words = clue.split(' ');
  if (words.length > limit) {
    return { ok: false, error: `Clue ${clueNumber} can be at most **${limit} word${limit === 1 ? '' : 's'}**.` };
  }

  // Hyphenated words ("sky-blue") are checked part by part.
  const parts = words.flatMap(word => word.split('-')).map(part => part.replace(/[^a-z0-9]/gi, ''));
  const colourWord = parts.find(part => COLOUR_WORD.test(part));
  if (colourWord) return { ok: false, error: `No basic colour names — **${colourWord}** isn't allowed.` };
  if (parts.some(part => GRID_REF.test(part))) return { ok: false, error: 'No grid references in your clue.' };

  return { ok: true, clue };
}

// ── Scoring ────────────────────────────────────────────────────────────────────

/** Points for a token by its distance from the target: on it, in the 3×3 frame, touching the frame. */
const POINTS_BY_DISTANCE = [3, 2, 1];

function tokenPoints(cell, target) {
  if (!cell) return 0;
  return POINTS_BY_DISTANCE[distance(cell, target)] ?? 0;
}

/**
 * Scores a finished turn. Each token scores on its own; the cue giver scores
 * 1 point for every token inside the 3×3 frame (the target included).
 *
 * @param {{row: number, col: number}} target
 * @param {Record<string, Array<{row: number, col: number}|null>>} tokens  userId → their tokens
 * @param {string} cueGiverId
 */
function scoreTurn(target, tokens, cueGiverId) {
  const guessers = {};
  let inFrame = 0;
  for (const [userId, cells] of Object.entries(tokens)) {
    const points = cells.map(cell => tokenPoints(cell, target));
    inFrame += cells.filter(cell => cell && distance(cell, target) <= 1).length;
    guessers[userId] = { points, total: points.reduce((sum, p) => sum + p, 0) };
  }
  return { guessers, cueGiver: { id: cueGiverId, inFrame, total: inFrame } };
}

/** Points each player scored in one turn of the session history. */
function turnPoints(turn) {
  const points = {};
  for (const [userId, { total }] of Object.entries(turn.scores.guessers)) points[userId] = total;
  const cue = turn.scores.cueGiver;
  points[cue.id] = (points[cue.id] ?? 0) + cue.total;
  return points;
}

/**
 * Running totals across the session, highest first.
 * @returns {Array<{userId: string, total: number}>}
 */
function sessionTotals(game) {
  const totals = new Map([...game.turnOrder].map(id => [id, 0]));
  for (const turn of game.sessionHistory) {
    for (const [userId, points] of Object.entries(turnPoints(turn))) {
      totals.set(userId, (totals.get(userId) ?? 0) + points);
    }
  }
  return [...totals].map(([userId, total]) => ({ userId, total })).sort((a, b) => b.total - a.total);
}

// ── Session modes ──────────────────────────────────────────────────────────────

/** Choices offered on the setup screen for each mode's X. */
const CLUE_TURN_CHOICES = [1, 2, 3];
const POINT_CHOICES = [25, 40, 60];

/** Official rules: everyone is cue giver twice with up to 6 players, once with more. */
function recommendedClueTurns(playerCount) {
  return playerCount <= 6 ? 2 : 1;
}

function describeSessionMode(mode) {
  if (!mode) return 'Not chosen yet';
  if (mode.type === 'clue_turns') {
    return mode.target ? `🔁 Everyone gives **${mode.target}** clue${mode.target === 1 ? '' : 's'}` : '🔁 Everyone gives X clues';
  }
  if (mode.type === 'first_to_points') return mode.target ? `🏁 First to **${mode.target}** points` : '🏁 First to X points';
  return '♾️ Endless';
}

/** Whether the mode is fully chosen (the two goal modes need their X too). */
function isModeComplete(mode) {
  return !!mode && (mode.type === 'endless' || Number.isInteger(mode.target));
}

/**
 * Where the session stands against its goal.
 * @returns {{ complete: boolean, message: string|null, winnerIds: string[] }}
 */
function evaluateSessionGoal(game) {
  const mode = game.sessionMode;
  const totals = sessionTotals(game);
  const leaders = totals.filter(entry => entry.total === totals[0]?.total && entry.total > 0).map(entry => entry.userId);

  if (mode?.type === 'clue_turns') {
    const done = game.turnOrder.length > 0
      && game.turnOrder.every(id => (game.clueTurnsByPlayer[id] ?? 0) >= mode.target);
    // A goal is only met once the last turn has been scored.
    const complete = done && game.phase === 'ended';
    const progress = game.turnOrder.map(id => `<@${id}> ${game.clueTurnsByPlayer[id] ?? 0}/${mode.target}`).join(' · ');
    return { complete, message: complete ? winnerMessage(leaders) : `Clues given: ${progress}`, winnerIds: complete ? leaders : [] };
  }

  if (mode?.type === 'first_to_points') {
    const complete = (totals[0]?.total ?? 0) >= mode.target;
    if (complete) return { complete, message: winnerMessage(leaders), winnerIds: leaders };
    const leader = totals[0];
    return {
      complete,
      message: leader?.total ? `Leader: <@${leader.userId}> on **${leader.total}/${mode.target}** points.` : `First to **${mode.target}** points wins.`,
      winnerIds: [],
    };
  }

  return { complete: false, message: null, winnerIds: [] };
}

function winnerMessage(winnerIds) {
  if (winnerIds.length === 0) return 'Nobody scored — it\'s a draw!';
  const names = winnerIds.map(id => `<@${id}>`).join(' & ');
  return winnerIds.length === 1 ? `🏆 ${names} wins!` : `🏆 ${names} share the win!`;
}

module.exports = {
  CLUE_WORD_LIMITS,
  CLUE_TURN_CHOICES,
  POINT_CHOICES,
  validateClue,
  tokenPoints,
  scoreTurn,
  turnPoints,
  sessionTotals,
  recommendedClueTurns,
  describeSessionMode,
  isModeComplete,
  evaluateSessionGoal,
};
