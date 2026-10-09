'use strict';

const BaseGameState = require('../_core/BaseGameState');

/**
 * In-memory representation of a single Werewords session.
 * Saved to the `werewords_games` table through toRow / fromRow (see repository.js).
 */
class WerewordsGameState extends BaseGameState {
  /**
   * @param {string} guildId
   * @param {string} channelId  Channel /werewords start was run in.
   * @param {string} threadId  The Discord thread channel ID that hosts this game.
   * @param {string} hostId
   * @param {string} hostUsername
   */
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    super(guildId, channelId, threadId, hostId, hostUsername);
    // messageId: the lobby message at the top of the thread, edited as the session progresses.
    /**
     * The live game message: ready-up, board, reveal, vote and result, rendered by
     * render.js and edited in place. Reposted at the bottom of the thread when the
     * phase changes after play (see gameMessage.js).
     */
    this.boardMessageId = null;

    // phase: 'lobby'|'mode_select'|'starting'|'playing'|'voting'|'ended'
    // players: userId → {id, username, role, secretRole, responseStats}

    this.word = null;
    /** @type {string[]} Three preset word options presented to the Mayor. */
    this.wordOptions = [];
    /**
     * Deferred ephemeral interactions from Werewolf/Seer players who clicked
     * "View Secret Info" before the Mayor chose a word. Each entry is a
     * Discord Interaction object whose editReply() we call once the word is set.
     * @type {import('discord.js').ButtonInteraction[]}
     */
    this.pendingSecretInteractions = [];
    this.tokens = { yes_no: 36, maybe: 12, correct: 1, so_close_way_off: 2 };
    this.readyPlayers = new Set();

    // Populated during the playing phase
    this.timerInterval = null;
    this.timeLeft = 240; // seconds (4 minutes)

    // Populated during reveal / voting phases
    /** @type {Map<string, string>} userId → targeted userId */
    this.votes = new Map();
    /** setTimeout handle for the reveal and voting deadlines. */
    this.revealTimeout = null;
    /** When the current reveal or voting window closes (ms since epoch); null otherwise. */
    this.phaseEndsAt = null;
    /** True once the Werewolf has revealed and is picking the Seer. */
    this.werewolfRevealed = false;

    /** @type {'text'|'voice'|null} Chosen play mode; null until host selects. */
    this.sessionMode = null;
    /** @type {Map<string, string>} userId → messageId of their voice-mode response panel. */
    this.voicePlayerMessageIds = new Map();

    // Session tracking
    /**
     * Results of previous games in this session.
     * @type {Array<{gameNumber: number, outcome: string, word: string|null, winners: string[], players: Array}>}
     */
    this.sessionHistory = [];
    /** userId of the player whose guess was accepted (for stats credit). */
    this.winnerGuesserUserId = null;
    /** Set to true once the response-card stats embed has been posted (e.g. before voting). */
    this.responseStatsShown = false;
  }
  /** Rehydrates a game state instance from a saved `werewords_games` row. */
  static fromRow(row) {
    const game = new WerewordsGameState(row.guild_id, row.channel_id, row.thread_id, row.host_id, row.host_username);
    game.messageId = row.message_id;
    game.boardMessageId = row.board_message_id;
    game.phase = row.phase;
    game.players = new Map(JSON.parse(row.players || '[]').map(p => [p.id, p]));
    game.word = row.word;
    game.wordOptions = JSON.parse(row.word_options || '[]');
    game.tokens = JSON.parse(row.tokens);
    game.readyPlayers = new Set(JSON.parse(row.ready_players || '[]'));
    game.timeLeft = row.time_left;
    game.votes = new Map(Object.entries(JSON.parse(row.votes || '{}')));
    game.phaseEndsAt = row.phase_ends_at ?? null;
    game.werewolfRevealed = !!row.werewolf_revealed;
    game.sessionMode = row.session_mode ?? null;
    game.voicePlayerMessageIds = new Map(Object.entries(JSON.parse(row.voice_player_message_ids || '{}')));
    game.gameNumber = row.game_number;
    game.sessionHistory = JSON.parse(row.session_history || '[]');
    game.winnerGuesserUserId = row.winner_guesser_user_id;
    game.responseStatsShown = !!row.response_stats_shown;
    game._createdAt = row.created_at;
    return game;
  }

  /** Maps a game state to its `werewords_games` row. */
  static toRow(game) {
    return {
      thread_id:                game.threadId,
      guild_id:                 game.guildId,
      channel_id:               game.channelId,
      host_id:                  game.hostId,
      host_username:            game.hostUsername,
      message_id:               game.messageId ?? null,
      board_message_id:         game.boardMessageId ?? null,
      phase:                    game.phase,
      players:                  JSON.stringify([...game.players.values()]),
      word:                     game.word ?? null,
      word_options:             JSON.stringify(game.wordOptions ?? []),
      tokens:                   JSON.stringify(game.tokens),
      ready_players:            JSON.stringify([...(game.readyPlayers ?? [])]),
      time_left:                game.timeLeft,
      votes:                    JSON.stringify(Object.fromEntries(game.votes ?? new Map())),
      phase_ends_at:            game.phaseEndsAt ?? null,
      werewolf_revealed:        game.werewolfRevealed ? 1 : 0,
      game_number:              game.gameNumber,
      winner_guesser_user_id:   game.winnerGuesserUserId ?? null,
      session_mode:             game.sessionMode ?? null,
      voice_player_message_ids: JSON.stringify(Object.fromEntries(game.voicePlayerMessageIds ?? new Map())),
      session_history:          JSON.stringify(game.sessionHistory ?? []),
      response_stats_shown:     game.responseStatsShown ? 1 : 0,
      created_at:               game._createdAt ?? Date.now(),
    };
  }
}

module.exports = WerewordsGameState;
