# Instagram 댓글 자동 DM 응답 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** OAuth로 Instagram Creator/Business 계정 1개를 연결하고, 게시물별 댓글 조건에 맞춰 Private Reply를 보내며, 성공 시 댓글 좋아요와 실패 시 fallback 대댓글을 수행하는 self-hosted Node.js MVP를 만든다.

**Architecture:** Express 단일 프로세스 서버가 관리자 UI, Instagram OAuth callback, SQLite repository, Instagram API client, 60초 polling worker를 함께 제공한다. SQLite는 파일 DB로 사용하며 서버 시작 시 migration을 실행한다. Instagram API 호출은 `src/instagram/client.js`로 격리하고, polling 정책은 `src/poller/poller.js`에서 repository와 client를 주입받아 테스트 가능하게 만든다.

**Tech Stack:** Node.js 22+, Express 5, better-sqlite3, dotenv, cookie-parser, node:test, assert, built-in fetch, built-in crypto.

---

## Scope Check

이 계획은 하나의 MVP를 만든다. 독립된 하위 제품으로 분리하지 않는다. OAuth, 관리자 UI, 룰 CRUD, polling, DM/좋아요/fallback 대댓글, 로그 UI가 하나의 실행 가능한 서버에서 동작해야 하므로 같은 계획에서 다룬다.

## Planned File Structure

- Create: `package.json` — npm scripts, runtime dependencies, test command.
- Create: `.env.example` — 배포자가 채워야 하는 환경변수 예시.
- Create: `README.md` — 실행, Meta 설정, 배포 전제, 검증 절차.
- Create: `src/server.js` — Express app 생성, middleware, routes 연결.
- Create: `src/index.js` — config/db/app/poller를 조립하고 서버 시작.
- Create: `src/config.js` — 환경변수 로딩 및 검증.
- Create: `src/security/crypto.js` — access token 암복호화.
- Create: `src/security/auth.js` — 관리자 password cookie 인증 middleware.
- Create: `src/db/database.js` — SQLite 연결, WAL 설정, migration 실행.
- Create: `src/db/schema.sql` — accounts, oauth_states, media, automation_rules, comment_events, reply_logs schema.
- Create: `src/repositories/accounts.js` — 계정 저장/조회/token 갱신 시각 저장.
- Create: `src/repositories/oauthStates.js` — OAuth state 생성/소비.
- Create: `src/repositories/media.js` — media upsert/list.
- Create: `src/repositories/rules.js` — 룰 CRUD, pause/resume, soft delete.
- Create: `src/repositories/comments.js` — comment_events 저장/조회.
- Create: `src/repositories/replyLogs.js` — reply action 상태 저장 및 중복 확인.
- Create: `src/instagram/client.js` — OAuth token 교환, long-lived token 교환/refresh, account/media/comment/DM/like/reply API 호출.
- Create: `src/instagram/errors.js` — Meta API error 분류, deliverability 실패 판정.
- Create: `src/routes/authRoutes.js` — 관리자 로그인/로그아웃.
- Create: `src/routes/instagramAuthRoutes.js` — Instagram OAuth 시작/callback.
- Create: `src/routes/dashboardRoutes.js` — dashboard, 계정 상태, media sync.
- Create: `src/routes/ruleRoutes.js` — 룰 생성/수정/일시중지/재개/삭제.
- Create: `src/routes/logRoutes.js` — reply 로그 조회.
- Create: `src/views/html.js` — HTML layout, escaping, form helpers.
- Create: `src/poller/matcher.js` — 댓글 keyword matching.
- Create: `src/poller/poller.js` — polling runOnce와 start/stop.
- Create: `test/helpers/testDb.js` — 임시 SQLite DB 생성 helper.
- Create: `test/config.test.js` — config 검증 테스트.
- Create: `test/crypto.test.js` — token 암복호화 테스트.
- Create: `test/db.test.js` — migration/schema 테스트.
- Create: `test/auth.test.js` — 관리자 인증 middleware 테스트.
- Create: `test/matcher.test.js` — keyword matching 테스트.
- Create: `test/instagramClient.test.js` — fetch mock 기반 Instagram client 테스트.
- Create: `test/poller.test.js` — DM 성공/실패 액션 정책 테스트.
- Create: `test/routes.test.js` — 주요 UI route smoke 테스트.

---

## Task 1: Project Scaffold and Scripts

**Files:**
- Create: `package.json`
- Create: `.env.example`
- Create: `README.md`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "instagram-auto-comment-reply",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "start": "node src/index.js",
    "dev": "node --watch src/index.js",
    "test": "node --test",
    "test:unit": "node --test test/*.test.js"
  },
  "dependencies": {
    "better-sqlite3": "^11.10.0",
    "cookie-parser": "^1.4.7",
    "dotenv": "^16.5.0",
    "express": "^5.1.0"
  }
}
```

- [ ] **Step 2: Create `.env.example`**

```env
PORT=3000
DATABASE_PATH=./data/app.db
PUBLIC_BASE_URL=https://your-domain.example.com
META_APP_ID=1234567890
META_APP_SECRET=replace-with-meta-app-secret
META_REDIRECT_URI=https://your-domain.example.com/auth/instagram/callback
ENCRYPTION_KEY=replace-with-32-byte-base64-key
ADMIN_PASSWORD=replace-with-strong-password
POLLING_INTERVAL_SECONDS=60
```

- [ ] **Step 3: Create initial `README.md`**

```markdown
# Instagram 댓글 자동 DM 응답

Self-hosted Node.js MVP for Instagram comment-to-DM automation.

## Requirements

- Node.js 22+
- HTTPS domain pointing to this server
- Instagram Creator or Business account
- Meta Developer App with Instagram API with Instagram Login

## Environment

Copy `.env.example` to `.env` and fill all values.

Generate `ENCRYPTION_KEY`:

```bash
openssl rand -base64 32
```

## Run

```bash
npm install
npm start
```

Open:

```txt
https://your-domain.example.com
```

## Instagram OAuth Redirect URI

Set this exact value in Meta App Dashboard:

```txt
https://your-domain.example.com/auth/instagram/callback
```

## Notes

- This MVP does not use Instagram Webhooks.
- Comments are checked by polling every 60 seconds by default.
- Rule deletion uses soft delete.
```

- [ ] **Step 4: Install dependencies**

Run:

```bash
npm install
```

Expected: `package-lock.json` is created and install exits with code `0`.

- [ ] **Step 5: Commit scaffold**

```bash
git add package.json package-lock.json .env.example README.md
git commit -m "chore: scaffold Node project"
```

---

## Task 2: Configuration and Token Encryption

**Files:**
- Create: `src/config.js`
- Create: `src/security/crypto.js`
- Create: `test/config.test.js`
- Create: `test/crypto.test.js`

- [ ] **Step 1: Write config tests**

Create `test/config.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

test('loadConfig returns parsed values with defaults', () => {
  const config = loadConfig({
    DATABASE_PATH: './tmp/app.db',
    PUBLIC_BASE_URL: 'https://example.com',
    META_APP_ID: 'app-id',
    META_APP_SECRET: 'secret',
    META_REDIRECT_URI: 'https://example.com/auth/instagram/callback',
    ENCRYPTION_KEY: Buffer.alloc(32, 1).toString('base64'),
    ADMIN_PASSWORD: 'pass1234'
  });

  assert.equal(config.port, 3000);
  assert.equal(config.databasePath, './tmp/app.db');
  assert.equal(config.publicBaseUrl, 'https://example.com');
  assert.equal(config.pollingIntervalSeconds, 60);
});

test('loadConfig rejects missing required values', () => {
  assert.throws(() => loadConfig({}), /DATABASE_PATH/);
});

test('loadConfig rejects invalid encryption key', () => {
  assert.throws(() => loadConfig({
    DATABASE_PATH: './tmp/app.db',
    PUBLIC_BASE_URL: 'https://example.com',
    META_APP_ID: 'app-id',
    META_APP_SECRET: 'secret',
    META_REDIRECT_URI: 'https://example.com/auth/instagram/callback',
    ENCRYPTION_KEY: 'short',
    ADMIN_PASSWORD: 'pass1234'
  }), /ENCRYPTION_KEY/);
});
```

- [ ] **Step 2: Write failing crypto tests**

Create `test/crypto.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { encryptText, decryptText } from '../src/security/crypto.js';

const key = Buffer.alloc(32, 7);

