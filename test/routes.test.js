import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';

function testConfig(overrides = {}) {
  return {
    adminPassword: 'admin-secret',
    publicBaseUrl: 'http://localhost:3000',
    ...overrides
  };
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

test('GET / redirects unauthenticated users to /login', async () => {
  const app = createServer({
    config: testConfig(),
    db: {},
    instagramClient: {},
    poller: { getStatus: () => ({ running: false }) }
  });

  const response = await request(app, '/');

  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');
});
