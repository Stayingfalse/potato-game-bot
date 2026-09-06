'use strict';

const WavelengthRepository = require('../../../db/WavelengthRepository');
const WavelengthStatsRepository = require('../../../db/WavelengthStatsRepository');

const TIER_BULLSEYE = 5;
const TIER_CLOSE = 10;
const TIER_NEAR = 20;

function tierScore(guess, target) {
  const dist = Math.abs(guess - target);
  if (dist <= TIER_BULLSEYE) return 4;
  if (dist <= TIER_CLOSE) return 3;
  if (dist <= TIER_NEAR) return 2;
  return 0;
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
  const avgScr = avg !== null ? tierScore(avg, target) : 0;
  const dev = stdDev(game.guesses);
  const synergy = dev <= 10 ? 5 : dev <= 15 ? 3 : 0;

  const guesserScores = new Map();
  let clueGiverFromGuessers = 0;

  for (const [userId, { position }] of game.guesses) {
    const individual = tierScore(position, target);
    const bonus = avgScr;
    const total = individual + bonus;

    const tierLabel = individual === 4 ? '🎯 Bullseye'
      : individual === 3 ? '🔵 Close'
        : individual === 2 ? '🟡 Near'
          : '⚫ Miss';

    guesserScores.set(userId, { individual, bonus, total, tier: tierLabel });
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
