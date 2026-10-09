'use strict';

const BaseGameState = require('../_core/BaseGameState');

/**
 * In-memory state of one High Roll game. BaseGameState provides guildId,
 * channelId, threadId, hostId, hostUsername, messageId, phase, players (Map),
 * gameNumber and _createdAt. Saved to `highroll_games` through toRow / fromRow.
 */
class HighRollGameState extends BaseGameState {
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    super(guildId, channelId, threadId, hostId, hostUsername);
    // phase: 'lobby' | 'rolling' | 'ended'
    // messageId: the one game message in the thread, rendered by render.js

    /** @type {Map<string, number>} userId → their roll (1–100) this round */
    this.rolls = new Map();
    /** When the rolling window closes (ms since epoch); null outside 'rolling'. Saved, so restore can re-arm it. */
    this.phaseEndsAt = null;
    /** setTimeout handle for the rolling deadline. Not saved; listed in the manager's timerKeys. */
    this.rollTimeout = null;
  }

  /** The player(s) with the highest roll this round (ties share the win). */
  winnerIds() {
    const best = Math.max(...this.rolls.values());
    return [...this.rolls].filter(([, roll]) => roll === best).map(([id]) => id);
  }

  /** Rehydrates a game from its saved `highroll_games` row. */
  static fromRow(row) {
    const game = new HighRollGameState(row.guild_id, row.channel_id, row.thread_id, row.host_id, row.host_username);
    game.messageId = row.message_id;
    game.phase = row.phase;
    game.players = new Map(JSON.parse(row.players || '[]').map(p => [p.id, p]));
    game.rolls = new Map(Object.entries(JSON.parse(row.rolls || '{}')));
    game.phaseEndsAt = row.phase_ends_at ?? null;
    game.gameNumber = row.game_number;
    game._createdAt = row.created_at;
    return game;
  }

  /** Maps a game to its `highroll_games` row. Its keys are the columns written on every save. */
  static toRow(game) {
    return {
      thread_id:     game.threadId,
      guild_id:      game.guildId,
      channel_id:    game.channelId,
      host_id:       game.hostId,
      host_username: game.hostUsername,
      message_id:    game.messageId ?? null,
      phase:         game.phase,
      players:       JSON.stringify([...game.players.values()]),
      rolls:         JSON.stringify(Object.fromEntries(game.rolls)),
      phase_ends_at: game.phaseEndsAt ?? null,
      game_number:   game.gameNumber,
      created_at:    game._createdAt ?? Date.now(),
    };
  }
}

module.exports = HighRollGameState;
