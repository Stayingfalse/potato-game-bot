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
 *   3 players  → Wordsmith, Demon, Townsfolk
 *   4+ players → Wordsmith, Demon, Librarian, ...Townsfolk
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
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const result = shuffled.map(p => ({ ...p, secretRole: null }));

  result[0].role = ROLES.MAYOR;
  result[1].role = ROLES.WEREWOLF;

  if (result.length >= 4) {
    result[2].role = ROLES.SEER;
    for (let i = 3; i < result.length; i++) {
      result[i].role = ROLES.VILLAGER;
    }
  } else {
    result[2].role = ROLES.VILLAGER;
  }

  const wordsmith = result.find(p => p.role === ROLES.MAYOR);
  if (wordsmith) {
    const secretPool = [ROLES.WEREWOLF, ROLES.VILLAGER];
    if (result.length >= 4) secretPool.push(ROLES.SEER);
    wordsmith.secretRole = secretPool[Math.floor(Math.random() * secretPool.length)];
  }

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
