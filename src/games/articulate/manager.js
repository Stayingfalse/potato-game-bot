'use strict';

const BaseGameManager = require('../_core/BaseGameManager');
const { shuffle } = require('../_core/random');
const ArticulateRepository = require('./repository');
const ArticulateGameState = require('./state');
const { FINISH, turnCategory, isSpinSquare, isControlSquare, move } = require('./board');
const {
  MIN_TEAM_SIZE, PASSES_PER_TURN, TURN_SECONDS_CHOICES,
  newTeam, maxTeamsFor, randomTeams, smallestTeam, teamOf, teamsReady, draftPicker,
  describersFor, advanceDescribers, drawCard,
} = require('./rules');

const MIN_PLAYERS = 4;
const MAX_PLAYERS = 20;
const TEAM_METHODS = ['random', 'choose', 'captains', 'keep'];

/**
 * BaseGameManager provides getGame, getGameByHost, saveGame, deleteGame,
 * addPlayer / removePlayer (using createPlayer and maxPlayers) and clearTimers
 * (for the fields in timerKeys). The game's own actions are below; each saves
 * the game and returns false (or null) when it doesn't apply.
 */
class ArticulateManager extends BaseGameManager {
  constructor() {
    super({ repository: ArticulateRepository, timerKeys: ['turnTimeout'], maxPlayers: MAX_PLAYERS });
  }

  createGame(guildId, channelId, threadId, hostId, hostUsername) {
    return this.registerGame(new ArticulateGameState(guildId, channelId, threadId, hostId, hostUsername));
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
    ArticulateRepository.upsert(game);
  }

  // ── Setup: teams and options ─────────────────────────────────────────────────

  beginSetup(game) {
    if (game.phase !== 'lobby') return false;
    game.phase = 'setup';
    game.options.teamMethod = null;
    game.options.teamCount = Math.min(game.options.teamCount ?? 2, maxTeamsFor(game.players.size));
    game.teams = [];
    game.draft = null;
    this.save(game);
    return true;
  }

  /** Changing the number of teams starts team picking again. */
  setTeamCount(game, count) {
    if (game.phase !== 'setup' || count < 2 || count > maxTeamsFor(game.players.size)) return false;
    game.options.teamCount = count;
    game.options.teamMethod = null;
    game.teams = [];
    game.draft = null;
    this.save(game);
    return true;
  }

  /** Picks how teams are made, and makes them (or sets up the picking). */
  setTeamMethod(game, method) {
    if (game.phase !== 'setup' || !TEAM_METHODS.includes(method)) return false;
    if (method === 'keep' && !game.previousTeams) return false;
    const playerIds = [...game.players.keys()];
    const count = game.options.teamCount;
    game.options.teamMethod = method;
    game.draft = null;

    if (method === 'random') {
      game.teams = randomTeams(playerIds, count);
    } else if (method === 'choose') {
      game.teams = Array.from({ length: count }, (_, i) => newTeam(i));
    } else if (method === 'captains') {
      game.teams = Array.from({ length: count }, (_, i) => newTeam(i));
      const captains = shuffle(playerIds).slice(0, count);
      captains.forEach((id, i) => game.teams[i].playerIds.push(id));
      game.draft = { ids: captains, pickNumber: 0 };
    } else {
      // Keep the last game's teams; anyone new goes to the smallest team.
      game.teams = game.previousTeams.map((team, i) => ({ ...newTeam(i), playerIds: team.playerIds.filter(id => game.players.has(id)) }));
      game.options.teamCount = game.teams.length;
      for (const id of playerIds) {
        if (teamOf(game.teams, id) === null) smallestTeam(game.teams).playerIds.push(id);
      }
    }
    this.save(game);
    return true;
  }

  /** "Pick your team": puts the player in that team (moving them if they were in another). */
  joinTeam(game, userId, index) {
    if (game.phase !== 'setup' || game.options.teamMethod !== 'choose' || !game.players.has(userId) || !game.teams[index]) return false;
    for (const team of game.teams) team.playerIds = team.playerIds.filter(id => id !== userId);
    game.teams[index].playerIds.push(userId);
    this.save(game);
    return true;
  }

  /** "Pick your team": places everyone who hasn't chosen into the smallest teams. */
  placeRemaining(game) {
    if (game.phase !== 'setup' || game.options.teamMethod !== 'choose') return false;
    for (const id of shuffle([...game.players.keys()])) {
      if (teamOf(game.teams, id) === null) smallestTeam(game.teams).playerIds.push(id);
    }
    this.save(game);
    return true;
  }

