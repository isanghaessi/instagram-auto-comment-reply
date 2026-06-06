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

test('encryptText and decryptText round-trip empty text', () => {
  const encrypted = encryptText('', key);
  assert.equal(JSON.parse(encrypted).data, '');
  assert.equal(decryptText(encrypted, key), '');
});



function encryptedPayload(plainText = 'secret-token') {
  return JSON.parse(encryptText(plainText, key));
}

test('decryptText rejects encrypted payload fields with trailing garbage', () => {
  for (const field of ['iv', 'tag', 'data']) {
    const payload = encryptedPayload();
    payload[field] = `${payload[field]}!`;
    assert.throws(() => decryptText(JSON.stringify(payload), key), /Invalid encrypted value/);
  }
});

test('decryptText rejects tampered ciphertext and tag', () => {
  const tamperedData = encryptedPayload();
  const data = Buffer.from(tamperedData.data, 'base64');
  data[0] ^= 1;
  tamperedData.data = data.toString('base64');
  assert.throws(() => decryptText(JSON.stringify(tamperedData), key), /Invalid encrypted value/);

  const tamperedTag = encryptedPayload();
  const tag = Buffer.from(tamperedTag.tag, 'base64');
  tag[0] ^= 1;
  tamperedTag.tag = tag.toString('base64');
  assert.throws(() => decryptText(JSON.stringify(tamperedTag), key), /Invalid encrypted value/);
});

test('decryptText rejects invalid IV and tag lengths', () => {
  const invalidIv = encryptedPayload();
  invalidIv.iv = Buffer.alloc(11, 1).toString('base64');
  assert.throws(() => decryptText(JSON.stringify(invalidIv), key), /Invalid encrypted value/);

  const invalidTag = encryptedPayload();
  invalidTag.tag = Buffer.alloc(15, 1).toString('base64');
  assert.throws(() => decryptText(JSON.stringify(invalidTag), key), /Invalid encrypted value/);
});
