import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('loadConfig returns parsed values with defaults', () => {
  const config = loadConfig({
    DATABASE_PATH: './tmp/app.db',
    PUBLIC_BASE_URL: 'https://example.com',
    META_APP_ID: 'app-id',
    META_APP_SECRET: 'secret',
    META_REDIRECT_URI: 'https://example.com/auth/instagram/callback',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    ADMIN_PASSWORD: 'pass1234'
  });

  assert.equal(config.port, 3000);
  assert.equal(config.databasePath, './tmp/app.db');
  assert.equal(config.publicBaseUrl, 'https://example.com');
  assert.equal(config.pollingIntervalSeconds, 60);
});

test('loadConfig rejects missing required values', () => {
  assert.throws(() => loadConfig({}), /DATABASE_PATH/);
});

test('loadConfig rejects invalid encryption key', () => {
  assert.throws(() => loadConfig({
    DATABASE_PATH: './tmp/app.db',
    PUBLIC_BASE_URL: 'https://example.com',
    META_APP_ID: 'app-id',
    META_APP_SECRET: 'secret',
    META_REDIRECT_URI: 'https://example.com/auth/instagram/callback',
    ENCRYPTION_KEY: 'short',
    ADMIN_PASSWORD: 'pass1234'
  }), /ENCRYPTION_KEY/);
});
