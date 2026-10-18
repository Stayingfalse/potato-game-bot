require('dotenv').config();

const { syncCommands } = require('./utils/commandSync');

// `npm run deploy` always deploys. The bot also deploys by itself on startup
// whenever the commands have changed (see src/utils/commandSync.js).
syncCommands({ token: process.env.DISCORD_TOKEN, clientId: process.env.CLIENT_ID, force: true })
  .catch((error) => {
    console.error('Failed to deploy commands:', error);
    process.exit(1);
  });
