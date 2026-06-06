function normalizeLimit(limit) {
  if (!Number.isInteger(limit) || limit < 1) {
    return 100;
  }
  return limit;
}

export function findReplyLog(db, ruleId, instagramCommentId) {
  return db.prepare(`
    SELECT *
    FROM reply_logs
    WHERE rule_id = ? AND instagram_comment_id = ?
  `).get(ruleId, instagramCommentId) || null;
}

export function createReplyLog(db, log) {
  const result = db.prepare(`
    INSERT INTO reply_logs (
      rule_id,
      comment_event_id,
      instagram_comment_id,
      dm_status,
      comment_like_status,
      fallback_reply_status,
      fallback_reply_comment_id,
      request_payload_json,
      response_payload_json,
      error_message,
      sent_at
    ) VALUES (
      @ruleId,
      @commentEventId,
      @instagramCommentId,
      @dmStatus,
      @commentLikeStatus,
      @fallbackReplyStatus,
      @fallbackReplyCommentId,
      @requestPayloadJson,
      @responsePayloadJson,
      @errorMessage,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
  `).run(log);
  return Number(result.lastInsertRowid);
}

export function claimReplyLog(db, claim) {
  const result = db.prepare(`
    INSERT OR IGNORE INTO reply_logs (
      rule_id,
      comment_event_id,
      instagram_comment_id,
      dm_status,
      comment_like_status,
      fallback_reply_status,
      fallback_reply_comment_id,
      request_payload_json,
      response_payload_json,
      error_message,
      sent_at
    ) VALUES (
      @ruleId,
      @commentEventId,
      @instagramCommentId,
      'skipped',
      'skipped',
      'skipped',
      NULL,
      '{}',
      '{}',
      NULL,
      NULL
    )
  `).run(claim);
  return result.changes === 1;
}

export function updateReplyLog(db, log) {
  const result = db.prepare(`
    UPDATE reply_logs
    SET comment_event_id = @commentEventId,
        dm_status = @dmStatus,
        comment_like_status = @commentLikeStatus,
        fallback_reply_status = @fallbackReplyStatus,
        fallback_reply_comment_id = @fallbackReplyCommentId,
        request_payload_json = @requestPayloadJson,
        response_payload_json = @responsePayloadJson,
        error_message = @errorMessage,
        sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    WHERE rule_id = @ruleId
      AND instagram_comment_id = @instagramCommentId
  `).run(log);
  return result.changes === 1;
}

export function listReplyLogs(db, limit = 100) {
  return db.prepare(`
    SELECT
      l.*,
      r.name AS rule_name,
      c.comment_text,
      c.commenter_username,
      m.caption,
      m.instagram_media_id
    FROM reply_logs AS l
    JOIN automation_rules AS r ON r.id = l.rule_id
    JOIN comment_events AS c ON c.id = l.comment_event_id
    JOIN media AS m ON m.id = c.media_id
    ORDER BY l.id DESC
    LIMIT ?
  `).all(normalizeLimit(limit));
}
