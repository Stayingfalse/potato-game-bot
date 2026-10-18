'use strict';

/**
 * The Articulate board, categories and spinner. Pure data and helpers.
 *
 * Squares run from START (0) to FINISH. Category squares repeat the six
 * categories in order; every CONTROL_EVERY-th square is a white Control
 * square (♠). Action and Random squares are the Spin squares that reach into
 * the middle of the board.
 */

const CATEGORIES = {
  object: { name: 'Object', emoji: '📦', color: '#2F7FD8' },
  nature: { name: 'Nature', emoji: '🌿', color: '#2E9E55' },
  action: { name: 'Action', emoji: '🏃', color: '#F0882A', spin: true },
  world:  { name: 'World',  emoji: '🌍', color: '#E3B505' },
  person: { name: 'Person', emoji: '🧑', color: '#8E4FB8' },
  random: { name: 'Random', emoji: '🎲', color: '#D93A2F', spin: true },
};
const CATEGORY_ORDER = ['object', 'nature', 'action', 'world', 'person', 'random'];

const FINISH = 48;
const CONTROL_EVERY = 8;

/** Every square: { kind: 'start'|'category'|'control'|'finish', category? }. */
const SQUARES = (() => {
  const squares = [{ kind: 'start', category: 'object' }];
  let next = 1; // the start square is Object, so the track carries on from Nature
  for (let i = 1; i < FINISH; i++) {
    if (i % CONTROL_EVERY === 0) {
      squares.push({ kind: 'control' });
    } else {
      squares.push({ kind: 'category', category: CATEGORY_ORDER[next % CATEGORY_ORDER.length] });
      next++;
    }
  }
  squares.push({ kind: 'finish' });
  return squares;
})();

function squareAt(position) {
  return SQUARES[Math.max(0, Math.min(FINISH, position))];
}

/** The category a team on this square describes on a normal turn; null means ♠ entries (any category). */
function turnCategory(position) {
  const square = squareAt(position);
  return square.kind === 'category' || square.kind === 'start' ? square.category : null;
}

function isSpinSquare(position) {
  const square = squareAt(position);
  return square.kind === 'category' && !!CATEGORIES[square.category].spin;
}

function isControlSquare(position) {
  return squareAt(position).kind === 'control';
}

/** Moves a position by `steps`, never before START or past FINISH. */
function move(position, steps) {
  return Math.max(0, Math.min(FINISH, position + steps));
}

function describeSquare(position) {
  const square = squareAt(position);
  if (square.kind === 'finish') return '🏁 Finish';
  if (square.kind === 'control') return '♠ Control';
  const category = CATEGORIES[square.category];
  return `${category.emoji} ${category.name}${square.kind === 'start' ? ' (Start)' : ''}`;
}

// ── Spinner ────────────────────────────────────────────────────────────────────

/**
 * The spinner, clockwise from the top. Wide green: 2 squares; narrow green:
 * 3 squares (forward for you, or back for another team); orange and red: no bonus.
 */
const SPINNER = [
  { key: 'red', sweep: 65 },
  { key: 'wide', sweep: 45, steps: 2 },
  { key: 'orange', sweep: 60 },
  { key: 'narrow', sweep: 20, steps: 3 },
  { key: 'red', sweep: 65 },
  { key: 'wide', sweep: 45, steps: 2 },
  { key: 'orange', sweep: 60 },
];

/**
 * Spins: the arrow's angle (degrees clockwise from the top) and the section it
 * points at. An arrow exactly on a line is spun again, as on the real board.
 */
function spin(random = Math.random) {
  for (;;) {
    const angle = random() * 360;
    let start = 0;
    for (const section of SPINNER) {
      const end = start + section.sweep;
      if (angle > start && angle < end) return { angle, key: section.key, steps: section.steps ?? 0 };
      start = end;
    }
  }
}

module.exports = {
  CATEGORIES,
  CATEGORY_ORDER,
  FINISH,
  SQUARES,
  SPINNER,
  squareAt,
  turnCategory,
  isSpinSquare,
  isControlSquare,
  move,
  describeSquare,
  spin,
};
