require('dotenv').config();

const { REST, Routes } = require('discord.js');
const { loadCommands } = require('./utils/loadCommands');

const commands = loadCommands().map(command => command.data.toJSON());

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
  try {
    console.log(`Deploying ${commands.length} application command(s) globally…`);
    await rest.put(
      Routes.applicationCommands(process.env.CLIENT_ID),
      { body: commands },
    );
    console.log('Commands deployed successfully.');
  } catch (error) {
    console.error('Failed to deploy commands:', error);
    process.exit(1);
  }
})();
