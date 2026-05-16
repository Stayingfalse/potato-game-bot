'use strict';

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  PermissionsBitField,
} = require('discord.js');

const settingsRepo = require('../dashboard/SettingsRepository');

const ROLE_MENU_FEATURE_ID = 'rolemenu';
const ROLE_MENU_BUTTON_PREFIX = 'rmr:';
const MAX_ROLE_OPTIONS = 20;

const BUTTON_STYLE_MAP = {
  primary: ButtonStyle.Primary,
  secondary: ButtonStyle.Secondary,
  success: ButtonStyle.Success,
  danger: ButtonStyle.Danger,
};

function normalizeString(value) {
  const trimmed = String(value ?? '').trim();
  return trimmed || null;
}

function normalizeRoleId(value) {
  const id = normalizeString(value);
  return id && /^\d{17,20}$/.test(id) ? id : null;
}

function normalizeEmoji(value) {
  const emoji = normalizeString(value);
  if (!emoji || emoji.length > 40) return null;
  const looksLikeCustom = /^<a?:\w{2,32}:\d{17,20}>$/.test(emoji);
  const looksLikeUnicode = /^\p{Extended_Pictographic}[\uFE0F\u200D\p{Extended_Pictographic}]*$/u.test(emoji);
  return looksLikeCustom || looksLikeUnicode ? emoji : null;
}

function normalizeRoleOption(raw, index) {
  if (!raw || typeof raw !== 'object') return null;
  const roleId = normalizeRoleId(raw.roleId);
  if (!roleId) return null;

  const fallbackLabel = `Role ${index + 1}`;
  const label = normalizeString(raw.label) || fallbackLabel;
  const emoji = normalizeEmoji(raw.emoji);
  const styleKey = String(raw.style || 'secondary').toLowerCase();
  const style = BUTTON_STYLE_MAP[styleKey] ?? ButtonStyle.Secondary;

  return { roleId, label: label.slice(0, 80), emoji, style };
}

function parseRoleOptions(extra) {
  if (!extra || typeof extra !== 'object' || !Array.isArray(extra.roleOptions)) return [];
  return extra.roleOptions
    .map((option, index) => normalizeRoleOption(option, index))
    .filter(Boolean)
    .slice(0, MAX_ROLE_OPTIONS);
}

function getRoleMenuSettings(guildId) {
  let row = null;
  try {
    row = settingsRepo.getGuildSettings(guildId)?.[ROLE_MENU_FEATURE_ID] ?? null;
  } catch (err) {
    console.error('[RoleMenu] Failed to load guild settings:', err.message);
  }

  const extra = row && row.extra && typeof row.extra === 'object' ? row.extra : {};
  return {
    enabled: row?.enabled === true,
    channelIds: Array.isArray(row?.channelIds) && row.channelIds.length > 0
      ? row.channelIds.map((id) => String(id))
      : null,
    menuChannelId: normalizeString(extra.menuChannelId),
    roleMenuMessageId: normalizeString(extra.roleMenuMessageId),
    title: normalizeString(extra.title) || 'Role Menu: Roles',
    description: normalizeString(extra.description) || 'Use the buttons below to toggle your roles.',
    roleOptions: parseRoleOptions(extra),
    extra,
  };
}

function buildRoleMenuComponents(roleOptions) {
  const rows = [];
  let currentRow = new ActionRowBuilder();

  for (let i = 0; i < roleOptions.length; i += 1) {
    const option = roleOptions[i];
    const button = new ButtonBuilder()
      .setCustomId(`${ROLE_MENU_BUTTON_PREFIX}${option.roleId}`)
      .setLabel(option.label)
      .setStyle(option.style);

    if (option.emoji) {
      button.setEmoji(option.emoji);
    }

    currentRow.addComponents(button);
    if (currentRow.components.length === 5 || i === roleOptions.length - 1) {
      rows.push(currentRow);
      currentRow = new ActionRowBuilder();
    }
  }

  return rows;
}

function buildRoleMenuMessageContent(config) {
  const lines = [`**${config.title}**`, config.description, ''];
  for (const option of config.roleOptions) {
    const prefix = option.emoji ? `${option.emoji} ` : '• ';
    lines.push(`${prefix}<@&${option.roleId}>`);
  }
  return lines.join('\n');
}

