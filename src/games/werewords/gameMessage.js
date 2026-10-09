'use strict';

const { renderGameMessage } = require('./render');
const WerewordsRepository = require('./repository');
const { fetchChannel } = require('../_core/threads');
const { editMessage, editOrSend } = require('../_core/messages');

/**
 * Re-renders the live game message in place, or posts it if it doesn't exist yet
 * (a new game) or has been deleted.
 * @param {import('./state')} game
 * @param {{ outcome?: string }} [options]  passed to renderGameMessage
 */
async function updateGameMessage(game, client, options) {
  const thread = await fetchChannel(client, game.threadId);
  const result = await editOrSend(thread, game.boardMessageId, renderGameMessage(game, options));
  if (result?.created) {
    game.boardMessageId = result.message.id;
    WerewordsRepository.upsert(game);
  }
}

/**
 * Posts the live game message afresh at the bottom of the thread. Used when the
 * phase changes after play, by which point the old message is buried under
 * guesses. The old message keeps its last state as a record, loses its buttons
 * and links to the new one.
 */
async function moveGameMessage(game, client, options) {
  const thread = await fetchChannel(client, game.threadId);
  if (!thread) return;

  const previousId = game.boardMessageId;
  const sent = await thread.send(renderGameMessage(game, options)).catch(() => null);
  if (!sent) return;
  game.boardMessageId = sent.id;
  WerewordsRepository.upsert(game);

  if (previousId) {
    const url = `https://discord.com/channels/${game.guildId}/${game.threadId}/${sent.id}`;
    await editMessage(thread, previousId, { content: `⬇️ Continued below: ${url}`, components: [] });
  }
}

module.exports = { updateGameMessage, moveGameMessage };
