import crypto from 'node:crypto';

export const AUTH_COOKIE = 'ig_auto_reply_auth';
export const SESSION_MAX_AGE_SECONDS = 12 * 60 * 60;
export const LOGIN_THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_THROTTLE_MAX_FAILURES = 5;
export const LOGIN_THROTTLE_MAX_KEYS = 1000;

function createSessionToken() {
  return crypto.randomBytes(32).toString('hex');
}

export function createSessionStore() {
  const sessions = new Map();

  return {
    createSession(now = Date.now()) {
      const token = createSessionToken();
      sessions.set(token, now + (SESSION_MAX_AGE_SECONDS * 1000));
      return token;
    },

    destroySession(cookieValue) {
      if (typeof cookieValue !== 'string') {
        return false;
      }

      return sessions.delete(cookieValue);
    },

    isAuthenticated(cookieValue, now = Date.now()) {
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
  };
}

export function createLoginThrottle({
  windowMs = LOGIN_THROTTLE_WINDOW_MS,
  maxFailures = LOGIN_THROTTLE_MAX_FAILURES,
  maxKeys = LOGIN_THROTTLE_MAX_KEYS
} = {}) {
  const failures = new Map();

  function keyFor(req) {
    return req.ip || req.socket?.remoteAddress || 'unknown';
  }

  function prune(now) {
    for (const [key, entry] of failures.entries()) {
      if (entry.resetAt <= now) {
        failures.delete(key);
      }
    }
  }

  function evictOldestIfNeeded() {
    while (failures.size > maxKeys) {
      const oldestKey = failures.keys().next().value;
      if (oldestKey === undefined) {
        return;
      }
      failures.delete(oldestKey);
    }
  }

  return {
    isLimited(req, now = Date.now()) {
      prune(now);
      const entry = failures.get(keyFor(req));
      return Boolean(entry && entry.count >= maxFailures && entry.resetAt > now);
    },

    recordFailure(req, now = Date.now()) {
      prune(now);
      const key = keyFor(req);
      const existing = failures.get(key);
      if (!existing || existing.resetAt <= now) {
        failures.set(key, { count: 1, resetAt: now + windowMs });
        evictOldestIfNeeded();
        return;
      }
      existing.count += 1;
    },

    recordSuccess(req) {
      failures.delete(keyFor(req));
    }
  };
}

const defaultSessionStore = createSessionStore();

export function createSession(now = Date.now()) {
  return defaultSessionStore.createSession(now);
}

export function destroySession(cookieValue) {
  return defaultSessionStore.destroySession(cookieValue);
}

export function isAuthenticated(cookieValue, now = Date.now()) {
  return defaultSessionStore.isAuthenticated(cookieValue, now);
}

export function requireAdmin(config, sessionStore = defaultSessionStore) {
  return (req, res, next) => {
    if (sessionStore.isAuthenticated(req.cookies?.[AUTH_COOKIE])) {
      next();
      return;
    }

    res.redirect('/login');
  };
}

function requestOrigin(req) {
  const origin = req.get?.('origin');
  if (origin) {
    return origin;
  }

  const referer = req.get?.('referer');
  if (!referer) {
    return null;
  }

  try {
    return new URL(referer).origin;
  } catch (error) {
    return null;
  }
}

export function requireSameOrigin(config) {
  const expectedOrigin = new URL(config.publicBaseUrl).origin;
  return (req, res, next) => {
    const origin = requestOrigin(req);
    if (origin === expectedOrigin) {
      next();
      return;
    }

    res.status(403).type('html').send('Forbidden');
  };
}
