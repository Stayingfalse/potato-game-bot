'use strict';

const { MIN_PLAYERS } = require('./manager');

/** Shown by the lobby's "How to play" button and by /help. See src/games/_core/registry.js. */
module.exports = {
  emoji: '🔮',
  summary: 'A social deduction game: guess the secret word with yes/no questions while hidden Werewolves try to steer you wrong.',
  players: `${MIN_PLAYERS}–10`,
  rules: [
    '**Goal:** the Townsfolk must guess the secret word before the 4-minute timer or the answer tokens run out.',
    'Everyone gets a secret role. Press **View Secret Info** to see yours, then **I\'m Ready!**',
    'The **Mayor** picks the secret word from three options (or writes their own) and may only answer through buttons.',
    'Everyone else asks yes/no questions: typed in the thread in text mode, or out loud in voice mode.',
    'The Mayor answers each one with **Yes**, **No**, **Maybe**, **So Close**, **Way Off** or **Correct**. Each answer uses up a token.',
    'The **Werewolf** knows the word and tries to mislead. With 6 or more players there are two.',
    'The **Seer** (sometimes dealt in with 5 or more players) also knows the word and hints at it without being obvious.',
    '**Word guessed:** the Werewolf gets one chance to name the Seer. If they are right, the Werewolves steal the win.',
    '**Word not guessed:** everyone votes for who they think the Werewolf is. Catch one and the Townsfolk win after all.',
    'The Mayor has a secret role too, so they may not be on your side.',
  ],
};
