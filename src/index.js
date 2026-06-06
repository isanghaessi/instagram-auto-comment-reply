import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { createServer } from './server.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const poller = { getStatus: () => ({ running: false }) };
const instagramClient = {};
const app = createServer({ config, db, instagramClient, poller });

app.listen(config.port, () => {
  console.log(`Instagram auto reply admin listening on port ${config.port}`);
});
