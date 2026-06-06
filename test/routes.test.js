import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AUTH_COOKIE } from '../src/security/auth.js';
import { decryptText } from '../src/security/crypto.js';
import { getAccount } from '../src/repositories/accounts.js';
import { createServer } from '../src/server.js';
import { createTestDb } from './helpers/testDb.js';

function testConfig(overrides = {}) {
  return {
    adminPassword: 'admin-secret',
    publicBaseUrl: 'http://localhost:3000',
    encryptionKey: Buffer.alloc(32, 7),
    ...overrides
  };
}

function testApp(overrides = {}) {
  const hasServerOverrides = 'config' in overrides || 'db' in overrides || 'instagramClient' in overrides || 'poller' in overrides;
  const serverOverrides = hasServerOverrides ? overrides : { config: overrides };
  const { config: configOverrides = {}, db = {}, instagramClient = {}, poller = { getStatus: () => ({ running: false }) } } = serverOverrides;
  return createServer({
    config: testConfig(configOverrides),
    db,
    instagramClient,
    poller
  });
}

async function request(app, path, options = {}) {
  const server = app.listen(0);
  try {
    await new Promise((resolve) => server.once('listening', resolve));
    const { port } = server.address();
    return await fetch(`http://127.0.0.1:${port}${path}`, {
      redirect: 'manual',
      ...options
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

function formBody(fields) {
  return new URLSearchParams(fields).toString();
}

function authCookieHeader(setCookie) {
  const cookiePair = setCookie.split(';')[0];
  assert.match(cookiePair, new RegExp(`^${AUTH_COOKIE}=`));
  return cookiePair;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('GET / redirects unauthenticated users to /login', async () => {
  const response = await request(testApp(), '/');

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');
});

test('POST /login sets opaque secure session cookie on successful login', async () => {
  const response = await request(testApp({ publicBaseUrl: 'https://admin.example.com' }), '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ password: 'admin-secret' })
  });
  const setCookie = response.headers.get('set-cookie');

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/');
  assert.match(setCookie, new RegExp(`${AUTH_COOKIE}=[a-f0-9]{64}`));
  assert.match(setCookie, /HttpOnly/i);
  assert.match(setCookie, /SameSite=Lax/i);
  assert.match(setCookie, /Secure/i);
  assert.match(setCookie, /Max-Age=\d+/i);
  assert.doesNotMatch(setCookie, new RegExp(sha256('admin-secret')));
});

test('POST /login failure redirects without setting auth cookie', async () => {
  const response = await request(testApp(), '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ password: 'wrong-secret' })
  });
  const setCookie = response.headers.get('set-cookie');

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login?error=1');
  assert.equal(setCookie, null);
});

test('authenticated session cookie can access dashboard', async () => {
  const app = testApp();
  const loginResponse = await request(app, '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ password: 'admin-secret' })
  });
  const cookie = authCookieHeader(loginResponse.headers.get('set-cookie'));

  const response = await request(app, '/', {
    headers: { Cookie: cookie }
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(html, /Dashboard/);
  assert.match(html, /Polling status/);
});

test('forged cookie value cannot access dashboard', async () => {
  const response = await request(testApp(), '/', {
    headers: { Cookie: `${AUTH_COOKIE}=${sha256('admin-secret')}` }
  });

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');
});

test('POST /logout destroys session and clears cookie', async () => {
  const app = testApp();
  const loginResponse = await request(app, '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ password: 'admin-secret' })
  });
  const cookie = authCookieHeader(loginResponse.headers.get('set-cookie'));

  const logoutResponse = await request(app, '/logout', {
    method: 'POST',
    headers: { Cookie: cookie }
  });
  const afterLogoutResponse = await request(app, '/', {
    headers: { Cookie: cookie }
  });

  assert.equal(logoutResponse.status, 302);
  assert.equal(logoutResponse.headers.get('location'), '/login');
  assert.match(logoutResponse.headers.get('set-cookie'), new RegExp(`${AUTH_COOKIE}=`));
  assert.match(logoutResponse.headers.get('set-cookie'), /Max-Age=0/i);
  assert.equal(afterLogoutResponse.status, 302);
  assert.equal(afterLogoutResponse.headers.get('location'), '/login');
});

test('GET /logout does not clear cookie', async () => {
  const app = testApp();
  const loginResponse = await request(app, '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ password: 'admin-secret' })
  });
  const cookie = authCookieHeader(loginResponse.headers.get('set-cookie'));

  const logoutResponse = await request(app, '/logout', {
    headers: { Cookie: cookie }
  });
  const dashboardResponse = await request(app, '/', {
    headers: { Cookie: cookie }
  });

  assert.equal(logoutResponse.status, 302);
  assert.equal(logoutResponse.headers.get('location'), '/');
  assert.equal(logoutResponse.headers.get('set-cookie'), null);
  assert.equal(dashboardResponse.status, 200);
});

test('authenticated GET /auth/instagram/start redirects to Instagram authorize URL with stored state', async () => {
  const { db } = createTestDb();
  let authorizeState;
  const instagramClient = {
    buildAuthorizeUrl(state) {
      authorizeState = state;
      return `https://instagram.example/oauth?state=${state}`;
    }
  };
  const app = testApp({ db, instagramClient });

  try {
    const loginResponse = await request(app, '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ password: 'admin-secret' })
    });
    const cookie = authCookieHeader(loginResponse.headers.get('set-cookie'));

    const response = await request(app, '/auth/instagram/start', {
      headers: { Cookie: cookie }
    });
    const storedState = db.prepare('SELECT state FROM oauth_states').get().state;

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), `https://instagram.example/oauth?state=${storedState}`);
    assert.equal(authorizeState, storedState);
    assert.match(storedState, /^[a-f0-9]{48}$/);
  } finally {
    db.close();
  }
});

