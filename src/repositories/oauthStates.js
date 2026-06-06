import crypto from 'node:crypto';

function normalizeMaxAgeSeconds(maxAgeSeconds) {
  return Number.isFinite(maxAgeSeconds) && maxAgeSeconds >= 0 ? maxAgeSeconds : 600;
}

export function createOAuthState(db) {
  const state = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO oauth_states (state) VALUES (?)').run(state);
  return state;
}

export function consumeOAuthState(db, state, maxAgeSeconds = 600) {
  const maxAgeModifier = `-${normalizeMaxAgeSeconds(maxAgeSeconds)} seconds`;
  const result = db.prepare(`
    UPDATE oauth_states
    SET consumed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE state = ?
      AND consumed_at IS NULL
      AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
  `).run(state, maxAgeModifier);
  return result.changes === 1;
}
