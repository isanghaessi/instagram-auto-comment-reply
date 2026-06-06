import { Router } from 'express';
import { consumeOAuthState, createOAuthState } from '../repositories/oauthStates.js';
import { upsertAccount } from '../repositories/accounts.js';
import { requireAdmin } from '../security/auth.js';
import { encryptText } from '../security/crypto.js';
import { escapeHtml, layout } from '../views/html.js';

function failurePage(message, description) {
  const descriptionHtml = description
    ? `\n      <p>${escapeHtml(description)}</p>`
    : '';

  return layout('Instagram connection failed', `    <section class="card">
      <h2>Instagram connection failed</h2>
      <p class="error">${escapeHtml(message)}</p>${descriptionHtml}
      <p><a class="button" href="/">Back to dashboard</a></p>
    </section>`);
}

function sendFailure(res, status, message, description) {
  res.status(status).type('html').send(failurePage(message, description));
}

function queryStringValue(value) {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function tokenExpiresAt(expiresIn) {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return new Date(Date.now() + (seconds * 1000)).toISOString();
}

function requireValue(value, name) {
  if (typeof value !== 'string' || value === '') {
    throw new Error(`Instagram OAuth response missing ${name}`);
  }
  return value;
}

export function instagramAuthRoutes({ config, db, instagramClient }) {
  const router = Router();

  router.get('/auth/instagram/start', requireAdmin(config), (req, res, next) => {
    try {
      const state = createOAuthState(db);
      res.redirect(instagramClient.buildAuthorizeUrl(state));
    } catch (error) {
      next(error);
    }
  });

  router.get('/auth/instagram/callback', async (req, res) => {
    const providerError = queryStringValue(req.query.error);
    if (providerError) {
      sendFailure(
        res,
        400,
        'Instagram did not authorize the connection.',
        queryStringValue(req.query.error_description) ?? providerError
      );
      return;
    }

    const code = queryStringValue(req.query.code);
    const state = queryStringValue(req.query.state);
    if (!code || !state || !consumeOAuthState(db, state)) {
      sendFailure(res, 400, 'Invalid or expired Instagram OAuth state.');
      return;
    }

    try {
      const shortToken = await instagramClient.exchangeCodeForShortLivedToken(code);
      const longToken = await instagramClient.exchangeForLongLivedToken(requireValue(shortToken?.accessToken, 'short-lived access token'));
      const longAccessToken = requireValue(longToken?.accessToken, 'long-lived access token');
      const account = await instagramClient.getAccount(longAccessToken);

      upsertAccount(db, {
        instagramUserId: requireValue(account?.id, 'account id'),
        username: requireValue(account?.username, 'username'),
        accountType: account?.account_type ?? null,
        accessTokenEncrypted: encryptText(longAccessToken, config.encryptionKey),
        tokenExpiresAt: tokenExpiresAt(longToken?.expiresIn)
      });

      res.redirect('/');
    } catch (error) {
      sendFailure(res, 502, 'Unable to connect Instagram. Please try again.');
    }
  });

  return router;
}