test('GET /auth/instagram/callback rejects an unknown state without requiring admin cookie', async () => {
  const { db } = createTestDb();
  const app = testApp({ db });

  try {
    const response = await request(app, '/auth/instagram/callback?code=auth-code&state=missing-state');
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /Instagram connection failed/);
    assert.doesNotMatch(html, /href="\/login"/);
  } finally {
    db.close();
  }
});

test('GET /auth/instagram/callback renders provider errors with escaped description', async () => {
  const { db } = createTestDb();
  const app = testApp({ db });

  try {
    const response = await request(app, '/auth/instagram/callback?error=access_denied&error_description=%3Cscript%3Ebad()%3C%2Fscript%3E');
    const html = await response.text();

    assert.equal(response.status, 400);
    assert.match(html, /Instagram connection failed/);
    assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
  } finally {
    db.close();
  }
});

test('GET /auth/instagram/callback exchanges tokens, saves encrypted account, and redirects home', async () => {
  const { db } = createTestDb();
  const calls = [];
  const instagramClient = {
    buildAuthorizeUrl(state) {
      calls.push(['buildAuthorizeUrl', state]);
      return `https://instagram.example/oauth?state=${state}`;
    },
    async exchangeCodeForShortLivedToken(code) {
      calls.push(['exchangeCodeForShortLivedToken', code]);
      return { accessToken: 'short-token', userId: 'short-user-id' };
    },
    async exchangeForLongLivedToken(shortToken) {
      calls.push(['exchangeForLongLivedToken', shortToken]);
      return { accessToken: 'long-token', expiresIn: 3600 };
    },
    async getAccount(longToken) {
      calls.push(['getAccount', longToken]);
      return { id: 'ig-user-1', username: 'creator', account_type: 'BUSINESS' };
    }
  };
  const config = testConfig();
  const app = createServer({
    config,
    db,
    instagramClient,
    poller: { getStatus: () => ({ running: false }) }
  });

  try {
    const loginResponse = await request(app, '/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ password: 'admin-secret' })
    });
    const cookie = authCookieHeader(loginResponse.headers.get('set-cookie'));
    const startResponse = await request(app, '/auth/instagram/start', {
      headers: { Cookie: cookie }
    });
    const state = new URL(startResponse.headers.get('location')).searchParams.get('state');
    const before = Date.now();

    const response = await request(app, `/auth/instagram/callback?code=auth-code&state=${state}`);
    const account = getAccount(db);

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/');
    assert.deepEqual(calls, [
      ['buildAuthorizeUrl', state],
      ['exchangeCodeForShortLivedToken', 'auth-code'],
      ['exchangeForLongLivedToken', 'short-token'],
      ['getAccount', 'long-token']
    ]);
    assert.equal(account.instagram_user_id, 'ig-user-1');
    assert.equal(account.username, 'creator');
    assert.equal(account.account_type, 'BUSINESS');
    assert.notEqual(account.access_token_encrypted, 'long-token');
    assert.equal(decryptText(account.access_token_encrypted, config.encryptionKey), 'long-token');
    assert.ok(Date.parse(account.token_expires_at) >= before + 3599_000);
    assert.ok(Date.parse(account.token_expires_at) <= Date.now() + 3601_000);

    const repeatResponse = await request(app, `/auth/instagram/callback?code=auth-code-2&state=${state}`);
    assert.equal(repeatResponse.status, 400);
    assert.equal(calls.length, 4);
  } finally {
    db.close();
  }
});
