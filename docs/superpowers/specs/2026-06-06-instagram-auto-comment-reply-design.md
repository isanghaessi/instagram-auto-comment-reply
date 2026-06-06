# Instagram Auto Comment Reply MVP Design

Date: 2026-06-06
Status: Approved for implementation planning

## Summary

Build a lightweight self-hosted Node.js web server that runs locally, stores data in a SQLite file, polls Instagram comments every 60 seconds, and sends a configured Instagram Private Reply when a selected post receives a matching comment.

The product intentionally avoids OAuth, webhooks, custom domains, and public HTTPS endpoints for the MVP. The administrator connects one Instagram Creator or Business account by pasting a long-lived Instagram access token into the web UI.

## Goals

- Run locally with `npm start` and no external database server.
- Support one Instagram Creator or Business account.
- Connect the account via direct access-token input.
- Show a friendly web UI for setup and daily operation.
- List Instagram posts from the connected account.
- Let the admin create, edit, pause, resume, and soft-delete automation rules.
- Let the admin choose a post, enter comment matching text, and enter a DM reply message.
- Poll comments every 60 seconds by default.
- Send one Private Reply for matching comments.
- Store processed comments and reply attempts to avoid duplicate sends.
- Keep logs for success, failure, and rule attribution.

## Non-goals for MVP

- OAuth login flow.
- Instagram webhooks.
- Public domain, HTTPS callback, ngrok, or Cloudflare Tunnel requirement.
- Follower-status checks.
- Multi-account support.
- Multi-user team management.
- SaaS deployment.
- AI-generated replies.
- Visual campaign builder.

## Required Instagram Token

The app accepts a long-lived Instagram access token generated outside this app. The token must belong to a Professional Instagram account, either Creator or Business.

Required scopes:

- `instagram_business_basic` for account and media metadata.
- `instagram_business_manage_comments` for comment access.
- `instagram_business_manage_messages` for Private Reply sending.

The app will not store Instagram username/password. It stores only the pasted access token, encrypted at rest.

## Runtime Configuration

Environment variables:

```env
PORT=3000
DATABASE_PATH=./data/app.db
ENCRYPTION_KEY=<32-byte encryption key>
POLLING_INTERVAL_SECONDS=60
```

Notes:

- `PORT` controls the local web UI address, defaulting to `3000`.
- `DATABASE_PATH` points to the SQLite file. The server creates parent folders and schema on startup.
- `ENCRYPTION_KEY` encrypts the Instagram token before saving it to SQLite.
- `POLLING_INTERVAL_SECONDS` defaults to `60` and can be changed later.

## User Experience

### Account connection

The local admin opens `http://localhost:3000`, goes to the account connection page, pastes the long-lived access token, and clicks **Verify and Connect**. The MVP does not include a separate login screen because it is designed for local-only use.

The server validates the token by calling Instagram APIs to fetch account information and confirm that basic media access works. On success, the UI shows:

- Instagram username.
- Instagram account id.
- Account type when available.
- Token status.
- Last verification time.

### Post selection

The post picker shows recent media from the connected account. Each card should include:

- Thumbnail when available.
- Caption preview.
- Media type.
- Post timestamp.
- Permalink when available.

The admin selects one post and creates a rule from it.

### Rule creation and editing

A rule contains:

- Rule name.
- Selected Instagram media id.
- Comment matching text.
- Match mode.
- Reply message.
- Active or paused status.

MVP match modes:

- `contains_any`: comma-separated terms; a comment matches if it contains at least one term.
- Case-insensitive matching.
- Leading and trailing whitespace ignored.

The reply message is plain text. Links are allowed as text. Rich media, buttons, and quick replies are not in scope for MVP.

### Rule management

The rule list supports:

- View active and paused rules.
- Edit rule fields.
- Pause and resume.
- Soft delete.

Soft delete behavior:

- Set `deleted_at` to the current timestamp.
- Set `is_active` to false.
- Hide the rule from the default list.
- Preserve rule rows for historical log attribution.

### Logs

The UI shows a reply log with:

