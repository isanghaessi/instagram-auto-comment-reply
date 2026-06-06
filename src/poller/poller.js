import { getAccount } from '../repositories/accounts.js';
import { upsertCommentEvent } from '../repositories/comments.js';
import { createReplyLog, findReplyLog } from '../repositories/replyLogs.js';
import { listActiveRules } from '../repositories/rules.js';
import { isDeliverabilityError } from '../instagram/errors.js';
import { decryptText } from '../security/crypto.js';
import { matchesRule } from './matcher.js';

function groupRulesByMedia(rules) {
  const grouped = new Map();
  for (const rule of rules) {
    const instagramMediaId = rule.instagram_media_id;
    if (!grouped.has(instagramMediaId)) {
      grouped.set(instagramMediaId, []);
    }
    grouped.get(instagramMediaId).push(rule);
  }
  return grouped;
}

function normalizeComment(comment) {
  return {
    id: String(comment?.id ?? ''),
    text: String(comment?.text ?? ''),
    username: comment?.username ? String(comment.username) : null,
    fromId: comment?.from?.id ? String(comment.from.id) : null,
    timestamp: comment?.timestamp ? String(comment.timestamp) : null
  };
}

function errorMessage(error, token) {
  const message = error instanceof Error ? error.message : String(error);
  return token ? message.split(token).join('[redacted]') : message;
}

function minimalError(error, token) {
  return {
    message: errorMessage(error, token),
    status: error?.status ?? null,
    code: error?.code ?? null,
    errorSubcode: error?.errorSubcode ?? null
  };
}

function sanitizeValue(value, token) {
  if (value === undefined) {
    return undefined;
  }
  if (value === null || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'string') {
    return token ? value.split(token).join('[redacted]') : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, token));
  }
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !/access[_-]?token|client[_-]?secret/i.test(key))
        .map(([key, item]) => [key, sanitizeValue(item, token)])
    );
  }
  return String(value);
}

function jsonPayload(value, token) {
  return JSON.stringify(sanitizeValue(value, token));
}

function fallbackReplyId(response) {
  if (response?.id !== undefined && response?.id !== null) {
    return String(response.id);
  }
  return null;
}

function appendError(existingMessage, nextMessage) {
  if (!nextMessage) {
    return existingMessage;
  }
  return existingMessage ? `${existingMessage}; ${nextMessage}` : nextMessage;
}

async function processMatchedComment({ db, instagramClient, token, account, rule, comment }) {
  const commentEventId = upsertCommentEvent(db, {
    instagramCommentId: comment.id,
    mediaId: rule.media_id,
    commenterId: comment.fromId,
    commenterUsername: comment.username,
    commentText: comment.text,
    instagramCreatedAt: comment.timestamp
  });

  const requestPayload = {
    dm: {
      recipient: { comment_id: comment.id },
      message: { text: rule.reply_message }
    }
  };
  const responsePayload = {};
  let errorMessageForLog = null;

  let dmStatus = 'skipped';
  let commentLikeStatus = 'skipped';
  let fallbackReplyStatus = 'skipped';
  let fallbackReplyCommentId = null;

  try {
    responsePayload.dm = await instagramClient.sendPrivateReply(
      token,
      account.instagram_user_id,
      comment.id,
      rule.reply_message
    );
    dmStatus = 'sent';
  } catch (dmError) {
    dmStatus = 'failed';
    responsePayload.dm_error = minimalError(dmError, token);
    errorMessageForLog = appendError(errorMessageForLog, errorMessage(dmError, token));

    if (isDeliverabilityError(dmError)) {
      requestPayload.fallbackReply = { message: rule.dm_failure_reply_message };
      try {
        responsePayload.fallbackReply = await instagramClient.replyToComment(
          token,
          comment.id,
          rule.dm_failure_reply_message
        );
        fallbackReplyStatus = 'sent';
        fallbackReplyCommentId = fallbackReplyId(responsePayload.fallbackReply);
      } catch (fallbackError) {
        fallbackReplyStatus = 'failed';
        responsePayload.fallback_error = minimalError(fallbackError, token);
        errorMessageForLog = appendError(
          errorMessageForLog,
          `fallback failed: ${errorMessage(fallbackError, token)}`
        );
      }
    }
  }

  if (dmStatus === 'sent') {
    requestPayload.like = { comment_id: comment.id };
    try {
      responsePayload.like = await instagramClient.likeComment(
        token,
        account.instagram_user_id,
        comment.id
      );
      commentLikeStatus = 'sent';
    } catch (likeError) {
      commentLikeStatus = 'failed';
      responsePayload.like_error = minimalError(likeError, token);
      errorMessageForLog = appendError(
        errorMessageForLog,
        `like failed: ${errorMessage(likeError, token)}`
      );
    }
  }

  createReplyLog(db, {
    ruleId: rule.id,
    commentEventId,
    instagramCommentId: comment.id,
    dmStatus,
    commentLikeStatus,
    fallbackReplyStatus,
    fallbackReplyCommentId,
    requestPayloadJson: jsonPayload(requestPayload, token),
    responsePayloadJson: jsonPayload(responsePayload, token),
    errorMessage: errorMessageForLog
  });
}

export async function runPollingOnce({ db, instagramClient, encryptionKey }) {
  const account = getAccount(db);
  if (!account) {
    return { processed: 0 };
  }

  const token = decryptText(account.access_token_encrypted, encryptionKey);
  const rulesByMedia = groupRulesByMedia(listActiveRules(db));
  let processed = 0;

  for (const [instagramMediaId, rules] of rulesByMedia.entries()) {
    let comments;
    try {
      comments = await instagramClient.listComments(token, instagramMediaId);
    } catch (error) {
      console.error('Polling listComments failed', {
        instagramMediaId,
        error: errorMessage(error, token)
      });
      continue;
    }

    for (const rawComment of comments) {
      const comment = normalizeComment(rawComment);
      if (!comment.id) {
        continue;
      }

      for (const rule of rules) {
        if (!matchesRule(comment.text, rule)) {
          continue;
        }
        if (findReplyLog(db, rule.id, comment.id)) {
          continue;
        }

        try {
          await processMatchedComment({ db, instagramClient, token, account, rule, comment });
          processed += 1;
        } catch (error) {
          if (/UNIQUE constraint failed: reply_logs\.rule_id, reply_logs\.instagram_comment_id/.test(errorMessage(error, token))) {
            continue;
          }
          console.error('Polling comment action failed', {
            ruleId: rule.id,
            instagramCommentId: comment.id,
            error: errorMessage(error, token)
          });
        }
      }
    }
  }

  return { processed };
}

export function createPoller({ db, instagramClient, encryptionKey, intervalSeconds }) {
  let timer = null;
  let activeRun = false;

  async function tick() {
    if (activeRun) {
      return;
    }

    activeRun = true;
    try {
      await runPollingOnce({ db, instagramClient, encryptionKey });
    } catch (error) {
      console.error('Polling run failed', { error: errorMessage(error) });
    } finally {
      activeRun = false;
    }
  }

  return {
    start() {
      if (timer) {
        return;
      }
      timer = setInterval(tick, intervalSeconds * 1000);
      tick();
    },

    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },

    getStatus() {
      return {
        running: Boolean(timer),
        activeRun
      };
    }
  };
}
