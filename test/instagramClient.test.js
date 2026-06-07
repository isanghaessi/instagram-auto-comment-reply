import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstagramClient } from '../src/instagram/client.js';
import { InstagramApiError, isDeliverabilityError } from '../src/instagram/errors.js';

const config = {
  metaAppId: 'app-id',
  metaAppSecret: 'app-secret',
  metaRedirectUri: 'https://admin.example.com/auth/instagram/callback'
};

function okJson(body) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

function errorJson(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

function textResponse(status, body, contentType = 'text/plain') {
  return new Response(body, {
    status,
    headers: { 'Content-Type': contentType }
  });
}

function createRecordingFetch(response = okJson({ ok: true })) {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({ url: String(url), options });
    if (typeof response === 'function') {
      return response();
    }
    return response.clone();
  };
  fetchImpl.calls = calls;
  return fetchImpl;
}

test('buildAuthorizeUrl includes required scopes and state', () => {
  const client = createInstagramClient({ config, fetchImpl: createRecordingFetch() });

  const url = new URL(client.buildAuthorizeUrl('state-123'));

  assert.equal(url.origin, 'https://www.instagram.com');
  assert.equal(url.pathname, '/oauth/authorize');
  assert.equal(url.searchParams.get('client_id'), 'app-id');
  assert.equal(url.searchParams.get('redirect_uri'), config.metaRedirectUri);
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('state'), 'state-123');
  const scopes = url.searchParams.get('scope').split(',');
  assert.deepEqual(new Set(scopes), new Set([
    'instagram_business_basic',
    'instagram_business_manage_comments',
    'instagram_business_manage_messages',
    'instagram_manage_engagement'
  ]));
});

test('exchangeCodeForShortLivedToken posts form data to api.instagram.com', async () => {
  const fetchImpl = createRecordingFetch(okJson({ access_token: 'short-token', user_id: 'ig-user-1' }));
  const client = createInstagramClient({ config, fetchImpl });

  const result = await client.exchangeCodeForShortLivedToken('auth-code');

  assert.deepEqual(result, { accessToken: 'short-token', userId: 'ig-user-1' });
  assert.equal(fetchImpl.calls.length, 1);
  const [call] = fetchImpl.calls;
  const url = new URL(call.url);
  assert.equal(url.origin, 'https://api.instagram.com');
  assert.equal(url.pathname, '/oauth/access_token');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers['Content-Type'], 'application/x-www-form-urlencoded');
  assert.equal(call.options.body.get('client_id'), 'app-id');
  assert.equal(call.options.body.get('client_secret'), 'app-secret');
  assert.equal(call.options.body.get('grant_type'), 'authorization_code');
  assert.equal(call.options.body.get('redirect_uri'), config.metaRedirectUri);
  assert.equal(call.options.body.get('code'), 'auth-code');
});

test('token exchange and refresh methods call graph API with URLSearchParams', async () => {
  const fetchImpl = createRecordingFetch(okJson({ access_token: 'long-token', expires_in: 5183944 }));
  const client = createInstagramClient({ config, fetchImpl });

  assert.deepEqual(await client.exchangeForLongLivedToken('short-token'), {
    accessToken: 'long-token',
    expiresIn: 5183944
  });

  let url = new URL(fetchImpl.calls.at(-1).url);
  assert.equal(url.origin, 'https://graph.instagram.com');
  assert.equal(url.pathname, '/access_token');
  assert.equal(url.searchParams.get('grant_type'), 'ig_exchange_token');
  assert.equal(url.searchParams.get('client_secret'), 'app-secret');
  assert.equal(url.searchParams.get('access_token'), 'short-token');

  fetchImpl.calls.length = 0;
  assert.deepEqual(await client.refreshLongLivedToken('long-token'), {
    accessToken: 'long-token',
    expiresIn: 5183944
  });

  url = new URL(fetchImpl.calls[0].url);
  assert.equal(url.pathname, '/refresh_access_token');
  assert.equal(url.searchParams.get('grant_type'), 'ig_refresh_token');
  assert.equal(url.searchParams.get('access_token'), 'long-token');
});

