'use strict';

const { MIN_PLAYERS, MAX_PLAYERS } = require('./manager');

/** Shown by the lobby's "How to play" button and by /help. See src/games/_core/registry.js. */
module.exports = {
  emoji: '🎨',
  summary: 'One player describes a colour in a word or two; everyone else tries to find it on a 480-colour board.',
  players: `${MIN_PLAYERS}–${MAX_PLAYERS}`,
  rules: [
    '**Goal:** score the most points by placing tokens close to the cue giver\'s colour.',
    'The host picks how the session ends: everyone gives X clues, first to X points, or endless.',
    'Each turn one player is the **cue giver**. They draw a card of four colours, pick one, and give a **one-word** clue.',
    'Clues can\'t use basic colour names or grid references.',
    'Everyone else places a token: type a grid ref like `F12`, fine-tune it with the arrow buttons, then lock in.',
    'The board is then shown, and the cue giver may add a **second clue** of up to two words, or say nothing more.',
    'Everyone places a second token, which can\'t go on a square that already has a first token.',
    '**Tokens score** 3 on the colour, 2 inside the 3×3 frame around it and 1 touching the frame.',
    '**The cue giver scores** 1 for every token inside the frame.',
    'The results show every token and the running totals, then the next cue giver takes a turn.',
  ],
};