  /** Whose pick it is in the captains' draft, or null when everyone is picked. */
  draftCaptain(game) {
    if (!game.draft || this.undraftedIds(game).length === 0) return null;
    return game.draft.ids[draftPicker(game.draft.ids.length, game.draft.pickNumber)];
  }

  undraftedIds(game) {
    return [...game.players.keys()].filter(id => teamOf(game.teams, id) === null);
  }

  /** The captain whose turn it is picks a player for their team. */
  draftPick(game, captainId, playerId) {
    if (game.phase !== 'setup' || this.draftCaptain(game) !== captainId || !this.undraftedIds(game).includes(playerId)) return false;
    game.teams[teamOf(game.teams, captainId)].playerIds.push(playerId);
    game.draft.pickNumber++;
    this.save(game);
    return true;
  }

  setVoiceChannel(game, channelId) {
    game.options.voiceChannelId = channelId ?? null;
    this.save(game);
    return true;
  }

  setTurnSeconds(game, seconds) {
    if (game.phase !== 'setup' || !TURN_SECONDS_CHOICES.includes(seconds)) return false;
    game.options.turnSeconds = seconds;
    this.save(game);
    return true;
  }

  toggleSingleDescriber(game) {
    if (game.phase !== 'setup') return false;
    game.options.singleDescriber = !game.options.singleDescriber;
    this.save(game);
    return true;
  }

  canStart(game) {
    return game.phase === 'setup' && teamsReady(game.teams, [...game.players.keys()]);
  }

  /** Setup → the first turn. The first team is chosen at random. */
  startGame(game) {
    if (!this.canStart(game)) return false;
    for (const team of game.teams) {
      team.position = 0;
      team.describerIndex = 0;
      team.playerIds = shuffle(team.playerIds);
    }
    game.turnNumber = 0;
    game.used = {};
    game.winnerTeam = null;
    game.nextTeamOverride = null;
    return this.startTurn(game, Math.floor(Math.random() * game.teams.length));
  }

  // ── A turn ───────────────────────────────────────────────────────────────────

  /**
   * Starts a team's turn. A team already on the finish plays a Control round
   * instead, which wins the game if they win it.
   */
  startTurn(game, teamIndex) {
    this.clearTimers(game);
    game.currentTeam = teamIndex;
    game.turnNumber++;
    game.turnMessageId = null;
    game.spinResult = null;
    game.control = null;
    game.describerIds = describersFor(game.team, game.options.singleDescriber);
    game.turn = {
      category: turnCategory(game.team.position),
      card: null,
      cardNumber: 0,
      correct: [],
      passed: [],
      passesLeft: PASSES_PER_TURN,
      endsAt: null,
      foulBy: null,
    };
    if (game.team.position >= FINISH) {
      this.openControl(game, 'finish');
    } else {
      game.phase = 'ready';
      this.save(game);
    }
    return true;
  }

  /** A describer starts the timer. */
  beginDescribing(game) {
    if (game.phase !== 'ready') return false;
    game.phase = 'describing';
    game.turn.endsAt = Date.now() + game.options.turnSeconds * 1000;
    this.nextCard(game);
    return true;
  }

  nextCard(game) {
    game.turn.card = drawCard(game.turn.category, game.used);
    game.turn.cardNumber++;
    this.save(game);
  }

  /**
   * The team guessed the card. `cardNumber` is the card the describer was
   * looking at, so two describers pressing at once only count it once.
   */
  gotIt(game, cardNumber) {
    if (game.phase !== 'describing' || game.turn.cardNumber !== cardNumber) return false;
    game.turn.correct.push(game.turn.card);
    this.nextCard(game);
    return true;
  }

  /** Describers may pass once per turn. */
  pass(game, cardNumber) {
    if (game.phase !== 'describing' || game.turn.cardNumber !== cardNumber || game.turn.passesLeft <= 0) return false;
    game.turn.passesLeft--;
    game.turn.passed.push(game.turn.card);
    this.nextCard(game);
    return true;
  }

  /** An opponent calls a broken rule: the turn is forfeited. */
  foul(game, userId) {
    if (game.phase !== 'describing' || game.turn.foulBy) return false;
    game.turn.foulBy = userId;
    this.save(game);
    return true;
  }

