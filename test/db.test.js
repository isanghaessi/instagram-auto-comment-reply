import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/testDb.js';
import { upsertAccount, getAccount, updateTokenRefresh } from '../src/repositories/accounts.js';
import { createOAuthState, consumeOAuthState } from '../src/repositories/oauthStates.js';
import { upsertMedia, listMedia } from '../src/repositories/media.js';
import {
  createRule,
  updateRule,
  listRules,
  listActiveRules,
  getRule,
  setRuleActive,
  softDeleteRule
} from '../src/repositories/rules.js';
import { upsertCommentEvent } from '../src/repositories/comments.js';
import { createReplyLog, findReplyLog, listReplyLogs } from '../src/repositories/replyLogs.js';

const isoUtcTimestampPattern = /^\d{4}-\d{2}-\d{2}T.*Z$/;

function assertIsoUtcTimestamp(value) {
  assert.equal(typeof value, 'string');
  assert.match(value, isoUtcTimestampPattern);
}

function insertMedia(db, overrides = {}) {
  return upsertMedia(db, {
    instagramMediaId: overrides.instagramMediaId ?? 'media-1',
    caption: overrides.caption ?? 'caption',
    mediaType: overrides.mediaType ?? 'IMAGE',
    mediaUrl: overrides.mediaUrl ?? 'https://cdn.example/media.jpg',
    thumbnailUrl: overrides.thumbnailUrl ?? 'https://cdn.example/thumb.jpg',
    permalink: overrides.permalink ?? 'https://instagram.com/p/x',
    timestamp: overrides.timestamp ?? '2026-06-06T00:00:00.000Z'
  });
}

function insertRule(db, mediaId, overrides = {}) {
  return createRule(db, {
    mediaId,
    name: overrides.name ?? 'coupon',
    matchMode: overrides.matchMode ?? 'contains_any',
    keywordText: overrides.keywordText ?? '쿠폰, 링크',
    replyMessage: overrides.replyMessage ?? 'DM입니다',
    dmFailureReplyMessage: overrides.dmFailureReplyMessage ?? 'DM 불가 안내',
    isActive: overrides.isActive ?? true
  });
}

function insertComment(db, mediaId, overrides = {}) {
  return upsertCommentEvent(db, {
    instagramCommentId: overrides.instagramCommentId ?? 'comment-1',
    mediaId,
    commenterId: overrides.commenterId ?? 'user-1',
    commenterUsername: overrides.commenterUsername ?? 'user',
    commentText: overrides.commentText ?? '쿠폰 주세요',
    instagramCreatedAt: overrides.instagramCreatedAt ?? '2026-06-06T00:01:00.000Z'
  });
}

