import 'dotenv/config';

function required(env, key) {
  const value = env[key];
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return String(value).trim();
}

function parseInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer environment variable: ${name}`);
  }
  return parsed;
}

function parseEncryptionKey(value) {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

export function loadConfig(env = process.env) {
  const databasePath = required(env, 'DATABASE_PATH');
  const encryptionKeyRaw = required(env, 'ENCRYPTION_KEY');
  return {
    port: parseInteger(env.PORT, 3000, 'PORT'),
    databasePath,
    publicBaseUrl: required(env, 'PUBLIC_BASE_URL').replace(/\/$/, ''),
    metaAppId: required(env, 'META_APP_ID'),
    metaAppSecret: required(env, 'META_APP_SECRET'),
    metaRedirectUri: required(env, 'META_REDIRECT_URI'),
    encryptionKey: parseEncryptionKey(encryptionKeyRaw),
    adminPassword: required(env, 'ADMIN_PASSWORD'),
    pollingIntervalSeconds: parseInteger(env.POLLING_INTERVAL_SECONDS, 60, 'POLLING_INTERVAL_SECONDS')
  };
}
