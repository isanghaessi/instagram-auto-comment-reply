import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { createServer } from './server.js';
import { createInstagramClient } from './instagram/client.js';
import { createPoller } from './poller/poller.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const instagramClient = createInstagramClient({ config });
const poller = createPoller({
  db,
  instagramClient,
  encryptionKey: config.encryptionKey,
  intervalSeconds: config.pollingIntervalSeconds
});
const app = createServer({ config, db, instagramClient, poller });

app.listen(config.port, () => {
  console.log(`Instagram auto reply admin listening on port ${config.port}`);
  poller.start();
});
