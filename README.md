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
