import crypto from 'node:crypto';

export const AUTH_COOKIE = 'ig_auto_reply_auth';
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;

const sessions = new Map();

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function createSession(now = Date.now()) {
  const token = createSessionToken();
  sessions.set(token, now + (SESSION_MAX_AGE_SECONDS * 1000));
  return token;
}

export function destroySession(cookieValue) {
  if (typeof cookieValue !== 'string') {
    return false;
  }

  return sessions.delete(cookieValue);
}

export function isAuthenticated(cookieValue, now = Date.now()) {
  if (typeof cookieValue !== 'string') {
    return false;
  }

  const expiresAt = sessions.get(cookieValue);
  if (expiresAt === undefined) {
    return false;
  }

  if (expiresAt <= now) {
    sessions.delete(cookieValue);
    return false;
  }

  return true;
}

export function requireAdmin(config) {
  return (req, res, next) => {
    if (isAuthenticated(req.cookies?.[AUTH_COOKIE])) {
      next();
      return;
    }

    res.redirect('/login');
  };
}
