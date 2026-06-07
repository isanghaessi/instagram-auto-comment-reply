import { InstagramApiError } from './errors.js';

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const API_BASE_URL = 'https://api.instagram.com';
const GRAPH_BASE_URL = 'https://graph.instagram.com';

const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages'
];

const ACCOUNT_FIELDS = ['user_id', 'username', 'account_type'];
const MEDIA_FIELDS = ['id', 'caption', 'media_type', 'media_url', 'thumbnail_url', 'permalink', 'timestamp'];
const COMMENT_FIELDS = ['id', 'text', 'username', 'from', 'timestamp'];
const COMMENT_FIELDS_WITH_VIEWER_LIKE = [...COMMENT_FIELDS, 'user_likes'];
const RAW_BODY_LIMIT = 1024;
const READ_PAGE_LIMIT = 50;
const MAX_READ_PAGES = 10;

function appendSearchParams(url, params) {
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function buildUrl(baseUrl, pathname, params = {}) {
  const url = new URL(pathname, baseUrl);
  return appendSearchParams(url, params);
}

function pathSegment(value) {
  return encodeURIComponent(String(value));
}

function truncateRawBody(rawBody) {
  if (typeof rawBody !== 'string') {
    return undefined;
  }
  if (rawBody.length <= RAW_BODY_LIMIT) {
    return rawBody;
  }
  return `${rawBody.slice(0, RAW_BODY_LIMIT)}…[truncated]`;
}

function sensitiveValuesFromUrl(url) {
  const parsedUrl = url instanceof URL ? url : new URL(String(url));
  return ['access_token', 'client_secret']
    .map((key) => parsedUrl.searchParams.get(key))
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function redactSensitiveValues(message, url) {
  let redacted = String(message || '');
  for (const value of sensitiveValuesFromUrl(url)) {
    redacted = redacted.split(value).join('[redacted]');
  }
  redacted = redacted.replace(/(access_token=)[^\s&]+/gi, '$1[redacted]');
  redacted = redacted.replace(/(client_secret=)[^\s&]+/gi, '$1[redacted]');
  return redacted;
}

async function parseJsonResponse(response) {
  const rawBody = await response.text();
  if (rawBody === '') {
    return { body: null, rawBody: '' };
  }

  try {
    return { body: JSON.parse(rawBody), rawBody };
  } catch (error) {
    return {
      body: null,
      rawBody: truncateRawBody(rawBody),
      parseError: error
    };
  }
}

function instagramErrorDetails(body) {
  const error = body?.error && typeof body.error === 'object' ? body.error : body;
  return {
    message: error?.message,
    code: error?.code,
    errorSubcode: error?.error_subcode ?? error?.errorSubcode
  };
}

async function requestJson(fetchImpl, url, options = {}) {
  const response = await fetchImpl(url, options);
  const parsed = await parseJsonResponse(response);

  if (parsed.parseError) {
    const rawBody = redactSensitiveValues(parsed.rawBody, url);
    throw new InstagramApiError(
      response.ok
        ? 'Instagram API response JSON parse error'
        : `Instagram API request failed with status ${response.status}`,
      {
        status: response.status,
        body: {
          rawBody,
          parseError: parsed.parseError.message
        },
        rawBody
      }
    );
  }

  if (!response.ok) {
    const { message, code, errorSubcode } = instagramErrorDetails(parsed.body);
    throw new InstagramApiError(
      message
        ? redactSensitiveValues(message, url)
        : `Instagram API request failed with status ${response.status}`,
      {
        status: response.status,
        body: parsed.body,
        code,
        errorSubcode
      }
    );
  }

  return parsed.body;
}

function formPost(fetchImpl, url, body) {
  return requestJson(fetchImpl, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
}

function jsonPost(fetchImpl, url, body) {
  return requestJson(fetchImpl, url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function dataArray(body) {
  return Array.isArray(body?.data) ? body.data : [];
}

async function requestPagedData(fetchImpl, firstUrl) {
  const items = [];
  let nextUrl = firstUrl;
  let pageCount = 0;

  while (nextUrl && pageCount < MAX_READ_PAGES) {
    const response = await requestJson(fetchImpl, nextUrl);
    items.push(...dataArray(response));
    const next = typeof response?.paging?.next === 'string' ? response.paging.next : null;
    nextUrl = next ? new URL(next) : null;
    pageCount += 1;
  }

  return items;
}

function isUnsupportedFieldError(error) {
  if (!(error instanceof InstagramApiError)) {
    return false;
  }
  if (error.status !== 400 || error.code !== 100) {
    return false;
  }

  const message = String(error.message || '');
  return /user_likes/i.test(message) || /(nonexisting|unsupported|unknown)\s+field/i.test(message);
}

export function createInstagramClient({ config, fetchImpl = fetch }) {
  return {
    buildAuthorizeUrl(state) {
      return appendSearchParams(new URL(AUTHORIZE_URL), {
        client_id: config.metaAppId,
        redirect_uri: config.metaRedirectUri,
        response_type: 'code',
        enable_fb_login: 0,
        force_authentication: 1,
        scope: INSTAGRAM_SCOPES.join(','),
        state
      }).toString();
    },

    async exchangeCodeForShortLivedToken(code) {
      const body = new URLSearchParams({
        client_id: config.metaAppId,
        client_secret: config.metaAppSecret,
        grant_type: 'authorization_code',
        redirect_uri: config.metaRedirectUri,
        code
      });
      const response = await formPost(fetchImpl, buildUrl(API_BASE_URL, '/oauth/access_token'), body);
      return {
        accessToken: response?.access_token,
        userId: response?.user_id
      };
    },

    async exchangeForLongLivedToken(shortLivedToken) {
      const response = await requestJson(fetchImpl, buildUrl(GRAPH_BASE_URL, '/access_token', {
        grant_type: 'ig_exchange_token',
        client_secret: config.metaAppSecret,
        access_token: shortLivedToken
      }));
      return {
        accessToken: response?.access_token,
        expiresIn: response?.expires_in
      };
    },

    async refreshLongLivedToken(accessToken) {
      const response = await requestJson(fetchImpl, buildUrl(GRAPH_BASE_URL, '/refresh_access_token', {
        grant_type: 'ig_refresh_token',
        access_token: accessToken
      }));
      return {
        accessToken: response?.access_token,
        expiresIn: response?.expires_in
      };
    },

    getAccount(accessToken) {
      return requestJson(fetchImpl, buildUrl(GRAPH_BASE_URL, '/me', {
        fields: ACCOUNT_FIELDS.join(','),
        access_token: accessToken
      }));
    },

    async listMedia(accessToken) {
      return requestPagedData(fetchImpl, buildUrl(GRAPH_BASE_URL, '/me/media', {
        fields: MEDIA_FIELDS.join(','),
        limit: READ_PAGE_LIMIT,
        access_token: accessToken
      }));
    },

    async listComments(accessToken, instagramMediaId) {
      const commentsUrlWithViewerLike = buildUrl(GRAPH_BASE_URL, `/${pathSegment(instagramMediaId)}/comments`, {
        fields: COMMENT_FIELDS_WITH_VIEWER_LIKE.join(','),
        limit: READ_PAGE_LIMIT,
        access_token: accessToken
      });

      try {
        return await requestPagedData(fetchImpl, commentsUrlWithViewerLike);
      } catch (error) {
        if (!isUnsupportedFieldError(error)) {
          throw error;
        }
        return requestPagedData(fetchImpl, buildUrl(GRAPH_BASE_URL, `/${pathSegment(instagramMediaId)}/comments`, {
          fields: COMMENT_FIELDS.join(','),
          limit: READ_PAGE_LIMIT,
          access_token: accessToken
        }));
      }
    },

    sendPrivateReply(accessToken, igUserId, commentId, message) {
      return jsonPost(fetchImpl, buildUrl(GRAPH_BASE_URL, `/${pathSegment(igUserId)}/messages`, {
        access_token: accessToken
      }), {
        recipient: { comment_id: commentId },
        message: { text: message }
      });
    },

    likeComment(accessToken, igUserId, commentId) {
      return jsonPost(fetchImpl, buildUrl(GRAPH_BASE_URL, `/${pathSegment(igUserId)}/likes`, {
        access_token: accessToken
      }), {
        comment_id: commentId
      });
    },

    replyToComment(accessToken, commentId, message) {
      return jsonPost(fetchImpl, buildUrl(GRAPH_BASE_URL, `/${pathSegment(commentId)}/replies`, {
        access_token: accessToken
      }), {
        message
      });
    }
  };
}