test('read methods request graph fields and return data arrays with fallback', async () => {
  const responses = [
    okJson({ id: 'ig-user-1', username: 'creator', account_type: 'BUSINESS' }),
    okJson({ data: [{ id: 'media-1' }] }),
    okJson({}),
    okJson({ data: [{ id: 'comment-1' }] })
  ];
  const fetchImpl = async (url, options = {}) => {
    fetchImpl.calls.push({ url: String(url), options });
    return responses.shift();
  };
  fetchImpl.calls = [];
  const client = createInstagramClient({ config, fetchImpl });

  assert.deepEqual(await client.getAccount('token'), {
    id: 'ig-user-1',
    username: 'creator',
    account_type: 'BUSINESS'
  });
  assert.deepEqual(await client.listMedia('token'), [{ id: 'media-1' }]);
  assert.deepEqual(await client.listMedia('token'), []);
  assert.deepEqual(await client.listComments('token', 'media-1'), [{ id: 'comment-1' }]);

  const accountUrl = new URL(fetchImpl.calls[0].url);
  assert.equal(accountUrl.pathname, '/me');
  assert.equal(accountUrl.searchParams.get('access_token'), 'token');
  assert.equal(accountUrl.searchParams.get('fields'), 'id,username,account_type');

  const mediaUrl = new URL(fetchImpl.calls[1].url);
  assert.equal(mediaUrl.pathname, '/me/media');
  assert.equal(mediaUrl.searchParams.get('fields'), 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp');
  assert.equal(mediaUrl.searchParams.get('limit'), '50');

  const commentsUrl = new URL(fetchImpl.calls[3].url);
  assert.equal(commentsUrl.pathname, '/media-1/comments');
  assert.equal(commentsUrl.searchParams.get('fields'), 'id,text,username,from,timestamp,user_likes');
  assert.equal(commentsUrl.searchParams.get('limit'), '50');
});

test('listComments retries without connected-account like field when unsupported', async () => {
  const responses = [
    errorJson(400, {
      error: {
        message: 'Tried accessing nonexisting field (user_likes) on node type (IGComment)',
        code: 100
      }
    }),
    okJson({ data: [{ id: 'comment-1', text: 'hello' }] })
  ];
  const fetchImpl = async (url, options = {}) => {
    fetchImpl.calls.push({ url: String(url), options });
    return responses.shift();
  };
  fetchImpl.calls = [];
  const client = createInstagramClient({ config, fetchImpl });

  assert.deepEqual(await client.listComments('token', 'media-1'), [{ id: 'comment-1', text: 'hello' }]);

  assert.equal(fetchImpl.calls.length, 2);
  assert.equal(
    new URL(fetchImpl.calls[0].url).searchParams.get('fields'),
    'id,text,username,from,timestamp,user_likes'
  );
  assert.equal(
    new URL(fetchImpl.calls[1].url).searchParams.get('fields'),
    'id,text,username,from,timestamp'
  );
});

test('read methods follow bounded pagination for media and comments', async () => {
  const responses = [
    okJson({ data: [{ id: 'media-1' }], paging: { next: 'https://graph.instagram.com/me/media?after=cursor-1&access_token=token' } }),
    okJson({ data: [{ id: 'media-2' }] }),
    okJson({ data: [{ id: 'comment-1' }], paging: { next: 'https://graph.instagram.com/media-1/comments?after=cursor-2&access_token=token' } }),
    okJson({ data: [{ id: 'comment-2' }] })
  ];
  const fetchImpl = async (url, options = {}) => {
    fetchImpl.calls.push({ url: String(url), options });
    return responses.shift();
  };
  fetchImpl.calls = [];
  const client = createInstagramClient({ config, fetchImpl });

  assert.deepEqual(await client.listMedia('token'), [{ id: 'media-1' }, { id: 'media-2' }]);
  assert.deepEqual(await client.listComments('token', 'media-1'), [{ id: 'comment-1' }, { id: 'comment-2' }]);

  assert.equal(fetchImpl.calls.length, 4);
  assert.equal(new URL(fetchImpl.calls[1].url).searchParams.get('after'), 'cursor-1');
  assert.equal(new URL(fetchImpl.calls[3].url).searchParams.get('after'), 'cursor-2');
});

test('write methods post JSON bodies to graph API', async () => {
  const fetchImpl = createRecordingFetch(okJson({ id: 'ok-id' }));
  const client = createInstagramClient({ config, fetchImpl });

  assert.deepEqual(await client.sendPrivateReply('token', 'ig-user-1', 'comment-1', 'DM text'), { id: 'ok-id' });
  assert.deepEqual(await client.likeComment('token', 'ig-user-1', 'comment-1'), { id: 'ok-id' });
  assert.deepEqual(await client.replyToComment('token', 'comment-1', 'Reply text'), { id: 'ok-id' });

  let call = fetchImpl.calls[0];
  let url = new URL(call.url);
  assert.equal(url.pathname, '/ig-user-1/messages');
  assert.equal(url.searchParams.get('access_token'), 'token');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.options.body), {
    recipient: { comment_id: 'comment-1' },
    message: { text: 'DM text' }
  });

  call = fetchImpl.calls[1];
  url = new URL(call.url);
  assert.equal(url.origin, 'https://graph.instagram.com');
  assert.equal(url.pathname, '/ig-user-1/likes');
  assert.equal(call.options.method, 'POST');
  assert.equal(call.options.headers['Content-Type'], 'application/json');
  assert.deepEqual(JSON.parse(call.options.body), { comment_id: 'comment-1' });

  call = fetchImpl.calls[2];
  url = new URL(call.url);
  assert.equal(url.pathname, '/comment-1/replies');
  assert.deepEqual(JSON.parse(call.options.body), { message: 'Reply text' });
});

