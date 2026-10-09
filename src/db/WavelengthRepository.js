'use strict';

const createRepository = require('../games/_core/createRepository');

/** @param {import('../game/WavelengthManager').WavelengthGameState} game */
function toRow(game) {
  return {
    thread_id:        game.threadId,
    guild_id:         game.guildId,
    channel_id:       game.channelId,
    host_id:          game.hostId,
    host_username:    game.hostUsername,
    message_id:       game.messageId ?? null,
    round_message_id: game.roundMessageId ?? null,
    phase:            game.phase,
    players:          JSON.stringify([...game.players.values()]),
    clue_giver_id:    game.clueGiverId ?? null,
    spectrum_options: JSON.stringify(game.spectrumOptions ?? []),
    chosen_spectrum:  game.chosenSpectrum ? JSON.stringify(game.chosenSpectrum) : null,
    target_position:  game.targetPosition ?? null,
    clue:             game.clue ?? null,
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

const repository = createRepository({ table: 'wavelength_games', toRow });

module.exports = repository;
