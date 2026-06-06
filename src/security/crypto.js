import crypto from 'node:crypto';

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
    const parsed = JSON.parse(encryptedValue);
    if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) {
      throw new Error('Invalid encrypted value');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    throw new Error('Invalid encrypted value', { cause: error });
  }
}