test('non-ok JSON responses throw InstagramApiError with status, body, code, and subcode', async () => {
  const fetchImpl = createRecordingFetch(errorJson(400, {
    error: {
      message: 'Cannot send message to this user',
      code: 10,
      error_subcode: 2534022
    }
  }));
  const client = createInstagramClient({ config, fetchImpl });

  await assert.rejects(
    () => client.sendPrivateReply('token', 'ig-user-1', 'comment-1', 'DM text'),
    (error) => {
      assert.equal(error instanceof InstagramApiError, true);
      assert.equal(error.message, 'Cannot send message to this user');
      assert.equal(error.status, 400);
      assert.equal(error.code, 10);
      assert.equal(error.errorSubcode, 2534022);
      assert.equal(error.body.error.message, 'Cannot send message to this user');
      return true;
    }
  );
});

async function assertApiErrorFromListMedia(response, expectedStatus = 500) {
  const fakeToken = 'fake-access-token-should-not-appear';
  const fetchImpl = createRecordingFetch(response);
  const client = createInstagramClient({ config, fetchImpl });

  await assert.rejects(
    () => client.listMedia(fakeToken),
    (error) => {
      assert.equal(error instanceof InstagramApiError, true);
      assert.equal(error.status, expectedStatus);
      assert.doesNotMatch(error.message, new RegExp(fakeToken));
      return true;
    }
  );
}

test('non-JSON 500 responses throw InstagramApiError without leaking access token', async () => {
  await assertApiErrorFromListMedia(textResponse(500, '<html>server failed</html>', 'text/html'));
});

test('malformed JSON 500 responses throw InstagramApiError without leaking access token', async () => {
  await assertApiErrorFromListMedia(textResponse(500, '{"error":', 'application/json'));
});

test('empty 500 responses throw InstagramApiError without leaking access token', async () => {
  await assertApiErrorFromListMedia(textResponse(500, '', 'application/json'));
});

test('malformed JSON 200 responses throw consistent InstagramApiError parse error type', async () => {
  const fetchImpl = createRecordingFetch(textResponse(200, '{"data":', 'application/json'));
  const client = createInstagramClient({ config, fetchImpl });

  await assert.rejects(
    () => client.listMedia('fake-access-token-should-not-appear'),
    (error) => {
      assert.equal(error instanceof InstagramApiError, true);
      assert.equal(error.status, 200);
      assert.match(error.message, /parse|json/i);
      assert.doesNotMatch(error.message, /fake-access-token-should-not-appear/);
      return true;
    }
  );
});

test('isDeliverabilityError is conservative', () => {
  assert.equal(isDeliverabilityError(new InstagramApiError('Cannot send message to this user', { status: 400 })), true);
  assert.equal(isDeliverabilityError(new InstagramApiError('Not allowed to message this user', { status: 400 })), true);
  assert.equal(isDeliverabilityError(new InstagramApiError('User is unavailable', { status: 400 })), true);
  assert.equal(isDeliverabilityError(new InstagramApiError('Recipient is unavailable', { status: 400 })), true);
  assert.equal(isDeliverabilityError(new InstagramApiError('This user blocked your account', { status: 400 })), true);
  assert.equal(isDeliverabilityError(new InstagramApiError('User cannot receive messages', { status: 400 })), true);

  assert.equal(isDeliverabilityError(new InstagramApiError('Invalid recipient id', { status: 400, code: 100 })), false);
  assert.equal(isDeliverabilityError(new InstagramApiError('Recipient field is required', { status: 400, code: 100 })), false);
  assert.equal(isDeliverabilityError(new InstagramApiError('Recipient validation failed', { status: 500 })), false);
  assert.equal(isDeliverabilityError(new InstagramApiError('Cannot send message to this user', { status: 500 })), false);
  assert.equal(isDeliverabilityError(new InstagramApiError('Invalid OAuth access token', { status: 400, code: 190 })), false);
  assert.equal(isDeliverabilityError(new InstagramApiError('Permission denied', { status: 403, code: 10 })), false);
  for (const code of [4, 17, 32, 613]) {
    assert.equal(isDeliverabilityError(new InstagramApiError('Rate limit or system error', { status: 429, code })), false);
  }
  assert.equal(isDeliverabilityError(new Error('Network failed')), false);
});
