'use strict';

const { MIN_PLAYERS } = require('./manager');

/** Shown by the lobby's "How to play" button and by /help. See src/games/_core/registry.js. */
module.exports = {
  emoji: '〰️',
  summary: 'One player gives a clue; everyone else guesses where a hidden target sits on a spectrum between two extremes.',
  players: `${MIN_PLAYERS}–20`,
  rules: [
    '**Goal:** score the most points by guessing close to the target, and by giving clues that lead people there.',
    'The host picks how the session ends and the pace (realtime or turn-based).',
    'Each round one player is the **Clue Giver**. They pick a spectrum (like *Cold ↔ Hot*) and privately see a target position on it.',
    'The Clue Giver gives a short clue that hints at where the target sits.',
    'Everyone else privately nudges their marker along the spectrum and submits a guess.',
    'In realtime pace, guesses lock after 3 minutes; in turn-based pace the round waits for everyone.',
    '**Guessers score** 4 for an exact bullseye, 3 within 5, 2 within 10, 1 within 20, plus a group bonus scored the same way on the average guess.',
    '**The Clue Giver scores** the sum of the guessers\' own points, plus up to 5 more when the guesses are close together.',
    'After the reveal the next round starts with a new Clue Giver.',
  ],
};