test('database schema supports account, oauth state, media, rule, comment, reply log, and soft delete flow', () => {
  const { db } = createTestDb();

  try {
    assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
    assert.equal(db.pragma('journal_mode', { simple: true }), 'wal');

    upsertAccount(db, {
      instagramUserId: 'ig-1',
      username: 'creator',
      accountType: 'CREATOR',
      accessTokenEncrypted: 'encrypted',
      tokenExpiresAt: '2026-08-01T00:00:00.000Z'
    });
    assert.equal(getAccount(db).username, 'creator');

    upsertAccount(db, {
      instagramUserId: 'ig-1',
      username: 'creator-renamed',
      accountType: 'BUSINESS',
      accessTokenEncrypted: 'encrypted-2',
      tokenExpiresAt: '2026-09-01T00:00:00.000Z'
    });
    const updatedAccount = getAccount(db);
    assert.equal(updatedAccount.id, 1);
    assert.equal(updatedAccount.username, 'creator-renamed');
    assertIsoUtcTimestamp(updatedAccount.created_at);
    assertIsoUtcTimestamp(updatedAccount.updated_at);
    assertIsoUtcTimestamp(updatedAccount.token_last_verified_at);

    assert.equal(updateTokenRefresh(db, 'encrypted-3', '2026-10-01T00:00:00.000Z'), true);
    const refreshedAccount = getAccount(db);
    assert.equal(refreshedAccount.access_token_encrypted, 'encrypted-3');
    assertIsoUtcTimestamp(refreshedAccount.token_last_refreshed_at);

    const state = createOAuthState(db);
    assert.match(state, /^[a-f0-9]{48}$/);
    assertIsoUtcTimestamp(db.prepare('SELECT created_at FROM oauth_states WHERE state = ?').get(state).created_at);
    assert.equal(consumeOAuthState(db, state), true);
    assert.equal(consumeOAuthState(db, state), false);
    assert.equal(consumeOAuthState(db, 'missing-state'), false);

    const olderMediaId = insertMedia(db, {
      instagramMediaId: 'media-older',
      caption: 'older caption',
      mediaUrl: 'https://cdn.example/older.jpg',
      thumbnailUrl: 'https://cdn.example/older-thumb.jpg',
      permalink: 'https://instagram.com/p/older',
      timestamp: '2026-06-05T00:00:00.000Z'
    });
    const mediaId = insertMedia(db);
    const sameMediaId = insertMedia(db, {
      instagramMediaId: 'media-1',
      caption: 'updated caption',
      mediaType: 'VIDEO',
      mediaUrl: 'https://cdn.example/media.mp4',
      thumbnailUrl: 'https://cdn.example/thumb2.jpg'
    });
    assert.equal(sameMediaId, mediaId);
    assert.notEqual(olderMediaId, mediaId);
    const mediaRows = listMedia(db);
    assert.deepEqual(mediaRows.map((row) => row.instagram_media_id), ['media-1', 'media-older']);
    assert.equal(mediaRows[0].caption, 'updated caption');
    assertIsoUtcTimestamp(mediaRows[0].created_at);
    assertIsoUtcTimestamp(mediaRows[0].updated_at);

    const ruleId = insertRule(db, mediaId);
    assert.equal(getRule(db, ruleId).dm_failure_reply_message, 'DM 불가 안내');
    assert.equal(listActiveRules(db).length, 1);
    assert.equal(listActiveRules(db)[0].instagram_media_id, 'media-1');

    assert.equal(updateRule(db, ruleId, {
      mediaId,
      name: 'coupon updated',
      matchMode: 'contains_any',
      keywordText: '쿠폰 링크',
      replyMessage: '새 DM입니다',
      dmFailureReplyMessage: '새 DM 불가 안내',
      isActive: false
    }), true);
    assert.equal(getRule(db, ruleId).name, 'coupon updated');
    assert.equal(listActiveRules(db).length, 0);

    assert.equal(setRuleActive(db, ruleId, true), true);
    assert.equal(listRules(db)[0].is_active, 1);
    assert.equal(listActiveRules(db).length, 1);

    const commentEventId = insertComment(db, mediaId);
    const duplicateCommentEventId = insertComment(db, mediaId, {
      instagramCommentId: 'comment-1',
      commenterUsername: 'user-renamed',
      commentText: '쿠폰 링크 주세요'
    });
    assert.equal(duplicateCommentEventId, commentEventId);
    assertIsoUtcTimestamp(db.prepare('SELECT created_at FROM comment_events WHERE id = ?').get(commentEventId).created_at);
    assertIsoUtcTimestamp(db.prepare('SELECT received_at FROM comment_events WHERE id = ?').get(commentEventId).received_at);

    const replyLogId = createReplyLog(db, {
      ruleId,
      commentEventId,
      instagramCommentId: 'comment-1',
      dmStatus: 'sent',
      commentLikeStatus: 'sent',
      fallbackReplyStatus: 'skipped',
      fallbackReplyCommentId: null,
      requestPayloadJson: '{"message":"새 DM입니다"}',
      responsePayloadJson: '{"ok":true}',
      errorMessage: null
    });
    assert.equal(Number.isInteger(replyLogId), true);
    assert.equal(findReplyLog(db, ruleId, 'comment-1').dm_status, 'sent');
    assertIsoUtcTimestamp(findReplyLog(db, ruleId, 'comment-1').created_at);
    assertIsoUtcTimestamp(findReplyLog(db, ruleId, 'comment-1').sent_at);
    assert.throws(() => createReplyLog(db, {
      ruleId,
      commentEventId,
      instagramCommentId: 'comment-1',
      dmStatus: 'sent',
      commentLikeStatus: 'sent',
      fallbackReplyStatus: 'skipped',
      fallbackReplyCommentId: null,
      requestPayloadJson: '{}',
      responsePayloadJson: '{}',
      errorMessage: null
    }), /UNIQUE constraint failed/);

    const [replyLog] = listReplyLogs(db);
    assert.equal(replyLog.rule_name, 'coupon updated');
    assert.equal(replyLog.commenter_username, 'user-renamed');
    assert.equal(replyLog.instagram_media_id, 'media-1');

    assert.equal(softDeleteRule(db, ruleId), true);
    assert.equal(getRule(db, ruleId), null);
    assert.equal(listActiveRules(db).length, 0);
    assert.equal(listRules(db).length, 0);
  } finally {
    db.close();
  }
});

