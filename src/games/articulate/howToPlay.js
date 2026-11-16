'use strict';

const { MIN_PLAYERS, MAX_PLAYERS } = require('./manager');

/** Shown by the lobby's "How to play" button and by /help. See src/games/_core/registry.js. */
module.exports = {
  emoji: '🗣️',
  summary: 'A team describing game played over voice chat: describe as many words as you can before the timer runs out.',
  players: `${MIN_PLAYERS}–${MAX_PLAYERS}`,
  rules: [
    '**Goal:** be the first team round the board, then win a ♠ Control round on the finish.',
    'The host sets up 2–4 teams of at least two, the voice channel and the timer (30 seconds, or 45/60).',
    'On your team\'s turn the describer opens their private panel, presses **Start**, and describes words from your square\'s category.',
    'The team shouts guesses in voice. The describer presses **Got it** for each correct guess, and each one moves the team on a square.',
    'The describer may pass once per turn. Teams of three or more have two describers, who see the same card.',
    'No saying the word or part of it, no "sounds like" or "rhymes with", no letters. Acting and miming are fine.',
    'Any player on another team can call a **Foul**, which forfeits the turn.',
    'Land on a **Spin** square to spin for a bonus: move forward, or send another team back.',
    'Land on a **♠ Control** square and the describer describes one word to **every** team; the first to shout it takes the next turn.',
    'Lose the ♠ round on the finish and you try again on your next turn.',
  ],
};
