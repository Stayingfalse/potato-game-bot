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
const { CHALLENGE_TOKENS_PER_PLAYER } = require('../NoMoreJockeysManager');

/** Renders the player order list, marking eliminated players and the current turn. */
function renderPlayerOrder(game) {
  if (game.players.length === 0) return '*No players yet.*';
  return game.players
    .map((id, i) => {
      const eliminated = game.eliminatedPlayers.includes(id);
      const isCurrent = game.status === 'playing' && !eliminated && game.currentPlayerIndex === i;
      const marker = eliminated ? '❌' : isCurrent ? '▶️' : '•';
      return `${marker} \`${String(i + 1).padStart(2, '0')}.\` <@${id}>${eliminated ? ' *(eliminated)*' : ''}`;
    })
    .join('\n');
}

function renderChallengeCounts(game) {
  const alive = game.alivePlayers();
  if (alive.length === 0) return '*None*';
  return alive
    .map(id => `<@${id}>: ${game.challengeCounts.get(id) ?? CHALLENGE_TOKENS_PER_PLAYER}🪙`)
    .join('\n');
}

function renderEliminated(game) {
  if (game.eliminatedPlayers.length === 0) return '*None*';
  return game.eliminatedPlayers.map(id => `<@${id}>`).join(', ');
}

function renderCelebHistory(game) {
  if (game.moves.length === 0) return '*No celebrities named yet.*';
  return game.moves
    .map((m, i) => `\`${String(i + 1).padStart(2, '0')}.\` ${m.celebs.join(' / ')} — <@${m.playerId}>`)
    .join('\n');
}

function baseHeader(game) {
  const stageNames = {
    recruiting: '🧑\u200d🤝\u200d🧑 Recruiting Players',
    ordering: '🎡 Determining Turn Order',
    playing: '🎬 Game In Progress',
    ended: '🏁 Game Ended',
  };
  return `## No More Jockeys — ${stageNames[game.status] ?? game.status}`;
}

function statusBlock(game) {
  const lines = [
    `**Player Order**`,
    renderPlayerOrder(game),
    '',
    `**Challenge Tokens**`,
    renderChallengeCounts(game),
    '',
    `**Eliminated**`,
    renderEliminated(game),
  ];
  return lines.join('\n');
}

// ── Stage: recruiting ───────────────────────────────────────────────────────

function buildRecruitingMessage(game) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(baseHeader(game)))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `Join the game below! A minimum of **3 players** is required.\n\n**Players (${game.players.length})**\n${
        game.players.length ? game.players.map(id => `<@${id}>`).join('\n') : '*No players yet — be the first to join!*'
      }`,
    ))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nmj_join').setLabel('Join Game').setEmoji('✋').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('nmj_leave').setLabel('Leave Game').setEmoji('🚪').setStyle(ButtonStyle.Secondary),
        new ButtonBuilder().setCustomId('nmj_start').setLabel('Start Game').setEmoji('▶️').setStyle(ButtonStyle.Primary),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// ── Stage: ordering ──────────────────────────────────────────────────────────

function buildOrderingMessage(game) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(baseHeader(game)))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `Spin the wheel to randomize turn order, then begin the game!\n\n**Player Order**\n${renderPlayerOrder(game)}`,
    ))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nmj_spin').setLabel('Spin Wheel').setEmoji('🎡').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('nmj_begin').setLabel('Begin Game').setEmoji('🎬').setStyle(ButtonStyle.Success),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// ── Stage: playing — declare ─────────────────────────────────────────────────

function buildDeclareMessage(game) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(baseHeader(game)))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `It's <@${game.currentPlayerId()}>'s turn! They must name a celebrity and a "No More…" category.\n\n${statusBlock(game)}\n\n**Named So Far**\n${renderCelebHistory(game)}`,
    ))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nmj_take_turn').setLabel('Take Turn').setEmoji('🎤').setStyle(ButtonStyle.Primary),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// ── Stage: playing — respond (Accept / Challenge / Name Another) ────────────

