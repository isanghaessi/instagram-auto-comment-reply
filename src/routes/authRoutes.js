import { Router } from 'express';
import { AUTH_COOKIE, createAuthCookieValue } from '../security/auth.js';
import { layout } from '../views/html.js';

function usesSecureCookie(config) {
  return String(config.publicBaseUrl).startsWith('https://');
}

function authCookieOptions(config) {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: usesSecureCookie(config)
  };
}

function loginPage(showError = false) {
  return layout('Login', `    <section class="card">
      <h2>Admin login</h2>
      ${showError ? '<p class="error">Invalid password.</p>' : ''}
      <form method="post" action="/login">
        <label>Password
          <input type="password" name="password" autocomplete="current-password" required autofocus>
        </label>
        <button type="submit">Log in</button>
      </form>
    </section>`);
}

export function createAuthRoutes(config) {
  const router = Router();

  router.get('/login', (req, res) => {
    res.type('html').send(loginPage(req.query.error === '1'));
  });

  router.post('/login', (req, res) => {
    if (req.body?.password === config.adminPassword) {
      res.cookie(AUTH_COOKIE, createAuthCookieValue(config.adminPassword), authCookieOptions(config));
      res.redirect('/');
      return;
    }

    res.redirect('/login?error=1');
  });

  router.get('/logout', (req, res) => {
    res.clearCookie(AUTH_COOKIE, authCookieOptions(config));
    res.redirect('/login');
  });

  return router;
}
