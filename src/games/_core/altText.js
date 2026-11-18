'use strict';

/**
 * Alt text for generated images. Discord allows up to 1024 characters for a
 * media gallery item or attachment description; longer text is cut at a word
 * boundary and ends with an ellipsis.
 */

const ALT_TEXT_MAX = 1024;

/** Collapses whitespace and truncates politely to `max` characters. */
function altText(text, max = ALT_TEXT_MAX) {
  const clean = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,;:·]+$/, '')}…`;
}

/** "a", "a and b", "a, b and c". */
function listText(items) {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

module.exports = { ALT_TEXT_MAX, altText, listText };
