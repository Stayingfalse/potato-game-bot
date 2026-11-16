'use strict';

const { MIN_PLAYERS } = require('./manager');

/**
 * The game's rules for new players: shown by the lobby's "How to play" button
 * and by /help. Keep `rules` to about 8–12 short lines covering the goal, a
 * turn, and how scoring or winning works. See src/games/_core/registry.js.
 */
module.exports = {
  emoji: '🎲',
  summary: 'Everyone rolls once; the highest roll wins.',
  players: `${MIN_PLAYERS} or more`,
  rules: [
    '**Goal:** roll the highest number.',
    'Once the host starts the game, press **Roll** to roll a number from 1 to 100. You get one roll.',
    'The round ends when everyone has rolled, or when the timer runs out.',
    'The highest roll wins. The host can then start another game or close the session.',
  ],
};
