import crypto from 'node:crypto';

export const AUTH_COOKIE = 'ig_auto_reply_auth';

export function createAuthCookieValue(password) {
  return crypto.createHash('sha256').update(String(password)).digest('hex');
}

export function isAuthenticated(cookieValue, adminPassword) {
  if (typeof cookieValue !== 'string' || typeof adminPassword !== 'string') {
    return false;
  }

  const expected = Buffer.from(createAuthCookieValue(adminPassword), 'utf8');
  const actual = Buffer.from(cookieValue, 'utf8');

  if (actual.length !== expected.length) {
    crypto.timingSafeEqual(expected, expected);
    return false;
  }

  return crypto.timingSafeEqual(actual, expected);
}

export function requireAdmin(config) {
  return (req, res, next) => {
    if (isAuthenticated(req.cookies?.[AUTH_COOKIE], config.adminPassword)) {
      next();
      return;
    }

    res.redirect('/login');
  };
}
