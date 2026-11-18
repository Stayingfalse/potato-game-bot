'use strict';

/**
 * Records every image attachment and media gallery item the bot builds, so a
 * test can check they all carry alt text.
 *
 * Call `trackImages()` before requiring anything from src/: the games take
 * `AttachmentBuilder` from discord.js when they load, so it must be swapped
 * for the recording version first.
 */

const discord = require('discord.js');

const IMAGE_NAME = /\.(png|jpe?g|gif|webp)$/i;
let tracked = null;

function trackImages() {
  if (tracked) return tracked;
  tracked = { attachments: [], mediaItems: [] };
  const Original = discord.AttachmentBuilder;
  discord.AttachmentBuilder = class TrackedAttachmentBuilder extends Original {
    constructor(...args) {
      super(...args);
      if (IMAGE_NAME.test(this.name ?? '')) tracked.attachments.push(this);
    }
  };
  const setURL = discord.MediaGalleryItemBuilder.prototype.setURL;
  discord.MediaGalleryItemBuilder.prototype.setURL = function trackedSetURL(...args) {
    tracked.mediaItems.push(this);
    return setURL.apply(this, args);
  };
  return tracked;
}

/** Every recorded image without a usable description, as "name: problem" strings. */
function missingAltText({ attachments, mediaItems }) {
  const problems = [];
  const check = (label, description) => {
    if (typeof description !== 'string' || description.trim() === '') problems.push(`${label}: no description`);
    else if (description.length > 1024) problems.push(`${label}: description is ${description.length} characters`);
  };
  for (const file of attachments) check(file.name, file.description);
  for (const item of mediaItems) check(item.data.media?.url ?? 'media item', item.data.description);
  return problems;
}

module.exports = { trackImages, missingAltText };