test('encryptText and decryptText round-trip a token', () => {
  const encrypted = encryptText('secret-token', key);
  assert.notEqual(encrypted, 'secret-token');
  assert.equal(decryptText(encrypted, key), 'secret-token');
});

test('decryptText rejects malformed ciphertext', () => {
  assert.throws(() => decryptText('not-json', key), /Invalid encrypted value/);
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm test
```

Expected: tests fail because `src/config.js` and `src/security/crypto.js` do not exist.

- [ ] **Step 4: Implement `src/config.js`**

```js
import 'dotenv/config';

function required(env, key) {
  const value = env[key];
  if (!value || String(value).trim() === '') {
    throw new Error(`Missing required environment variable: ${key}`);
  }
  return String(value).trim();
}

function parseInteger(value, fallback, name) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid integer environment variable: ${name}`);
  }
  return parsed;
}

function parseEncryptionKey(value) {
  const key = Buffer.from(value, 'base64');
  if (key.length !== 32) {
    throw new Error('ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

export function loadConfig(env = process.env) {
  const encryptionKeyRaw = required(env, 'ENCRYPTION_KEY');
  return {
    port: parseInteger(env.PORT, 3000, 'PORT'),
    databasePath: required(env, 'DATABASE_PATH'),
    publicBaseUrl: required(env, 'PUBLIC_BASE_URL').replace(/\/$/, ''),
    metaAppId: required(env, 'META_APP_ID'),
    metaAppSecret: required(env, 'META_APP_SECRET'),
    metaRedirectUri: required(env, 'META_REDIRECT_URI'),
    encryptionKey: parseEncryptionKey(encryptionKeyRaw),
    adminPassword: required(env, 'ADMIN_PASSWORD'),
    pollingIntervalSeconds: parseInteger(env.POLLING_INTERVAL_SECONDS, 60, 'POLLING_INTERVAL_SECONDS')
  };
}
```

- [ ] **Step 5: Implement `src/security/crypto.js`**

```js
import crypto from 'node:crypto';

export function encryptText(plainText, key) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(String(plainText), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return JSON.stringify({
    v: 1,
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    data: encrypted.toString('base64')
  });
}

export function decryptText(encryptedValue, key) {
  try {
    const parsed = JSON.parse(encryptedValue);
    if (parsed.v !== 1 || !parsed.iv || !parsed.tag || !parsed.data) {
      throw new Error('Invalid encrypted value');
    }
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(parsed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(parsed.tag, 'base64'));
    return Buffer.concat([
      decipher.update(Buffer.from(parsed.data, 'base64')),
      decipher.final()
    ]).toString('utf8');
  } catch (error) {
    throw new Error('Invalid encrypted value', { cause: error });
  }
}
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test
```

Expected: `config.test.js` and `crypto.test.js` pass.

- [ ] **Step 7: Commit config and crypto**

```bash
git add src/config.js src/security/crypto.js test/config.test.js test/crypto.test.js
git commit -m "feat: add config and token encryption"
```

---

## Task 3: SQLite Schema and Repositories

**Files:**
- Create: `src/db/schema.sql`
- Create: `src/db/database.js`
- Create: `src/repositories/accounts.js`
- Create: `src/repositories/oauthStates.js`
- Create: `src/repositories/media.js`
- Create: `src/repositories/rules.js`
- Create: `src/repositories/comments.js`
- Create: `src/repositories/replyLogs.js`
- Create: `test/helpers/testDb.js`
- Create: `test/db.test.js`

- [ ] **Step 1: Write DB tests**

Create `test/helpers/testDb.js`:

```js
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import { openDatabase } from '../../src/db/database.js';

export function createTestDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ig-auto-reply-'));
  const dbPath = path.join(dir, 'test.db');
  const db = openDatabase(dbPath);
  return { db, dbPath, dir };
}
```

Create `test/db.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/testDb.js';
import { upsertAccount, getAccount } from '../src/repositories/accounts.js';
import { createOAuthState, consumeOAuthState } from '../src/repositories/oauthStates.js';
import { upsertMedia, listMedia } from '../src/repositories/media.js';
import { createRule, listActiveRules, softDeleteRule } from '../src/repositories/rules.js';
import { upsertCommentEvent } from '../src/repositories/comments.js';
import { createReplyLog, findReplyLog } from '../src/repositories/replyLogs.js';

test('database schema supports account, media, rule, comment, reply log flow', () => {
  const { db } = createTestDb();

  upsertAccount(db, {
    instagramUserId: 'ig-1', username: 'creator', accountType: 'CREATOR',
    accessTokenEncrypted: 'encrypted', tokenExpiresAt: '2026-08-01T00:00:00.000Z'
  });
  assert.equal(getAccount(db).username, 'creator');

  const state = createOAuthState(db);
  assert.equal(consumeOAuthState(db, state), true);
  assert.equal(consumeOAuthState(db, state), false);

  const mediaId = upsertMedia(db, {
    instagramMediaId: 'media-1', caption: 'caption', mediaType: 'IMAGE',
    mediaUrl: '', thumbnailUrl: '', permalink: 'https://instagram.com/p/x', timestamp: '2026-06-06T00:00:00.000Z'
  });
  assert.equal(listMedia(db).length, 1);

  const ruleId = createRule(db, {
    mediaId, name: 'coupon', matchMode: 'contains_any', keywordText: '쿠폰, 링크',
    replyMessage: 'DM입니다', dmFailureReplyMessage: 'DM 불가 안내', isActive: true
  });
  assert.equal(listActiveRules(db).length, 1);

  const commentEventId = upsertCommentEvent(db, {
    instagramCommentId: 'comment-1', mediaId, commenterId: 'user-1', commenterUsername: 'user',
    commentText: '쿠폰 주세요', instagramCreatedAt: '2026-06-06T00:01:00.000Z'
  });

  createReplyLog(db, {
    ruleId, commentEventId, instagramCommentId: 'comment-1', dmStatus: 'sent',
    commentLikeStatus: 'sent', fallbackReplyStatus: 'skipped', fallbackReplyCommentId: null,
    requestPayloadJson: '{}', responsePayloadJson: '{}', errorMessage: null
  });
  assert.equal(findReplyLog(db, ruleId, 'comment-1').dm_status, 'sent');

  softDeleteRule(db, ruleId);
  assert.equal(listActiveRules(db).length, 0);
});
```

- [ ] **Step 2: Run DB tests to verify failure**

Run:

```bash
npm test
```

Expected: tests fail because DB modules do not exist.

- [ ] **Step 3: Create `src/db/schema.sql`**

```sql
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  instagram_user_id TEXT NOT NULL,
  username TEXT NOT NULL,
  account_type TEXT,
  access_token_encrypted TEXT NOT NULL,
  token_expires_at TEXT,
  token_last_refreshed_at TEXT,
  token_last_verified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS oauth_states (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  state TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  consumed_at TEXT
);

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instagram_media_id TEXT NOT NULL UNIQUE,
  caption TEXT,
  media_type TEXT,
  media_url TEXT,
  thumbnail_url TEXT,
  permalink TEXT,
  timestamp TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS automation_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  media_id INTEGER NOT NULL REFERENCES media(id),
  name TEXT NOT NULL,
  match_mode TEXT NOT NULL DEFAULT 'contains_any',
  keyword_text TEXT NOT NULL,
  reply_message TEXT NOT NULL,
  dm_failure_reply_message TEXT NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1,
  deleted_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS comment_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  instagram_comment_id TEXT NOT NULL UNIQUE,
  media_id INTEGER NOT NULL REFERENCES media(id),
  commenter_id TEXT,
  commenter_username TEXT,
  comment_text TEXT NOT NULL,
  instagram_created_at TEXT,
  received_at TEXT NOT NULL DEFAULT (datetime('now')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS reply_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rule_id INTEGER NOT NULL REFERENCES automation_rules(id),
  comment_event_id INTEGER NOT NULL REFERENCES comment_events(id),
  instagram_comment_id TEXT NOT NULL,
  dm_status TEXT NOT NULL,
  comment_like_status TEXT NOT NULL,
  fallback_reply_status TEXT NOT NULL,
  fallback_reply_comment_id TEXT,
  request_payload_json TEXT NOT NULL,
  response_payload_json TEXT NOT NULL,
  error_message TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(rule_id, instagram_comment_id)
);

CREATE INDEX IF NOT EXISTS idx_media_instagram_media_id ON media(instagram_media_id);
CREATE INDEX IF NOT EXISTS idx_rules_media_active ON automation_rules(media_id, is_active, deleted_at);
CREATE INDEX IF NOT EXISTS idx_reply_logs_rule_comment ON reply_logs(rule_id, instagram_comment_id);
```

- [ ] **Step 4: Implement `src/db/database.js`**

```js
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, 'schema.sql');

export function openDatabase(databasePath) {
  fs.mkdirSync(path.dirname(databasePath), { recursive: true });
  const db = new Database(databasePath);
  db.pragma('foreign_keys = ON');
  db.pragma('journal_mode = WAL');
  const schema = fs.readFileSync(schemaPath, 'utf8');
  db.exec(schema);
  return db;
}
```

- [ ] **Step 5: Implement repositories**

Create `src/repositories/accounts.js`:

```js
export function upsertAccount(db, account) {
  db.prepare(`
    INSERT INTO accounts (id, instagram_user_id, username, account_type, access_token_encrypted, token_expires_at, token_last_verified_at, updated_at)
    VALUES (1, @instagramUserId, @username, @accountType, @accessTokenEncrypted, @tokenExpiresAt, datetime('now'), datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      instagram_user_id = excluded.instagram_user_id,
      username = excluded.username,
      account_type = excluded.account_type,
      access_token_encrypted = excluded.access_token_encrypted,
      token_expires_at = excluded.token_expires_at,
      token_last_verified_at = datetime('now'),
      updated_at = datetime('now')
  `).run(account);
}

export function getAccount(db) {
  return db.prepare('SELECT * FROM accounts WHERE id = 1').get() || null;
}

export function updateTokenRefresh(db, accessTokenEncrypted, tokenExpiresAt) {
  db.prepare(`
    UPDATE accounts
    SET access_token_encrypted = ?, token_expires_at = ?, token_last_refreshed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = 1
  `).run(accessTokenEncrypted, tokenExpiresAt);
}
```

Create `src/repositories/oauthStates.js`:

```js
import crypto from 'node:crypto';

export function createOAuthState(db) {
  const state = crypto.randomBytes(24).toString('hex');
  db.prepare('INSERT INTO oauth_states (state) VALUES (?)').run(state);
  return state;
}

export function consumeOAuthState(db, state) {
  const result = db.prepare(`
    UPDATE oauth_states
    SET consumed_at = datetime('now')
    WHERE state = ? AND consumed_at IS NULL
  `).run(state);
  return result.changes === 1;
}
```

Create `src/repositories/media.js`:

```js
export function upsertMedia(db, media) {
  const result = db.prepare(`
    INSERT INTO media (instagram_media_id, caption, media_type, media_url, thumbnail_url, permalink, timestamp, updated_at)
    VALUES (@instagramMediaId, @caption, @mediaType, @mediaUrl, @thumbnailUrl, @permalink, @timestamp, datetime('now'))
    ON CONFLICT(instagram_media_id) DO UPDATE SET
      caption = excluded.caption,
      media_type = excluded.media_type,
      media_url = excluded.media_url,
      thumbnail_url = excluded.thumbnail_url,
      permalink = excluded.permalink,
      timestamp = excluded.timestamp,
      updated_at = datetime('now')
  `).run(media);
  if (result.lastInsertRowid) return Number(result.lastInsertRowid);
  return db.prepare('SELECT id FROM media WHERE instagram_media_id = ?').get(media.instagramMediaId).id;
}

export function listMedia(db) {
  return db.prepare('SELECT * FROM media ORDER BY timestamp DESC, id DESC').all();
}
```

Create `src/repositories/rules.js`:

```js
export function createRule(db, rule) {
  const result = db.prepare(`
    INSERT INTO automation_rules (media_id, name, match_mode, keyword_text, reply_message, dm_failure_reply_message, is_active)
    VALUES (@mediaId, @name, @matchMode, @keywordText, @replyMessage, @dmFailureReplyMessage, @isActive)
  `).run({ ...rule, isActive: rule.isActive ? 1 : 0 });
  return Number(result.lastInsertRowid);
}

export function updateRule(db, id, rule) {
  db.prepare(`
    UPDATE automation_rules
    SET media_id = @mediaId, name = @name, match_mode = @matchMode, keyword_text = @keywordText,
        reply_message = @replyMessage, dm_failure_reply_message = @dmFailureReplyMessage,
        is_active = @isActive, updated_at = datetime('now')
    WHERE id = @id AND deleted_at IS NULL
  `).run({ id, ...rule, isActive: rule.isActive ? 1 : 0 });
}

export function listRules(db) {
  return db.prepare(`
    SELECT r.*, m.caption, m.instagram_media_id
    FROM automation_rules r
    JOIN media m ON m.id = r.media_id
    WHERE r.deleted_at IS NULL
    ORDER BY r.id DESC
  `).all();
}

export function listActiveRules(db) {
  return db.prepare(`
    SELECT r.*, m.instagram_media_id
    FROM automation_rules r
    JOIN media m ON m.id = r.media_id
    WHERE r.deleted_at IS NULL AND r.is_active = 1
    ORDER BY r.id ASC
  `).all();
}

export function getRule(db, id) {
  return db.prepare('SELECT * FROM automation_rules WHERE id = ? AND deleted_at IS NULL').get(id) || null;
}

export function setRuleActive(db, id, isActive) {
  db.prepare('UPDATE automation_rules SET is_active = ?, updated_at = datetime(\'now\') WHERE id = ? AND deleted_at IS NULL').run(isActive ? 1 : 0, id);
}

export function softDeleteRule(db, id) {
  db.prepare('UPDATE automation_rules SET is_active = 0, deleted_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ? AND deleted_at IS NULL').run(id);
}
```

Create `src/repositories/comments.js`:

```js
export function upsertCommentEvent(db, comment) {
  const result = db.prepare(`
    INSERT INTO comment_events (instagram_comment_id, media_id, commenter_id, commenter_username, comment_text, instagram_created_at)
    VALUES (@instagramCommentId, @mediaId, @commenterId, @commenterUsername, @commentText, @instagramCreatedAt)
    ON CONFLICT(instagram_comment_id) DO UPDATE SET
      commenter_id = excluded.commenter_id,
      commenter_username = excluded.commenter_username,
      comment_text = excluded.comment_text,
      instagram_created_at = excluded.instagram_created_at
  `).run(comment);
  if (result.lastInsertRowid) return Number(result.lastInsertRowid);
  return db.prepare('SELECT id FROM comment_events WHERE instagram_comment_id = ?').get(comment.instagramCommentId).id;
}
```

Create `src/repositories/replyLogs.js`:

```js
export function findReplyLog(db, ruleId, instagramCommentId) {
  return db.prepare('SELECT * FROM reply_logs WHERE rule_id = ? AND instagram_comment_id = ?').get(ruleId, instagramCommentId) || null;
}

export function createReplyLog(db, log) {
  const result = db.prepare(`
    INSERT INTO reply_logs (
      rule_id, comment_event_id, instagram_comment_id, dm_status, comment_like_status,
      fallback_reply_status, fallback_reply_comment_id, request_payload_json,
      response_payload_json, error_message, sent_at
    ) VALUES (
      @ruleId, @commentEventId, @instagramCommentId, @dmStatus, @commentLikeStatus,
      @fallbackReplyStatus, @fallbackReplyCommentId, @requestPayloadJson,
      @responsePayloadJson, @errorMessage, datetime('now')
    )
  `).run(log);
  return Number(result.lastInsertRowid);
}

export function listReplyLogs(db, limit = 100) {
  return db.prepare(`
    SELECT l.*, r.name AS rule_name, c.comment_text, c.commenter_username, m.caption, m.instagram_media_id
    FROM reply_logs l
    JOIN automation_rules r ON r.id = l.rule_id
    JOIN comment_events c ON c.id = l.comment_event_id
    JOIN media m ON m.id = c.media_id
    ORDER BY l.id DESC
    LIMIT ?
  `).all(limit);
}
```

- [ ] **Step 6: Run DB tests**

Run:

```bash
npm test
```

Expected: DB tests pass with config and crypto tests.

- [ ] **Step 7: Commit DB layer**

```bash
git add src/db src/repositories test/helpers/testDb.js test/db.test.js
git commit -m "feat: add SQLite schema and repositories"
```

---

## Task 4: Admin Auth and Express Shell

**Files:**
- Create: `src/views/html.js`
- Create: `src/security/auth.js`
- Create: `src/routes/authRoutes.js`
- Create: `src/server.js`
- Create: `src/index.js`
- Create: `test/auth.test.js`
- Create: `test/routes.test.js`

- [ ] **Step 1: Write auth tests**

Create `test/auth.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAuthenticated, createAuthCookieValue } from '../src/security/auth.js';

test('createAuthCookieValue authenticates with configured password', () => {
  const cookie = createAuthCookieValue('secret');
  assert.equal(isAuthenticated(cookie, 'secret'), true);
  assert.equal(isAuthenticated(cookie, 'wrong'), false);
});
```

Create `test/routes.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from '../src/server.js';
import { createTestDb } from './helpers/testDb.js';

function fakeConfig() {
  return {
    publicBaseUrl: 'https://example.com', metaAppId: 'app-id', metaAppSecret: 'secret',
    metaRedirectUri: 'https://example.com/auth/instagram/callback', adminPassword: 'admin',
    encryptionKey: Buffer.alloc(32, 1), pollingIntervalSeconds: 60
  };
}

test('GET / redirects unauthenticated user to login', async () => {
  const { db } = createTestDb();
  const app = createServer({ config: fakeConfig(), db, instagramClient: {}, poller: { getStatus: () => ({ running: false }) } });
  const server = app.listen(0);
  const port = server.address().port;
  const response = await fetch(`http://127.0.0.1:${port}/`, { redirect: 'manual' });
  server.close();
  assert.equal(response.status, 302);
  assert.equal(response.headers.get('location'), '/login');
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test
```

Expected: tests fail because Express shell and auth modules do not exist.

- [ ] **Step 3: Implement `src/views/html.js`**

```js
export function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function layout(title, body) {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; background: #f7f7fb; color: #222; }
    header { background: #111827; color: white; padding: 16px 24px; }
    nav a { color: white; margin-right: 16px; text-decoration: none; }
    main { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
    .card { background: white; border: 1px solid #e5e7eb; border-radius: 12px; padding: 18px; margin-bottom: 16px; }
    label { display: block; margin-top: 12px; font-weight: 600; }
    input, textarea, select { width: 100%; box-sizing: border-box; padding: 10px; border: 1px solid #d1d5db; border-radius: 8px; }
    button, .button { display: inline-block; background: #2563eb; color: white; border: 0; padding: 10px 14px; border-radius: 8px; text-decoration: none; cursor: pointer; }
    .danger { background: #dc2626; }
    .muted { color: #6b7280; }
    table { width: 100%; border-collapse: collapse; background: white; }
    th, td { border-bottom: 1px solid #e5e7eb; padding: 10px; text-align: left; vertical-align: top; }
  </style>
</head>
<body>
  <header>
    <nav>
      <a href="/">Dashboard</a>
      <a href="/rules">Rules</a>
      <a href="/logs">Logs</a>
      <a href="/logout">Logout</a>
    </nav>
  </header>
  <main>${body}</main>
</body>
</html>`;
}
```

- [ ] **Step 4: Implement `src/security/auth.js`**

```js
import crypto from 'node:crypto';

export const AUTH_COOKIE = 'ig_auto_reply_auth';

function digest(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

export function createAuthCookieValue(password) {
  return digest(password);
}

export function isAuthenticated(cookieValue, adminPassword) {
  if (!cookieValue) return false;
  const actual = Buffer.from(String(cookieValue));
  const expected = Buffer.from(digest(adminPassword));
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

export function requireAdmin(config) {
  return (req, res, next) => {
    if (isAuthenticated(req.cookies?.[AUTH_COOKIE], config.adminPassword)) return next();
    res.redirect('/login');
  };
}
```

- [ ] **Step 5: Implement auth routes**

Create `src/routes/authRoutes.js`:

```js
import express from 'express';
import { AUTH_COOKIE, createAuthCookieValue } from '../security/auth.js';
import { layout, escapeHtml } from '../views/html.js';

export function authRoutes(config) {
  const router = express.Router();

  router.get('/login', (req, res) => {
    const error = req.query.error ? '<p class="muted">비밀번호가 올바르지 않습니다.</p>' : '';
    res.send(layout('Login', `<div class="card"><h1>관리자 로그인</h1>${error}<form method="post" action="/login"><label>비밀번호</label><input name="password" type="password" autofocus><p><button>로그인</button></p></form></div>`));
  });

  router.post('/login', express.urlencoded({ extended: false }), (req, res) => {
    if (req.body.password !== config.adminPassword) {
      res.redirect('/login?error=1');
      return;
    }
    res.cookie(AUTH_COOKIE, createAuthCookieValue(config.adminPassword), { httpOnly: true, sameSite: 'lax', secure: config.publicBaseUrl.startsWith('https://') });
    res.redirect('/');
  });

  router.get('/logout', (req, res) => {
    res.clearCookie(AUTH_COOKIE);
    res.redirect('/login');
  });

  return router;
}
```

- [ ] **Step 6: Implement Express shell and index**

Create `src/server.js`:

```js
import express from 'express';
import cookieParser from 'cookie-parser';
import { authRoutes } from './routes/authRoutes.js';
import { requireAdmin } from './security/auth.js';
import { layout } from './views/html.js';

export function createServer({ config, db, instagramClient, poller }) {
  const app = express();
  app.use(cookieParser());
  app.use(express.urlencoded({ extended: false }));
  app.use(authRoutes(config));

  app.get('/', requireAdmin(config), (req, res) => {
    const status = poller.getStatus();
    res.send(layout('Dashboard', `<div class="card"><h1>Instagram 자동응답</h1><p>Polling running: ${status.running ? 'yes' : 'no'}</p><p><a class="button" href="/auth/instagram/start">Instagram 계정 연결</a></p></div>`));
  });

  return app;
}
```

Create `src/index.js`:

```js
import { loadConfig } from './config.js';
import { openDatabase } from './db/database.js';
import { createServer } from './server.js';

const config = loadConfig();
const db = openDatabase(config.databasePath);
const poller = { getStatus: () => ({ running: false }) };
const instagramClient = {};
const app = createServer({ config, db, instagramClient, poller });

app.listen(config.port, () => {
  console.log(`Instagram auto reply server listening on port ${config.port}`);
});
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test
```

Expected: tests pass.

- [ ] **Step 8: Commit Express shell**

```bash
git add src/views src/security/auth.js src/routes/authRoutes.js src/server.js src/index.js test/auth.test.js test/routes.test.js
git commit -m "feat: add admin auth and server shell"
```

---

## Task 5: Instagram API Client and Error Classification

**Files:**
- Create: `src/instagram/client.js`
- Create: `src/instagram/errors.js`
- Create: `test/instagramClient.test.js`

- [ ] **Step 1: Write Instagram client tests**

Create `test/instagramClient.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createInstagramClient } from '../src/instagram/client.js';
import { isDeliverabilityError } from '../src/instagram/errors.js';

function mockFetch(handler) {
  return async (url, options = {}) => handler(String(url), options);
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

test('buildAuthorizeUrl includes required scopes and state', () => {
  const client = createInstagramClient({
    config: { metaAppId: 'app-id', metaAppSecret: 'secret', metaRedirectUri: 'https://example.com/cb' },
    fetchImpl: mockFetch(() => jsonResponse({}))
  });
  const url = new URL(client.buildAuthorizeUrl('state-1'));
  assert.equal(url.hostname, 'www.instagram.com');
  assert.equal(url.searchParams.get('state'), 'state-1');
  assert.match(url.searchParams.get('scope'), /instagram_business_manage_messages/);
  assert.match(url.searchParams.get('scope'), /instagram_manage_engagement/);
});

test('exchangeCodeForShortLivedToken posts to api.instagram.com', async () => {
  const client = createInstagramClient({
    config: { metaAppId: 'app-id', metaAppSecret: 'secret', metaRedirectUri: 'https://example.com/cb' },
    fetchImpl: mockFetch((url, options) => {
      assert.equal(url, 'https://api.instagram.com/oauth/access_token');
      assert.equal(options.method, 'POST');
      return jsonResponse({ access_token: 'short', user_id: 'ig-1' });
    })
  });
  assert.deepEqual(await client.exchangeCodeForShortLivedToken('code-1'), { accessToken: 'short', userId: 'ig-1' });
});

test('isDeliverabilityError is conservative', () => {
  assert.equal(isDeliverabilityError({ code: 10, message: 'Cannot send message to this user' }), true);
  assert.equal(isDeliverabilityError({ code: 190, message: 'Invalid OAuth 2.0 Access Token' }), false);
  assert.equal(isDeliverabilityError({ code: 4, message: 'Application request limit reached' }), false);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test
```

Expected: tests fail because Instagram modules do not exist.

- [ ] **Step 3: Implement `src/instagram/errors.js`**

```js
export class InstagramApiError extends Error {
  constructor(message, { status, body }) {
    super(message);
    this.name = 'InstagramApiError';
    this.status = status;
    this.body = body;
    this.code = body?.error?.code;
    this.errorSubcode = body?.error?.error_subcode;
  }
}

export function isDeliverabilityError(error) {
  const message = String(error?.message || error?.body?.error?.message || '').toLowerCase();
  const code = error?.code ?? error?.body?.error?.code;
  if (code === 190 || code === 4 || code === 17 || code === 32 || code === 613) return false;
  return message.includes('cannot send') ||
    message.includes('not allowed to message') ||
    message.includes('recipient') ||
    message.includes('message to this user') ||
    message.includes('user is unavailable');
}
```

- [ ] **Step 4: Implement `src/instagram/client.js`**

```js
import { InstagramApiError } from './errors.js';

const SCOPES = [
  'instagram_business_basic',
  'instagram_business_manage_comments',
  'instagram_business_manage_messages',
  'instagram_manage_engagement'
];

async function parseJsonResponse(response) {
  const text = await response.text();
  const body = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new InstagramApiError(body?.error?.message || `Instagram API failed with ${response.status}`, { status: response.status, body });
  }
  return body;
}

export function createInstagramClient({ config, fetchImpl = fetch }) {
  const graphBase = 'https://graph.instagram.com';

  return {
    buildAuthorizeUrl(state) {
      const url = new URL('https://www.instagram.com/oauth/authorize');
      url.searchParams.set('client_id', config.metaAppId);
      url.searchParams.set('redirect_uri', config.metaRedirectUri);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('scope', SCOPES.join(','));
      url.searchParams.set('state', state);
      return url.toString();
    },

    async exchangeCodeForShortLivedToken(code) {
      const body = new URLSearchParams();
      body.set('client_id', config.metaAppId);
      body.set('client_secret', config.metaAppSecret);
      body.set('grant_type', 'authorization_code');
      body.set('redirect_uri', config.metaRedirectUri);
      body.set('code', code);
      const data = await parseJsonResponse(await fetchImpl('https://api.instagram.com/oauth/access_token', { method: 'POST', body }));
      return { accessToken: data.access_token, userId: String(data.user_id) };
    },

    async exchangeForLongLivedToken(shortLivedToken) {
      const url = new URL(`${graphBase}/access_token`);
      url.searchParams.set('grant_type', 'ig_exchange_token');
      url.searchParams.set('client_secret', config.metaAppSecret);
      url.searchParams.set('access_token', shortLivedToken);
      const data = await parseJsonResponse(await fetchImpl(url));
      return { accessToken: data.access_token, expiresIn: data.expires_in };
    },

    async refreshLongLivedToken(accessToken) {
      const url = new URL(`${graphBase}/refresh_access_token`);
      url.searchParams.set('grant_type', 'ig_refresh_token');
      url.searchParams.set('access_token', accessToken);
      const data = await parseJsonResponse(await fetchImpl(url));
      return { accessToken: data.access_token, expiresIn: data.expires_in };
    },

    async getAccount(accessToken) {
      const url = new URL(`${graphBase}/me`);
      url.searchParams.set('fields', 'id,username,account_type');
      url.searchParams.set('access_token', accessToken);
      return parseJsonResponse(await fetchImpl(url));
    },

    async listMedia(accessToken) {
      const url = new URL(`${graphBase}/me/media`);
      url.searchParams.set('fields', 'id,caption,media_type,media_url,thumbnail_url,permalink,timestamp');
      url.searchParams.set('access_token', accessToken);
      const data = await parseJsonResponse(await fetchImpl(url));
      return data.data || [];
    },

    async listComments(accessToken, instagramMediaId) {
      const url = new URL(`${graphBase}/${instagramMediaId}/comments`);
      url.searchParams.set('fields', 'id,text,username,from,timestamp');
      url.searchParams.set('access_token', accessToken);
      const data = await parseJsonResponse(await fetchImpl(url));
      return data.data || [];
    },

    async sendPrivateReply(accessToken, igUserId, commentId, message) {
      const url = new URL(`${graphBase}/${igUserId}/messages`);
      url.searchParams.set('access_token', accessToken);
      return parseJsonResponse(await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: message } })
      }));
    },

    async likeComment(accessToken, igUserId, commentId) {
      const url = new URL(`${graphBase}/${igUserId}/likes`);
      url.searchParams.set('access_token', accessToken);
      return parseJsonResponse(await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ comment_id: commentId })
      }));
    },

    async replyToComment(accessToken, commentId, message) {
      const url = new URL(`${graphBase}/${commentId}/replies`);
      url.searchParams.set('access_token', accessToken);
      return parseJsonResponse(await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message })
      }));
    }
  };
}
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test
```

Expected: Instagram client tests pass with previous tests.

- [ ] **Step 6: Commit Instagram client**

```bash
git add src/instagram test/instagramClient.test.js
git commit -m "feat: add Instagram API client"
```

---

## Task 6: OAuth Routes and Account Connection

**Files:**
- Create: `src/routes/instagramAuthRoutes.js`
- Modify: `src/server.js`
- Modify: `src/index.js`
- Modify: `test/routes.test.js`

- [ ] **Step 1: Extend route tests for OAuth start**

Append to `test/routes.test.js`:

```js
import { createAuthCookieValue, AUTH_COOKIE } from '../src/security/auth.js';

test('GET /auth/instagram/start redirects authenticated admin to Instagram authorize URL', async () => {
  const { db } = createTestDb();
  const instagramClient = { buildAuthorizeUrl: (state) => `https://www.instagram.com/oauth/authorize?state=${state}` };
  const app = createServer({ config: fakeConfig(), db, instagramClient, poller: { getStatus: () => ({ running: false }) } });
  const server = app.listen(0);
  const port = server.address().port;
  const cookie = `${AUTH_COOKIE}=${createAuthCookieValue('admin')}`;
  const response = await fetch(`http://127.0.0.1:${port}/auth/instagram/start`, { redirect: 'manual', headers: { cookie } });
  server.close();
  assert.equal(response.status, 302);
  assert.match(response.headers.get('location'), /^https:\/\/www\.instagram\.com\/oauth\/authorize/);
});
```

- [ ] **Step 2: Run route tests to verify failure**

Run:

```bash
npm test
```

Expected: OAuth route test fails with `404`.

- [ ] **Step 3: Implement `src/routes/instagramAuthRoutes.js`**

```js
import express from 'express';
import { requireAdmin } from '../security/auth.js';
import { createOAuthState, consumeOAuthState } from '../repositories/oauthStates.js';
import { upsertAccount } from '../repositories/accounts.js';
import { encryptText } from '../security/crypto.js';
import { layout, escapeHtml } from '../views/html.js';

function expiresAtFromSeconds(expiresIn) {
  if (!expiresIn) return null;
  return new Date(Date.now() + Number(expiresIn) * 1000).toISOString();
}

export function instagramAuthRoutes({ config, db, instagramClient }) {
  const router = express.Router();

  router.get('/auth/instagram/start', requireAdmin(config), (req, res) => {
    const state = createOAuthState(db);
    res.redirect(instagramClient.buildAuthorizeUrl(state));
  });

  router.get('/auth/instagram/callback', async (req, res, next) => {
    try {
      const { code, state, error, error_description: errorDescription } = req.query;
      if (error) {
        res.status(400).send(layout('Instagram 연결 실패', `<div class="card"><h1>Instagram 연결 실패</h1><p>${escapeHtml(errorDescription || error)}</p><p><a class="button" href="/">돌아가기</a></p></div>`));
        return;
      }
      if (!code || !state || !consumeOAuthState(db, String(state))) {
        res.status(400).send(layout('Instagram 연결 실패', '<div class="card"><h1>OAuth state가 올바르지 않습니다</h1><p><a class="button" href="/">돌아가기</a></p></div>'));
        return;
      }

      const shortToken = await instagramClient.exchangeCodeForShortLivedToken(String(code));
      const longToken = await instagramClient.exchangeForLongLivedToken(shortToken.accessToken);
      const account = await instagramClient.getAccount(longToken.accessToken);
      upsertAccount(db, {
        instagramUserId: account.id,
        username: account.username,
        accountType: account.account_type || null,
        accessTokenEncrypted: encryptText(longToken.accessToken, config.encryptionKey),
        tokenExpiresAt: expiresAtFromSeconds(longToken.expiresIn)
      });
      res.redirect('/');
    } catch (error) {
      next(error);
    }
  });

  return router;
}
```

- [ ] **Step 4: Wire OAuth routes into `src/server.js`**

Modify `src/server.js` to import and use the route:

```js
import { instagramAuthRoutes } from './routes/instagramAuthRoutes.js';
```

Add after `app.use(authRoutes(config));`:

```js
app.use(instagramAuthRoutes({ config, db, instagramClient }));
```

- [ ] **Step 5: Wire real Instagram client in `src/index.js`**

Modify `src/index.js` imports:

```js
import { createInstagramClient } from './instagram/client.js';
```

Replace `const instagramClient = {};` with:

```js
const instagramClient = createInstagramClient({ config });
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test
```

Expected: OAuth route test passes.

- [ ] **Step 7: Commit OAuth routes**

```bash
git add src/routes/instagramAuthRoutes.js src/server.js src/index.js test/routes.test.js
git commit -m "feat: add Instagram OAuth connection routes"
```

---

## Task 7: Dashboard, Media Sync, and Rule CRUD UI

**Files:**
- Create: `src/routes/dashboardRoutes.js`
- Create: `src/routes/ruleRoutes.js`
- Modify: `src/server.js`
- Modify: `test/routes.test.js`

- [ ] **Step 1: Add route smoke tests for rules page**

Append to `test/routes.test.js`:

```js
test('GET /rules returns rule management page for authenticated admin', async () => {
  const { db } = createTestDb();
  const app = createServer({ config: fakeConfig(), db, instagramClient: {}, poller: { getStatus: () => ({ running: false }) } });
  const server = app.listen(0);
  const port = server.address().port;
  const cookie = `${AUTH_COOKIE}=${createAuthCookieValue('admin')}`;
  const response = await fetch(`http://127.0.0.1:${port}/rules`, { headers: { cookie } });
  const html = await response.text();
  server.close();
  assert.equal(response.status, 200);
  assert.match(html, /자동응답 룰/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test
```

Expected: rules route test fails with `404`.

- [ ] **Step 3: Implement dashboard routes**

Create `src/routes/dashboardRoutes.js`:

```js
import express from 'express';
import { requireAdmin } from '../security/auth.js';
import { getAccount } from '../repositories/accounts.js';
import { upsertMedia, listMedia } from '../repositories/media.js';
import { decryptText } from '../security/crypto.js';
import { layout, escapeHtml } from '../views/html.js';

export function dashboardRoutes({ config, db, instagramClient, poller }) {
  const router = express.Router();

  router.get('/', requireAdmin(config), (req, res) => {
    const account = getAccount(db);
    const status = poller.getStatus();
    const accountHtml = account
      ? `<p>연결됨: @${escapeHtml(account.username)} (${escapeHtml(account.account_type || '')})</p><form method="post" action="/media/sync"><button>게시물 불러오기</button></form>`
      : '<p>Instagram 계정이 연결되지 않았습니다.</p><p><a class="button" href="/auth/instagram/start">Instagram 계정 연결</a></p>';
    res.send(layout('Dashboard', `<div class="card"><h1>Dashboard</h1>${accountHtml}<p class="muted">Polling running: ${status.running ? 'yes' : 'no'}</p></div>`));
  });

  router.post('/media/sync', requireAdmin(config), async (req, res, next) => {
    try {
      const account = getAccount(db);
      if (!account) {
        res.redirect('/');
        return;
      }
      const token = decryptText(account.access_token_encrypted, config.encryptionKey);
      const mediaItems = await instagramClient.listMedia(token);
      for (const item of mediaItems) {
        upsertMedia(db, {
          instagramMediaId: item.id,
          caption: item.caption || '',
          mediaType: item.media_type || '',
          mediaUrl: item.media_url || '',
          thumbnailUrl: item.thumbnail_url || '',
          permalink: item.permalink || '',
          timestamp: item.timestamp || ''
        });
      }
      res.redirect('/rules');
    } catch (error) {
      next(error);
    }
  });

  router.get('/media', requireAdmin(config), (req, res) => {
    const rows = listMedia(db).map((m) => `<tr><td>${escapeHtml(m.caption || m.instagram_media_id)}</td><td>${escapeHtml(m.media_type)}</td><td>${escapeHtml(m.timestamp)}</td></tr>`).join('');
    res.send(layout('Media', `<div class="card"><h1>게시물</h1><table><tbody>${rows}</tbody></table></div>`));
  });

  return router;
}
```

- [ ] **Step 4: Implement rule routes**

Create `src/routes/ruleRoutes.js`:

```js
import express from 'express';
import { requireAdmin } from '../security/auth.js';
import { listMedia } from '../repositories/media.js';
import { createRule, getRule, listRules, updateRule, setRuleActive, softDeleteRule } from '../repositories/rules.js';
import { layout, escapeHtml } from '../views/html.js';

function mediaOptions(media, selectedId) {
  return media.map((m) => `<option value="${m.id}" ${Number(selectedId) === Number(m.id) ? 'selected' : ''}>${escapeHtml(m.caption || m.instagram_media_id)}</option>`).join('');
}

function ruleForm(media, rule = {}) {
  return `<div class="card"><h2>${rule.id ? '룰 수정' : '룰 생성'}</h2><form method="post" action="${rule.id ? `/rules/${rule.id}` : '/rules'}">
    <label>룰 이름</label><input name="name" value="${escapeHtml(rule.name || '')}" required>
    <label>게시물</label><select name="mediaId" required>${mediaOptions(media, rule.media_id)}</select>
    <label>댓글 조건</label><input name="keywordText" value="${escapeHtml(rule.keyword_text || '')}" required>
    <label>Private Reply 메시지</label><textarea name="replyMessage" required>${escapeHtml(rule.reply_message || '')}</textarea>
    <label>DM 실패 fallback 대댓글</label><textarea name="dmFailureReplyMessage" required>${escapeHtml(rule.dm_failure_reply_message || '')}</textarea>
    <label><input type="checkbox" name="isActive" value="1" ${rule.is_active === 0 ? '' : 'checked'}> 활성화</label>
    <p><button>저장</button></p>
  </form></div>`;
}

function parseRuleBody(body) {
  return {
    mediaId: Number(body.mediaId),
    name: body.name,
    matchMode: 'contains_any',
    keywordText: body.keywordText,
    replyMessage: body.replyMessage,
    dmFailureReplyMessage: body.dmFailureReplyMessage,
    isActive: body.isActive === '1'
  };
}

export function ruleRoutes({ config, db }) {
  const router = express.Router();

  router.get('/rules', requireAdmin(config), (req, res) => {
    const media = listMedia(db);
    const rows = listRules(db).map((r) => `<tr><td>${escapeHtml(r.name)}</td><td>${escapeHtml(r.caption || r.instagram_media_id)}</td><td>${escapeHtml(r.keyword_text)}</td><td>${r.is_active ? '활성' : '일시중지'}</td><td><a href="/rules/${r.id}/edit">수정</a><form method="post" action="/rules/${r.id}/toggle" style="display:inline"><button>${r.is_active ? '일시중지' : '재개'}</button></form><form method="post" action="/rules/${r.id}/delete" style="display:inline"><button class="danger">삭제</button></form></td></tr>`).join('');
    res.send(layout('자동응답 룰', `<h1>자동응답 룰</h1>${ruleForm(media)}<div class="card"><table><tbody>${rows}</tbody></table></div>`));
  });

  router.post('/rules', requireAdmin(config), (req, res) => {
    createRule(db, parseRuleBody(req.body));
    res.redirect('/rules');
  });

  router.get('/rules/:id/edit', requireAdmin(config), (req, res) => {
    const rule = getRule(db, Number(req.params.id));
    if (!rule) { res.status(404).send('Not found'); return; }
    res.send(layout('룰 수정', ruleForm(listMedia(db), rule)));
  });

  router.post('/rules/:id', requireAdmin(config), (req, res) => {
    updateRule(db, Number(req.params.id), parseRuleBody(req.body));
    res.redirect('/rules');
  });

  router.post('/rules/:id/toggle', requireAdmin(config), (req, res) => {
    const rule = getRule(db, Number(req.params.id));
    if (rule) setRuleActive(db, rule.id, !rule.is_active);
    res.redirect('/rules');
  });

  router.post('/rules/:id/delete', requireAdmin(config), (req, res) => {
    softDeleteRule(db, Number(req.params.id));
    res.redirect('/rules');
  });

  return router;
}
```

- [ ] **Step 5: Wire dashboard and rule routes**

Modify `src/server.js` imports:

```js
import { dashboardRoutes } from './routes/dashboardRoutes.js';
import { ruleRoutes } from './routes/ruleRoutes.js';
```

Replace the inline `app.get('/')` handler with:

```js
app.use(dashboardRoutes({ config, db, instagramClient, poller }));
app.use(ruleRoutes({ config, db }));
```

- [ ] **Step 6: Run tests**

Run:

```bash
npm test
```

Expected: rules route smoke test passes.

- [ ] **Step 7: Commit UI CRUD routes**

```bash
git add src/routes/dashboardRoutes.js src/routes/ruleRoutes.js src/server.js test/routes.test.js
git commit -m "feat: add media sync and rule management UI"
```

---

## Task 8: Matcher and Polling Engine

**Files:**
- Create: `src/poller/matcher.js`
- Create: `src/poller/poller.js`
- Modify: `src/index.js`
- Create: `test/matcher.test.js`
- Create: `test/poller.test.js`

- [ ] **Step 1: Write matcher tests**

Create `test/matcher.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesRule } from '../src/poller/matcher.js';

test('matchesRule supports comma separated contains_any', () => {
  assert.equal(matchesRule('쿠폰 주세요', { match_mode: 'contains_any', keyword_text: '링크, 쿠폰' }), true);
  assert.equal(matchesRule('안녕하세요', { match_mode: 'contains_any', keyword_text: '링크, 쿠폰' }), false);
});

test('matchesRule ignores case and keyword whitespace', () => {
  assert.equal(matchesRule('Please send LINK', { match_mode: 'contains_any', keyword_text: ' link ' }), true);
});
```

- [ ] **Step 2: Write poller action policy tests**

Create `test/poller.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from './helpers/testDb.js';
import { upsertAccount } from '../src/repositories/accounts.js';
import { upsertMedia } from '../src/repositories/media.js';
import { createRule } from '../src/repositories/rules.js';
import { findReplyLog } from '../src/repositories/replyLogs.js';
import { runPollingOnce } from '../src/poller/poller.js';
import { encryptText } from '../src/security/crypto.js';

function setupDb() {
  const { db } = createTestDb();
  const key = Buffer.alloc(32, 1);
  upsertAccount(db, {
    instagramUserId: 'ig-user-1', username: 'creator', accountType: 'CREATOR',
    accessTokenEncrypted: encryptText('token', key), tokenExpiresAt: '2099-01-01T00:00:00.000Z'
  });
  const mediaId = upsertMedia(db, {
    instagramMediaId: 'media-1', caption: 'post', mediaType: 'IMAGE', mediaUrl: '', thumbnailUrl: '', permalink: '', timestamp: '2026-06-06T00:00:00.000Z'
  });
  const ruleId = createRule(db, {
    mediaId, name: 'coupon', matchMode: 'contains_any', keywordText: '쿠폰',
    replyMessage: 'DM message', dmFailureReplyMessage: 'fallback comment', isActive: true
  });
  return { db, key, ruleId };
}

test('runPollingOnce sends DM and likes comment on success', async () => {
  const { db, key, ruleId } = setupDb();
  const calls = [];
  const instagramClient = {
    listComments: async () => [{ id: 'comment-1', text: '쿠폰 주세요', username: 'user', from: { id: 'user-1' }, timestamp: '2026-06-06T00:01:00.000Z' }],
    sendPrivateReply: async () => { calls.push('dm'); return { ok: true }; },
    likeComment: async () => { calls.push('like'); return { ok: true }; },
    replyToComment: async () => { calls.push('fallback'); return { id: 'reply-1' }; }
  };

  await runPollingOnce({ db, instagramClient, encryptionKey: key });

  assert.deepEqual(calls, ['dm', 'like']);
  const log = findReplyLog(db, ruleId, 'comment-1');
  assert.equal(log.dm_status, 'sent');
  assert.equal(log.comment_like_status, 'sent');
  assert.equal(log.fallback_reply_status, 'skipped');
});

test('runPollingOnce writes fallback reply only for deliverability failure', async () => {
  const { db, key, ruleId } = setupDb();
  const calls = [];
  const instagramClient = {
    listComments: async () => [{ id: 'comment-2', text: '쿠폰 주세요', username: 'user', from: { id: 'user-1' }, timestamp: '2026-06-06T00:01:00.000Z' }],
    sendPrivateReply: async () => { const error = new Error('Cannot send message to this user'); error.code = 10; throw error; },
    likeComment: async () => { calls.push('like'); return { ok: true }; },
    replyToComment: async () => { calls.push('fallback'); return { id: 'reply-1' }; }
  };

  await runPollingOnce({ db, instagramClient, encryptionKey: key });

  assert.deepEqual(calls, ['fallback']);
  const log = findReplyLog(db, ruleId, 'comment-2');
  assert.equal(log.dm_status, 'failed');
  assert.equal(log.comment_like_status, 'skipped');
  assert.equal(log.fallback_reply_status, 'sent');
});
```

- [ ] **Step 3: Run tests to verify failure**

Run:

```bash
npm test
```

Expected: matcher and poller tests fail because modules do not exist.

- [ ] **Step 4: Implement matcher**

Create `src/poller/matcher.js`:

```js
export function matchesRule(commentText, rule) {
  if (rule.match_mode !== 'contains_any') return false;
  const text = String(commentText || '').toLocaleLowerCase();
  return String(rule.keyword_text || '')
    .split(',')
    .map((keyword) => keyword.trim().toLocaleLowerCase())
    .filter(Boolean)
    .some((keyword) => text.includes(keyword));
}
```

- [ ] **Step 5: Implement poller**

Create `src/poller/poller.js`:

```js
import { getAccount } from '../repositories/accounts.js';
import { listActiveRules } from '../repositories/rules.js';
import { upsertCommentEvent } from '../repositories/comments.js';
import { createReplyLog, findReplyLog } from '../repositories/replyLogs.js';
import { decryptText } from '../security/crypto.js';
import { isDeliverabilityError } from '../instagram/errors.js';
import { matchesRule } from './matcher.js';

function stringify(value) {
  return JSON.stringify(value ?? {});
}

function normalizeComment(comment) {
  return {
    id: comment.id,
    text: comment.text || '',
    username: comment.username || comment.from?.username || '',
    userId: comment.from?.id || '',
    timestamp: comment.timestamp || null
  };
}

export async function runPollingOnce({ db, instagramClient, encryptionKey }) {
  const account = getAccount(db);
  if (!account) return { processed: 0 };
  const token = decryptText(account.access_token_encrypted, encryptionKey);
  const rules = listActiveRules(db);
  let processed = 0;

  const rulesByMedia = new Map();
  for (const rule of rules) {
    const list = rulesByMedia.get(rule.instagram_media_id) || [];
    list.push(rule);
    rulesByMedia.set(rule.instagram_media_id, list);
  }

  for (const [instagramMediaId, mediaRules] of rulesByMedia.entries()) {
    const comments = await instagramClient.listComments(token, instagramMediaId);
    for (const rawComment of comments) {
      const comment = normalizeComment(rawComment);
      for (const rule of mediaRules) {
        if (!matchesRule(comment.text, rule)) continue;
        if (findReplyLog(db, rule.id, comment.id)) continue;

        const commentEventId = upsertCommentEvent(db, {
          instagramCommentId: comment.id,
          mediaId: rule.media_id,
          commenterId: comment.userId,
          commenterUsername: comment.username,
          commentText: comment.text,
          instagramCreatedAt: comment.timestamp
        });

        let dmStatus = 'failed';
        let commentLikeStatus = 'skipped';
        let fallbackReplyStatus = 'skipped';
        let fallbackReplyCommentId = null;
        let responsePayload = {};
        let errorMessage = null;

        try {
          responsePayload.dm = await instagramClient.sendPrivateReply(token, account.instagram_user_id, comment.id, rule.reply_message);
          dmStatus = 'sent';
          try {
            responsePayload.like = await instagramClient.likeComment(token, account.instagram_user_id, comment.id);
            commentLikeStatus = 'sent';
          } catch (likeError) {
            commentLikeStatus = 'failed';
            errorMessage = likeError.message;
          }
        } catch (dmError) {
          errorMessage = dmError.message;
          if (isDeliverabilityError(dmError)) {
            try {
              const fallback = await instagramClient.replyToComment(token, comment.id, rule.dm_failure_reply_message);
              fallbackReplyStatus = 'sent';
              fallbackReplyCommentId = fallback.id || null;
              responsePayload.fallback = fallback;
            } catch (fallbackError) {
              fallbackReplyStatus = 'failed';
              errorMessage = fallbackError.message;
            }
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
          requestPayloadJson: stringify({ ruleId: rule.id, commentId: comment.id }),
          responsePayloadJson: stringify(responsePayload),
          errorMessage
        });
        processed += 1;
      }
    }
  }

  return { processed };
}

export function createPoller({ db, instagramClient, encryptionKey, intervalSeconds }) {
  let timer = null;
  let running = false;
  let activeRun = false;

  async function tick() {
    if (activeRun) return;
    activeRun = true;
    try {
      await runPollingOnce({ db, instagramClient, encryptionKey });
    } catch (error) {
      console.error('Polling failed:', error.message);
    } finally {
      activeRun = false;
    }
  }

  return {
    start() {
      if (timer) return;
      running = true;
      timer = setInterval(tick, intervalSeconds * 1000);
      tick();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      running = false;
    },
    getStatus() {
      return { running, activeRun };
    }
  };
}
```

- [ ] **Step 6: Wire poller in `src/index.js`**

Modify `src/index.js` imports:

```js
import { createPoller } from './poller/poller.js';
```

Replace poller construction:

```js
const poller = createPoller({
  db,
  instagramClient,
  encryptionKey: config.encryptionKey,
  intervalSeconds: config.pollingIntervalSeconds
});
```

After `app.listen(...)`, add:

```js
poller.start();
```

- [ ] **Step 7: Run tests**

Run:

```bash
npm test
```

Expected: matcher and poller tests pass.

- [ ] **Step 8: Commit poller**

```bash
git add src/poller src/index.js test/matcher.test.js test/poller.test.js
git commit -m "feat: add polling engine and comment actions"
```

---

## Task 9: Logs UI and Final Error Handler

**Files:**
- Create: `src/routes/logRoutes.js`
- Modify: `src/server.js`
- Modify: `test/routes.test.js`

- [ ] **Step 1: Add logs route smoke test**

Append to `test/routes.test.js`:

```js
test('GET /logs returns reply log page for authenticated admin', async () => {
  const { db } = createTestDb();
  const app = createServer({ config: fakeConfig(), db, instagramClient: {}, poller: { getStatus: () => ({ running: false }) } });
  const server = app.listen(0);
  const port = server.address().port;
  const cookie = `${AUTH_COOKIE}=${createAuthCookieValue('admin')}`;
  const response = await fetch(`http://127.0.0.1:${port}/logs`, { headers: { cookie } });
  const html = await response.text();
  server.close();
  assert.equal(response.status, 200);
  assert.match(html, /발송 로그/);
});
```

- [ ] **Step 2: Run tests to verify failure**

Run:

```bash
npm test
```

Expected: logs route test fails with `404`.

- [ ] **Step 3: Implement `src/routes/logRoutes.js`**

```js
import express from 'express';
import { requireAdmin } from '../security/auth.js';
import { listReplyLogs } from '../repositories/replyLogs.js';
import { layout, escapeHtml } from '../views/html.js';

export function logRoutes({ config, db }) {
  const router = express.Router();

  router.get('/logs', requireAdmin(config), (req, res) => {
    const rows = listReplyLogs(db).map((log) => `<tr>
      <td>${escapeHtml(log.created_at)}</td>
      <td>${escapeHtml(log.rule_name)}</td>
      <td>${escapeHtml(log.commenter_username || '')}</td>
      <td>${escapeHtml(log.comment_text)}</td>
      <td>${escapeHtml(log.dm_status)}</td>
      <td>${escapeHtml(log.comment_like_status)}</td>
      <td>${escapeHtml(log.fallback_reply_status)}</td>
      <td>${escapeHtml(log.error_message || '')}</td>
    </tr>`).join('');
    res.send(layout('발송 로그', `<div class="card"><h1>발송 로그</h1><table><thead><tr><th>시각</th><th>룰</th><th>작성자</th><th>댓글</th><th>DM</th><th>좋아요</th><th>대댓글</th><th>에러</th></tr></thead><tbody>${rows}</tbody></table></div>`));
  });

  return router;
}
```

- [ ] **Step 4: Wire log route and error handler**

Modify `src/server.js` imports:

```js
import { logRoutes } from './routes/logRoutes.js';
import { layout, escapeHtml } from './views/html.js';
```

Add route wiring after rule routes:

```js
app.use(logRoutes({ config, db }));
```

Add final error handler before `return app;`:

```js
app.use((error, req, res, next) => {
  console.error(error);
  res.status(500).send(layout('오류', `<div class="card"><h1>오류</h1><p>${escapeHtml(error.message)}</p><p><a class="button" href="/">돌아가기</a></p></div>`));
});
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test
```

Expected: logs route smoke test passes.

- [ ] **Step 6: Commit logs UI**

```bash
git add src/routes/logRoutes.js src/server.js test/routes.test.js
git commit -m "feat: add reply log UI"
```

---

## Task 10: Documentation and End-to-End Verification

**Files:**
- Modify: `README.md`
- Modify: `.env.example`

- [ ] **Step 1: Update README with Meta setup checklist**

Add this section to `README.md`:

```markdown
## Meta App Setup Checklist

1. Create a Meta Developer App.
2. Enable Instagram API with Instagram Login.
3. Add this redirect URI exactly:
   `https://your-domain.example.com/auth/instagram/callback`
4. Add or verify these scopes:
   - `instagram_business_basic`
   - `instagram_business_manage_comments`
   - `instagram_business_manage_messages`
   - `instagram_manage_engagement`
5. Add the Instagram Professional account you own or manage to the app setup.
6. Keep the app limited to role users unless App Review and Business Verification are completed.

## Production Notes

- Run behind HTTPS.
- Keep `.env` out of git.
- Persist `data/app.db` with disk backups.
- Use `ADMIN_PASSWORD` with at least 16 random characters.
- If `instagram_manage_engagement` is not available, disable DM success comment-like behavior before production use.
```

- [ ] **Step 2: Run full automated tests**

Run:

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Run server smoke test with local env**

Run:

```bash
ENCRYPTION_KEY=$(openssl rand -base64 32) \
DATABASE_PATH=./data/smoke.db \
PUBLIC_BASE_URL=https://example.com \
META_APP_ID=app-id \
META_APP_SECRET=secret \
META_REDIRECT_URI=https://example.com/auth/instagram/callback \
ADMIN_PASSWORD=admin-password \
POLLING_INTERVAL_SECONDS=60 \
PORT=3000 \
npm start
```

Expected: console prints `Instagram auto reply server listening on port 3000`. Stop with `Ctrl+C`.

- [ ] **Step 4: Confirm git ignores runtime files**

Run:

```bash
git status --short
```

Expected: `data/smoke.db`, `data/smoke.db-shm`, and `data/smoke.db-wal` are not listed.

- [ ] **Step 5: Commit documentation update**

```bash
git add README.md .env.example
git commit -m "docs: add Meta setup and deployment notes"
```

---

## Self-Review Checklist

### Spec Coverage

- OAuth with domain: Task 5 and Task 6.
- SQLite file DB and migration: Task 3.
- Admin password protection: Task 4.
- Media list and sync: Task 7.
- Rule create/edit/pause/resume/soft delete: Task 7.
- Polling every 60 seconds: Task 8.
- Private Reply: Task 5 and Task 8.
- DM success comment like: Task 5 and Task 8.
- DM deliverability failure fallback comment reply: Task 5 and Task 8.
- System failure no public fallback reply: Task 8.
- Duplicate DM/like/fallback prevention: Task 3 and Task 8.
- Logs UI: Task 9.
- README deployment and Meta setup notes: Task 10.

### Placeholder Scan

The plan avoids open placeholders. Values that must be supplied by deployer are expressed as concrete environment variable names and example values in `.env.example`.

### Type Consistency

Repository field names use camelCase inputs and SQLite snake_case columns. Route form names map to repository camelCase fields. Poller consumes SQLite snake_case rule rows returned by `listActiveRules` and writes camelCase log inputs accepted by `createReplyLog`.
