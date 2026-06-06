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

const server = app.listen(config.port, () => {
  console.log(`Instagram auto reply admin listening on port ${config.port}`);
  poller.start();
});

async function shutdown(signal) {
  console.log(`Received ${signal}; shutting down Instagram auto reply admin`);
  poller.stop();
  await poller.drain();
  server.close((error) => {
    if (error) {
      console.error('HTTP server shutdown failed', error);
      process.exit(1);
      return;
    }

    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
