import { Router } from 'express';
import {
  AUTH_COOKIE,
  SESSION_MAX_AGE_SECONDS,
  createLoginThrottle,
  createSession,
  destroySession,
  requireAdmin,
  requireSameOrigin
} from '../security/auth.js';
import { layout } from '../views/html.js';

function usesSecureCookie(config) {
  return String(config.publicBaseUrl).startsWith('https://');
}

function authCookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: usesSecureCookie(config),
    maxAge: SESSION_MAX_AGE_SECONDS * 1000
  };
}

function loginPage(showError = false, throttled = false) {
  return layout('Login', `    <section class="card">
      <h2>Admin login</h2>
      ${throttled ? '<p class="error">Too many failed login attempts. Please wait and try again.</p>' : ''}
      ${showError ? '<p class="error">Invalid password.</p>' : ''}
      <form method="post" action="/login">
        <label>Password
          <input type="password" name="password" autocomplete="current-password" required autofocus>
        </label>
        <button type="submit">Log in</button>
      </form>
    </section>`);
}

export function createAuthRoutes(config, sessionStore = { createSession, destroySession }, loginThrottle = createLoginThrottle()) {
  const router = Router();

  router.get('/login', (req, res) => {
    res.type('html').send(loginPage(req.query.error === '1', req.query.throttled === '1'));
  });

  router.post('/login', (req, res) => {
    if (loginThrottle.isLimited(req)) {
      res.status(429).type('html').send(loginPage(false, true));
      return;
    }

    if (req.body?.password === config.adminPassword) {
      loginThrottle.recordSuccess(req);
      res.cookie(AUTH_COOKIE, sessionStore.createSession(), authCookieOptions(config));
      res.redirect('/');
      return;
    }

    loginThrottle.recordFailure(req);
    res.redirect('/login?error=1');
  });

  router.get('/logout', (req, res) => {
    res.redirect('/');
  });

  router.post('/logout', requireAdmin(config, sessionStore), requireSameOrigin(config), (req, res) => {
    sessionStore.destroySession(req.cookies?.[AUTH_COOKIE]);
    res.cookie(AUTH_COOKIE, '', {
      ...authCookieOptions(config),
      maxAge: 0
    });
    res.redirect('/login');
  });

  return router;
}
