import { Router } from 'express';
import { getAccount, upsertAccount } from '../repositories/accounts.js';
import { listMedia, upsertMedia } from '../repositories/media.js';
import { requireAdmin, requireSameOrigin } from '../security/auth.js';
import { decryptText, encryptText } from '../security/crypto.js';
import { escapeHtml, layout } from '../views/html.js';

const DASHBOARD_TOKEN_EXPIRES_IN_SECONDS = 60 * 24 * 60 * 60;

function pollingStatusText(poller) {
  const status = poller?.getStatus?.() ?? { running: false };
  return status.running ? 'Running' : 'Stopped';
}

function normalizeMedia(media) {
  return {
    instagramMediaId: media?.id,
    caption: media?.caption ?? null,
    mediaType: media?.media_type ?? null,
    mediaUrl: media?.media_url ?? null,
    thumbnailUrl: media?.thumbnail_url ?? null,
    permalink: media?.permalink ?? null,
    timestamp: media?.timestamp ?? null
  };
}

function dashboardHtml({ account, poller }) {
  const runningText = pollingStatusText(poller);
  const accountHtml = account
    ? `      <p>Connected account: <strong>@${escapeHtml(account.username)}</strong>${account.account_type ? ` (${escapeHtml(account.account_type)})` : ''}</p>
      <form method="post" action="/account/token">
        <label>Replace Access Token
          <textarea name="accessToken" autocomplete="off" spellcheck="false" placeholder="Paste a fresh long-lived Instagram access token"></textarea>
        </label>
        <button type="submit">Update token</button>
      </form>
      <form method="post" action="/media/sync">
        <button type="submit">Sync Instagram media</button>
      </form>
      <p><a href="/media">View media</a> · <a href="/rules">Manage rules</a></p>`
    : `      <p>No Instagram account is connected yet.</p>
      <p>Meta App Dashboard에서 발급한 long-lived Instagram access token을 붙여넣어 연결하세요.</p>
      <form method="post" action="/account/token">
        <label>Access Token
          <textarea name="accessToken" autocomplete="off" spellcheck="false" required placeholder="Paste Instagram access token"></textarea>
        </label>
        <button type="submit">Connect with token</button>
      </form>`;

  return layout('Dashboard', `    <section class="card">
      <h2>Dashboard</h2>
      <p>Polling status: <strong>${escapeHtml(runningText)}</strong></p>
${accountHtml}
    </section>`);
}

function safeHttpUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch (error) {
    return null;
  }
}

function mediaRows(mediaItems) {
  if (mediaItems.length === 0) {
    return '<p>No media synced yet.</p>';
  }

  return `      <table>
        <thead>
          <tr><th>Media</th><th>Type</th><th>Caption</th><th>Timestamp</th></tr>
        </thead>
        <tbody>
${mediaItems.map((media) => {
  const safePermalink = safeHttpUrl(media.permalink);
  return `          <tr>
            <td>${safePermalink ? `<a href="${escapeHtml(safePermalink)}">${escapeHtml(media.instagram_media_id)}</a>` : escapeHtml(media.instagram_media_id)}</td>
            <td>${escapeHtml(media.media_type ?? '')}</td>
            <td>${escapeHtml(media.caption ?? '')}</td>
            <td>${escapeHtml(media.timestamp ?? '')}</td>
          </tr>`;
}).join('\n')}
        </tbody>
      </table>`;
}

function syncFailureHtml() {
  return layout('Media sync failed', `    <section class="card">
      <h2>Media sync failed</h2>
      <p class="error">Unable to sync Instagram media. Please try again.</p>
      <p><a href="/">Back to dashboard</a></p>
    </section>`);
}

function tokenConnectionFailureHtml() {
  return layout('Instagram connection failed', `    <section class="card">
      <h2>Instagram connection failed</h2>
      <p class="error">Unable to connect Instagram. Please check the access token and try again.</p>
      <p><a href="/">Back to dashboard</a></p>
    </section>`);
}

function mediaHtml(mediaItems) {
  return layout('Media', `    <section class="card">
      <h2>Media</h2>
${mediaRows(mediaItems)}
      <p><a href="/">Back to dashboard</a></p>
    </section>`);
}

function tokenExpiresAt(now = Date.now()) {
  return new Date(now + (DASHBOARD_TOKEN_EXPIRES_IN_SECONDS * 1000)).toISOString();
}

function accountId(account) {
  const id = account?.user_id ?? account?.id;
  return typeof id === 'string' && id !== '' ? id : null;
}

function accountUsername(account) {
  return typeof account?.username === 'string' && account.username !== '' ? account.username : null;
}

function accountType(account) {
  return typeof account?.account_type === 'string' && account.account_type !== '' ? account.account_type : null;
}

export function dashboardRoutes({ config, db, instagramClient, poller, sessionStore }) {
  const router = Router();

  router.get('/', requireAdmin(config, sessionStore), (req, res, next) => {
    try {
      res.type('html').send(dashboardHtml({ account: getAccount(db), poller }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/account/token', requireAdmin(config, sessionStore), requireSameOrigin(config), async (req, res) => {
    const accessToken = typeof req.body?.accessToken === 'string' ? req.body.accessToken.trim() : '';
    if (!accessToken) {
      res.status(502).type('html').send(tokenConnectionFailureHtml());
      return;
    }

    try {
      const instagramAccount = await instagramClient.getAccount(accessToken);
      const instagramUserId = accountId(instagramAccount);
      const username = accountUsername(instagramAccount);
      if (!instagramUserId || !username) {
        throw new Error('Instagram token validation did not return account id and username');
      }

      upsertAccount(db, {
        instagramUserId,
        username,
        accountType: accountType(instagramAccount),
        accessTokenEncrypted: encryptText(accessToken, config.encryptionKey),
        tokenExpiresAt: tokenExpiresAt()
      });

      res.redirect('/');
    } catch (error) {
      res.status(502).type('html').send(tokenConnectionFailureHtml());
    }
  });

  router.post('/media/sync', requireAdmin(config, sessionStore), requireSameOrigin(config), async (req, res, next) => {
    try {
      const account = getAccount(db);
      if (!account) {
        res.redirect('/');
        return;
      }

      const accessToken = decryptText(account.access_token_encrypted, config.encryptionKey);
      const mediaItems = await instagramClient.listMedia(accessToken);
      for (const media of mediaItems) {
        upsertMedia(db, normalizeMedia(media));
      }

      res.redirect('/rules');
    } catch (error) {
      res.status(502).type('html').send(syncFailureHtml());
    }
  });

  router.get('/media', requireAdmin(config, sessionStore), (req, res, next) => {
    try {
      res.type('html').send(mediaHtml(listMedia(db)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
