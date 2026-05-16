'use strict';

const { PermissionsBitField } = require('discord.js');
const settingsRepo = require('../dashboard/SettingsRepository');

const WELCOME_FEATURE_ID = 'welcomeautomation';

const DEFAULT_THEMES = [
  'Pull up a chair at the table, %s! We\'ve set up the board for you.',
  'A new player has joined the game! Welcome, %s.',
  'The dice have been rolled and they\'ve landed on you, %s! Welcome to the town.',
  'Welcome, %s! You\'re just in time for the next round.',
  'It\'s your turn, %s! Glad to have you in our gaming circle.',
  'New Townsfolk alert! %s has entered the village square.',
  'The box is open and the pieces are set—welcome to the team, %s!',
  'Welcome to the town, %s! We hope you\'re ready for some high-stakes strategy.',
  'A wild %s appeared! Will you play a card or roll the dice?',
  'The board is bigger now that you\'re here, %s! Welcome home.',
];

function normalizeString(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function normalizeId(value) {
  const id = normalizeString(value);
  return id && /^\d{17,20}$/.test(id) ? id : null;
}

function normalizeTemplateList(rawTemplates) {
  if (!Array.isArray(rawTemplates)) return DEFAULT_THEMES;
  const cleaned = rawTemplates
    .map((value) => normalizeString(value))
    .filter(Boolean)
    .slice(0, 30);
  return cleaned.length ? cleaned : DEFAULT_THEMES;
}

function normalizeTriggerPhrase(value) {
  return normalizeString(value) || 'welcome';
}

function getWelcomeAutomationSettings(guildId) {
  let row = null;
  try {
    row = settingsRepo.getGuildSettings(guildId)?.[WELCOME_FEATURE_ID] ?? null;
  } catch (err) {
    console.error('[WelcomeAutomation] Failed to load guild settings:', err.message);
  }

  const extra = row && row.extra && typeof row.extra === 'object' ? row.extra : {};
  return {
    enabled: row?.enabled === true,
    triggerPhrase: normalizeTriggerPhrase(extra.triggerPhrase),
    triggerChannelId: normalizeId(extra.triggerChannelId),
    grantRoleId: normalizeId(extra.grantRoleId),
    roleMenuChannelId: normalizeId(extra.roleMenuChannelId),
    templates: normalizeTemplateList(extra.templates),
  };
}

function isAdminMember(member) {
  if (!member || !member.permissions) return false;
  return member.permissions.has(PermissionsBitField.Flags.Administrator)
    || member.permissions.has(PermissionsBitField.Flags.ManageGuild);
}

function pickTemplate(templates) {
  return templates[Math.floor(Math.random() * templates.length)] || DEFAULT_THEMES[0];
}

function formatWelcomeMessage(template, userMention, roleMenuChannelId) {
  const base = template.includes('%s') ? template.replace('%s', userMention) : `${template} ${userMention}`;
  if (!roleMenuChannelId) return base;
  return `${base} Please head to <#${roleMenuChannelId}> to choose your roles.`;
}

async function handleWelcomeAutomationMessage(message) {
  if (!message.guild || message.author.bot || message.system) return;
  if (!isAdminMember(message.member)) return;
  const config = getWelcomeAutomationSettings(message.guild.id);
  if (!config.enabled) return;
  const lowerContent = String(message.content || '').toLowerCase();
  if (!lowerContent.includes(config.triggerPhrase.toLowerCase())) return;
  if (!message.mentions?.members?.size) return;
  if (!config.triggerChannelId || !config.grantRoleId) return;
  if (message.channelId !== config.triggerChannelId) return;

  const targetMember = message.mentions.members
    .find((member) => member && member.id !== message.author.id && !member.user.bot);
  if (!targetMember) return;

  const role = await message.guild.roles.fetch(config.grantRoleId).catch(() => null);
  if (!role) {
    await message.channel.send('⚠️ Welcome automation is configured with a missing base role.').catch(() => {});
    return;
  }

  const me = message.guild.members.me;
  if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageRoles) || me.roles.highest.comparePositionTo(role) <= 0) {
    await message.channel.send('⚠️ I can’t assign the configured welcome role due to role hierarchy/permissions.').catch(() => {});
    return;
  }

  if (!targetMember.roles.cache.has(role.id)) {
    await targetMember.roles.add(role.id, `Welcomed by ${message.author.tag}`).catch((err) => {
      console.error('[WelcomeAutomation] Failed to add role:', err);
    });
  }

  const template = pickTemplate(config.templates);
  const reply = formatWelcomeMessage(template, targetMember.toString(), config.roleMenuChannelId);
  await message.channel.send(reply).catch(() => {});
}

module.exports = {
  WELCOME_FEATURE_ID,
  getWelcomeAutomationSettings,
  handleWelcomeAutomationMessage,
};
