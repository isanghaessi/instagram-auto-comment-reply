import crypto from 'node:crypto';

export function createOAuthState(db) {
  const state = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO oauth_states (state) VALUES (?)').run(state);
  return state;
}

export function consumeOAuthState(db, state) {
  const result = db.prepare(`
    UPDATE oauth_states
    SET consumed_at = datetime('now')
    WHERE state = ? AND consumed_at IS NULL
  `).run(state);
  return result.changes === 1;
}
