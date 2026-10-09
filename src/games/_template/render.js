'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const { MIN_PLAYERS } = require('./manager');

/**
 * Builds the game's one message from its state. Pure: no Discord calls, so the
 * same function serves new messages, edits, button updates and restore.
 *
 * @param {import('./state')} game
 * @param {{ closedReason?: string }} [options]  set when the session has been closed
 * @returns {{ components: ContainerBuilder[], flags: number }}
 */
function renderGameMessage(game, { closedReason } = {}) {
  if (closedReason) return message(`## 🎲 High Roll — Session Closed\n${closedReason}`, resultsText(game));
  if (game.phase === 'rolling') return renderRolling(game);
  if (game.phase === 'ended') return renderEnded(game);
  return renderLobby(game);
}

function renderLobby(game) {
  const players = [...game.players.keys()].map(id => `• <@${id}>`).join('\n') || '*No players yet — be the first to join!*';
  return message(
    `## 🎲 High Roll — Game ${game.gameNumber}\nEveryone rolls once; the highest roll wins. At least **${MIN_PLAYERS} players** needed.`,
    `**Players (${game.players.size})**\n${players}`,
    buttons(
      button('hr_join', 'Join', '✋', ButtonStyle.Success),
      button('hr_leave', 'Leave', '🚪', ButtonStyle.Secondary),
      button('hr_start', 'Start', '▶️', ButtonStyle.Primary),
      button('hr_cancel', 'Cancel', '✖️', ButtonStyle.Danger),
    ),
  );
}

function renderRolling(game) {
  const deadline = `<t:${Math.floor(game.phaseEndsAt / 1000)}:R>`;
  const lines = [...game.players.keys()].map(id => (game.rolls.has(id) ? `🎲 <@${id}> rolled **${game.rolls.get(id)}**` : `⏳ <@${id}>`));
  return message(
    `## 🎲 High Roll — Game ${game.gameNumber}\nPress **Roll** once. Rolling closes ${deadline}.`,
    lines.join('\n'),
    buttons(button('hr_roll', 'Roll', '🎲', ButtonStyle.Primary)),
  );
}

function renderEnded(game) {
  return message(
    `## 🎲 High Roll — Game ${game.gameNumber} Results`,
    resultsText(game),
    buttons(
      button('hr_again', 'Play Again', '🔄', ButtonStyle.Primary),
      button('hr_close', 'Close Session', '🔒', ButtonStyle.Secondary),
    ),
  );
}

function resultsText(game) {
  if (game.rolls.size === 0) return '*Nobody rolled.*';
  const winners = new Set(game.winnerIds());
  return [...game.rolls]
    .sort(([, a], [, b]) => b - a)
    .map(([id, roll]) => `${winners.has(id) ? '🏆' : '•'} <@${id}> — **${roll}**`)
    .join('\n');
}

// ── Small builders ─────────────────────────────────────────────────────────────

function message(header, body, actionRow) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(header))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(body));
  if (actionRow) container.addActionRowComponents(actionRow);
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buttons(...items) {
  return new ActionRowBuilder().addComponents(...items);
}

function button(customId, label, emoji, style) {
  return new ButtonBuilder().setCustomId(customId).setLabel(label).setEmoji(emoji).setStyle(style);
}

module.exports = { renderGameMessage };
