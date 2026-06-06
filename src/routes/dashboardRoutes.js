import { Router } from 'express';
import { getAccount } from '../repositories/accounts.js';
import { listMedia, upsertMedia } from '../repositories/media.js';
import { requireAdmin } from '../security/auth.js';
import { decryptText } from '../security/crypto.js';
import { escapeHtml, layout } from '../views/html.js';

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
      <form method="post" action="/media/sync">
        <button type="submit">Sync Instagram media</button>
      </form>
      <p><a href="/media">View media</a> · <a href="/rules">Manage rules</a></p>`
    : '      <p>No Instagram account is connected yet.</p>\n      <p><a class="button" href="/auth/instagram/start">Connect Instagram</a></p>';

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

function mediaHtml(mediaItems) {
  return layout('Media', `    <section class="card">
      <h2>Media</h2>
${mediaRows(mediaItems)}
      <p><a href="/">Back to dashboard</a></p>
    </section>`);
}

export function dashboardRoutes({ config, db, instagramClient, poller }) {
  const router = Router();

  router.get('/', requireAdmin(config), (req, res, next) => {
    try {
      res.type('html').send(dashboardHtml({ account: getAccount(db), poller }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/media/sync', requireAdmin(config), async (req, res, next) => {
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

  router.get('/media', requireAdmin(config), (req, res, next) => {
    try {
      res.type('html').send(mediaHtml(listMedia(db)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
