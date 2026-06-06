export function upsertCommentEvent(db, comment) {
  db.prepare(`
    INSERT INTO comment_events (
      instagram_comment_id,
      media_id,
      commenter_id,
      commenter_username,
      comment_text,
      instagram_created_at
    ) VALUES (
      @instagramCommentId,
      @mediaId,
      @commenterId,
      @commenterUsername,
      @commentText,
      @instagramCreatedAt
    )
    ON CONFLICT(instagram_comment_id) DO UPDATE SET
      media_id = excluded.media_id,
      commenter_id = excluded.commenter_id,
      commenter_username = excluded.commenter_username,
      comment_text = excluded.comment_text,
      instagram_created_at = excluded.instagram_created_at
  `).run(comment);

  return db.prepare('SELECT id FROM comment_events WHERE instagram_comment_id = ?')
    .get(comment.instagramCommentId)
    .id;
}
