import { Router } from 'express';
import { listMedia } from '../repositories/media.js';
import {
  createRule,
  getRule,
  listRules,
  setRuleActive,
  softDeleteRule,
  updateRule
} from '../repositories/rules.js';
import { requireAdmin, requireSameOrigin } from '../security/auth.js';
import { escapeHtml, layout } from '../views/html.js';

function asString(value) {
  return typeof value === 'string' ? value : '';
}

function parsePositiveInteger(value) {
  const text = asString(value).trim();
  if (!/^[1-9]\d*$/.test(text)) {
    return null;
  }
  return Number.parseInt(text, 10);
}

function hasMedia(mediaItems, mediaId) {
  return mediaItems.some((media) => Number(media.id) === mediaId);
}

function requestedRule(body, mediaItems) {
  const mediaId = parsePositiveInteger(body?.mediaId);
  const rule = {
    mediaId,
    name: asString(body?.name).trim(),
    matchMode: 'contains_any',
    keywordText: asString(body?.keywordText).trim(),
    replyMessage: asString(body?.replyMessage).trim(),
    dmFailureReplyMessage: asString(body?.dmFailureReplyMessage).trim(),
    isActive: body?.isActive === 'on'
  };
  const errors = [];

  if (mediaId === null) {
    errors.push('Please choose a valid media item.');
  } else if (!hasMedia(mediaItems, mediaId)) {
    errors.push('Selected media item does not exist.');
  }
  if (rule.name === '') {
    errors.push('Rule name is required.');
  }
  if (rule.keywordText === '') {
    errors.push('Keywords are required.');
  }
  if (rule.replyMessage === '') {
    errors.push('DM reply message is required.');
  }
  if (rule.dmFailureReplyMessage === '') {
    errors.push('Fallback public reply is required.');
  }

  return { rule, errors };
}

function mediaLabel(media) {
  const caption = media.caption ? ` - ${media.caption}` : '';
  return `${media.instagram_media_id}${caption}`;
}

function mediaOptions(mediaItems, selectedMediaId) {
  return mediaItems.map((media) => `          <option value="${escapeHtml(media.id)}"${Number(media.id) === Number(selectedMediaId) ? ' selected' : ''}>${escapeHtml(mediaLabel(media))}</option>`).join('\n');
}

function ruleForm({ mediaItems, rule = null, action = '/rules', submitLabel = 'Create rule' }) {
  if (mediaItems.length === 0) {
    return `      <p>No media has been synced yet. Connect an Instagram access token and sync media before creating an auto-reply rule.</p>
      <p><a class="button" href="/">Go to dashboard</a></p>`;
  }

  const selectedMediaId = rule?.media_id ?? mediaItems[0]?.id;
  return `      <form method="post" action="${escapeHtml(action)}">
        <label>Media
          <select name="mediaId" required>
${mediaOptions(mediaItems, selectedMediaId)}
          </select>
        </label>
        <label>Rule name
          <input type="text" name="name" value="${escapeHtml(rule?.name ?? '')}" required>
        </label>
        <label>Keywords
          <textarea name="keywordText" required>${escapeHtml(rule?.keyword_text ?? '')}</textarea>
        </label>
        <label>DM reply message
          <textarea name="replyMessage" required>${escapeHtml(rule?.reply_message ?? '')}</textarea>
        </label>
        <label>Fallback public reply when DM fails
          <textarea name="dmFailureReplyMessage" required>${escapeHtml(rule?.dm_failure_reply_message ?? '')}</textarea>
        </label>
        <label>
          <input type="checkbox" name="isActive"${rule === null || rule.is_active ? ' checked' : ''}> Active
        </label>
        <button type="submit">${escapeHtml(submitLabel)}</button>
      </form>`;
}

function ruleRows(rules) {
  if (rules.length === 0) {
    return '<p>No rules created yet.</p>';
  }

  return `      <table>
        <thead>
          <tr><th>Name</th><th>Media</th><th>Keywords</th><th>Status</th><th>Actions</th></tr>
        </thead>
        <tbody>
${rules.map((rule) => `          <tr>
            <td>${escapeHtml(rule.name)}</td>
            <td>${escapeHtml(rule.instagram_media_id)}${rule.caption ? `<br><small>${escapeHtml(rule.caption)}</small>` : ''}</td>
            <td>${escapeHtml(rule.keyword_text)}</td>
            <td>${rule.is_active ? 'Active' : 'Paused'}</td>
            <td>
              <a href="/rules/${escapeHtml(rule.id)}/edit">Edit</a>
              <form method="post" action="/rules/${escapeHtml(rule.id)}/toggle" style="display:inline">
                <button type="submit">${rule.is_active ? 'Pause' : 'Resume'}</button>
              </form>
              <form method="post" action="/rules/${escapeHtml(rule.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this rule?')">
                <button type="submit">Delete</button>
              </form>
            </td>
          </tr>`).join('\n')}
        </tbody>
      </table>`;
}

