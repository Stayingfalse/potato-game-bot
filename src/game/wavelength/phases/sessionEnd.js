'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { describeSessionMode } = require('./sessionConfig');

function buildAutoAdvanceToggleButton(game) {
  const autoAdv = game?.autoAdvanceRounds ?? false;
  return new ButtonBuilder()
    .setCustomId('wl_toggle_autoadvance')
    .setLabel(autoAdv ? '✅ Auto-advance: ON' : '❌ Auto-advance: OFF')
    .setStyle(autoAdv ? ButtonStyle.Success : ButtonStyle.Secondary);
}

function buildRematchComponents(disableNextRound = false, game = null) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wl_rematch_same')
        .setLabel('Next Round')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('🔄')
        .setDisabled(disableNextRound),
      new ButtonBuilder()
        .setCustomId('wl_rematch_open')
        .setLabel('New Game (Open Signups)')
        .setStyle(ButtonStyle.Secondary)
        .setEmoji('📋'),
      buildAutoAdvanceToggleButton(game),
      new ButtonBuilder()
        .setCustomId('wl_close_session')
        .setLabel('End Game & Close Session')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒'),
    ),
  ];
}

function buildAutoAdvanceControls(game) {
  return [
    new ActionRowBuilder().addComponents(
      buildAutoAdvanceToggleButton(game),
      new ButtonBuilder()
        .setCustomId('wl_close_session')
        .setLabel('End Game & Close Session')
        .setStyle(ButtonStyle.Danger)
        .setEmoji('🔒'),
    ),
  ];
}

function computeRoundTotal(roundHistory) {
  let total = 0;
  for (const [, value] of iterateGuesserScores(roundHistory?.scores?.guesserScores)) {
    total += value?.total ?? 0;
  }
  total += roundHistory?.scores?.clueGiverScore?.total ?? 0;
  return total;
}

function computeSessionTotals(game) {
  const totals = new Map();

  for (const round of game.sessionHistory ?? []) {
    for (const [userId, value] of iterateGuesserScores(round?.scores?.guesserScores)) {
      totals.set(userId, (totals.get(userId) ?? 0) + (value?.total ?? 0));
    }

    if (round?.clueGiverId) {
      totals.set(
        round.clueGiverId,
        (totals.get(round.clueGiverId) ?? 0) + (round?.scores?.clueGiverScore?.total ?? 0),
      );
    }
  }

  return [...totals.entries()]
    .map(([userId, total]) => ({ userId, total }))
    .sort((a, b) => b.total - a.total);
}

function evaluateSessionGoal(game) {
  const sessionMode = game.sessionMode;
  if (!sessionMode || sessionMode.type === 'endless') {
    return { complete: false, message: null };
  }

  if (sessionMode.type === 'round_robin_times') {
    const target = Math.max(1, sessionMode.targetClueTurns ?? 1);
    const counts = game.clueOrderState?.clueTurnsByPlayer ?? {};
    const playerIds = [...game.players.keys()];
    const everyoneComplete = playerIds.length > 0 && playerIds.every((id) => (counts[id] ?? 0) >= target);
    const progressLines = playerIds
      .map((id) => `<@${id}>: **${counts[id] ?? 0}/${target}**`)
      .join(' · ');
    return { complete: everyoneComplete, message: progressLines || 'No players tracked yet.' };
  }

  if (sessionMode.type === 'snake_points') {
    const target = Math.max(1, sessionMode.targetPoints ?? 1);
    const totals = computeSessionTotals(game);
    const winner = totals.find(entry => entry.total >= target);
    if (winner) {
      return {
        complete: true,
        message: `<@${winner.userId}> reached **${winner.total}** points (target: **${target}**).`,
      };
    }
    const leader = totals[0];
    return {
      complete: false,
      message: leader
        ? `Leader: <@${leader.userId}> at **${leader.total}/${target}** points.`
        : `First player to **${target}** points wins.`,
    };
  }

  return { complete: false, message: null };
}

function renderSessionSummaryText(game, options = {}) {
  const cumulative = computeSessionTotals(game);
  const goal = evaluateSessionGoal(game);
  const rounds = (game.sessionHistory ?? []).map((h) => {
    const roundNo = h.roundNumber ?? h.gameNumber ?? '?';
    const avg = h.scores?.avgPosition ?? '?';
    const roundTotal = computeRoundTotal(h);
    return (
      `**Round ${roundNo}** — \`${h.spectrum?.left}\` ↔ \`${h.spectrum?.right}\`\n` +
      `Clue: "${h.clue}" · Target: \`${h.target}\` · Group avg: \`${avg}\` · Round pts: **${roundTotal}**`
    );
  });

  const totalsText = cumulative.length > 0
    ? cumulative.map((entry, idx) => `**${idx + 1}.** <@${entry.userId}> — **${entry.total} pts**`).join('\n')
    : '*No scores recorded yet.*';

  return [
    options.heading ?? '## 〰️ Wavelength — Session Summary',
    options.prefixText ?? null,
    `**Session Mode:** ${describeSessionMode(game.sessionMode)}`,
    '',
    '**Rounds**',
    rounds.join('\n\n') || '*No rounds yet.*',
    '',
    '**📈 Cumulative Session Scores**',
    totalsText,
    goal.message
      ? `\n**${goal.complete ? '🏁 Goal Reached' : '📌 Goal Progress'}**\n${goal.message}`
      : null,
    options.autoAdvanceNotice ? '\n🔄 **Auto-advance is ON** — starting next round in 5 seconds…' : null,
  ].filter(Boolean).join('\n');
}

function iterateGuesserScores(guesserScores) {
  if (guesserScores instanceof Map) return guesserScores.entries();
  if (guesserScores && typeof guesserScores === 'object') return Object.entries(guesserScores);
  return [];
}

module.exports = {
  buildRematchComponents,
  buildAutoAdvanceControls,
  computeSessionTotals,
  evaluateSessionGoal,
  renderSessionSummaryText,
};
