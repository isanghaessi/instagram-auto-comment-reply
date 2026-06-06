function ruleParams(rule) {
  return {
    ...rule,
    isActive: rule.isActive ? 1 : 0
  };
}

export function createRule(db, rule) {
  const result = db.prepare(`
    INSERT INTO automation_rules (
      media_id,
      name,
      match_mode,
      keyword_text,
      reply_message,
      dm_failure_reply_message,
      is_active
    ) VALUES (
      @mediaId,
      @name,
      @matchMode,
      @keywordText,
      @replyMessage,
      @dmFailureReplyMessage,
      @isActive
    )
  `).run(ruleParams(rule));
  return Number(result.lastInsertRowid);
}

export function updateRule(db, id, rule) {
  db.prepare(`
    UPDATE automation_rules
    SET media_id = @mediaId,
        name = @name,
        match_mode = @matchMode,
        keyword_text = @keywordText,
        reply_message = @replyMessage,
        dm_failure_reply_message = @dmFailureReplyMessage,
        is_active = @isActive,
        updated_at = datetime('now')
    WHERE id = @id AND deleted_at IS NULL
  `).run({ id, ...ruleParams(rule) });
}

export function listRules(db) {
  return db.prepare(`
    SELECT r.*, m.caption, m.instagram_media_id
    FROM automation_rules AS r
    JOIN media AS m ON m.id = r.media_id
    WHERE r.deleted_at IS NULL
    ORDER BY r.id DESC
  `).all();
}

export function listActiveRules(db) {
  return db.prepare(`
    SELECT r.*, m.instagram_media_id
    FROM automation_rules AS r
    JOIN media AS m ON m.id = r.media_id
    WHERE r.deleted_at IS NULL AND r.is_active = 1
    ORDER BY r.id ASC
  `).all();
}

export function getRule(db, id) {
  return db.prepare(`
    SELECT r.*, m.instagram_media_id
    FROM automation_rules AS r
    JOIN media AS m ON m.id = r.media_id
    WHERE r.id = ? AND r.deleted_at IS NULL
  `).get(id) || null;
}

export function setRuleActive(db, id, isActive) {
  db.prepare(`
    UPDATE automation_rules
    SET is_active = ?, updated_at = datetime('now')
    WHERE id = ? AND deleted_at IS NULL
  `).run(isActive ? 1 : 0, id);
}

export function softDeleteRule(db, id) {
  db.prepare(`
    UPDATE automation_rules
    SET is_active = 0,
        deleted_at = datetime('now'),
        updated_at = datetime('now')
    WHERE id = ? AND deleted_at IS NULL
  `).run(id);
}
