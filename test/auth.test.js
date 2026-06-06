import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthCookieValue, isAuthenticated } from '../src/security/auth.js';
import { escapeHtml, layout } from '../src/views/html.js';

test('createAuthCookieValue hashes the password and authenticates matching cookie only', () => {
  const cookieValue = createAuthCookieValue('admin-secret');

  assert.match(cookieValue, /^[a-f0-9]{64}$/);
  assert.notEqual(cookieValue, 'admin-secret');
  assert.equal(isAuthenticated(cookieValue, 'admin-secret'), true);
  assert.equal(isAuthenticated(cookieValue, 'wrong-secret'), false);
});

test('isAuthenticated safely rejects length-mismatched cookie values', () => {
  assert.equal(isAuthenticated('short', 'admin-secret'), false);
  assert.equal(isAuthenticated(`${createAuthCookieValue('admin-secret')}extra`, 'admin-secret'), false);
});

test('escapeHtml escapes HTML-sensitive characters', () => {
  assert.equal(escapeHtml(`A&B <tag> "quote" 'apos'`), 'A&amp;B &lt;tag&gt; &quot;quote&quot; &#39;apos&#39;');
});

test('layout escapes title and includes admin navigation', () => {
  const html = layout('<Dashboard>', '<main>Body</main>');

  assert.match(html, /&lt;Dashboard&gt;/);
  assert.match(html, /href="\/"[^>]*>Dashboard/);
  assert.match(html, /href="\/rules"[^>]*>Rules/);
  assert.match(html, /href="\/logs"[^>]*>Logs/);
  assert.match(html, /href="\/logout"[^>]*>Logout/);
  assert.match(html, /<main>Body<\/main>/);
});
