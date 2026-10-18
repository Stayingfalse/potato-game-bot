'use strict';

const BaseGameManager = require('../_core/BaseGameManager');
const { shuffle } = require('../_core/random');
const HuesCluesRepository = require('./repository');
const HuesCluesGameState = require('./state');
const { CENTRE, CARD_SIZE, clampCell, drawCard } = require('./board');
const { scoreTurn, firstTokenOwnerAt } = require('./rules');

const MIN_PLAYERS = 2;
const MAX_PLAYERS = 10;

/**
 * BaseGameManager provides getGame, getGameByHost, saveGame, deleteGame,
 * addPlayer / removePlayer (using createPlayer and maxPlayers) and clearTimers
 * (for the fields in timerKeys). The game's own actions are below; each saves
 * the game and returns false (or null) when it doesn't apply.
 */
class HuesCluesManager extends BaseGameManager {
  constructor() {
    super({ repository: HuesCluesRepository, timerKeys: ['autoAdvanceTimeout'], maxPlayers: MAX_PLAYERS });
  }

  createGame(guildId, channelId, threadId, hostId, hostUsername) {
    return this.registerGame(new HuesCluesGameState(guildId, channelId, threadId, hostId, hostUsername));
  }

  createPlayer(user) {
    return {
      id: user.id,
      username: user.username,
      avatarURL: user.displayAvatarURL({ extension: 'png', size: 64, forceStatic: true }),
    };
  }

  /** Players can only join or leave while the game is in its lobby. */
  addPlayer(threadId, user) {
    if (this.games.get(threadId)?.phase !== 'lobby') return false;
    return super.addPlayer(threadId, user);
  }

  removePlayer(threadId, userId) {
    if (this.games.get(threadId)?.phase !== 'lobby') return false;
    return super.removePlayer(threadId, userId);
  }

  save(game) {
    HuesCluesRepository.upsert(game);
  }

  // ── Setup ────────────────────────────────────────────────────────────────────

  /** Lobby → setup: shuffles the cue giver order. */
  beginSetup(game) {
    if (game.phase !== 'lobby') return false;
    game.phase = 'setup';
    game.turnOrder = shuffle([...game.players.keys()]);
    this.save(game);
    return true;
  }

  reshuffle(game) {
    if (game.phase !== 'setup') return false;
    game.turnOrder = shuffle(game.turnOrder);
    this.save(game);
    return true;
  }

  setSessionMode(game, mode) {
    if (game.phase !== 'setup') return false;
    game.sessionMode = mode;
    this.save(game);
    return true;
  }

  toggleAutoAdvance(game) {
    game.autoAdvanceRounds = !game.autoAdvanceRounds;
    this.save(game);
    return game.autoAdvanceRounds;
  }

  // ── A turn ───────────────────────────────────────────────────────────────────

  /** Starts the next turn: the next cue giver in order draws a card. */
  startTurn(game) {
    if (game.phase !== 'setup' && game.phase !== 'ended') return false;
    this.clearTimers(game);
    if (game.phase === 'ended') game.gameNumber++;

    game.cueGiverId = game.turnOrder[game.turnIndex % game.turnOrder.length];
    game.turnIndex++;
    game.clueTurnsByPlayer[game.cueGiverId] = (game.clueTurnsByPlayer[game.cueGiverId] ?? 0) + 1;

    game.phase = 'picking';
    game.turnMessageId = null;
    game.card = drawCard();
    game.targetIndex = null;
    game.clues = [];
    game.guessRound = 1;
    game.tokens = new Map(game.turnOrder.filter(id => id !== game.cueGiverId).map(id => [id, { cells: [], draft: null }]));
    game.advanceAt = null;
    this.save(game);
    return true;
  }

  /** The cue giver picks which card colour to describe. They can change it until they give a clue. */
  pickColour(game, index) {
    if (game.phase !== 'picking' || !Number.isInteger(index) || index < 0 || index >= CARD_SIZE) return false;
    game.targetIndex = index;
    this.save(game);
    return true;
  }

