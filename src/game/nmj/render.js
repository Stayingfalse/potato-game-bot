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

// ── Shared content helpers ───────────────────────────────────────────────────

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

/**
 * Renders the full celeb + category history in the clear.
 * Used for the spectator ephemeral view and the final roll call when the game ends.
 * Never shown in the public game message while the game is still running.
 */
function renderSpectatorHistory(game) {
  if (game.moves.length === 0) return '*No celebrities named yet.*';
  return game.moves
    .map((m, i) => `\`${String(i + 1).padStart(2, '0')}.\` **${m.celebs.join(' / ')}** — ${m.category} *(<@${m.playerId}>)*`)
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

// ── Containers ───────────────────────────────────────────────────────────────

/** Top box: header + the fixed game info (turn order & challenge tokens). */
function fixedContainer(game) {
  const lines = [
    `**Turn Order**`,
    renderPlayerOrder(game),
  ];
  if (game.status === 'playing' || game.status === 'ended') {
    lines.push('', `**Challenge Tokens**`, renderChallengeCounts(game));
  }
  return new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(baseHeader(game)))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
}

/** Adds the spectator (👁️) button at the top right of the given container. */
function withSpectatorButton(container) {
  return container.addSectionComponents(section =>
    section
      .addTextDisplayComponents(new TextDisplayBuilder().setContent('👀 **Spectator?** Peek at what\'s been named so far.'))
      .setButtonAccessory(new ButtonBuilder().setCustomId('nmj_spectate').setEmoji('👁️').setStyle(ButtonStyle.Secondary)),
  );
}

/** Adds the spectator button (right-aligned accessory in its own row) + action row(s) to a container. */
function bottomContainer(lines, ...actionRows) {
  const container = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')))
    .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  withSpectatorButton(container);
  for (const row of actionRows) container.addActionRowComponents(row);
  return container;
}

/** Wraps text in a code block so the current turn stands out. */
function codeBlock(text) {
  return `\`\`\`\n${text}\n\`\`\``;
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
  const fixed = fixedContainer(game);
  const turn = bottomContainer(
    [
      codeBlock('Spin the wheel to randomize the turn order, then begin the game!'),
      '**Eliminated**',
      renderEliminated(game),
    ],
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('nmj_spin').setLabel('Spin Wheel').setEmoji('🎡').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('nmj_begin').setLabel('Begin Game').setEmoji('🎬').setStyle(ButtonStyle.Success),
    ),
  );
  return { components: [fixed, turn], flags: MessageFlags.IsComponentsV2 };
}

// ── Stage: playing — declare ─────────────────────────────────────────────────

function buildDeclareMessage(game, displayNames) {
  const currentId = game.currentPlayerId();
  const currentName = displayNames?.get(currentId);
  const turn = bottomContainer(
    [
      '### 🎤 Current Turn',
      `${currentName ? `${currentName}'s turn` : 'Turn'}: <@${currentId}> must name a celebrity and a "No More…" category.`,
      '**Eliminated**',
      renderEliminated(game),
    ],
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('nmj_take_turn')
        .setLabel(currentName ? `${currentName}, Take Your Turn` : 'Take Your Turn')
        .setEmoji('🎤')
        .setStyle(ButtonStyle.Primary),
    ),
  );
  return { components: [fixedContainer(game), turn], flags: MessageFlags.IsComponentsV2 };
}

// ── Stage: playing — respond (Accept / Challenge / Name Another) ────────────

function buildRespondMessage(game) {
  const pending = game.pendingMove;
  const responders = game.alivePlayers().filter(id => id !== pending.playerId);
  const statusLines = responders.length
    ? responders.map(id => `${game.acceptedPlayers.has(id) ? '✅' : '⏳'} <@${id}>`).join('\n')
    : '*No other active players.*';

  const turn = bottomContainer(
    [
      '### 📣 Move On The Table',
      `<@${pending.playerId}> named:`,
      codeBlock(`${pending.celebs.join(' / ')}\nCategory: ${pending.category}`),
      '**Responses** (✅ Accepted • ⏳ Awaiting Accept/Challenge/Name Another)',
      statusLines,
      '',
      '**Eliminated**',
      renderEliminated(game),
    ],
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('nmj_accept').setLabel('Accept').setEmoji('✅').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('nmj_challenge').setLabel('Challenge').setEmoji('⚠️').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('nmj_name_another').setLabel('Name Another').setEmoji('❓').setStyle(ButtonStyle.Secondary),
    ),
  );
  return { components: [fixedContainer(game), turn], flags: MessageFlags.IsComponentsV2 };
}

