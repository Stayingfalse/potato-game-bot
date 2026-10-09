const { assignRoles } = require('../utils/roles');
const GameRepository  = require('../db/GameRepository');
const BaseGameState = require('../games/_core/BaseGameState');
const BaseGameManager = require('../games/_core/BaseGameManager');

// ── GameState ──────────────────────────────────────────────────────────────────

class GameState extends BaseGameState {
  /**
   * @param {string} guildId
   * @param {string} channelId  Parent channel where the public lobby embed lives.
   * @param {string} threadId  The Discord thread channel ID that hosts this game.
   * @param {string} hostId
   * @param {string} hostUsername
   */
  constructor(guildId, channelId, threadId, hostId, hostUsername) {
    super(guildId, channelId, threadId, hostId, hostUsername);
    /** Discord message ID of the game board embed posted in the thread. */
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
    /** Discord message ID of the "Game Started" embed (used to update ready-up status). */
    this.readyMessageId = null;

    // Populated during the playing phase
    this.timerInterval = null;
    this.timeLeft = 240; // seconds (4 minutes)

    // Populated during reveal / voting phases
    /** @type {Map<string, string>} userId → targeted userId */
    this.votes = new Map();
    /** setTimeout handle for the 90s outer reveal safety net / voting window. */
    this.revealTimeout = null;

    /** @type {'text'|'voice'|null} Chosen play mode; null until host selects. */
    this.sessionMode = null;
    /** @type {Map<string, string>} userId → messageId of their voice-mode response panel. */
    this.voicePlayerMessageIds = new Map();

    // Session tracking
    /**
     * Results of previous games in this session.
     * @type {Array<{gameNumber: number, outcome: string, word: string|null, players: Array}>}
     */
    this.sessionHistory = [];
    /** userId of the player whose guess was accepted (for stats credit). */
    this.winnerGuesserUserId = null;
    /** Set to true once the response-card stats embed has been posted (e.g. before voting). */
    this.responseStatsShown = false;
  }
}

// ── GameManager ────────────────────────────────────────────────────────────────

class GameManager extends BaseGameManager {
  constructor() {
    super({ repository: GameRepository, timerKeys: ['timerInterval', 'revealTimeout'], maxPlayers: 10 });
  }

  /**
   * Creates and registers a new game, keyed by thread ID.
   * @returns {GameState}
   */
  createGame(guildId, channelId, threadId, hostId, hostUsername) {
    return this.registerGame(new GameState(guildId, channelId, threadId, hostId, hostUsername));
  }

  /**
   * Resets the game for a rematch without destroying the session.
   * @param {string} threadId
   * @param {boolean} openSignups  true = back to lobby; false = straight to playing
   * @returns {GameState|null}
   */
  resetForRematch(threadId, openSignups) {
    const game = this.games.get(threadId);
    if (!game) return null;

    this.clearTimers(game);

    game.gameNumber++;
    game.phase = openSignups ? 'lobby' : 'playing';
    game.word = null;
    game.wordOptions = [];
    game.pendingSecretInteractions = [];
    game.tokens = { yes_no: 36, maybe: 12, correct: 1, so_close_way_off: 2 };
    game.readyPlayers = new Set();
    game.votes = new Map();
    game.boardMessageId = null;
    game.readyMessageId = null;
    game.winnerGuesserUserId = null;
    game.responseStatsShown = false;
    game.timeLeft = 240;
    // For same-group rematch keep the previously chosen mode; for open sign-ups ask again.
    if (openSignups) game.sessionMode = null;
    game.voicePlayerMessageIds = new Map();

    // Reset roles so they get reassigned on start.
    for (const player of game.players.values()) {
      player.role = null;
      player.secretRole = null;
      player.responseStats = { yes: 0, no: 0, maybe: 0, soClose: 0, wayOff: 0 };
    }

    GameRepository.upsert(game);
    return game;
  }

  createPlayer(user) {
    return {
      id: user.id,
      username: user.username,
      role: null,
      secretRole: null,
      responseStats: { yes: 0, no: 0, maybe: 0, soClose: 0, wayOff: 0 },
    };
  }

  /**
   * Shuffles the player list and assigns roles in place.
   * @param {string} threadId
   * @returns {GameState|null}
   */
  assignRoles(threadId) {
    const game = this.games.get(threadId);
    if (!game) return null;

    const assigned = assignRoles([...game.players.values()]);
    for (const player of assigned) {
      game.players.set(player.id, player);
    }
    GameRepository.upsert(game);
    return game;
  }
}

module.exports = GameManager;
