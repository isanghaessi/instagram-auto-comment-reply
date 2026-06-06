import { Router } from 'express';
import { listReplyLogs } from '../repositories/replyLogs.js';
import { requireAdmin } from '../security/auth.js';
import { escapeHtml, layout } from '../views/html.js';

function valueOrDash(value) {
  return value === null || value === undefined || value === '' ? '-' : value;
}

function timestampHtml(createdAt, sentAt) {
  return `<div><strong>Created:</strong> ${escapeHtml(valueOrDash(createdAt))}</div>
              <div><strong>Sent:</strong> ${escapeHtml(valueOrDash(sentAt))}</div>`;
}

function logRows(logs) {
  if (logs.length === 0) {
    return '      <p>아직 발송 로그가 없습니다. 자동응답이 발송되면 이곳에 최근 기록이 표시됩니다.</p>';
  }

  return `      <table>
        <thead>
          <tr>
            <th>Created / Sent</th>
            <th>Rule</th>
            <th>Commenter</th>
            <th>Comment</th>
            <th>DM</th>
            <th>Like</th>
            <th>Fallback reply</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
${logs.map((log) => `          <tr>
            <td>${timestampHtml(log.created_at, log.sent_at)}</td>
            <td>${escapeHtml(valueOrDash(log.rule_name))}</td>
            <td>${escapeHtml(valueOrDash(log.commenter_username))}</td>
            <td>${escapeHtml(valueOrDash(log.comment_text))}</td>
            <td>${escapeHtml(valueOrDash(log.dm_status))}</td>
            <td>${escapeHtml(valueOrDash(log.comment_like_status))}</td>
            <td>${escapeHtml(valueOrDash(log.fallback_reply_status))}</td>
            <td>${escapeHtml(valueOrDash(log.error_message))}</td>
          </tr>`).join('\n')}
        </tbody>
      </table>`;
}

function logsPage(logs) {
  return layout('발송 로그', `    <section class="card">
      <h2>발송 로그</h2>
      <p>최근 자동응답 발송 결과를 확인할 수 있습니다.</p>
${logRows(logs)}
    </section>`);
}

export function logRoutes({ config, db, sessionStore }) {
  const router = Router();

  router.get('/logs', requireAdmin(config, sessionStore), (req, res, next) => {
    try {
      res.type('html').send(logsPage(listReplyLogs(db)));
    } catch (error) {
      next(error);
    }
  });

  return router;
}
