# Instagram 댓글 자동 DM 응답

Self-hosted Node.js MVP for Instagram comment-to-DM automation.

Instagram Creator/Business 계정 1개를 OAuth로 연결한 뒤, 선택한 게시물의 댓글을 60초 주기로 확인하여 룰에 맞는 댓글 작성자에게 Instagram Private Reply(DM)를 자동 발송합니다.

## 주요 기능

- 관리자 비밀번호 기반 로컬/셀프호스팅 웹 UI
- Instagram OAuth 계정 연결
- Instagram 게시물 목록 동기화
- 게시물별 자동응답 룰 생성/수정/일시중지/재개/soft delete
- 댓글 keyword `contains_any` 매칭
- DM 발송 성공 시 원댓글 좋아요
- DM 발송이 사용자 수신 설정 등 deliverability 사유로 실패한 경우 룰별 fallback 대댓글 작성
- 시스템/API/rate-limit/token 오류 등은 공개 fallback 대댓글 미작성
- `(rule, comment)` 단위 중복 처리 방지
- 발송 로그 UI

## Requirements

- Node.js 22+
- HTTPS 도메인이 연결된 서버
- Instagram Creator 또는 Business 계정
- Meta Developer App
- Meta 앱에서 Instagram API with Instagram Login 설정

## Environment

`.env.example`을 `.env`로 복사한 뒤 값을 채웁니다.

```bash
cp .env.example .env
```

`ENCRYPTION_KEY` 생성:

```bash
openssl rand -base64 32
```

환경변수 설명:

| 변수 | 설명 | 예시/획득 방법 |
| --- | --- | --- |
| `PORT` | Node 서버 포트 | `3000` |
| `DATABASE_PATH` | SQLite 파일 경로 | `./data/app.db` |
| `PUBLIC_BASE_URL` | 외부에서 접속 가능한 HTTPS origin | `https://your-domain.example.com` |
| `META_APP_ID` | Meta App Dashboard의 App ID | Meta Developer Console에서 확인 |
| `META_APP_SECRET` | Meta App Dashboard의 App Secret | Meta Developer Console에서 확인 |
| `META_REDIRECT_URI` | Instagram OAuth callback URL | `${PUBLIC_BASE_URL}/auth/instagram/callback` |
| `ENCRYPTION_KEY` | access token 암호화용 32바이트 base64 key | `openssl rand -base64 32` |
| `ADMIN_PASSWORD` | 관리자 UI 로그인 비밀번호 | 16자 이상 랜덤 문자열 권장 |
| `POLLING_INTERVAL_SECONDS` | 댓글 polling 주기 | 기본/권장 `60` |

## Run

```bash
npm install
npm start
```

브라우저에서 접속:

```txt
https://your-domain.example.com
```

로컬 개발 중에는 `PUBLIC_BASE_URL`/`META_REDIRECT_URI`는 실제 OAuth callback이 가능한 HTTPS 도메인 값이어야 합니다. 단순 `localhost`만으로는 Meta OAuth 설정/검증에 막힐 수 있으므로, 배포 도메인 또는 HTTPS 터널/프록시를 사용하세요.

## Meta App Setup Checklist

1. Meta Developer App을 생성합니다.
2. Instagram API with Instagram Login을 활성화합니다.
3. Instagram OAuth redirect URI에 아래 값을 정확히 등록합니다.
   `https://your-domain.example.com/auth/instagram/callback`
4. 앱 설정에서 다음 권한(scope)을 요청/확인합니다.
   - `instagram_business_basic`
   - `instagram_business_manage_comments`
   - `instagram_business_manage_messages`
   - `instagram_manage_engagement`
5. 본인이 소유하거나 관리 권한을 가진 Instagram Professional(Creator/Business) 계정을 앱 설정/역할 사용자로 접근 가능하게 둡니다.
6. 앱 리뷰와 Business Verification 전에는 앱 role user/tester 범위에서 사용하세요.

## 사용 흐름

1. 서버를 실행하고 관리자 UI에 로그인합니다.
2. Dashboard에서 Instagram 계정을 연결합니다.
3. `Sync Instagram media`로 게시물 목록을 가져옵니다.
4. `Rules`에서 게시물을 선택하고:
   - 룰 이름
   - 댓글 키워드(comma separated)
   - 성공 시 보낼 DM 문구
   - DM 실패 시 작성할 fallback 대댓글 문구
   를 입력합니다.
5. Poller가 주기적으로 댓글을 확인하고 자동 처리합니다.
6. `Logs`에서 처리 결과를 확인합니다.

## Production Notes

- 반드시 HTTPS 뒤에서 실행하세요. 관리자 POST 액션은 `PUBLIC_BASE_URL`과 일치하는 `Origin`/`Referer`만 허용합니다.
- `.env`는 git에 올리지 마세요.
- `data/app.db`는 SQLite 파일 DB입니다. 서버만 띄우면 자동 생성/마이그레이션되지만, 운영에서는 디스크 persistence와 백업을 설정하세요.
- `ADMIN_PASSWORD`는 16자 이상 랜덤 문자열을 권장합니다. 로그인 실패는 IP 기준으로 일정 횟수 이후 일시적으로 제한됩니다.
- `ENCRYPTION_KEY`를 분실하면 저장된 Instagram access token을 복호화할 수 없습니다.
- `ENCRYPTION_KEY`가 유출되면 `.env`와 DB를 함께 가진 공격자가 token을 복호화할 수 있으므로 안전하게 보관하세요.
- 저장된 long-lived token은 만료 7일 이내 polling 전에 자동 refresh를 시도합니다. refresh가 계속 실패하면 Instagram 계정을 UI에서 다시 연결하세요.
- 댓글 좋아요는 Meta Instagram Platform changelog의 Like Media and Comments API 기준 `POST /<IG_USER_ID>/likes` + `comment_id`를 사용합니다. `instagram_manage_engagement` 권한이 없거나 앱/계정/콘텐츠 제약에 걸리면 실패할 수 있으므로, 운영 전 해당 기능을 비활성화하거나 권한을 확보하고 `Logs`에서 실패 여부를 확인하세요.
- 이 MVP는 Instagram Webhook을 사용하지 않고 polling만 사용합니다.
- 여러 서버 인스턴스를 동시에 띄우는 구성은 권장하지 않습니다. 단일 프로세스/단일 SQLite 파일 기준 MVP입니다.
- 중복 DM 방지를 위해 `(rule, comment)` 선점 로그를 먼저 생성합니다. 프로세스가 중간에 죽어도 같은 댓글에 DM을 재발송하지 않는 쪽을 우선합니다.

## Local Smoke Test

```bash
ENCRYPTION_KEY=$(openssl rand -base64 32) \
DATABASE_PATH=./data/smoke.db \
PUBLIC_BASE_URL=https://example.com \
META_APP_ID=app-id \
META_APP_SECRET=secret \
META_REDIRECT_URI=https://example.com/auth/instagram/callback \
ADMIN_PASSWORD=replace-with-strong-random-password \
POLLING_INTERVAL_SECONDS=60 \
PORT=3000 \
npm start
```

정상 시작 시 다음과 유사한 로그가 출력됩니다.

```txt
Instagram auto reply admin listening on port 3000
```

중지하려면 `Ctrl+C`를 누릅니다.

## Notes

- 댓글은 기본 60초마다 확인합니다.
- 룰 삭제는 soft delete입니다.
- 런타임 DB 파일(`data/*.db`, `data/*.db-wal`, `data/*.db-shm`)은 git ignore 대상입니다.
