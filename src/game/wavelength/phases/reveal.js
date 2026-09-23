'use strict';

const WavelengthRepository = require('../../../db/WavelengthRepository');
const WavelengthStatsRepository = require('../../../db/WavelengthStatsRepository');

const TIER_BULLSEYE = 0;
const TIER_CLOSE = 5;
const TIER_NEAR = 10;
const TIER_FAR = 20;

function classifyTier(guess, target) {
  const dist = Math.abs(guess - target);
  if (dist === TIER_BULLSEYE) return { key: 'bullseye', label: '🎯 Exact Bullseye', points: 4, distance: dist };
  if (dist <= TIER_CLOSE) return { key: 'close', label: '🟢 Within 5', points: 3, distance: dist };
  if (dist <= TIER_NEAR) return { key: 'near', label: '🔵 Within 10', points: 2, distance: dist };
  if (dist <= TIER_FAR) return { key: 'far', label: '🟡 Within 20', points: 1, distance: dist };
  return { key: 'miss', label: '⚫ Miss', points: 0, distance: dist };
}

function groupAverage(guesses) {
  const positions = [...guesses.values()].map(g => g.position);
  if (positions.length === 0) return null;
  return Math.round(positions.reduce((s, p) => s + p, 0) / positions.length);
}

function stdDev(guesses) {
  const positions = [...guesses.values()].map(g => g.position);
  if (positions.length < 2) return 0;
  const mean = positions.reduce((s, p) => s + p, 0) / positions.length;
  const variance = positions.reduce((s, p) => s + (p - mean) ** 2, 0) / positions.length;
  return Math.sqrt(variance);
}

function computeScores(game) {
  const target = game.targetPosition;
  const avg = groupAverage(game.guesses);
  const avgTier = avg !== null ? classifyTier(avg, target) : { points: 0 };
  const avgScr = avgTier.points;
  const dev = stdDev(game.guesses);
  const synergy = dev <= 10 ? 5 : dev <= 15 ? 3 : 0;

  const guesserScores = new Map();
  let clueGiverFromGuessers = 0;

  for (const [userId, { position }] of game.guesses) {
    const tier = classifyTier(position, target);
    const individual = tier.points;
    const bonus = avgScr;
    const total = individual + bonus;

    guesserScores.set(userId, {
      individual,
      bonus,
      total,
      tier: tier.label,
      tierKey: tier.key,
      distance: tier.distance,
    });
    clueGiverFromGuessers += individual;
  }

  const clueGiverTotal = clueGiverFromGuessers + synergy;

  return {
    guesserScores,
    clueGiverScore: { fromGuessers: clueGiverFromGuessers, synergy, total: clueGiverTotal },
    avgPosition: avg,
    avgScore: avgScr,
    deviation: Math.round(dev * 10) / 10,
  };
}

function serializeScores(scores) {
  return {
    ...scores,
    guesserScores: Object.fromEntries(scores.guesserScores),
  };
}

function renderRevealBreakdownText(game, round) {
  if (!round) {
    return '## 〰️ Wavelength — Session Update\nNo completed round data is available.';
  }

  const scoreData = round.scores ?? {};
  const clueGiver = game.players.get(round.clueGiverId);
  const guesserLines = Object.entries(scoreData.guesserScores ?? {}).map(([userId, score]) => {
    const pos = round.guesses?.[userId]?.position ?? '?';
    return `<@${userId}> — pos \`${pos}\` ${score.tier} **${score.individual}** + group bonus **+${score.bonus}** = **${score.total} pts**`;
  });

  return [
    `## 〰️ Wavelength — Scores (Round ${round.roundNumber ?? game.gameNumber})`,
    `**Spectrum:** \`${round.spectrum?.left ?? '?'}\` ↔ \`${round.spectrum?.right ?? '?'}\``,
    `**Clue:** "${round.clue ?? '?'}"`,
    `**Target:** position \`${round.target ?? '?'}\``,
    scoreData.avgPosition !== null && scoreData.avgPosition !== undefined
      ? `**Group Average:** position \`${scoreData.avgPosition}\``
      : null,
    `**Deviation (σ):** ${scoreData.deviation ?? 0}`,
    '',
    '**📊 Guesser Scores**',
    guesserLines.join('\n') || '*No guesser scores recorded.*',
    '',
    '**🎤 Clue Giver Score**',
    `<@${round.clueGiverId}> (${clueGiver?.username ?? '?'})`,
    `From guessers: **${scoreData.clueGiverScore?.fromGuessers ?? 0} pts**`
      + ((scoreData.clueGiverScore?.synergy ?? 0) > 0 ? ` + synergy bonus: **+${scoreData.clueGiverScore.synergy} pts**` : '')
      + ` = **${scoreData.clueGiverScore?.total ?? 0} pts**`,
  ].filter(Boolean).join('\n');
}

async function startRevealPhase(game, client) {
  if (game.phase === 'reveal' || game.phase === 'ended') return;
  game.phase = 'reveal';
  WavelengthRepository.upsert(game);

  if (game.guessTimeout) {
    clearTimeout(game.guessTimeout);
    game.guessTimeout = null;
  }

  const scores = computeScores(game);
  game.sessionHistory.push({
    roundNumber: game.gameNumber,
    target: game.targetPosition,
    clue: game.clue,
    spectrum: game.chosenSpectrum,
    clueGiverId: game.clueGiverId,
    guesses: Object.fromEntries(game.guesses),
    scores: serializeScores(scores),
  });

  WavelengthStatsRepository.recordRound(game.guildId, game, scores);
  WavelengthRepository.upsert(game);

  const { endGame } = require('./endGame');
  await endGame(game, client);
}

module.exports = {
  startRevealPhase,
  renderRevealBreakdownText,
  computeScores,
};
