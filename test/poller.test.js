import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/testDb.js';
import { upsertAccount } from '../src/repositories/accounts.js';
import { upsertMedia } from '../src/repositories/media.js';
import { createRule } from '../src/repositories/rules.js';
import { upsertCommentEvent } from '../src/repositories/comments.js';
import { createReplyLog, findReplyLog } from '../src/repositories/replyLogs.js';
import { decryptText, encryptText } from '../src/security/crypto.js';
import { InstagramApiError } from '../src/instagram/errors.js';
import { createPoller, runPollingOnce } from '../src/poller/poller.js';

const encryptionKey = Buffer.alloc(32, 9);

function insertAccount(db, overrides = {}) {
  upsertAccount(db, {
    instagramUserId: 'ig-user-1',
    username: 'creator',
    accountType: 'BUSINESS',
    accessTokenEncrypted: encryptText(overrides.token ?? 'plain-token', encryptionKey),
    tokenExpiresAt: overrides.tokenExpiresAt ?? '2026-08-01T00:00:00.000Z'
  });
}

function insertMediaAndRule(db, overrides = {}) {
  const mediaId = upsertMedia(db, {
    instagramMediaId: overrides.instagramMediaId ?? 'media-1',
    caption: 'caption',
    mediaType: 'IMAGE',
    mediaUrl: 'https://cdn.example/media.jpg',
    thumbnailUrl: null,
    permalink: 'https://instagram.example/p/1',
    timestamp: '2026-06-06T00:00:00.000Z'
  });

  const ruleId = createRule(db, {
    mediaId,
    name: 'coupon',
    matchMode: 'contains_any',
    keywordText: overrides.keywordText ?? '쿠폰, link',
    replyMessage: overrides.replyMessage ?? 'DM reply',
    dmFailureReplyMessage: overrides.dmFailureReplyMessage ?? 'public fallback',
    isActive: true
  });

  return { mediaId, ruleId };
}

function createInstagramClient(overrides = {}) {
  const calls = [];
  return {
    calls,
    async listComments(token, mediaId) {
      calls.push(['listComments', token, mediaId]);
      return [{
        id: 'comment-1',
        text: '쿠폰 주세요',
        username: 'commenter',
        from: { id: 'commenter-id' },
        timestamp: '2026-06-06T00:01:00.000Z'
      }];
    },
    async sendPrivateReply(token, igUserId, commentId, message) {
      calls.push(['sendPrivateReply', token, igUserId, commentId, message]);
      return { id: 'dm-1' };
    },
    async likeComment(token, igUserId, commentId) {
      calls.push(['likeComment', token, igUserId, commentId]);
      return { success: true };
    },
    async replyToComment(token, commentId, message) {
      calls.push(['replyToComment', token, commentId, message]);
      return { id: 'fallback-comment-1' };
    },
    async refreshLongLivedToken(token) {
      calls.push(['refreshLongLivedToken', token]);
      return { accessToken: 'refreshed-token', expiresIn: 60 * 24 * 60 * 60 };
    },
    ...overrides
  };
}

function callNames(instagramClient) {
  return instagramClient.calls.map((call) => call[0]);
}

test('runPollingOnce sends DM, likes original comment, and skips fallback on DM success', async () => {
  const { db } = createTestDb();
  try {
    insertAccount(db);
    const { ruleId } = insertMediaAndRule(db);
    const instagramClient = createInstagramClient();

    const result = await runPollingOnce({ db, instagramClient, encryptionKey });

    assert.deepEqual(result, { processed: 1 });
    assert.deepEqual(callNames(instagramClient), ['listComments', 'sendPrivateReply', 'likeComment']);
    assert.deepEqual(instagramClient.calls[0], ['listComments', 'plain-token', 'media-1']);

    const log = findReplyLog(db, ruleId, 'comment-1');
    assert.equal(log.dm_status, 'sent');
    assert.equal(log.comment_like_status, 'sent');
    assert.equal(log.fallback_reply_status, 'skipped');
    assert.equal(log.fallback_reply_comment_id, null);
    assert.equal(log.error_message, null);
    assert.doesNotMatch(log.request_payload_json, /plain-token/);
    assert.doesNotMatch(log.response_payload_json, /plain-token/);
  } finally {
    db.close();
  }
});