async function publishRoleMenuMessage(client, guildId) {
  const config = getRoleMenuSettings(guildId);
  if (!config.enabled) {
    throw Object.assign(new Error('Role menu is disabled. Enable it before publishing.'), { status: 400 });
  }
  if (!config.menuChannelId) {
    throw Object.assign(new Error('Missing role menu channel in setup wizard.'), { status: 400 });
  }
  if (!config.roleOptions.length) {
    throw Object.assign(new Error('Add at least one role option before publishing.'), { status: 400 });
  }

  const guild = await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) {
    throw Object.assign(new Error('Guild not found in bot cache.'), { status: 404 });
  }

  const channel = await guild.channels.fetch(config.menuChannelId).catch(() => null);
  if (!channel || !channel.isTextBased()) {
    throw Object.assign(new Error('Configured role menu channel is not a text channel.'), { status: 400 });
  }

  const message = await channel.send({
    content: buildRoleMenuMessageContent(config),
    components: buildRoleMenuComponents(config.roleOptions),
  });

  const updatedExtra = {
    ...config.extra,
    menuChannelId: config.menuChannelId,
    title: config.title,
    description: config.description,
    roleOptions: config.roleOptions.map((option) => ({
      roleId: option.roleId,
      label: option.label,
      emoji: option.emoji,
      style: Object.keys(BUTTON_STYLE_MAP).find((key) => BUTTON_STYLE_MAP[key] === option.style) || 'secondary',
    })),
    roleMenuMessageId: message.id,
  };

  settingsRepo.setFeature(guildId, ROLE_MENU_FEATURE_ID, true, config.channelIds, updatedExtra);
  return { channelId: channel.id, messageId: message.id };
}

async function handleRoleMenuButton(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith(ROLE_MENU_BUTTON_PREFIX)) {
    return false;
  }
  if (!interaction.guildId || !interaction.member) return false;

  const roleId = interaction.customId.slice(ROLE_MENU_BUTTON_PREFIX.length);
  if (!roleId) return false;

  const config = getRoleMenuSettings(interaction.guildId);
  if (!config.enabled) {
    await interaction.reply({
      content: 'This role menu is currently disabled by server admins.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (!config.roleOptions.some((option) => option.roleId === roleId)) {
    await interaction.reply({
      content: 'That role is no longer configured in the role menu.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const channelAllowed = !config.channelIds || config.channelIds.includes(interaction.channelId);
  if (!channelAllowed) {
    await interaction.reply({
      content: 'This role menu button is not active in this channel.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const me = interaction.guild.members.me;
  if (!me || !me.permissions.has(PermissionsBitField.Flags.ManageRoles)) {
    await interaction.reply({
      content: 'I need the **Manage Roles** permission to update roles.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const role = await interaction.guild.roles.fetch(roleId).catch(() => null);
  if (!role) {
    await interaction.reply({
      content: 'That role no longer exists.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const isEveryoneRole = role.id === interaction.guild.id;
  if (role.managed || isEveryoneRole) {
    await interaction.reply({
      content: 'That role cannot be self-assigned.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  if (me.roles.highest.comparePositionTo(role) <= 0) {
    await interaction.reply({
      content: 'I can’t assign that role because it is above my highest role.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  let member = interaction.member && interaction.member.roles?.cache ? interaction.member : null;
  if (!member) {
    member = await interaction.guild.members.fetch(interaction.user.id).catch(() => null);
  }
  if (!member) {
    await interaction.reply({
      content: 'Could not resolve your server membership.',
      flags: MessageFlags.Ephemeral,
    });
    return true;
  }

  const memberHasRole = member.roles.cache.has(role.id);
  try {
    if (memberHasRole) {
      await member.roles.remove(role.id, 'Role menu self-unassign');
      await interaction.reply({
        content: `Removed role **${role.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await member.roles.add(role.id, 'Role menu self-assign');
      await interaction.reply({
        content: `Added role **${role.name}**.`,
        flags: MessageFlags.Ephemeral,
      });
    }
  } catch (err) {
    console.error('[RoleMenu] Button handler failed:', err);
    await interaction.reply({
      content: 'Failed to update your role. Please contact an admin.',
      flags: MessageFlags.Ephemeral,
    }).catch(() => {});
  }

  return true;
}

module.exports = {
  ROLE_MENU_FEATURE_ID,
  getRoleMenuSettings,
  publishRoleMenuMessage,
  handleRoleMenuButton,
};
