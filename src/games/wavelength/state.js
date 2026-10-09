'use strict';

const BaseGameState = require('../_core/BaseGameState');

/**
 * In-memory representation of a single Wavelength session.
 * Saved to the `wavelength_games` table through toRow / fromRow (see repository.js).
 */
class WavelengthGameState extends BaseGameState {
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    super(guildId, channelId, threadId, hostId, hostUsername);

    // One message per round: this tracks the current round's message, which is
    // edited as the round advances (cluing → guessing → reveal) and then left
    // in place when the next round posts a fresh message.
    this.roundMessageId = null;

    // phase: 'lobby'|'setup'|'cluing'|'guessing'|'reveal'|'ended'
    // players: userId → {id, username, avatarURL}

    this.clueGiverId = null;
    this.spectrumOptions = [];
    this.chosenSpectrum = null;
    this.targetPosition = null;
    this.clue = null;
    this.guesses = new Map();
    this.guessTimeout = null;
    this.autoAdvanceTimeout = null;
    this.sessionHistory = [];
    this.sessionMode = null;
    this.gamePace = 'realtime';
    this.autoAdvanceRounds = false;
    this.clueOrderState = {
      roundRobinIndex:      0,
      snakeIndex:           0,
      snakeDirection:       1,
      clueTurnsByPlayer:    {},
    };
  }

  /** Rehydrates a game state instance from a saved `wavelength_games` row. */
  static fromRow(row) {
    const game = new WavelengthGameState(row.guild_id, row.channel_id, row.thread_id, row.host_id, row.host_username);
    game.messageId = row.message_id;
    game.roundMessageId = row.round_message_id ?? null;
    game.phase = row.phase;
    game.players = new Map(JSON.parse(row.players || '[]').map(p => [p.id, p]));
    game.clueGiverId = row.clue_giver_id;
    game.spectrumOptions = row.spectrum_options ? JSON.parse(row.spectrum_options) : [];
    game.chosenSpectrum = row.chosen_spectrum ? JSON.parse(row.chosen_spectrum) : null;
    game.targetPosition = row.target_position;
    game.clue = row.clue;
    game.guesses = new Map(Object.entries(JSON.parse(row.guesses || '{}')));
    game.sessionMode = row.session_mode ? JSON.parse(row.session_mode) : null;
    game.clueOrderState = row.clue_order_state
      ? JSON.parse(row.clue_order_state)
      : { roundRobinIndex: 0, snakeIndex: 0, snakeDirection: 1, clueTurnsByPlayer: {} };
    game.gameNumber = row.game_number;
    game.sessionHistory = JSON.parse(row.session_history || '[]');
    game.gamePace = row.game_pace ?? 'realtime';
    game.autoAdvanceRounds = row.auto_advance_rounds === 1;
    game._createdAt = row.created_at;
    return game;
  }

  /** Maps a game state to its `wavelength_games` row. */
  static toRow(game) {
    return {
      thread_id:            game.threadId,
      guild_id:             game.guildId,
      channel_id:           game.channelId,
      host_id:              game.hostId,
      host_username:        game.hostUsername,
      message_id:           game.messageId ?? null,
      round_message_id:     game.roundMessageId ?? null,
      phase:                game.phase,
      players:              JSON.stringify([...game.players.values()]),
      clue_giver_id:        game.clueGiverId ?? null,
      spectrum_options:     JSON.stringify(game.spectrumOptions ?? []),
      chosen_spectrum:      game.chosenSpectrum ? JSON.stringify(game.chosenSpectrum) : null,
      target_position:      game.targetPosition ?? null,
      clue:                 game.clue ?? null,
      guesses:              JSON.stringify(Object.fromEntries(game.guesses ?? new Map())),
      session_mode:         game.sessionMode ? JSON.stringify(game.sessionMode) : null,
      clue_order_state:     game.clueOrderState ? JSON.stringify(game.clueOrderState) : null,
      game_number:          game.gameNumber,
      game_pace:            game.gamePace ?? 'realtime',
      auto_advance_rounds:  game.autoAdvanceRounds ? 1 : 0,
      session_history:      JSON.stringify(game.sessionHistory ?? []),
      created_at:           game._createdAt ?? Date.now(),
    };
  }
}

module.exports = WavelengthGameState;