  /**
   * Time's up (or a foul): the team moves one square per correct guess. Landing
   * on a Control or Spin square (or reaching the finish) by guessing triggers it.
   * @returns {{ moved: number, next: 'control'|'spin'|null }|null}
   */
  finishDescribing(game) {
    if (game.phase !== 'describing') return null;
    this.clearTimers(game);
    const moved = game.turn.foulBy ? 0 : game.turn.correct.length;
    game.team.position = move(game.team.position, moved);
    game.turn.card = null;

    let next = null;
    if (moved > 0 && game.team.position >= FINISH) next = this.openControl(game, 'finish');
    else if (moved > 0 && isControlSquare(game.team.position)) next = this.openControl(game, 'square');
    else if (moved > 0 && isSpinSquare(game.team.position)) next = 'spin';

    if (next === 'spin') game.phase = 'spin';
    else if (!next) game.phase = 'turnover';
    this.save(game);
    return { moved, next };
  }

  /** A Control round: the describers describe a ♠ entry to every team, with no time limit. */
  openControl(game, reason) {
    game.phase = 'control';
    game.control = { reason, card: drawCard(null, game.used), cardNumber: 1 };
    this.save(game);
    return 'control';
  }

  /** Two teams shouted at once: describe a new card. */
  controlTie(game, cardNumber) {
    if (game.phase !== 'control' || game.control.cardNumber !== cardNumber) return false;
    game.control.card = drawCard(null, game.used);
    game.control.cardNumber++;
    this.save(game);
    return true;
  }

  /**
   * A team won the Control round. On the finish, the team that reached it wins
   * the game by winning it; otherwise the winner takes the next turn.
   * @returns {'won'|'next'|null}
   */
  controlWon(game, cardNumber, teamIndex) {
    if (game.phase !== 'control' || game.control.cardNumber !== cardNumber || !game.teams[teamIndex]) return null;
    game.control.winner = teamIndex;
    if (game.control.reason === 'finish' && teamIndex === game.currentTeam) {
      game.winnerTeam = teamIndex;
      game.phase = 'ended';
      advanceDescribers(game.team, game.options.singleDescriber);
      this.save(game);
      return 'won';
    }
    game.nextTeamOverride = teamIndex;
    game.phase = 'turnover';
    this.save(game);
    return 'next';
  }

  /** Spins on a Spin square. */
  spin(game, result) {
    if (game.phase !== 'spin' || game.spinResult) return false;
    game.spinResult = { ...result, used: result.steps === 0 };
    if (result.steps === 0) game.phase = 'turnover';
    this.save(game);
    return true;
  }

  /**
   * Uses a spin bonus: forward for the spinning team, or back for another team
   * (never before the start). Squares reached this way don't trigger anything.
   */
  applyBonus(game, teamIndex) {
    if (game.phase !== 'spin' || !game.spinResult || game.spinResult.used || !game.teams[teamIndex]) return false;
    const steps = game.spinResult.steps;
    const team = game.teams[teamIndex];
    team.position = move(team.position, teamIndex === game.currentTeam ? steps : -steps);
    game.spinResult.used = true;
    game.spinResult.target = teamIndex;
    game.phase = 'turnover';
    this.save(game);
    return true;
  }

  /** Ends the turn and starts the next team's: a Control winner if there is one, else the next team in order. */
  nextTurn(game) {
    if (game.phase !== 'turnover') return false;
    advanceDescribers(game.team, game.options.singleDescriber);
    const next = game.nextTeamOverride ?? (game.currentTeam + 1) % game.teams.length;
    game.nextTeamOverride = null;
    return this.startTurn(game, next);
  }

  // ── Between games ────────────────────────────────────────────────────────────

  /** Another game with the same teams. */
  rematch(game) {
    if (game.phase !== 'ended') return false;
    game.gameNumber++;
    game.previousTeams = game.teams.map(team => ({ playerIds: [...team.playerIds] }));
    game.phase = 'setup';
    return this.startGame(game);
  }

  /** Back to an open lobby for a new game; setup then offers to keep these teams. */
  newGame(game) {
    if (game.phase !== 'ended') return false;
    game.gameNumber++;
    game.previousTeams = game.teams.map(team => ({ playerIds: [...team.playerIds] }));
    game.teams = [];
    game.phase = 'lobby';
    game.turnNumber = 0;
    game.turnMessageId = null;
    game.turn = null;
    game.control = null;
    this.save(game);
    return true;
  }
}

module.exports = { ArticulateManager, ArticulateGameState, MIN_PLAYERS, MAX_PLAYERS, MIN_TEAM_SIZE };
