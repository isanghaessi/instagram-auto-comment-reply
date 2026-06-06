export function upsertMedia(db, media) {
  db.prepare(`
    INSERT INTO media (
      instagram_media_id,
      caption,
      media_type,
      media_url,
      thumbnail_url,
      permalink,
      timestamp,
      updated_at
    ) VALUES (
      @instagramMediaId,
      @caption,
      @mediaType,
      @mediaUrl,
      @thumbnailUrl,
      @permalink,
      @timestamp,
      strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    )
    ON CONFLICT(instagram_media_id) DO UPDATE SET
      caption = excluded.caption,
      media_type = excluded.media_type,
      media_url = excluded.media_url,
      thumbnail_url = excluded.thumbnail_url,
      permalink = excluded.permalink,
      timestamp = excluded.timestamp,
      updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  `).run(media);

  return db.prepare('SELECT id FROM media WHERE instagram_media_id = ?')
    .get(media.instagramMediaId)
    .id;
}

export function listMedia(db) {
  return db.prepare('SELECT * FROM media ORDER BY timestamp DESC, id DESC').all();
}
