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
    assert.ok(updatedAccount.token_last_verified_at);

    updateTokenRefresh(db, 'encrypted-3', '2026-10-01T00:00:00.000Z');
    const refreshedAccount = getAccount(db);
    assert.equal(refreshedAccount.access_token_encrypted, 'encrypted-3');
    assert.ok(refreshedAccount.token_last_refreshed_at);

    const state = createOAuthState(db);
    assert.match(state, /^[a-f0-9]{48}$/);
    assert.equal(consumeOAuthState(db, state), true);
    assert.equal(consumeOAuthState(db, state), false);
    assert.equal(consumeOAuthState(db, 'missing-state'), false);

    const olderMediaId = upsertMedia(db, {
      instagramMediaId: 'media-older',
      caption: 'older caption',
      mediaType: 'IMAGE',
      mediaUrl: 'https://cdn.example/older.jpg',
      thumbnailUrl: 'https://cdn.example/older-thumb.jpg',
      permalink: 'https://instagram.com/p/older',
      timestamp: '2026-06-05T00:00:00.000Z'
    });
    const mediaId = upsertMedia(db, {
      instagramMediaId: 'media-1',
      caption: 'caption',
      mediaType: 'IMAGE',
      mediaUrl: 'https://cdn.example/media.jpg',
      thumbnailUrl: 'https://cdn.example/thumb.jpg',
      permalink: 'https://instagram.com/p/x',
      timestamp: '2026-06-06T00:00:00.000Z'
    });
    const sameMediaId = upsertMedia(db, {
      instagramMediaId: 'media-1',
      caption: 'updated caption',
      mediaType: 'VIDEO',
      mediaUrl: 'https://cdn.example/media.mp4',
      thumbnailUrl: 'https://cdn.example/thumb2.jpg',
      permalink: 'https://instagram.com/p/x',
      timestamp: '2026-06-06T00:00:00.000Z'
    });
    assert.equal(sameMediaId, mediaId);
    assert.notEqual(olderMediaId, mediaId);
    const mediaRows = listMedia(db);
    assert.deepEqual(mediaRows.map((row) => row.instagram_media_id), ['media-1', 'media-older']);
    assert.equal(mediaRows[0].caption, 'updated caption');

    const ruleId = createRule(db, {
      mediaId,
      name: 'coupon',
      matchMode: 'contains_any',
      keywordText: '쿠폰, 링크',
      replyMessage: 'DM입니다',
      dmFailureReplyMessage: 'DM 불가 안내',
      isActive: true
    });
    assert.equal(getRule(db, ruleId).dm_failure_reply_message, 'DM 불가 안내');
    assert.equal(listActiveRules(db).length, 1);
    assert.equal(listActiveRules(db)[0].instagram_media_id, 'media-1');

    updateRule(db, ruleId, {
      mediaId,
      name: 'coupon updated',
      matchMode: 'contains_all',
      keywordText: '쿠폰 링크',
      replyMessage: '새 DM입니다',
      dmFailureReplyMessage: '새 DM 불가 안내',
      isActive: false
    });
    assert.equal(getRule(db, ruleId).name, 'coupon updated');
    assert.equal(listActiveRules(db).length, 0);

    setRuleActive(db, ruleId, true);
    assert.equal(listRules(db)[0].is_active, 1);
    assert.equal(listActiveRules(db).length, 1);

    const commentEventId = upsertCommentEvent(db, {
      instagramCommentId: 'comment-1',
      mediaId,
      commenterId: 'user-1',
      commenterUsername: 'user',
      commentText: '쿠폰 주세요',
      instagramCreatedAt: '2026-06-06T00:01:00.000Z'
    });
    const duplicateCommentEventId = upsertCommentEvent(db, {
      instagramCommentId: 'comment-1',
      mediaId,
      commenterId: 'user-1',
      commenterUsername: 'user-renamed',
      commentText: '쿠폰 링크 주세요',
      instagramCreatedAt: '2026-06-06T00:01:00.000Z'
    });
    assert.equal(duplicateCommentEventId, commentEventId);

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

    softDeleteRule(db, ruleId);
    assert.equal(getRule(db, ruleId), null);
    assert.equal(listActiveRules(db).length, 0);
    assert.equal(listRules(db).length, 0);
  } finally {
    db.close();
  }
});
