import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AUTH_COOKIE } from '../src/security/auth.js';
import { decryptText, encryptText } from '../src/security/crypto.js';
import { getAccount, upsertAccount } from '../src/repositories/accounts.js';
import { upsertMedia } from '../src/repositories/media.js';
import { createRule } from '../src/repositories/rules.js';
import { upsertCommentEvent } from '../src/repositories/comments.js';
import { createReplyLog } from '../src/repositories/replyLogs.js';
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

async function authenticatedCookie(app) {
  const loginResponse = await request(app, '/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: formBody({ password: 'admin-secret' })
  });
  return authCookieHeader(loginResponse.headers.get('set-cookie'));
}

async function startInstagramOAuth(app) {
  const cookie = await authenticatedCookie(app);
  const response = await request(app, '/auth/instagram/start', {
    headers: { Cookie: cookie }
  });
  assert.equal(response.status, 302);
  return new URL(response.headers.get('location')).searchParams.get('state');
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
  const { db } = createTestDb();
  const app = testApp({ db });

  try {
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
  } finally {
    db.close();
  }
});



test('session cookie from one app instance cannot authenticate another app instance', async () => {
  const dbA = createTestDb();
  const dbB = createTestDb();
  const appA = testApp({ db: dbA.db });
  const appB = testApp({ db: dbB.db });

  try {
    const cookie = await authenticatedCookie(appA);
    const response = await request(appB, '/', {
      headers: { Cookie: cookie }
    });

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  } finally {
    dbA.db.close();
    dbB.db.close();
  }
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
  const { db } = createTestDb();
  const app = testApp({ db });

  try {
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
  } finally {
    db.close();
  }
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

test('GET /auth/instagram/callback rejects provider errors with missing or unknown state', async () => {
  const { db } = createTestDb();
  const app = testApp({ db });

  try {
    const missingStateResponse = await request(app, '/auth/instagram/callback?error=access_denied&error_description=provider-message');
    const missingStateHtml = await missingStateResponse.text();
    const unknownStateResponse = await request(app, '/auth/instagram/callback?error=access_denied&error_description=provider-message&state=missing-state');
    const unknownStateHtml = await unknownStateResponse.text();

    assert.equal(missingStateResponse.status, 400);
    assert.match(missingStateHtml, /Invalid or expired Instagram OAuth state/);
    assert.doesNotMatch(missingStateHtml, /provider-message/);
    assert.equal(unknownStateResponse.status, 400);
    assert.match(unknownStateHtml, /Invalid or expired Instagram OAuth state/);
    assert.doesNotMatch(unknownStateHtml, /provider-message/);
  } finally {
    db.close();
  }
});

test('GET /auth/instagram/callback renders provider errors with escaped description after consuming valid state', async () => {
  const { db } = createTestDb();
  const app = testApp({
    db,
    instagramClient: {
      buildAuthorizeUrl: (state) => `https://instagram.example/oauth?state=${state}`
    }
  });

  try {
    const state = await startInstagramOAuth(app);
    const response = await request(app, `/auth/instagram/callback?error=access_denied&error_description=%3Cscript%3Ebad()%3C%2Fscript%3E&state=${state}`);
    const html = await response.text();
    const repeatResponse = await request(app, `/auth/instagram/callback?error=access_denied&error_description=second-message&state=${state}`);
    const repeatHtml = await repeatResponse.text();

    assert.equal(response.status, 400);
    assert.match(html, /Instagram did not authorize the connection/);
    assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
    assert.doesNotMatch(html, /<script>bad\(\)<\/script>/);
    assert.equal(repeatResponse.status, 400);
    assert.match(repeatHtml, /Invalid or expired Instagram OAuth state/);
    assert.doesNotMatch(repeatHtml, /second-message/);
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

test('GET /auth/instagram/callback stores null token expiry for missing or invalid expiresIn values', async () => {
  for (const expiresIn of [null, undefined, '', Number.NaN, Infinity, -1]) {
    const { db } = createTestDb();
    const instagramClient = {
      buildAuthorizeUrl: (state) => `https://instagram.example/oauth?state=${state}`,
      exchangeCodeForShortLivedToken: async () => ({ accessToken: 'short-token' }),
      exchangeForLongLivedToken: async () => ({ accessToken: 'long-token', expiresIn }),
      getAccount: async () => ({ id: `ig-user-${String(expiresIn)}`, username: 'creator', account_type: 'BUSINESS' })
    };
    const app = testApp({ db, instagramClient });

    try {
      const state = await startInstagramOAuth(app);
      const response = await request(app, `/auth/instagram/callback?code=auth-code&state=${state}`);
      const account = getAccount(db);

      assert.equal(response.status, 302);
      assert.equal(account.token_expires_at, null);
    } finally {
      db.close();
    }
  }
});

test('GET /auth/instagram/callback renders generic failure without leaking exchange errors or saving account', async () => {
  const { db } = createTestDb();
  const leakedToken = 'fake-access-token-should-not-appear';
  const leakedSecret = 'fake-client-secret-should-not-appear';
  const internalMessage = 'internal oauth exchange failure should not appear';
  const instagramClient = {
    buildAuthorizeUrl: (state) => `https://instagram.example/oauth?state=${state}`,
    exchangeCodeForShortLivedToken: async () => ({ accessToken: 'short-token' }),
    exchangeForLongLivedToken: async () => ({ accessToken: leakedToken, expiresIn: 3600 }),
    getAccount: async () => {
      throw new Error(`${internalMessage}: ${leakedToken} ${leakedSecret}`);
    }
  };
  const app = testApp({ db, instagramClient });

  try {
    const state = await startInstagramOAuth(app);
    const response = await request(app, `/auth/instagram/callback?code=auth-code&state=${state}`);
    const html = await response.text();

    assert.equal(response.status, 502);
    assert.match(html, /Unable to connect Instagram\. Please try again\./);
    assert.doesNotMatch(html, new RegExp(leakedToken));
    assert.doesNotMatch(html, new RegExp(leakedSecret));
    assert.doesNotMatch(html, new RegExp(internalMessage));
    assert.equal(getAccount(db), null);
  } finally {
    db.close();
  }
});



test('authenticated GET /logs returns recent reply log page with escaped dynamic values', async () => {
  const { db } = createTestDb();
  const mediaId = upsertMedia(db, {
    instagramMediaId: 'media-logs',
    caption: 'log caption',
    mediaType: 'IMAGE',
    mediaUrl: null,
    thumbnailUrl: null,
    permalink: 'https://instagram.example/p/logs',
    timestamp: '2026-06-06T12:00:00+0000'
  });
  const ruleId = createRule(db, {
    mediaId,
    name: 'Rule <script>alert(1)</script>',
    matchMode: 'contains_any',
    keywordText: 'coupon',
    replyMessage: 'DM reply',
    dmFailureReplyMessage: 'fallback',
    isActive: true
  });
  const commentEventId = upsertCommentEvent(db, {
    instagramCommentId: 'comment-log-1',
    mediaId,
    commenterId: 'user-1',
    commenterUsername: 'user <img src=x onerror=alert(1)>',
    commentText: '쿠폰 주세요 <b>bold</b>',
    instagramCreatedAt: '2026-06-06T12:01:00.000Z'
  });
  createReplyLog(db, {
    ruleId,
    commentEventId,
    instagramCommentId: 'comment-log-1',
    dmStatus: 'failed',
    commentLikeStatus: 'skipped',
    fallbackReplyStatus: 'sent',
    fallbackReplyCommentId: 'fallback-1',
    requestPayloadJson: '{}',
    responsePayloadJson: '{}',
    errorMessage: 'provider failed <token-secret>'
  });
  const app = testApp({ db });

  try {
    const cookie = await authenticatedCookie(app);
    const response = await request(app, '/logs', { headers: { Cookie: cookie } });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /발송 로그/);
    assert.match(html, /Created \/ Sent/);
    assert.match(html, /Rule &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(html, /user &lt;img src=x onerror=alert\(1\)&gt;/);
    assert.match(html, /쿠폰 주세요 &lt;b&gt;bold&lt;\/b&gt;/);
    assert.match(html, /failed/);
    assert.match(html, /skipped/);
    assert.match(html, /sent/);
    assert.match(html, /provider failed &lt;token-secret&gt;/);
    assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(html, /<img src=x onerror=alert\(1\)>/);
    assert.doesNotMatch(html, /<b>bold<\/b>/);
    assert.doesNotMatch(html, /provider failed <token-secret>/);
  } finally {
    db.close();
  }
});

test('GET /logs redirects unauthenticated users to /login', async () => {
  const { db } = createTestDb();
  const app = testApp({ db });

  try {
    const response = await request(app, '/logs');

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/login');
  } finally {
    db.close();
  }
});

test('final 500 handler renders friendly page without stack or token leak', async () => {
  const leakedToken = 'fake-token-should-not-render';
  const internalMessage = `database exploded with ${leakedToken}`;
  const app = testApp({
    db: {
      prepare() {
        throw new Error(internalMessage);
      }
    }
  });
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const cookie = await authenticatedCookie(app);
    const response = await request(app, '/logs', { headers: { Cookie: cookie } });
    const html = await response.text();

    assert.equal(response.status, 500);
    assert.match(html, /일시적인 오류가 발생했습니다/);
    assert.match(html, /잠시 후 다시 시도해 주세요/);
    assert.doesNotMatch(html, new RegExp(leakedToken));
    assert.doesNotMatch(html, new RegExp(internalMessage));
    assert.doesNotMatch(html, /Error:/);
    assert.doesNotMatch(html, /at .*\(/);
  } finally {
    console.error = originalConsoleError;
  }
});

test('authenticated GET /rules returns rule management page', async () => {
  const { db } = createTestDb();
  const app = testApp({ db });

  try {
    const cookie = await authenticatedCookie(app);
    const response = await request(app, '/rules', {
      headers: { Cookie: cookie }
    });
    const html = await response.text();

    assert.equal(response.status, 200);
    assert.match(html, /자동응답 룰/);
  } finally {
    db.close();
  }
});

test('POST /media/sync decrypts saved token, persists Instagram media, and redirects to rules', async () => {
  const { db } = createTestDb();
  const config = testConfig();
  const calls = [];
  const instagramClient = {
    async listMedia(token) {
      calls.push(token);
      return [
        {
          id: 'media-1',
          caption: 'hello <script>bad()</script>',
          media_type: 'IMAGE',
          media_url: 'https://cdn.example/media-1.jpg',
          thumbnail_url: 'https://cdn.example/thumb-1.jpg',
          permalink: 'https://instagram.example/p/1',
          timestamp: '2026-06-06T12:00:00+0000'
        },
        {
          id: 'media-2',
          caption: null,
          media_type: 'VIDEO',
          media_url: null,
          thumbnail_url: null,
          permalink: 'https://instagram.example/p/2',
          timestamp: '2026-06-05T12:00:00+0000'
        }
      ];
    }
  };
  upsertAccount(db, {
    instagramUserId: 'ig-user-1',
    username: 'creator',
    accountType: 'BUSINESS',
    accessTokenEncrypted: encryptText('long-lived-token', config.encryptionKey),
    tokenExpiresAt: null
  });
  const app = createServer({ config, db, instagramClient, poller: { getStatus: () => ({ running: true }) } });

  try {
    const cookie = await authenticatedCookie(app);
    const response = await request(app, '/media/sync', {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    const media = db.prepare('SELECT instagram_media_id, caption, media_type, media_url, thumbnail_url, permalink, timestamp FROM media ORDER BY instagram_media_id').all();

    assert.equal(response.status, 302);
    assert.equal(response.headers.get('location'), '/rules');
    assert.deepEqual(calls, ['long-lived-token']);
    assert.deepEqual(media, [
      {
        instagram_media_id: 'media-1',
        caption: 'hello <script>bad()</script>',
        media_type: 'IMAGE',
        media_url: 'https://cdn.example/media-1.jpg',
        thumbnail_url: 'https://cdn.example/thumb-1.jpg',
        permalink: 'https://instagram.example/p/1',
        timestamp: '2026-06-06T12:00:00+0000'
      },
      {
        instagram_media_id: 'media-2',
        caption: null,
        media_type: 'VIDEO',
        media_url: null,
        thumbnail_url: null,
        permalink: 'https://instagram.example/p/2',
        timestamp: '2026-06-05T12:00:00+0000'
      }
    ]);
  } finally {
    db.close();
  }
});


test('POST /media/sync renders generic failure without leaking decrypted token', async () => {
  const { db } = createTestDb();
  const config = testConfig();
  const leakedToken = 'long-lived-token-that-must-not-render';
  upsertAccount(db, {
    instagramUserId: 'ig-user-1',
    username: 'creator',
    accountType: 'BUSINESS',
    accessTokenEncrypted: encryptText(leakedToken, config.encryptionKey),
    tokenExpiresAt: null
  });
  const app = createServer({
    config,
    db,
    instagramClient: {
      async listMedia(token) {
        throw new Error(`provider failed with ${token}`);
      }
    },
    poller: { getStatus: () => ({ running: false }) }
  });

  try {
    const cookie = await authenticatedCookie(app);
    const response = await request(app, '/media/sync', {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    const html = await response.text();

    assert.equal(response.status, 502);
    assert.match(html, /Unable to sync Instagram media/);
    assert.doesNotMatch(html, new RegExp(leakedToken));
    assert.doesNotMatch(html, /provider failed/);
  } finally {
    db.close();
  }
});

test('rule create, edit, toggle, and delete routes mutate rules without exposing deleted rows', async () => {
  const { db } = createTestDb();
  const mediaId = upsertMedia(db, {
    instagramMediaId: 'media-1',
    caption: 'caption <b>unsafe</b>',
    mediaType: 'IMAGE',
    mediaUrl: null,
    thumbnailUrl: null,
    permalink: 'https://instagram.example/p/1',
    timestamp: '2026-06-06T12:00:00+0000'
  });
  const app = testApp({ db });

  try {
    const cookie = await authenticatedCookie(app);
    const createResponse = await request(app, '/rules', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        mediaId: String(mediaId),
        name: 'Welcome <Rule>',
        keywordText: 'hi, hello',
        replyMessage: 'Thanks!',
        dmFailureReplyMessage: 'Please check DM later',
        isActive: 'on'
      })
    });
    const created = db.prepare('SELECT * FROM automation_rules').get();

    assert.equal(createResponse.status, 302);
    assert.equal(createResponse.headers.get('location'), '/rules');
    assert.equal(created.match_mode, 'contains_any');
    assert.equal(created.name, 'Welcome <Rule>');
    assert.equal(created.is_active, 1);

    const editPageResponse = await request(app, `/rules/${created.id}/edit`, { headers: { Cookie: cookie } });
    const editHtml = await editPageResponse.text();
    assert.equal(editPageResponse.status, 200);
    assert.match(editHtml, /Welcome &lt;Rule&gt;/);
    assert.doesNotMatch(editHtml, /Welcome <Rule>/);

    const updateResponse = await request(app, `/rules/${created.id}`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({
        mediaId: String(mediaId),
        name: 'Updated rule',
        keywordText: 'updated',
        replyMessage: 'Updated reply',
        dmFailureReplyMessage: 'Updated fallback'
      })
    });
    const updated = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(created.id);
    assert.equal(updateResponse.status, 302);
    assert.equal(updateResponse.headers.get('location'), '/rules');
    assert.equal(updated.name, 'Updated rule');
    assert.equal(updated.is_active, 0);

    const toggleResponse = await request(app, `/rules/${created.id}/toggle`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    assert.equal(toggleResponse.status, 302);
    assert.equal(db.prepare('SELECT is_active FROM automation_rules WHERE id = ?').get(created.id).is_active, 1);

    const deleteResponse = await request(app, `/rules/${created.id}/delete`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    assert.equal(deleteResponse.status, 302);
    assert.equal(db.prepare('SELECT is_active FROM automation_rules WHERE id = ?').get(created.id).is_active, 0);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM automation_rules WHERE deleted_at IS NULL').get().count, 0);

    const missingEditResponse = await request(app, `/rules/${created.id}/edit`, { headers: { Cookie: cookie } });
    assert.equal(missingEditResponse.status, 404);
  } finally {
    db.close();
  }
});


test('invalid rule create and update render friendly validation errors without mutating rules', async () => {
  const { db } = createTestDb();
  const mediaId = upsertMedia(db, {
    instagramMediaId: 'media-1',
    caption: 'safe caption',
    mediaType: 'IMAGE',
    mediaUrl: null,
    thumbnailUrl: null,
    permalink: 'https://instagram.example/p/1',
    timestamp: '2026-06-06T12:00:00+0000'
  });
  const existingRuleId = createRule(db, {
    mediaId,
    name: 'Existing rule',
    matchMode: 'contains_any',
    keywordText: 'hello',
    replyMessage: 'reply',
    dmFailureReplyMessage: 'fallback',
    isActive: true
  });
  const app = testApp({ db });

  try {
    const cookie = await authenticatedCookie(app);
    const missingFieldsResponse = await request(app, '/rules', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ mediaId: '', name: ' ', keywordText: '', replyMessage: ' ', dmFailureReplyMessage: '' })
    });
    const missingFieldsHtml = await missingFieldsResponse.text();
    const unknownMediaResponse = await request(app, '/rules', {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ mediaId: '999', name: 'Name', keywordText: 'keyword', replyMessage: 'reply', dmFailureReplyMessage: 'fallback' })
    });
    const invalidUpdateResponse = await request(app, `/rules/${existingRuleId}`, {
      method: 'POST',
      headers: { Cookie: cookie, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: formBody({ mediaId: 'abc', name: '', keywordText: ' ', replyMessage: '', dmFailureReplyMessage: ' ' })
    });
    const invalidUpdateHtml = await invalidUpdateResponse.text();
    const ruleCount = db.prepare('SELECT COUNT(*) AS count FROM automation_rules').get().count;
    const existingRule = db.prepare('SELECT * FROM automation_rules WHERE id = ?').get(existingRuleId);

    assert.equal(missingFieldsResponse.status, 422);
    assert.match(missingFieldsHtml, /Rule validation failed/);
    assert.match(missingFieldsHtml, /media/i);
    assert.equal(unknownMediaResponse.status, 422);
    assert.equal(invalidUpdateResponse.status, 422);
    assert.match(invalidUpdateHtml, /Rule validation failed/);
    assert.equal(ruleCount, 1);
    assert.equal(existingRule.name, 'Existing rule');
    assert.equal(existingRule.keyword_text, 'hello');
  } finally {
    db.close();
  }
});

test('missing or deleted rule toggle returns not found', async () => {
  const { db } = createTestDb();
  const mediaId = upsertMedia(db, {
    instagramMediaId: 'media-1',
    caption: 'safe caption',
    mediaType: 'IMAGE',
    mediaUrl: null,
    thumbnailUrl: null,
    permalink: 'https://instagram.example/p/1',
    timestamp: '2026-06-06T12:00:00+0000'
  });
  const ruleId = createRule(db, {
    mediaId,
    name: 'To delete',
    matchMode: 'contains_any',
    keywordText: 'hello',
    replyMessage: 'reply',
    dmFailureReplyMessage: 'fallback',
    isActive: true
  });
  const app = testApp({ db });

  try {
    const cookie = await authenticatedCookie(app);
    const missingResponse = await request(app, '/rules/999/toggle', {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    const deleteResponse = await request(app, `/rules/${ruleId}/delete`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });
    const deletedToggleResponse = await request(app, `/rules/${ruleId}/toggle`, {
      method: 'POST',
      headers: { Cookie: cookie }
    });

    assert.equal(missingResponse.status, 404);
    assert.equal(deleteResponse.status, 302);
    assert.equal(deletedToggleResponse.status, 404);
  } finally {
    db.close();
  }
});

test('unauthenticated POST actions redirect to login', async () => {
  const { db } = createTestDb();
  const mediaId = upsertMedia(db, {
    instagramMediaId: 'media-1',
    caption: 'safe caption',
    mediaType: 'IMAGE',
    mediaUrl: null,
    thumbnailUrl: null,
    permalink: 'https://instagram.example/p/1',
    timestamp: '2026-06-06T12:00:00+0000'
  });
  const ruleId = createRule(db, {
    mediaId,
    name: 'Protected rule',
    matchMode: 'contains_any',
    keywordText: 'hello',
    replyMessage: 'reply',
    dmFailureReplyMessage: 'fallback',
    isActive: true
  });
  const app = testApp({ db });
  const actions = [
    ['/media/sync', formBody({})],
    ['/rules', formBody({ mediaId: String(mediaId), name: 'Name', keywordText: 'keyword', replyMessage: 'reply', dmFailureReplyMessage: 'fallback' })],
    [`/rules/${ruleId}`, formBody({ mediaId: String(mediaId), name: 'Name', keywordText: 'keyword', replyMessage: 'reply', dmFailureReplyMessage: 'fallback' })],
    [`/rules/${ruleId}/toggle`, formBody({})],
    [`/rules/${ruleId}/delete`, formBody({})]
  ];

  try {
    for (const [path, body] of actions) {
      const response = await request(app, path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body
      });
      assert.equal(response.status, 302, path);
      assert.equal(response.headers.get('location'), '/login', path);
    }
  } finally {
    db.close();
  }
});

test('media, rules, and edit pages escape dynamic values and avoid unsafe media links', async () => {
  const { db } = createTestDb();
  const mediaId = upsertMedia(db, {
    instagramMediaId: 'media-<xss>',
    caption: '<img src=x onerror=alert(1)>',
    mediaType: 'IMAGE',
    mediaUrl: null,
    thumbnailUrl: null,
    permalink: 'javascript:alert(1)',
    timestamp: '2026-06-06T12:00:00+0000'
  });
  const ruleId = createRule(db, {
    mediaId,
    name: '<script>alert(1)</script>',
    matchMode: 'contains_any',
    keywordText: '<b>keyword</b>',
    replyMessage: '<i>reply</i>',
    dmFailureReplyMessage: '<u>fallback</u>',
    isActive: true
  });
  const app = testApp({ db });

  try {
    const cookie = await authenticatedCookie(app);
    const mediaResponse = await request(app, '/media', { headers: { Cookie: cookie } });
    const mediaHtml = await mediaResponse.text();
    const rulesResponse = await request(app, '/rules', { headers: { Cookie: cookie } });
    const rulesHtml = await rulesResponse.text();
    const editResponse = await request(app, `/rules/${ruleId}/edit`, { headers: { Cookie: cookie } });
    const editHtml = await editResponse.text();

    assert.equal(mediaResponse.status, 200);
    assert.equal(rulesResponse.status, 200);
    assert.equal(editResponse.status, 200);
    assert.doesNotMatch(mediaHtml, /<img src=x onerror=alert\(1\)>/);
    assert.doesNotMatch(mediaHtml, /href="javascript:alert\(1\)"/i);
    assert.match(mediaHtml, /&lt;img src=x onerror=alert\(1\)&gt;/);
    assert.doesNotMatch(rulesHtml, /<script>alert\(1\)<\/script>/);
    assert.doesNotMatch(rulesHtml, /<b>keyword<\/b>/);
    assert.match(rulesHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(rulesHtml, /confirm\(/);
    assert.doesNotMatch(editHtml, /<i>reply<\/i>/);
    assert.doesNotMatch(editHtml, /<u>fallback<\/u>/);
    assert.match(editHtml, /&lt;i&gt;reply&lt;\/i&gt;/);
  } finally {
    db.close();
  }
});
