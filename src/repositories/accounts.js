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
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
    ON CONFLICT(id) DO UPDATE SET
      instagram_user_id = excluded.instagram_user_id,
      username = excluded.username,
      account_type = excluded.account_type,
      access_token_encrypted = excluded.access_token_encrypted,
      token_expires_at = excluded.token_expires_at,
      token_last_verified_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).run(account);
}

export function getAccount(db) {
  return db.prepare('SELECT * FROM accounts WHERE id = 1').get() || null;
}

export function updateTokenRefresh(db, accessTokenEncrypted, tokenExpiresAt) {
  const result = db.prepare(`
    UPDATE accounts
    SET access_token_encrypted = ?,
        token_expires_at = ?,
        token_last_refreshed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE id = 1
  `).run(accessTokenEncrypted, tokenExpiresAt);
  return result.changes === 1;
}