test('consumeOAuthState rejects expired states', () => {
  const { db } = createTestDb();

  try {
    const state = createOAuthState(db);
    db.prepare(`
      UPDATE oauth_states
      SET created_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-601 seconds')
      WHERE state = ?
    `).run(state);

    assert.equal(consumeOAuthState(db, state, 600), false);
    assert.equal(db.prepare('SELECT consumed_at FROM oauth_states WHERE state = ?').get(state).consumed_at, null);
  } finally {
    db.close();
  }
});

test('update and delete repositories report missing or deleted rows', () => {
  const { db } = createTestDb();

  try {
    assert.equal(updateTokenRefresh(db, 'missing-token', '2026-10-01T00:00:00.000Z'), false);

    const mediaId = insertMedia(db);
    const ruleId = insertRule(db, mediaId);

    assert.equal(updateRule(db, 9999, {
      mediaId,
      name: 'missing',
      matchMode: 'contains_any',
      keywordText: 'missing',
      replyMessage: 'missing',
      dmFailureReplyMessage: 'missing',
      isActive: true
    }), false);
    assert.equal(setRuleActive(db, 9999, false), false);
    assert.equal(softDeleteRule(db, 9999), false);

    assert.equal(softDeleteRule(db, ruleId), true);
    assert.equal(setRuleActive(db, ruleId, true), false);
    assert.equal(updateRule(db, ruleId, {
      mediaId,
      name: 'deleted',
      matchMode: 'contains_any',
      keywordText: 'deleted',
      replyMessage: 'deleted',
      dmFailureReplyMessage: 'deleted',
      isActive: true
    }), false);
    assert.equal(softDeleteRule(db, ruleId), false);
  } finally {
    db.close();
  }
});

test('database constraints reject invalid rule match modes and reply log statuses', () => {
  const { db } = createTestDb();

  try {
    const mediaId = insertMedia(db);
    assert.throws(() => insertRule(db, mediaId, { matchMode: 'contains_all' }), /CHECK constraint failed/);

    const ruleId = insertRule(db, mediaId);
    const commentEventId = insertComment(db, mediaId);
    const validLog = {
      ruleId,
      commentEventId,
      instagramCommentId: 'comment-constraints',
      dmStatus: 'sent',
      commentLikeStatus: 'sent',
      fallbackReplyStatus: 'skipped',
      fallbackReplyCommentId: null,
      requestPayloadJson: '{}',
      responsePayloadJson: '{}',
      errorMessage: null
    };

    assert.throws(() => createReplyLog(db, { ...validLog, instagramCommentId: 'bad-dm', dmStatus: 'queued' }), /CHECK constraint failed/);
    assert.throws(() => createReplyLog(db, { ...validLog, instagramCommentId: 'bad-like', commentLikeStatus: 'queued' }), /CHECK constraint failed/);
    assert.throws(() => createReplyLog(db, { ...validLog, instagramCommentId: 'bad-fallback', fallbackReplyStatus: 'queued' }), /CHECK constraint failed/);
  } finally {
    db.close();
  }
});
