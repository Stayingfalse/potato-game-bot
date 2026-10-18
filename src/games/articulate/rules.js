'use strict';

/**
 * Articulate rules that don't touch Discord: teams, describer rotation and
 * drawing cards.
 */

const { shuffle } = require('../_core/random');
const { CATEGORY_ORDER } = require('./board');
const WORDS = require('./words.json');

const MIN_TEAM_SIZE = 2;
const MAX_TEAMS = 4;
const PASSES_PER_TURN = 1;
/** The sand timer, plus slower options for groups who want them. */
const TURN_SECONDS_CHOICES = [30, 45, 60];
/** "Got it" presses this soon after time runs out still count (voice lag). */
const TIMER_GRACE_MS = 1_500;

/** The four playing pieces. */
const TEAM_STYLES = [
  { name: 'Red', emoji: '🔴', color: '#E74C3C' },
  { name: 'Blue', emoji: '🔵', color: '#3498DB' },
  { name: 'Green', emoji: '🟢', color: '#2ECC71' },
  { name: 'Yellow', emoji: '🟡', color: '#F1C40F' },
];

// ── Teams ──────────────────────────────────────────────────────────────────────

function newTeam(index) {
  return { ...TEAM_STYLES[index], playerIds: [], position: 0, describerIndex: 0 };
}

/** How many teams `playerCount` players can make (each needs at least two). */
function maxTeamsFor(playerCount) {
  return Math.min(MAX_TEAMS, Math.floor(playerCount / MIN_TEAM_SIZE));
}

/** Deals players into `count` teams as evenly as possible. */
function randomTeams(playerIds, count) {
  const teams = Array.from({ length: count }, (_, i) => newTeam(i));
  shuffle(playerIds).forEach((id, i) => teams[i % count].playerIds.push(id));
  return teams;
}

/** The smallest team, for placing someone fairly. Ties go to the earliest team. */
function smallestTeam(teams) {
  return teams.reduce((best, team) => (team.playerIds.length < best.playerIds.length ? team : best));
}

function teamOf(teams, userId) {
  const index = teams.findIndex(team => team.playerIds.includes(userId));
  return index === -1 ? null : index;
}

function teamsReady(teams, playerIds) {
  return teams.length >= 2
    && teams.every(team => team.playerIds.length >= MIN_TEAM_SIZE)
    && playerIds.every(id => teamOf(teams, id) !== null);
}

/**
 * Captains' draft order: captains pick in snake order (1-2-2-1…), so the team
 * that picks first in one round picks last in the next.
 */
function draftPicker(captainCount, pickNumber) {
  const round = Math.floor(pickNumber / captainCount);
  const offset = pickNumber % captainCount;
  return round % 2 === 0 ? offset : captainCount - 1 - offset;
}

// ── Describers ─────────────────────────────────────────────────────────────────

/**
 * How many of a team describe each turn: a team never has more than two
 * describers, and a pair has one describer and one guesser. The single-describer
 * variation (for advanced players) always uses one.
 */
function describerCount(teamSize, singleDescriber) {
  if (singleDescriber || teamSize <= 2) return 1;
  return 2;
}

/** This turn's describers: the next players in the team's rotation, so everyone takes a turn. */
function describersFor(team, singleDescriber) {
  const count = describerCount(team.playerIds.length, singleDescriber);
  return Array.from({ length: count }, (_, i) => team.playerIds[(team.describerIndex + i) % team.playerIds.length]);
}

/** Moves the team's rotation on past this turn's describers. */
function advanceDescribers(team, singleDescriber) {
  team.describerIndex = (team.describerIndex + describerCount(team.playerIds.length, singleDescriber)) % team.playerIds.length;
}

// ── Cards ──────────────────────────────────────────────────────────────────────

/**
 * Draws an entry. With a category, from that category; with null (a ♠ entry,
 * used on Control rounds and Control squares), from a random category, as each
 * card's ♠ marks a different category. Words aren't repeated until a category
 * runs out.
 *
 * @param {Record<string, string[]>} used  category → words already drawn this session (updated)
 * @returns {{ word: string, category: string, spade: boolean }}
 */
function drawCard(category, used, random = Math.random) {
  const spade = category === null;
  const from = spade ? CATEGORY_ORDER[Math.floor(random() * CATEGORY_ORDER.length)] : category;
  used[from] ??= [];
  let fresh = WORDS[from].filter(word => !used[from].includes(word));
  if (fresh.length === 0) {
    used[from] = [];
    fresh = WORDS[from];
  }
  const word = fresh[Math.floor(random() * fresh.length)];
  used[from].push(word);
  return { word, category: from, spade };
}

module.exports = {
  MIN_TEAM_SIZE,
  MAX_TEAMS,
  PASSES_PER_TURN,
  TURN_SECONDS_CHOICES,
  TIMER_GRACE_MS,
  TEAM_STYLES,
  WORDS,
  newTeam,
  maxTeamsFor,
  randomTeams,
  smallestTeam,
  teamOf,
  teamsReady,
  draftPicker,
  describerCount,
  describersFor,
  advanceDescribers,
  drawCard,
};