test('runPollingOnce keeps DM sent when like fails and does not fallback', async () => {
  const { db } = createTestDb();
  try {
    insertAccount(db);
    const { ruleId } = insertMediaAndRule(db);
    const instagramClient = createInstagramClient({
      async likeComment(token, igUserId, commentId) {
        this.calls.push(['likeComment', token, igUserId, commentId]);
        throw new Error('like provider failed');
      }
    });

    const result = await runPollingOnce({ db, instagramClient, encryptionKey });

    assert.deepEqual(result, { processed: 1 });
    assert.deepEqual(callNames(instagramClient), ['listComments', 'sendPrivateReply', 'likeComment']);

    const log = findReplyLog(db, ruleId, 'comment-1');
    assert.equal(log.dm_status, 'sent');
    assert.equal(log.comment_like_status, 'failed');
    assert.equal(log.fallback_reply_status, 'skipped');
    assert.match(log.error_message, /like failed: like provider failed/);
  } finally {
    db.close();
  }
});

test('runPollingOnce falls back publicly on DM deliverability failure and skips like', async () => {
  const { db } = createTestDb();
  try {
    insertAccount(db);
    const { ruleId } = insertMediaAndRule(db);
    const instagramClient = createInstagramClient({
      async sendPrivateReply(token, igUserId, commentId, message) {
        this.calls.push(['sendPrivateReply', token, igUserId, commentId, message]);
        throw new InstagramApiError('Cannot send message to this user', { status: 400 });
      }
    });

    const result = await runPollingOnce({ db, instagramClient, encryptionKey });

    assert.deepEqual(result, { processed: 1 });
    assert.deepEqual(callNames(instagramClient), ['listComments', 'sendPrivateReply', 'replyToComment']);
    assert.deepEqual(instagramClient.calls.at(-1), ['replyToComment', 'plain-token', 'comment-1', 'public fallback']);

    const log = findReplyLog(db, ruleId, 'comment-1');
    assert.equal(log.dm_status, 'failed');
    assert.equal(log.comment_like_status, 'skipped');
    assert.equal(log.fallback_reply_status, 'sent');
    assert.equal(log.fallback_reply_comment_id, 'fallback-comment-1');
    assert.match(log.error_message, /Cannot send message to this user/);
  } finally {
    db.close();
  }
});

test('runPollingOnce does not fallback on system DM failure', async () => {
  const { db } = createTestDb();
  try {
    insertAccount(db);
    const { ruleId } = insertMediaAndRule(db);
    const instagramClient = createInstagramClient({
      async sendPrivateReply(token, igUserId, commentId, message) {
        this.calls.push(['sendPrivateReply', token, igUserId, commentId, message]);
        throw new InstagramApiError('Instagram API request failed with status 500', { status: 500 });
      }
    });

    const result = await runPollingOnce({ db, instagramClient, encryptionKey });

    assert.deepEqual(result, { processed: 1 });
    assert.deepEqual(callNames(instagramClient), ['listComments', 'sendPrivateReply']);

    const log = findReplyLog(db, ruleId, 'comment-1');
    assert.equal(log.dm_status, 'failed');
    assert.equal(log.comment_like_status, 'skipped');
    assert.equal(log.fallback_reply_status, 'skipped');
    assert.match(log.error_message, /status 500/);
  } finally {
    db.close();
  }
});

test('concurrent runs claim reply log before sending one DM', async () => {
  const { db } = createTestDb();
  try {
    insertAccount(db);
    const { ruleId } = insertMediaAndRule(db);
    let sendPrivateReplyCount = 0;
    const instagramClient = createInstagramClient({
      async sendPrivateReply(token, igUserId, commentId, message) {
        const claimedLog = findReplyLog(db, ruleId, commentId);
        assert.equal(claimedLog.dm_status, 'skipped');
        assert.equal(claimedLog.sent_at, null);
        sendPrivateReplyCount += 1;
        this.calls.push(['sendPrivateReply', token, igUserId, commentId, message]);
        await new Promise((resolve) => setImmediate(resolve));
        return { id: 'dm-1' };
      }
    });

    const results = await Promise.all([
      runPollingOnce({ db, instagramClient, encryptionKey }),
      runPollingOnce({ db, instagramClient, encryptionKey })
    ]);

    assert.equal(sendPrivateReplyCount, 1);
    assert.deepEqual(results.map((result) => result.processed).sort(), [0, 1]);
    assert.equal(db.prepare('SELECT COUNT(*) AS count FROM reply_logs').get().count, 1);

    const log = findReplyLog(db, ruleId, 'comment-1');
    assert.equal(log.dm_status, 'sent');
    assert.equal(log.comment_like_status, 'sent');
    assert.equal(log.fallback_reply_status, 'skipped');
    assert.equal(log.sent_at !== null, true);
    assert.doesNotMatch(log.request_payload_json, /plain-token/);
    assert.doesNotMatch(log.response_payload_json, /plain-token/);
  } finally {
    db.close();
  }
});

