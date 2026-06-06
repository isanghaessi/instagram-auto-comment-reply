import { getAccount, updateTokenRefresh } from '../repositories/accounts.js';
import { upsertCommentEvent } from '../repositories/comments.js';
import { claimReplyLog, updateReplyLog } from '../repositories/replyLogs.js';
import { listActiveRules } from '../repositories/rules.js';
import { isDeliverabilityError } from '../instagram/errors.js';
import { decryptText, encryptText } from '../security/crypto.js';
import { matchesRule } from './matcher.js';

const TOKEN_REFRESH_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

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

function tokenExpiresAt(expiresIn, nowMs) {
  const seconds = Number(expiresIn);
  if (!Number.isFinite(seconds) || seconds < 0) {
    return null;
  }
  return new Date(nowMs + (seconds * 1000)).toISOString();
}

function shouldRefreshToken(account, nowMs) {
  if (!account.token_expires_at) {
    return false;
  }
  const expiresAtMs = Date.parse(account.token_expires_at);
  if (!Number.isFinite(expiresAtMs)) {
    return false;
  }
  return expiresAtMs <= nowMs + TOKEN_REFRESH_WINDOW_MS;
}

async function accessTokenForPolling({ db, account, instagramClient, encryptionKey, nowMs }) {
  const currentToken = decryptText(account.access_token_encrypted, encryptionKey);
  if (!shouldRefreshToken(account, nowMs)) {
    return currentToken;
  }

  const refreshed = await instagramClient.refreshLongLivedToken(currentToken);
  const refreshedToken = refreshed?.accessToken;
  if (typeof refreshedToken !== 'string' || refreshedToken === '') {
    throw new Error('Instagram token refresh did not return an access token');
  }

  updateTokenRefresh(
    db,
    encryptText(refreshedToken, encryptionKey),
    tokenExpiresAt(refreshed?.expiresIn, nowMs)
  );
  return refreshedToken;
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

async function processClaimedComment({ db, instagramClient, token, account, rule, comment, commentEventId }) {
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

  const updated = updateReplyLog(db, {
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
  if (!updated) {
    throw new Error('Claimed reply log was not updated');
  }
}

export async function runPollingOnce({ db, instagramClient, encryptionKey, now = new Date() }) {
  const account = getAccount(db);
  if (!account) {
    return { processed: 0 };
  }

  const token = await accessTokenForPolling({
    db,
    account,
    instagramClient,
    encryptionKey,
    nowMs: now.getTime()
  });
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
        let commentEventId;
        try {
          commentEventId = upsertCommentEvent(db, {
            instagramCommentId: comment.id,
            mediaId: rule.media_id,
            commenterId: comment.fromId,
            commenterUsername: comment.username,
            commentText: comment.text,
            instagramCreatedAt: comment.timestamp
          });
          const claimed = claimReplyLog(db, {
            ruleId: rule.id,
            commentEventId,
            instagramCommentId: comment.id
          });
          if (!claimed) {
            continue;
          }
        } catch (error) {
          console.error('Polling reply log claim failed', {
            ruleId: rule.id,
            instagramCommentId: comment.id,
            error: errorMessage(error, token)
          });
          continue;
        }

        try {
          await processClaimedComment({ db, instagramClient, token, account, rule, comment, commentEventId });
          processed += 1;
        } catch (error) {
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
  let activeRunPromise = null;

  async function tick() {
    if (activeRun) {
      return;
    }

    activeRun = true;
    activeRunPromise = (async () => {
      try {
        await runPollingOnce({ db, instagramClient, encryptionKey });
      } catch (error) {
        console.error('Polling run failed', { error: errorMessage(error) });
      } finally {
        activeRun = false;
        activeRunPromise = null;
      }
    })();
    try {
      await activeRunPromise;
    } catch (error) {
      console.error('Polling run failed', { error: errorMessage(error) });
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

    async drain() {
      if (activeRunPromise) {
        await activeRunPromise;
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