function buildRespondMessage(game) {
  const pending = game.pendingMove;
  const waitingOn = game.alivePlayers().filter(id => id !== pending.playerId && !game.acceptedPlayers.has(id));

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(baseHeader(game)))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `<@${pending.playerId}> named: **${pending.celebs.join(' / ')}**\n` +
      `Category: **${pending.category}**\n\n` +
      `Waiting on: ${waitingOn.length ? waitingOn.map(id => `<@${id}>`).join(', ') : '*everyone has responded*'}\n\n${statusBlock(game)}`,
    ))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nmj_accept').setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success),
        new ButtonBuilder().setCustomId('nmj_challenge').setLabel('Challenge').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('nmj_name_another').setLabel('Name Another').setEmoji('❓').setStyle(ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// ── Stage: playing — name another ────────────────────────────────────────────

function buildNameAnotherMessage(game) {
  const pending = game.pendingMove;
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(baseHeader(game)))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `<@${pending.playerId}> has been asked to **name another** celebrity fitting **${pending.category}**, ` +
      `or if they cannot, provide a brand new category.\n\n${statusBlock(game)}`,
    ))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nmj_na_provide').setLabel('Name Another Celeb').setEmoji('🎤').setStyle(ButtonStyle.Primary),
        new ButtonBuilder().setCustomId('nmj_na_cant').setLabel("Can't — New Category").setEmoji('🔄').setStyle(ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// ── Stage: playing — challenge / vote ────────────────────────────────────────

function buildChallengeMessage(game) {
  const pending = game.pendingMove;
  const ch = game.challengeState;
  const votes = [...ch.votes.entries()];
  const successCount = votes.filter(([, v]) => v === 'success').length;
  const failCount = votes.filter(([, v]) => v === 'fail').length;
  const votedIds = new Set(votes.map(([id]) => id));
  const stillToVote = game.alivePlayers().filter(id => !votedIds.has(id));

  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(baseHeader(game)))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `⚠️ **Challenge!**\n` +
      `<@${ch.challengerId}> challenges <@${pending.playerId}>'s pick **${pending.celebs.join(' / ')}**, ` +
      `claiming it violates: **${ch.matchedCategory ?? ch.claimedCategoryText}**\n\n` +
      `Discuss in the thread, then cast your vote below. <@${pending.playerId}> has the tiebreaker vote.\n\n` +
      `**Votes** — ✅ Successful: ${successCount}  •  ❌ Unsuccessful: ${failCount}\n` +
      `Still to vote: ${stillToVote.length ? stillToVote.map(id => `<@${id}>`).join(', ') : '*none*'}\n\n${statusBlock(game)}`,
    ))
    .addActionRowComponents(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId('nmj_vote_success').setLabel('Successful Challenge').setEmoji('✅').setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId('nmj_vote_fail').setLabel('Unsuccessful Challenge').setEmoji('❌').setStyle(ButtonStyle.Secondary),
      ),
    );
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

// ── Stage: ended ──────────────────────────────────────────────────────────────

function buildEndedMessage(game, resultText) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(baseHeader(game)))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      `${resultText}\n\n${statusBlock(game)}\n\n**Named So Far**\n${renderCelebHistory(game)}`,
    ));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Build the payload for the single persistent NMJ message, based on current game state.
 * @returns {{ components: any[], flags: number }}
 */
function renderGameMessage(game, resultText) {
  if (game.status === 'recruiting') return buildRecruitingMessage(game);
  if (game.status === 'ordering') return buildOrderingMessage(game);
  if (game.status === 'ended') return buildEndedMessage(game, resultText ?? 'Game has ended.');

  // status === 'playing'
  if (game.challengeState) return buildChallengeMessage(game);
  if (game.pendingMove?.stage === 'name_another') return buildNameAnotherMessage(game);
  if (game.pendingMove?.stage === 'respond') return buildRespondMessage(game);
  return buildDeclareMessage(game);
}

module.exports = {
  renderGameMessage,
  renderPlayerOrder,
  renderChallengeCounts,
  renderEliminated,
  renderCelebHistory,
};
