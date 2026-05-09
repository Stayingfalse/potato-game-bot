const { randomInt } = require('node:crypto');

const ROLES = Object.freeze({
  MAYOR: 'Wordsmith',
  WEREWOLF: 'Demon',
  SEER: 'Librarian',
  VILLAGER: 'Townsfolk',
});

const ROLE_DISPLAY_NAMES = Object.freeze({
  [ROLES.MAYOR]: 'Mayor',
  [ROLES.WEREWOLF]: 'Werewolf',
  [ROLES.SEER]: 'Seer',
  [ROLES.VILLAGER]: 'Townsfolk',
});

const ROLE_DESCRIPTIONS = Object.freeze({
  [ROLES.MAYOR]:
    'You are the **Mayor** 👑\n\n' +
    "You know the secret word. Answer your fellow townsfolk's questions using only **Yes**, **No**, or " +
    '**Maybe** via the buttons on the game board. You **cannot speak** during the game — your answers are your only voice!',

  [ROLES.WEREWOLF]:
    'You are the **Werewolf** 😈\n\n' +
    'You already know the secret word. Pretend you don\'t! Blend in with the townsfolk, ask misleading ' +
    'questions, and stop them from guessing the word before time runs out.',

  [ROLES.SEER]:
    'You are the **Seer** 🔮\n\n' +
    'You know the secret word. Subtly guide the townsfolk toward the answer — without revealing that you ' +
    'already know it. The Werewolf will be watching for you!',

  [ROLES.VILLAGER]:
    'You are a **Townsfolk** 🏡\n\n' +
    "You don't know the secret word. Ask strategic yes/no questions, listen to the Mayor's answers, and " +
    'work together to guess the word before time runs out!',
});

/**
 * Returns the player's hidden alignment role when present.
 * Wordsmiths can carry a secondary secret role.
 * @param {{role?: string, secretRole?: string|null}} player
 * @returns {string|undefined}
 */
function getEffectiveRole(player) {
  return player?.secretRole ?? player?.role;
}

/**
 * @param {string|null|undefined} role
 * @returns {string}
 */
function getRoleDisplayName(role) {
  return ROLE_DISPLAY_NAMES[role] ?? role ?? 'Unknown';
}

/**
 * @param {{role?: string, secretRole?: string|null}} player
 * @returns {boolean}
 */
function isDemon(player) {
  return getEffectiveRole(player) === ROLES.WEREWOLF;
}

/**
 * @param {{role?: string, secretRole?: string|null}} player
 * @returns {boolean}
 */
function isLibrarian(player) {
  return getEffectiveRole(player) === ROLES.SEER;
}

/**
 * Assigns roles to a shuffled copy of the player array.
 *
 * Distribution:
 *   3 players  → 1 Werewolf, 2 Townsfolk, then one player becomes Mayor
 *   4 players  → 1 Werewolf, 3 Townsfolk, then one player becomes Mayor
 *   5 players  → 1 Werewolf, 3-4 Townsfolk, 0-1 Seer, then one player becomes Mayor
 *   6+ players → 2 Werewolves, remaining Townsfolk, optional Seer, then one player becomes Mayor
 *
 * @param {Array<{id: string, username: string}>} players
 * @returns {Array<{id: string, username: string, role: string, secretRole: string|null}>}
 * @throws {Error} if fewer than 3 players are provided
 */
function assignRoles(players) {
  if (players.length < 3) {
    throw new Error('At least 3 players are required to start Werewords.');
  }

  // Fisher-Yates shuffle for fair randomisation
  const shuffled = [...players];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const result = shuffled.map(p => ({ ...p, secretRole: null }));
  // For 5+ players, the Seer is included on a simple 50/50 roll.
  const includeSeer = result.length >= 5 && randomInt(2) === 0;
  const werewolfCount = result.length >= 6 ? 2 : 1;
  // Players were already shuffled above, so assigning this ordered pool still
  // distributes the hidden roles fairly.
  const rolePool = [
    ...Array(werewolfCount).fill(ROLES.WEREWOLF),
    ...(includeSeer ? [ROLES.SEER] : []),
    ...Array(result.length - werewolfCount - (includeSeer ? 1 : 0)).fill(ROLES.VILLAGER),
  ];

  for (let i = 0; i < result.length; i++) {
    result[i].role = rolePool[i];
  }

  const mayorIndex = randomInt(result.length);
  result[mayorIndex].secretRole = result[mayorIndex].role;
  result[mayorIndex].role = ROLES.MAYOR;

  return result;
}

module.exports = {
  ROLES,
  ROLE_DISPLAY_NAMES,
  ROLE_DESCRIPTIONS,
  assignRoles,
  getEffectiveRole,
  getRoleDisplayName,
  isDemon,
  isLibrarian,
};
