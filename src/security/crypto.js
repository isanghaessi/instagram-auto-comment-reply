import crypto from 'node:crypto';

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function decodeCanonicalBase64(value) {
  if (typeof value !== 'string') {
    throw new Error('Invalid encrypted value');
  }
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new Error('Invalid encrypted value');
  }
  const decoded = Buffer.from(value, 'base64');
  if (decoded.toString('base64') !== value) {
    throw new Error('Invalid encrypted value');
  }
  return decoded;
}

function parseEncryptedValue(encryptedValue) {
  const parsed = JSON.parse(encryptedValue);
  if (!isPlainObject(parsed)) {
    throw new Error('Invalid encrypted value');
  }
  if (parsed.v !== 1 || typeof parsed.iv !== 'string' || typeof parsed.tag !== 'string' || typeof parsed.data !== 'string') {
    throw new Error('Invalid encrypted value');
  }

  const iv = decodeCanonicalBase64(parsed.iv);
  const tag = decodeCanonicalBase64(parsed.tag);
  const data = decodeCanonicalBase64(parsed.data);

  if (iv.length !== 12 || tag.length !== 16) {
    throw new Error('Invalid encrypted value');
  }

  return { iv, tag, data };
}

export function encryptText(plainText, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  });
}

export function decryptText(encryptedValue, key) {
  try {
    const { iv, tag, data } = parseEncryptedValue(encryptedValue);
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([
      decipher.update(data),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    throw new Error('Invalid encrypted value', { cause: error });
  }
}