function rulesPage({ mediaItems, rules }) {
  return layout('자동응답 룰', `    <section class="card">
      <h2>자동응답 룰</h2>
      <h3>Create rule</h3>
${ruleForm({ mediaItems })}
    </section>
    <section class="card">
      <h3>Rules</h3>
${ruleRows(rules)}
    </section>`);
}

function editPage({ mediaItems, rule }) {
  return layout('Edit rule', `    <section class="card">
      <h2>Edit rule</h2>
${ruleForm({ mediaItems, rule, action: `/rules/${rule.id}`, submitLabel: 'Update rule' })}
      <p><a href="/rules">Back to rules</a></p>
    </section>`);
}

function sendValidationError(res, errors) {
  const errorItems = errors.map((error) => `        <li>${escapeHtml(error)}</li>`).join('\n');
  res.status(422).type('html').send(layout('Rule validation failed', `    <section class="card">
      <h2>Rule validation failed</h2>
      <p class="error">Please fix the rule form and try again.</p>
      <ul>
${errorItems}
      </ul>
      <p><a href="/rules">Back to rules</a></p>
    </section>`));
}

function sendNotFound(res) {
  res.status(404).type('html').send(layout('Rule not found', `    <section class="card">
      <h2>Rule not found</h2>
      <p class="error">The requested rule does not exist.</p>
      <p><a href="/rules">Back to rules</a></p>
    </section>`));
}

export function ruleRoutes({ config, db, sessionStore }) {
  const router = Router();

  router.get('/rules', requireAdmin(config, sessionStore), (req, res, next) => {
    try {
      res.type('html').send(rulesPage({ mediaItems: listMedia(db), rules: listRules(db) }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/rules', requireAdmin(config, sessionStore), requireSameOrigin(config), (req, res, next) => {
    try {
      const mediaItems = listMedia(db);
      const { rule, errors } = requestedRule(req.body, mediaItems);
      if (errors.length > 0) {
        sendValidationError(res, errors);
        return;
      }
      createRule(db, rule);
      res.redirect('/rules');
    } catch (error) {
      next(error);
    }
  });

  router.get('/rules/:id/edit', requireAdmin(config, sessionStore), (req, res, next) => {
    try {
      const rule = getRule(db, req.params.id);
      if (!rule) {
        sendNotFound(res);
        return;
      }
      res.type('html').send(editPage({ mediaItems: listMedia(db), rule }));
    } catch (error) {
      next(error);
    }
  });

  router.post('/rules/:id', requireAdmin(config, sessionStore), requireSameOrigin(config), (req, res, next) => {
    try {
      const existingRule = getRule(db, req.params.id);
      if (!existingRule) {
        sendNotFound(res);
        return;
      }
      const mediaItems = listMedia(db);
      const { rule, errors } = requestedRule(req.body, mediaItems);
      if (errors.length > 0) {
        sendValidationError(res, errors);
        return;
      }
      if (!updateRule(db, req.params.id, rule)) {
        sendNotFound(res);
        return;
      }
      res.redirect('/rules');
    } catch (error) {
      next(error);
    }
  });

  router.post('/rules/:id/toggle', requireAdmin(config, sessionStore), requireSameOrigin(config), (req, res, next) => {
    try {
      const rule = getRule(db, req.params.id);
      if (!rule) {
        sendNotFound(res);
        return;
      }
      if (!setRuleActive(db, req.params.id, !rule.is_active)) {
        sendNotFound(res);
        return;
      }
      res.redirect('/rules');
    } catch (error) {
      next(error);
    }
  });

  router.post('/rules/:id/delete', requireAdmin(config, sessionStore), requireSameOrigin(config), (req, res, next) => {
    try {
      if (!softDeleteRule(db, req.params.id)) {
        sendNotFound(res);
        return;
      }
      res.redirect('/rules');
    } catch (error) {
      next(error);
    }
  });

  return router;
}
