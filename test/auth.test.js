import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  SESSION_MAX_AGE_SECONDS,
  createSession,
  destroySession,
  isAuthenticated
} from '../src/security/auth.js';
import { escapeHtml, layout } from '../src/views/html.js';

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

test('createSession returns an opaque random token that authenticates until destroyed', () => {
  const token = createSession();

  assert.equal(typeof token, 'string');
  assert.match(token, /^[a-f0-9]{64}$/);
  assert.equal(isAuthenticated(token), true);

  destroySession(token);
  assert.equal(isAuthenticated(token), false);
});

test('isAuthenticated rejects forged password hashes and arbitrary values', () => {
  assert.equal(isAuthenticated(sha256('admin-secret')), false);
  assert.equal(isAuthenticated('short'), false);
  assert.equal(isAuthenticated('not-a-session'), false);
});

test('isAuthenticated rejects expired sessions', () => {
  const now = Date.now();
  const token = createSession(now);

  assert.equal(isAuthenticated(token, now + (SESSION_MAX_AGE_SECONDS * 1000) - 1), true);
  assert.equal(isAuthenticated(token, now + (SESSION_MAX_AGE_SECONDS * 1000) + 1), false);
});

test('escapeHtml escapes HTML-sensitive characters', () => {
  assert.equal(escapeHtml(`A&B <tag> "quote" 'apos'`), 'A&amp;B &lt;tag&gt; &quot;quote&quot; &#39;apos&#39;');
});

test('layout escapes title and includes admin navigation with POST logout form', () => {
  const html = layout('<Dashboard>', '<main>Body</main>');

  assert.match(html, /&lt;Dashboard&gt;/);
  assert.match(html, /href="\/"[^>]*>Dashboard/);
  assert.match(html, /href="\/rules"[^>]*>Rules/);
  assert.match(html, /href="\/logs"[^>]*>Logs/);
  assert.match(html, /<form method="post" action="\/logout"/);
  assert.match(html, /<button[^>]*>Logout<\/button>/);
  assert.doesNotMatch(html, /href="\/logout"/);
  assert.match(html, /<main>Body<\/main>/);
});
