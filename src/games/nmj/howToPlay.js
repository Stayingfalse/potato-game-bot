'use strict';

const { MIN_PLAYERS, CHALLENGE_TOKENS_PER_PLAYER } = require('./manager');

/** Shown by the lobby's "How to play" button and by /help. See src/games/_core/registry.js. */
module.exports = {
  emoji: '🎬',
  summary: 'Name a celebrity and ban a category they belong to. Name anyone who breaks an earlier ban and you are out.',
  players: `${MIN_PLAYERS} or more`,
  rules: [
    '**Goal:** be the last player standing.',
    'Once everyone has joined, the host spins the wheel to set the turn order.',
    'On your turn, name a celebrity and a "No More…" category they fit, e.g. *Tom Cruise — No More people who have won an Oscar*.',
    'That category is now banned: nobody may name a person who fits it for the rest of the game.',
    'The other players then **Accept** the move, ask you to **Name Another** celebrity who fits your category, or **Challenge** it.',
    'If you can\'t name another, you give a new category for your celebrity instead.',
    `**Challenge** if the celebrity breaks a category that was already banned. It costs one of your ${CHALLENGE_TOKENS_PER_PLAYER} tokens and goes to a vote.`,
    'If the vote upholds the challenge, the player is knocked out and the challenger gets the token back. If not, the token stays spent.',
    'Banned categories are not listed during the game, so remember them. Spectators and knocked-out players can peek with 👁️.',
  ],
};
