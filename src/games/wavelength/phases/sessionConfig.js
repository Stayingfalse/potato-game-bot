'use strict';

const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const MODE_LABELS = {
  round_robin_times: 'Round Robin · Everyone clues X times',
  snake_points: 'Snake Draft · First to X points',
  endless: 'Endless Mode',
};

const DEFAULT_SESSION_MODE = Object.freeze({ type: 'endless', clueOrder: 'random' });

function describeSessionMode(sessionMode) {
  if (!sessionMode) return 'Not selected yet';

  if (sessionMode.type === 'round_robin_times') {
    return `${MODE_LABELS.round_robin_times} (X = ${sessionMode.targetClueTurns})`;
  }
  if (sessionMode.type === 'snake_points') {
    return `${MODE_LABELS.snake_points} (X = ${sessionMode.targetPoints})`;
  }
  return `${MODE_LABELS.endless} (${formatClueOrder(sessionMode.clueOrder)})`;
}

function formatClueOrder(clueOrder) {
  if (clueOrder === 'round_robin') return 'Round Robin clue order';
  if (clueOrder === 'snake') return 'Snake Draft clue order';
  return 'Random clue giver';
}

function renderSessionModePromptText(game) {
  return [
    '## 〰️ Wavelength — Choose Session Mode',
    `Host <@${game.hostId}>, choose how this session should run before Round ${game.gameNumber} starts.`,
    '',
    '1) **Round Robin** until everyone has been Clue Giver X times.',
    '2) **Snake Draft** until one player reaches X points.',
    '3) **Endless Mode** with Round Robin, Snake Draft, or Random clue order.',
  ].join('\n');
}

function buildSessionModePromptComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wl_mode_rr_times')
        .setLabel('Round Robin (X clues each)')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('wl_mode_snake_points')
        .setLabel('Snake Draft (First to X pts)')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('wl_mode_endless')
        .setLabel('Endless Mode')
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

function buildSnakePointsComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wl_snake_points_30')
        .setLabel('30 pts')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('wl_snake_points_45')
        .setLabel('45 pts')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('wl_snake_points_60')
        .setLabel('60 pts')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

function buildEndlessClueOrderComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('wl_endless_order_round_robin')
        .setLabel('Round Robin')
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId('wl_endless_order_snake')
        .setLabel('Snake Draft')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('wl_endless_order_random')
        .setLabel('Random')
        .setStyle(ButtonStyle.Success),
    ),
  ];
}

function renderGameOptionsText(game) {
  const pace = game.gamePace ?? 'realtime';
  const autoAdv = game.autoAdvanceRounds ?? false;
  const paceLabel = pace === 'turnbased'
    ? '🐢 Turn-based (no timer — guessers are reminded when it\'s their turn)'
    : '⚡ Realtime (3-minute timer auto-locks remaining guesses)';
  const autoLabel = autoAdv
    ? '✅ ON — next round starts automatically after each reveal'
    : '❌ OFF — host clicks **Next Round** manually';

  return [
    '## 〰️ Wavelength — Game Options',
    `Host <@${game.hostId}>, configure game options before Round ${game.gameNumber} begins.`,
    '',
    `**Session Mode:** ${describeSessionMode(game.sessionMode)}`,
    `**Game Pace:** ${paceLabel}`,
    `**Auto-advance Rounds:** ${autoLabel}`,
  ].join('\n');
}

function buildGameOptionsComponents(game) {
  const pace = game.gamePace ?? 'realtime';
  const autoAdv = game.autoAdvanceRounds ?? false;

  const paceRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('wl_pace_realtime')
      .setLabel('⚡ Realtime')
      .setStyle(pace === 'realtime' ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('wl_pace_turnbased')
      .setLabel('🐢 Turn-based')
      .setStyle(pace === 'turnbased' ? ButtonStyle.Success : ButtonStyle.Secondary),
  );

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('wl_toggle_autoadvance')
      .setLabel(autoAdv ? '✅ Auto-advance: ON' : '❌ Auto-advance: OFF')
      .setStyle(autoAdv ? ButtonStyle.Success : ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('wl_confirm_options')
      .setLabel('▶ Confirm & Start Round')
      .setStyle(ButtonStyle.Primary),
  );

  return [paceRow, actionRow];
}

module.exports = {
  DEFAULT_SESSION_MODE,
  describeSessionMode,
  formatClueOrder,
  renderSessionModePromptText,
  buildSessionModePromptComponents,
  buildSnakePointsComponents,
  buildEndlessClueOrderComponents,
  renderGameOptionsText,
  buildGameOptionsComponents,
};