- Rule name.
- Post caption preview or media id.
- Comment text.
- Commenter username or id when available.
- Send status.
- Error message when failed.
- Timestamp.

## Data Model

### `accounts`

- `id`
- `instagram_user_id`
- `username`
- `account_type`
- `access_token_encrypted`
- `token_last_verified_at`
- `created_at`
- `updated_at`

### `media`

- `id`
- `instagram_media_id`
- `caption`
- `media_type`
- `media_url`
- `thumbnail_url`
- `permalink`
- `timestamp`
- `created_at`
- `updated_at`

### `automation_rules`

- `id`
- `media_id`
- `name`
- `match_mode`
- `keyword_text`
- `reply_message`
- `is_active`
- `deleted_at`
- `created_at`
- `updated_at`

### `comment_events`

- `id`
- `instagram_comment_id`
- `media_id`
- `commenter_id`
- `commenter_username`
- `comment_text`
- `instagram_created_at`
- `received_at`
- `created_at`

### `reply_logs`

- `id`
- `rule_id`
- `comment_event_id`
- `status`
- `request_payload_json`
- `response_payload_json`
- `error_message`
- `sent_at`
- `created_at`

### Duplicate prevention

The app must prevent duplicate replies by enforcing uniqueness on the pair:

- `rule_id`
- `instagram_comment_id`

If the app restarts, existing `reply_logs` and `comment_events` still prevent repeated sends.

## Polling Flow

Every 60 seconds:

1. Load active, non-deleted rules.
2. Group rules by selected media.
3. Fetch recent comments for each media id.
4. Store newly observed comments in `comment_events`.
5. Match each comment against active rules for that media.
6. Skip if a reply log already exists for that rule and comment.
7. Send Instagram Private Reply with the rule's `reply_message`.
8. Store success or failure in `reply_logs`.

The polling loop must avoid overlapping runs. If a previous run is still active, the next tick should be skipped and logged.

## Error Handling

- Invalid token: show a connection error and do not save the token.
- Expired token: mark account as disconnected and show reconnect instructions.
- Missing permission: show which capability failed, such as media fetch, comment fetch, or message send.
- API rate limit: log the error and retry on the next polling interval.
- Private Reply failure: store the failure in `reply_logs` and do not retry automatically until a retry policy is explicitly added later.
- Database error: log server-side and show a generic UI error.

## Security

- Never store Instagram username/password.
- Encrypt access tokens before writing to SQLite.
- Do not print access tokens in logs.
- Bind the server to localhost by default for MVP local-only use.
- Keep `.env` and SQLite database files out of git.
- Treat request and response payload logs as sensitive because they may contain comment text and identifiers.

## Implementation Approach

Use a small Node.js server with:

- Express or Fastify for HTTP routes.
- Server-rendered HTML with minimal client-side JavaScript.
- `better-sqlite3` for SQLite access.
- A startup migration step that creates or updates the schema.
- A background polling loop in the same Node process.

React, Next.js, OAuth libraries, webhook infrastructure, and external queue systems are unnecessary for the MVP.

## Validation Plan

Before claiming the MVP works:

- Start server from a clean checkout.
- Confirm SQLite database and tables are auto-created.
- Enter an invalid token and verify a friendly error.
- Enter a valid token and verify account metadata is shown.
- Fetch media list and select a post.
- Create, edit, pause, resume, and soft-delete a rule.
- Confirm soft-deleted rules are not executed but remain in the database.
- Run the polling loop against a controlled test post.
- Add a non-matching comment and confirm no reply is sent.
- Add a matching comment and confirm one Private Reply attempt is logged.
- Restart the server and confirm the same comment is not replied to again.

## Open Risks

- Meta API behavior and permissions can change, so token generation instructions must be kept current.
- Direct token input is less user-friendly than OAuth, but it best matches the local-only MVP constraint.
- Polling is not real-time. With the default interval, replies can be delayed by up to about 60 seconds plus API latency.
- Private Reply constraints are enforced by Instagram; failed sends must be visible in logs.
