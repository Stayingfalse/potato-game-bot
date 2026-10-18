'use strict';

const BaseGameState = require('../_core/BaseGameState');

/**
 * In-memory state of one Hues & Clues session. BaseGameState provides guildId,
 * channelId, threadId, hostId, hostUsername, messageId, phase, players (Map),
 * gameNumber (the turn number) and _createdAt. Saved to `huesclues_games`
 * through toRow / fromRow.
 */
class HuesCluesGameState extends BaseGameState {
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    super(guildId, channelId, threadId, hostId, hostUsername);
    // phase: 'lobby' | 'setup' | 'picking' | 'guessing' | 'followup' | 'ended'
    //   picking:  the cue giver chooses a colour from their card and gives the first clue
    //   guessing: everyone else places a token (guessRound 1, then 2)
    //   followup: the cue giver gives a second clue, or says nothing more
    //   ended:    the turn is scored; the next turn starts from here
    // players: userId → {id, username, avatarURL}
    // messageId: the lobby/setup message. Each turn then gets its own message (turnMessageId).

    this.turnMessageId = null;

    /** @type {{type: 'clue_turns'|'first_to_points'|'endless', target?: number}|null} */
    this.sessionMode = null;
    this.autoAdvanceRounds = true;
    /** Cue giver order, shuffled when the game starts. */
    this.turnOrder = [];
    /** How many turns have started this session; turnOrder[turnIndex % length] is next. */
    this.turnIndex = 0;
    /** userId → how many times they've been cue giver this session. */
    this.clueTurnsByPlayer = {};

    this.cueGiverId = null;
    /** The cue giver's four colours, as board cells. */
    this.card = [];
    /** Which card colour the cue giver chose; null until they pick. */
    this.targetIndex = null;
    /** The clues given this turn. The second is null if the cue giver had nothing more to say. */
    this.clues = [];
    this.guessRound = 1;
    /**
     * @type {Map<string, {cells: Array<{row: number, col: number}|null>, draft: {row: number, col: number}|null}>}
     * guesser → their locked-in tokens (one per guess round; null if the round was locked without
     * them) and the square they're currently lining up.
     */
    this.tokens = new Map();

    /** Every scored turn: { turnNumber, cueGiverId, target, clues, tokens, scores }. */
    this.sessionHistory = [];

    /** When the next turn auto-starts (ms since epoch). Saved, so restore can re-arm it. */
    this.advanceAt = null;
    /** setTimeout handle for auto-advance. Not saved; listed in the manager's timerKeys. */
    this.autoAdvanceTimeout = null;
  }

  get target() {
    return this.targetIndex === null ? null : this.card[this.targetIndex] ?? null;
  }

  /** Guessers who haven't locked in a token for the current guess round. */
  waitingGuesserIds() {
    return [...this.tokens].filter(([, t]) => t.cells.length < this.guessRound).map(([id]) => id);
  }

  /** Rehydrates a game from its saved `huesclues_games` row. */
  static fromRow(row) {
    const game = new HuesCluesGameState(row.guild_id, row.channel_id, row.thread_id, row.host_id, row.host_username);
    game.messageId = row.message_id;
    game.turnMessageId = row.turn_message_id ?? null;
    game.phase = row.phase;
    game.players = new Map(JSON.parse(row.players || '[]').map(p => [p.id, p]));
    game.sessionMode = row.session_mode ? JSON.parse(row.session_mode) : null;
    game.autoAdvanceRounds = row.auto_advance_rounds === 1;
    game.turnOrder = JSON.parse(row.turn_order || '[]');
    game.turnIndex = row.turn_index;
    game.clueTurnsByPlayer = JSON.parse(row.clue_turns_by_player || '{}');
    game.cueGiverId = row.cue_giver_id ?? null;
    game.card = JSON.parse(row.card || '[]');
    game.targetIndex = row.target_index ?? null;
    game.clues = JSON.parse(row.clues || '[]');
    game.guessRound = row.guess_round;
    game.tokens = new Map(Object.entries(JSON.parse(row.tokens || '{}')));
    game.sessionHistory = JSON.parse(row.session_history || '[]');
    game.advanceAt = row.advance_at ?? null;
    game.gameNumber = row.game_number;
    game._createdAt = row.created_at;
    return game;
  }

  /** Maps a game to its `huesclues_games` row. Its keys are the columns written on every save. */
  static toRow(game) {
    return {
      thread_id:            game.threadId,
      guild_id:             game.guildId,
      channel_id:           game.channelId,
      host_id:              game.hostId,
      host_username:        game.hostUsername,
      message_id:           game.messageId ?? null,
      turn_message_id:      game.turnMessageId ?? null,
      phase:                game.phase,
      players:              JSON.stringify([...game.players.values()]),
      session_mode:         game.sessionMode ? JSON.stringify(game.sessionMode) : null,
      auto_advance_rounds:  game.autoAdvanceRounds ? 1 : 0,
      turn_order:           JSON.stringify(game.turnOrder),
      turn_index:           game.turnIndex,
      clue_turns_by_player: JSON.stringify(game.clueTurnsByPlayer),
      cue_giver_id:         game.cueGiverId ?? null,
      card:                 JSON.stringify(game.card),
      target_index:         game.targetIndex ?? null,
      clues:                JSON.stringify(game.clues),
      guess_round:          game.guessRound,
      tokens:               JSON.stringify(Object.fromEntries(game.tokens)),
      session_history:      JSON.stringify(game.sessionHistory),
      advance_at:           game.advanceAt ?? null,
      game_number:          game.gameNumber,
      created_at:           game._createdAt ?? Date.now(),
    };
  }
}

module.exports = HuesCluesGameState;