test('runPollingOnce skips duplicate reply logs', async () => {
  const { db } = createTestDb();
  try {
    insertAccount(db);
    const { mediaId, ruleId } = insertMediaAndRule(db);
    const commentEventId = upsertCommentEvent(db, {
      instagramCommentId: 'comment-1',
      mediaId,
      commenterId: 'commenter-id',
      commenterUsername: 'commenter',
      commentText: '쿠폰 주세요',
      instagramCreatedAt: '2026-06-06T00:01:00.000Z'
    });
    createReplyLog(db, {
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
    });
    const instagramClient = createInstagramClient();

    const result = await runPollingOnce({ db, instagramClient, encryptionKey });

    assert.deepEqual(result, { processed: 0 });
    assert.deepEqual(callNames(instagramClient), ['listComments']);
  } finally {
    db.close();
  }
});

test('runPollingOnce refreshes long-lived token near expiry before reading comments', async () => {
  const { db } = createTestDb();
  try {
    insertAccount(db, {
      token: 'expiring-token',
      tokenExpiresAt: '2026-06-07T00:00:00.000Z'
    });
    insertMediaAndRule(db);
    const instagramClient = createInstagramClient();

    const result = await runPollingOnce({
      db,
      instagramClient,
      encryptionKey,
      now: new Date('2026-06-06T00:00:00.000Z')
    });

    assert.deepEqual(result, { processed: 1 });
    assert.deepEqual(callNames(instagramClient), ['refreshLongLivedToken', 'listComments', 'sendPrivateReply', 'likeComment']);
    assert.deepEqual(instagramClient.calls[0], ['refreshLongLivedToken', 'expiring-token']);
    assert.deepEqual(instagramClient.calls[1], ['listComments', 'refreshed-token', 'media-1']);

    const account = db.prepare('SELECT * FROM accounts WHERE id = 1').get();
    assert.equal(decryptText(account.access_token_encrypted, encryptionKey), 'refreshed-token');
    assert.equal(account.token_expires_at, '2026-08-05T00:00:00.000Z');
    assert.notEqual(account.token_last_refreshed_at, null);
  } finally {
    db.close();
  }
});

test('runPollingOnce returns processed 0 when no account exists', async () => {
  const { db } = createTestDb();
  try {
    insertMediaAndRule(db);
    const instagramClient = createInstagramClient();

    const result = await runPollingOnce({ db, instagramClient, encryptionKey });

    assert.deepEqual(result, { processed: 0 });
    assert.deepEqual(instagramClient.calls, []);
  } finally {
    db.close();
  }
});

test('createPoller starts one immediate run, reports active run, and stops interval', async () => {
  const { db } = createTestDb();
  try {
    let resolveRun;
    let runCount = 0;
    const poller = createPoller({
      db,
      instagramClient: createInstagramClient({
        async listComments() {
          runCount += 1;
          await new Promise((resolve) => { resolveRun = resolve; });
          return [];
        }
      }),
      encryptionKey,
      intervalSeconds: 60
    });

    insertAccount(db);
    insertMediaAndRule(db);
    poller.start();
    await new Promise((resolve) => setImmediate(resolve));

    assert.deepEqual(poller.getStatus(), { running: true, activeRun: true });
    assert.equal(runCount, 1);

    let drained = false;
    const drainPromise = poller.drain().then(() => {
      drained = true;
    });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(drained, false);

    resolveRun();
    await drainPromise;
    poller.stop();

    assert.deepEqual(poller.getStatus(), { running: false, activeRun: false });
  } finally {
    db.close();
  }
});