  /**
   * Records clue 1 or 2 (null for "nothing more to say") and opens that guess round.
   * Clue 1 needs a picked colour; clue 2 comes after every first token is in.
   */
  giveClue(game, clueNumber, clue) {
    const expected = clueNumber === 1 ? 'picking' : 'followup';
    if (game.phase !== expected || game.clues.length !== clueNumber - 1 || game.targetIndex === null) return false;
    game.clues.push(clue);
    game.guessRound = clueNumber;
    game.phase = 'guessing';
    for (const token of game.tokens.values()) token.draft = token.cells[0] ?? null;
    this.save(game);
    return true;
  }

  /** The guesser's token for this round, as it currently sits (the board centre if not moved yet). */
  draftOf(game, userId) {
    const token = game.tokens.get(userId);
    return token ? token.draft ?? { ...CENTRE } : null;
  }

  /** Moves a guesser's unlocked token to `cell`. */
  setDraft(game, userId, cell) {
    const token = game.tokens.get(userId);
    if (game.phase !== 'guessing' || !token || token.cells.length >= game.guessRound) return false;
    token.draft = clampCell(cell);
    this.save(game);
    return true;
  }

  /** Locks in the guesser's token for this round. A second token can't go on a first token's square. */
  lockIn(game, userId) {
    const token = game.tokens.get(userId);
    if (game.phase !== 'guessing' || !token || token.cells.length >= game.guessRound) return false;
    if (firstTokenOwnerAt(game, this.draftOf(game, userId))) return false;
    token.cells.push(this.draftOf(game, userId));
    token.draft = null;
    this.save(game);
    return true;
  }

  /** Closes the guess round for anyone who hasn't locked in (they place no token this round). */
  lockRemaining(game) {
    if (game.phase !== 'guessing') return false;
    for (const token of game.tokens.values()) {
      while (token.cells.length < game.guessRound) token.cells.push(null);
      token.draft = null;
    }
    this.save(game);
    return true;
  }

  /** Every token is in for this guess round: round 1 → follow-up clue, round 2 → scoring. */
  isGuessRoundComplete(game) {
    return game.phase === 'guessing' && game.waitingGuesserIds().length === 0;
  }

  /** Round 1's tokens are in: over to the cue giver for a follow-up clue. */
  openFollowup(game) {
    if (!this.isGuessRoundComplete(game) || game.guessRound !== 1) return false;
    game.phase = 'followup';
    this.save(game);
    return true;
  }

  /**
   * Scores the turn and adds it to the session history.
   * @returns {object|null} the history entry for the turn
   */
  finishTurn(game) {
    if (!this.isGuessRoundComplete(game) || game.guessRound !== 2) return null;
    const tokens = Object.fromEntries([...game.tokens].map(([id, t]) => [id, t.cells]));
    const turn = {
      turnNumber: game.gameNumber,
      cueGiverId: game.cueGiverId,
      target: game.target,
      card: game.card,
      clues: game.clues,
      tokens,
      scores: scoreTurn(game.target, tokens, game.cueGiverId),
    };
    game.sessionHistory.push(turn);
    game.phase = 'ended';
    this.save(game);
    return turn;
  }

  /** Back to an open lobby for a fresh session in the same thread. */
  resetForNewSession(game) {
    this.clearTimers(game);
    Object.assign(game, {
      phase: 'lobby',
      gameNumber: 1,
      turnMessageId: null,
      sessionMode: null,
      autoAdvanceRounds: true,
      turnOrder: [],
      turnIndex: 0,
      clueTurnsByPlayer: {},
      cueGiverId: null,
      card: [],
      targetIndex: null,
      clues: [],
      guessRound: 1,
      tokens: new Map(),
      sessionHistory: [],
      advanceAt: null,
    });
    this.save(game);
    return game;
  }
}

module.exports = { HuesCluesManager, HuesCluesGameState, MIN_PLAYERS, MAX_PLAYERS };
