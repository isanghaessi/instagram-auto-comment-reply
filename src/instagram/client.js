import { InstagramApiError } from './errors.js';

const AUTHORIZE_URL = 'https://www.instagram.com/oauth/authorize';
const API_BASE_URL = 'https://api.instagram.com';
const GRAPH_BASE_URL = 'https://graph.instagram.com';

const INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
  'instagram_manage_engagement'
];

const ACCOUNT_FIELDS = ['id', 'username', 'account_type'];
const MEDIA_FIELDS = ['id', 'caption', 'media_type', 'media_url', 'thumbnail_url', 'permalink', 'timestamp'];
const COMMENT_FIELDS = ['id', 'text', 'username', 'from', 'timestamp'];

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

async function parseJsonResponse(response) {
  const text = await response.text();
  if (text === '') {
    return null;
  }
  return JSON.parse(text);
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
  const body = await parseJsonResponse(response);

  if (!response.ok) {
    const { message, code, errorSubcode } = instagramErrorDetails(body);
    throw new InstagramApiError(message || `Instagram API request failed with status ${response.status}`, {
      status: response.status,
      body,
      code,
      errorSubcode
    });
  }

  return body;
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

export function createInstagramClient({ config, fetchImpl = fetch }) {
  return {
    buildAuthorizeUrl(state) {
      return appendSearchParams(new URL(AUTHORIZE_URL), {
        client_id: config.metaAppId,
        redirect_uri: config.metaRedirectUri,
        response_type: 'code',
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
      const response = await requestJson(fetchImpl, buildUrl(GRAPH_BASE_URL, '/me/media', {
        fields: MEDIA_FIELDS.join(','),
        access_token: accessToken
      }));
      return dataArray(response);
    },

    async listComments(accessToken, instagramMediaId) {
      const response = await requestJson(fetchImpl, buildUrl(GRAPH_BASE_URL, `/${pathSegment(instagramMediaId)}/comments`, {
        fields: COMMENT_FIELDS.join(','),
        access_token: accessToken
      }));
      return dataArray(response);
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
