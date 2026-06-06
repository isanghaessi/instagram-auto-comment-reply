import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptText, decryptText } from '../src/security/crypto.js';

const key = Buffer.alloc(32, 7);

test('encryptText and decryptText round-trip a token', () => {
  const encrypted = encryptText('secret-token', key);
  assert.notEqual(encrypted, 'secret-token');
  assert.equal(decryptText(encrypted, key), 'secret-token');
});

test('decryptText rejects malformed ciphertext', () => {
  assert.throws(() => decryptText('not-json', key), /Invalid encrypted value/);
});