// ── Stage: playing — name another ────────────────────────────────────────────

function buildNameAnotherMessage(game) {
  const pending = game.pendingMove;
  const turn = bottomContainer(
    [
      '### ❓ Name Another',
      `<@${pending.playerId}> must name another celebrity fitting:`,
      codeBlock(pending.category),
      '— or provide a brand new category.',
      '**Eliminated**',
      renderEliminated(game),
    ],
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('nmj_na_provide').setLabel('Name Another Celeb').setEmoji('🎤').setStyle(ButtonStyle.Primary),
      new ButtonBuilder().setCustomId('nmj_na_cant').setLabel("Can't — New Category").setEmoji('🔄').setStyle(ButtonStyle.Secondary),
    ),
  );
  return { components: [fixedContainer(game), turn], flags: MessageFlags.IsComponentsV2 };
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

  const turn = bottomContainer(
    [
      '### ⚠️ Challenge!',
      `<@${ch.challengerId}> challenges <@${pending.playerId}>'s pick:`,
      codeBlock(
        `${pending.celebs.join(' / ')}\n` +
        `Claimed violation: ${ch.matchedCategory ?? ch.claimedCategoryText}`,
      ),
      `Discuss in the thread, then cast your vote below. <@${pending.playerId}> has the tiebreaker vote.`,
      '',
      `**Votes** — ✅ Successful: ${successCount}  •  ❌ Unsuccessful: ${failCount}`,
      `Still to vote: ${stillToVote.length ? stillToVote.map(id => `<@${id}>`).join(', ') : '*none*'}`,
      '',
      '**Eliminated**',
      renderEliminated(game),
    ],
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('nmj_vote_success').setLabel('Successful Challenge').setEmoji('✅').setStyle(ButtonStyle.Danger),
      new ButtonBuilder().setCustomId('nmj_vote_fail').setLabel('Unsuccessful Challenge').setEmoji('❌').setStyle(ButtonStyle.Secondary),
    ),
  );
  return { components: [fixedContainer(game), turn], flags: MessageFlags.IsComponentsV2 };
}

// ── Stage: ended ──────────────────────────────────────────────────────────────

function buildEndedMessage(game, resultText) {
  // No spectator peek here — the full history is revealed to everyone.
  const turn = new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(
      [
        `**${resultText}**`,
        '**Eliminated**',
        renderEliminated(game),
        '',
        '**Final Roll Call — every celebrity & category named**',
        renderSpectatorHistory(game),
      ].join('\n'),
    ));
  return { components: [fixedContainer(game), turn], flags: MessageFlags.IsComponentsV2 };
}

/**
 * Build the payload for the single persistent NMJ message, based on current game state.
 * @param {object} game
 * @param {string} [resultText] Final result text for the ended stage.
 * @param {object} [options]
 * @param {Map<string, string>} [options.displayNames] Map of userId → display name (for button labels).
 * @returns {{ components: any[], flags: number }}
 */
function renderGameMessage(game, resultText, options = {}) {
  if (game.status === 'recruiting') return buildRecruitingMessage(game);
  if (game.status === 'ordering') return buildOrderingMessage(game);
  if (game.status === 'ended') return buildEndedMessage(game, resultText ?? 'Game has ended.');

  // status === 'playing'
  if (game.challengeState) return buildChallengeMessage(game);
  if (game.pendingMove?.stage === 'name_another') return buildNameAnotherMessage(game);
  if (game.pendingMove?.stage === 'respond') return buildRespondMessage(game);
  return buildDeclareMessage(game, options.displayNames);
}

module.exports = {
  renderGameMessage,
  renderPlayerOrder,
  renderChallengeCounts,
  renderEliminated,
  renderSpectatorHistory,
};
