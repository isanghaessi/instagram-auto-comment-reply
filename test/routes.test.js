import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { AUTH_COOKIE } from '../src/security/auth.js';
import { createServer } from '../src/server.js';

function testConfig(overrides = {}) {
  return {
    adminPassword: 'admin-secret',
    publicBaseUrl: 'http://localhost:3000',
    ...overrides
  };
}

function testApp(overrides = {}) {
  return createServer({
    config: testConfig(overrides),
    db: {},
    instagramClient: {},
    poller: { getStatus: () => ({ running: false }) }
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
