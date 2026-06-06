export function upsertAccount(db, account) {
  db.prepare(`
    INSERT INTO accounts (
      id,
      instagram_user_id,
      username,
      account_type,
      access_token_encrypted,
      token_expires_at,
      token_last_verified_at,
      updated_at
    ) VALUES (
      1,
      @instagramUserId,
      @username,
      @accountType,
      @accessTokenEncrypted,
      @tokenExpiresAt,
      datetime('now'),
      datetime('now')
    )
    ON CONFLICT(id) DO UPDATE SET
      instagram_user_id = excluded.instagram_user_id,
      username = excluded.username,
      account_type = excluded.account_type,
      access_token_encrypted = excluded.access_token_encrypted,
      token_expires_at = excluded.token_expires_at,
      token_last_verified_at = datetime('now'),
      updated_at = datetime('now')
  `).run(account);
}

export function getAccount(db) {
  return db.prepare('SELECT * FROM accounts WHERE id = 1').get() || null;
}

export function updateTokenRefresh(db, accessTokenEncrypted, tokenExpiresAt) {
  db.prepare(`
    UPDATE accounts
    SET access_token_encrypted = ?,
        token_expires_at = ?,
        token_last_refreshed_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = 1
  `).run(accessTokenEncrypted, tokenExpiresAt);
}
