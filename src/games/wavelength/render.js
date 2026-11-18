'use strict';

const {
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  MessageFlags,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  AttachmentBuilder,
} = require('discord.js');
const { renderLobbyText, buildLobbyComponents } = require('./phases/lobby');
const {
  renderSessionModePromptText,
  buildSessionModePromptComponents,
  renderGameOptionsText,
  buildGameOptionsComponents,
  describeSessionMode,
} = require('./phases/sessionConfig');
const {
  renderCluingBoardText,
  buildClueGiverPromptComponents,
  renderPublicClueText,
} = require('./phases/cluing');
const { buildGuessPromptComponents } = require('./phases/guessing');
const {
  renderSessionSummaryText,
  buildRematchComponents,
  buildAutoAdvanceControls,
  evaluateSessionGoal,
} = require('./phases/sessionEnd');
const { renderRevealBreakdownText } = require('./phases/reveal');
const { generateRevealImage } = require('./imageGen');
const { altText, listText } = require('../_core/altText');

function createContainer(text, accentColor) {
  return new ContainerBuilder()
    .setAccentColor(accentColor)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(text));
}

function renderPlayers(game) {
  return game.players.size === 0
    ? '*No players yet — be the first to join!*'
    : [...game.players.values()].map(player => `• <@${player.id}>`).join('\n');
}

function renderMetaText(game) {
  return [
    `**Round:** ${game.gameNumber}`,
    `**Players (${game.players.size}/20):**`,
    renderPlayers(game),
    '',
    `**Session Mode:** ${describeSessionMode(game.sessionMode)}`,
    `**Game Pace:** ${game.gamePace === 'turnbased' ? '🐢 Turn-based' : '⚡ Realtime'}`,
  ].join('\n');
}


function buildLobbyMessage(game) {
  const container = createContainer(renderLobbyText(game), 0x5865F2);
  container.addActionRowComponents(...buildLobbyComponents(game));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildSetupMessage(game) {
  const container = createContainer(
    game.sessionMode ? renderGameOptionsText(game) : renderSessionModePromptText(game),
    0x5865F2,
  );
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(renderMetaText(game)));
  container.addActionRowComponents(...(game.sessionMode ? buildGameOptionsComponents(game) : buildSessionModePromptComponents()));
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildAwaitingClueMessage(game) {
  const container = createContainer(renderCluingBoardText(game), 0xF39C12);
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(renderMetaText(game)));
  container.addActionRowComponents(...buildClueGiverPromptComponents());
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

function buildGuessingMessage(game) {
  const container = createContainer(renderPublicClueText(game), 0x3498DB);
  container.addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(renderMetaText(game)));
  container.addActionRowComponents(...buildGuessPromptComponents());
  return { components: [container], flags: MessageFlags.IsComponentsV2 };
}

/** Alt text for the reveal: the dial's ends, the clue, the target, the group average and every guess. */
function revealAlt(round, playerGuesses) {
  const average = round.scores?.avgPosition;
  const guesses = playerGuesses.map(g => `${g.username} at ${g.position}`);
  return altText([
    `Wavelength dial from ${round.spectrum.left} to ${round.spectrum.right}${round.clue ? `, clue "${round.clue}"` : ''}.`,
    `Target at ${round.target}${average !== null && average !== undefined ? `, group average ${average}` : ''}.`,
    guesses.length > 0 ? `Guesses: ${listText(guesses)}.` : 'No guesses.',
  ].join(' '));
}

async function buildEndedMessage(game, options = {}) {
  const latestRound = game.sessionHistory?.[game.sessionHistory.length - 1] ?? null;
  const goal = evaluateSessionGoal(game);
  const autoAdvanceNotice = !options.closedReason && options.includeControls !== false && game.autoAdvanceRounds && !goal.complete;

  const components = [];
  const files = [];

  const headerLines = [
    options.closedReason
      ? '## 〰️ Wavelength — Session Closed'
      : '## 〰️ Wavelength — Round Complete',
    options.resultText ?? null,
  ].filter(Boolean).join('\n\n');
  components.push(createContainer(headerLines, options.closedReason ? 0x95A5A6 : 0x2ECC71));

  if (latestRound?.spectrum && latestRound?.target !== null && latestRound?.target !== undefined) {
    const playerGuesses = Object.entries(latestRound.guesses ?? {}).map(([userId, guess]) => {
      const player = game.players.get(userId) ?? { username: userId, avatarURL: null };
      return {
        userId,
        username: player.username,
        avatarURL: player.avatarURL,
        position: guess.position,
      };
    });

    try {
      const imageBuffer = await generateRevealImage(
        latestRound.spectrum,
        latestRound.target,
        playerGuesses,
        latestRound.clue,
      );
      const description = revealAlt(latestRound, playerGuesses);
      files.push(new AttachmentBuilder(imageBuffer, { name: 'wavelength_reveal.png', description }));
      components.push(
        new ContainerBuilder()
          .setAccentColor(0x2ECC71)
          .addMediaGalleryComponents(
            new MediaGalleryBuilder().addItems(
              new MediaGalleryItemBuilder()
                .setURL('attachment://wavelength_reveal.png')
                .setDescription(description),
            ),
          ),
      );
    } catch (err) {
      console.error('[Wavelength] generateRevealImage failed:', err);
    }
  }

  if (latestRound) {
    components.push(createContainer(renderRevealBreakdownText(game, latestRound), 0x2ECC71));
  }

  const summaryContainer = createContainer(renderSessionSummaryText(game, {
    autoAdvanceNotice,
  }), 0x5865F2);

  if (options.includeControls !== false) {
    summaryContainer.addActionRowComponents(...(
      autoAdvanceNotice ? buildAutoAdvanceControls(game) : buildRematchComponents(goal.complete, game)
    ));
  }

  components.push(summaryContainer);

  return {
    components,
    flags: MessageFlags.IsComponentsV2,
    ...(files.length ? { files } : {}),
  };
}

async function renderGameMessage(game, options = {}) {
  if (game.phase === 'lobby') return buildLobbyMessage(game);
  if (game.phase === 'setup') return buildSetupMessage(game);
  if (game.phase === 'cluing' && (!game.clue || !game.chosenSpectrum)) return buildAwaitingClueMessage(game);
  if (game.phase === 'cluing' || game.phase === 'guessing') return buildGuessingMessage(game);
  if (game.phase === 'reveal' || game.phase === 'ended') return buildEndedMessage(game, options);
  return buildLobbyMessage(game);
}

module.exports = {
  renderGameMessage,
  createContainer,
};
