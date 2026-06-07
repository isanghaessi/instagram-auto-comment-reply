# Instagram 댓글 자동 DM 응답 MVP 설계

작성일: 2026-06-06
상태: 구현 계획 작성 전 승인된 설계

## 요약

도메인과 공개 HTTPS 서버가 있다는 전제로, Instagram Creator 또는 Business 계정 1개를 OAuth 방식으로 연결하는 self-hosted Node.js 웹 서버를 만든다. 서버는 SQLite 파일 DB에 데이터를 저장하고, 기본 60초마다 Instagram 댓글을 polling한다. 선택된 게시물에 조건과 일치하는 댓글이 달리면 설정된 메시지를 Instagram Private Reply 방식으로 자동 발송한다.

MVP에서는 Instagram Webhook을 사용하지 않는다. 댓글 감지는 서버가 주기적으로 Instagram API를 호출하는 polling 방식으로 처리한다. 따라서 공개 도메인은 OAuth callback을 위해 필요하지만, 댓글 이벤트 수신용 Webhook endpoint는 필요하지 않다.

## 목표

- 도메인과 HTTPS가 연결된 서버에서 실행한다.
- `npm start`만으로 Node.js 서버를 실행한다.
- 외부 DB 서버 없이 SQLite 파일 DB를 사용한다.
- Instagram Creator 또는 Business 계정 1개만 지원한다.
- 계정 연결은 Instagram OAuth 방식으로 처리한다.
- OAuth 성공 후 access token을 long-lived token으로 교환해 암호화 저장한다.
- 설정과 운영을 위한 친화적인 웹 UI를 제공한다.
- 연결된 Instagram 계정의 게시물 목록을 보여준다.
- 관리자가 자동응답 룰을 생성, 수정, 일시중지, 재개, soft delete 할 수 있게 한다.
- 관리자가 게시물을 선택하고, 반응할 댓글 조건과 보낼 DM 메시지를 입력할 수 있게 한다.
- 기본 60초마다 댓글을 확인한다.
- 조건과 일치하는 댓글에 대해 Private Reply를 1회 발송한다.
- 단, 연결된 Instagram 계정이 이미 좋아요를 누른 댓글은 이미 처리된 댓글로 간주하고 Private Reply를 발송하지 않는다.
- Private Reply 발송이 성공하면 해당 원댓글에 좋아요를 누른다.
- Private Reply 발송이 실패하면, 실패 유형에 따라 룰별로 설정된 fallback 대댓글 문구를 원댓글에 공개 답글로 작성한다.
- 이미 처리한 댓글과 발송 시도를 저장해 중복 DM, 중복 좋아요, 중복 fallback 대댓글을 방지한다.
- 성공, 실패, 어떤 룰에 의해 발송됐는지와 후속 댓글 액션 결과를 로그로 남긴다.

## MVP에서 제외하는 것

- Instagram Webhook.
- 팔로우 여부 확인.
- 다중 Instagram 계정 지원.
- 여러 고객이 자기 Instagram 계정을 연결하는 SaaS 형태.
- 여러 관리자 계정 또는 팀 관리.
- AI 기반 답변 생성.
- 시각적 캠페인 빌더.

## Meta App 및 심사 전제

이 MVP는 내가 소유하거나 관리하는 Instagram Professional 계정 1개를 연결하는 용도다. Meta 공식 문서 기준으로, 앱 role 사용자와 내가 소유/관리하며 App Dashboard에 추가한 Instagram Professional 계정만 사용하는 Standard Access 범위에서는 일반적으로 App Review 없이 개발/운영할 수 있다.

단, 다음으로 확장하면 Advanced Access, App Review, Business Verification이 필요할 수 있다.

- 내가 소유하거나 관리하지 않는 Instagram Professional 계정 연결.
- 외부 사용자가 각자 자기 Instagram 계정을 연결하는 SaaS 구조.
- app role 사용자가 아닌 일반 사용자를 대상으로 권한 요청.

## 필요한 Instagram 권한

OAuth에서 요청할 scope:

- `instagram_business_basic`: 계정 및 게시물 기본 정보 조회.
- `instagram_business_manage_comments`: 댓글 조회 및 관리.
- `instagram_business_manage_messages`: Private Reply 발송.
- `instagram_manage_engagement`: DM 발송 성공 후 댓글 좋아요 처리.

앱은 Instagram username/password를 저장하지 않는다. OAuth 결과로 받은 access token만 암호화해서 저장한다.

## 실행 설정

환경변수:

```env
PORT=3000
DATABASE_PATH=./data/app.db
PUBLIC_BASE_URL=https://your-domain.example.com
META_APP_ID=<Meta App ID>
META_APP_SECRET=<Meta App Secret>
META_REDIRECT_URI=https://your-domain.example.com/auth/instagram/callback
ENCRYPTION_KEY=<32-byte encryption key>
ADMIN_PASSWORD=<admin password>
POLLING_INTERVAL_SECONDS=60
```

설명:

- `PORT`: Node.js 서버 포트. 기본값은 `3000`.
- `DATABASE_PATH`: SQLite DB 파일 경로. 서버 시작 시 상위 폴더와 스키마를 자동 생성한다.
- `PUBLIC_BASE_URL`: 외부에서 접근 가능한 HTTPS 도메인. OAuth redirect와 UI 링크 생성에 사용한다.
- `META_APP_ID`: Meta Developer App의 App ID.
- `META_APP_SECRET`: Meta Developer App의 App Secret. token 교환과 갱신에 사용한다.
- `META_REDIRECT_URI`: Meta App Dashboard에 등록한 OAuth redirect URI와 정확히 일치해야 한다.
- `ENCRYPTION_KEY`: Instagram access token을 SQLite에 저장하기 전에 암호화할 때 사용하는 키.
- `ADMIN_PASSWORD`: 공개 도메인에 노출되는 관리자 UI 보호용 비밀번호.
- `POLLING_INTERVAL_SECONDS`: 댓글 polling 주기. 기본값은 `60`.

## 사용자 경험

### 관리자 로그인

도메인이 있는 서버에 배포되는 전제이므로 MVP에도 단순 관리자 로그인 화면을 둔다. 관리자는 `ADMIN_PASSWORD`로 로그인한 뒤 계정 연결과 룰 관리를 수행한다.

### Instagram 계정 연결

관리자는 웹 UI에서 **Instagram 계정 연결** 버튼을 누른다. 서버는 Instagram OAuth authorize URL로 사용자를 redirect한다.

OAuth 요청은 다음 정보를 포함한다.

- `client_id`: `META_APP_ID`.
- `redirect_uri`: `META_REDIRECT_URI`.
- `response_type`: `code`.
- `scope`: 필요한 Instagram business 권한 목록.
- `state`: CSRF 방지를 위한 임의 값.

Instagram 권한 승인이 성공하면 사용자는 `META_REDIRECT_URI`로 돌아오고, 서버는 callback의 `code`를 short-lived access token으로 교환한다. 이후 long-lived token으로 교환해 SQLite에 암호화 저장한다.

연결 성공 후 UI에는 다음 정보를 보여준다.

- Instagram username.
- Instagram account id.
- 확인 가능한 경우 account type.
- token 상태.
- token 만료 또는 갱신 가능 시각.
- 마지막 검증 시각.

### 토큰 갱신

서버는 저장된 long-lived token을 사용한다. 토큰 만료가 가까워지면 Meta refresh endpoint를 호출해 갱신을 시도한다. 갱신 실패 또는 토큰 만료 시 UI에서 재연결을 안내한다.

### 게시물 선택

게시물 선택 화면은 연결된 계정의 최근 media 목록을 보여준다. 각 게시물 카드는 다음 정보를 포함한다.

- 가능한 경우 썸네일.
- 캡션 미리보기.
- media type.
- 게시 시각.
- 가능한 경우 permalink.

관리자는 게시물 하나를 선택하고, 해당 게시물에 대한 자동응답 룰을 생성한다.

### 룰 생성 및 수정

룰은 다음 필드를 가진다.

- 룰 이름.
- 선택된 Instagram media id.
- 댓글 매칭 텍스트.
- 매칭 방식.
- 발송할 Private Reply 메시지.
- DM 실패 시 작성할 fallback 대댓글 문구.
- 활성 또는 일시중지 상태.

MVP 매칭 방식:

- `contains_any`: 쉼표로 구분된 단어 중 하나라도 댓글에 포함되면 매칭한다.
- 대소문자는 구분하지 않는다.
- 각 키워드의 앞뒤 공백은 제거한다.

Private Reply 메시지와 DM 실패 시 fallback 대댓글 문구는 모두 plain text만 지원한다. 링크는 일반 텍스트로 포함할 수 있다. 이미지, 버튼, quick reply 같은 rich message는 MVP 범위에 포함하지 않는다.

DM 실패 fallback 문구는 룰마다 설정한다. 예: `DM을 보낼 수 없어 댓글로 안내드려요. 프로필 링크를 확인해주세요.`

### 룰 관리

룰 목록에서는 다음 작업을 지원한다.

- 활성 룰과 일시중지 룰 보기.
- 룰 필드 수정.
- 룰 일시중지 및 재개.
- 룰 삭제.

삭제는 soft delete로 처리한다.

soft delete 동작:

- `deleted_at`에 현재 시각을 저장한다.
- `is_active`를 false로 변경한다.
- 기본 룰 목록에서는 숨긴다.
- 과거 발송 로그에서 어떤 룰에 의해 발송됐는지 추적할 수 있도록 DB row는 보존한다.

### 댓글 액션 정책

조건과 일치한 댓글에 대한 액션 순서는 다음과 같다.

1. 댓글 조회 결과에서 연결된 Instagram 계정이 이미 해당 댓글에 좋아요를 눌렀는지 확인한다.
2. 이미 좋아요를 누른 댓글이면 이미 처리된 댓글로 간주해 Private Reply, 추가 좋아요, fallback 대댓글을 모두 수행하지 않는다. 이 skip 결과는 `reply_logs`에 남겨 같은 룰과 댓글 조합이 다음 polling에서 반복 평가되지 않게 한다.
3. 이미 좋아요가 눌리지 않은 댓글에만 Instagram Private Reply를 발송한다.
4. Private Reply가 성공하면 원댓글에 좋아요를 누른다. 이 좋아요는 이후 같은 댓글을 이미 처리된 댓글로 식별하는 보조 신호가 된다.
5. Private Reply가 실패하고, 실패 원인이 상대방의 DM 수신 불가/차단/대화 불가처럼 사용자별 deliverability 문제로 분류되면 룰에 설정된 fallback 대댓글 문구를 원댓글에 공개 답글로 작성한다.
6. 토큰 만료, 권한 부족, rate limit, Meta API 장애, 네트워크 장애처럼 시스템성 실패로 분류되는 경우에는 공개 대댓글을 작성하지 않고 로그만 남긴다.

중복 방지 원칙:

- 연결된 Instagram 계정이 이미 좋아요를 누른 댓글은 같은 룰과 댓글 조합에 대해 Private Reply를 시도하지 않는다.
- 같은 룰과 댓글 조합에 대해 Private Reply는 1회만 시도한다.
- DM 성공 후 댓글 좋아요도 1회만 시도한다.
- DM 실패 fallback 대댓글도 1회만 시도한다.
- 서버 재시작 후에도 DB 로그를 기준으로 같은 댓글에 반복 액션을 수행하지 않는다.

### 로그

발송 로그 UI는 다음 정보를 보여준다.

- 룰 이름.
- 게시물 캡션 미리보기 또는 media id.
- 댓글 내용.
- 가능한 경우 댓글 작성자 username 또는 id.
- Private Reply 발송 상태.
- 댓글 좋아요 상태.
- fallback 대댓글 작성 상태.
- 실패 시 error message.
- 시각.

## 데이터 모델

### `accounts`

- `id`
- `instagram_user_id`
- `username`
- `account_type`
- `access_token_encrypted`
- `token_expires_at`
- `token_last_refreshed_at`
- `token_last_verified_at`
- `created_at`
- `updated_at`

### `oauth_states`

- `id`
- `state`
- `created_at`
- `consumed_at`

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
- `dm_failure_reply_message`
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
- `dm_status`
- `comment_like_status`
- `fallback_reply_status`
- `fallback_reply_comment_id`
- `request_payload_json`
- `response_payload_json`
- `error_message`
- `sent_at`
- `created_at`

### 중복 발송 방지

앱은 다음 조합에 대해 uniqueness를 보장해 중복 발송을 막는다.

- `rule_id`
- `instagram_comment_id`

서버가 재시작되더라도 기존 `reply_logs`와 `comment_events`를 기준으로 같은 댓글에 대한 반복 발송과 반복 후속 액션을 방지한다. 이미 좋아요가 눌려 skip된 댓글도 `reply_logs`에 `dm_status = skipped`, `comment_like_status = skipped`, `fallback_reply_status = skipped` 형태로 남겨 반복 평가를 막는다.

## Polling 흐름

기본 60초마다 다음 과정을 실행한다.

1. 연결된 Instagram 계정과 token 상태를 확인한다.
2. 활성 상태이고 삭제되지 않은 룰을 불러온다.
3. 룰을 선택된 media 기준으로 그룹화한다.
4. 각 media id에 대해 최근 댓글을 조회한다. 댓글 조회에는 가능한 경우 연결된 Instagram 계정의 해당 댓글 좋아요 여부를 판별할 수 있는 필드를 포함한다.
5. 새로 관측된 댓글을 `comment_events`에 저장한다.
6. 각 댓글을 해당 media의 활성 룰과 매칭한다.
7. 같은 룰과 댓글 조합의 발송 로그가 이미 있으면 건너뛴다.
8. 댓글이 매칭되었더라도 연결된 Instagram 계정이 이미 해당 댓글에 좋아요를 누른 상태라면 DM을 발송하지 않고 skip 로그를 저장한다.
9. 좋아요가 눌리지 않은 댓글에 대해서만 룰의 `reply_message`로 Instagram Private Reply를 발송한다.
10. DM 발송 성공 시 해당 원댓글에 좋아요를 누른다.
11. DM 발송 실패가 사용자별 deliverability 문제로 분류되면 룰의 `dm_failure_reply_message`로 원댓글에 fallback 대댓글을 작성한다.
12. DM, 댓글 좋아요, fallback 대댓글 결과를 `reply_logs`에 저장한다.

Polling loop는 중첩 실행을 피해야 한다. 이전 polling이 아직 실행 중이면 다음 tick은 건너뛰고 로그를 남긴다.

## 에러 처리

- OAuth 설정 오류: App ID, App Secret, Redirect URI 불일치 여부를 UI와 서버 로그에 표시한다.
- OAuth state 불일치: callback을 거부하고 재연결을 안내한다.
- 권한 승인 거부: 계정을 연결하지 않고 다시 연결 버튼을 보여준다.
- token 교환 실패: 원인 메시지를 로그에 남기고 계정 연결 실패로 처리한다.
- 만료된 token: 계정을 disconnected 상태로 표시하고 재연결 안내를 보여준다.
- 권한 부족: media 조회, 댓글 조회, 메시지 발송 중 어떤 기능이 실패했는지 보여준다.
- API rate limit: 에러를 로그에 남기고 다음 polling 주기에 다시 시도한다.
- 이미 좋아요가 눌린 댓글: 연결된 Instagram 계정이 이미 좋아요를 누른 것으로 명시적으로 확인되면 Private Reply를 발송하지 않고 skip 로그를 남긴다. 단순 `like_count`처럼 총 좋아요 수만으로는 이미 처리된 댓글이라고 판단하지 않는다.
- Private Reply 실패: 실패 내용을 `reply_logs`에 저장한다. 사용자별 deliverability 실패로 분류되면 룰별 fallback 대댓글을 1회 작성한다. 시스템성 실패로 분류되면 공개 대댓글을 작성하지 않는다.
- 댓글 좋아요 실패: DM 발송 자체는 성공으로 유지하고, 좋아요 실패만 별도 상태로 로그에 남긴다.
- fallback 대댓글 실패: 실패 내용을 `reply_logs`에 저장하고 자동 재시도는 하지 않는다.
- DB 에러: 서버 로그에 기록하고 UI에는 일반적인 에러 메시지를 보여준다.

## 보안

- Instagram username/password는 절대 저장하지 않는다.
- Access token은 SQLite에 저장하기 전에 암호화한다.
- Access token과 App Secret을 로그에 출력하지 않는다.
- OAuth callback에서는 `state`를 검증해 CSRF를 방지한다.
- 관리자 UI는 최소한 `ADMIN_PASSWORD` 기반 로그인으로 보호한다.
- HTTPS 뒤에서 실행하는 것을 전제로 한다.
- `.env`와 SQLite DB 파일은 git에 포함하지 않는다.
- request/response payload 로그에는 댓글 내용과 식별자가 포함될 수 있으므로 민감 정보로 취급한다.

## 구현 접근

작은 Node.js 서버로 구현한다.

- HTTP route: Express 또는 Fastify.
- UI: 서버 렌더링 HTML + 최소한의 client-side JavaScript.
- DB: `better-sqlite3`.
- OAuth: 직접 route 구현 또는 가벼운 helper 사용.
- 서버 시작 시 DB schema를 생성 또는 갱신하는 migration step 실행.
- 같은 Node process 안에서 background polling loop 실행.

MVP에는 React, Next.js, Instagram Webhook infrastructure, 외부 queue system이 필요하지 않다.

## 검증 계획

MVP 완료 판단 전에 다음을 확인한다.

- 깨끗한 checkout에서 서버가 시작되는지 확인한다.
- SQLite DB 파일과 테이블이 자동 생성되는지 확인한다.
- 관리자 로그인 없이 설정 화면에 접근할 수 없는지 확인한다.
- Meta OAuth authorize URL이 올바르게 생성되는지 확인한다.
- OAuth callback에서 `state` 검증이 동작하는지 확인한다.
- OAuth code를 access token으로 교환하고 long-lived token으로 저장하는지 확인한다.
- 유효한 token으로 계정 metadata가 표시되는지 확인한다.
- OAuth scope에 `instagram_manage_engagement`가 포함되어 댓글 좋아요 권한을 요청하는지 확인한다.
- 게시물 목록을 가져오고 게시물을 선택할 수 있는지 확인한다.
- 룰 생성, 수정, 일시중지, 재개, soft delete가 동작하는지 확인한다.
- soft-deleted 룰은 실행되지 않지만 DB에는 남아 있는지 확인한다.
- 통제된 테스트 게시물에서 polling loop를 실행한다.
- 매칭되지 않는 댓글에는 reply가 발송되지 않는지 확인한다.
- 매칭되는 댓글에는 Private Reply 발송 시도가 1회 기록되는지 확인한다.
- 연결된 Instagram 계정이 이미 좋아요를 누른 댓글에는 Private Reply가 발송되지 않고 skip 로그가 남는지 확인한다.
- Private Reply 성공 시 원댓글 좋아요가 1회 시도되고 로그에 기록되는지 확인한다.
- Private Reply가 사용자별 deliverability 실패로 분류될 때 룰별 fallback 대댓글이 1회 작성되고 로그에 기록되는지 확인한다.
- Private Reply가 시스템성 실패로 분류될 때 fallback 대댓글이 작성되지 않는지 확인한다.
- 서버 재시작 후 같은 댓글에 다시 reply, 좋아요, fallback 대댓글이 수행되지 않는지 확인한다.

## 남은 리스크

- Meta API 동작과 권한 정책은 변경될 수 있으므로 OAuth 설정 가이드는 최신 상태로 관리해야 한다.
- 내 계정 1개가 아닌 외부 사용자 계정 연결로 확장하면 App Review와 Business Verification이 필요할 수 있다.
- Polling 방식은 실시간이 아니다. 기본 설정에서는 최대 약 60초와 API latency만큼 응답이 지연될 수 있다.
- Private Reply 제약은 Instagram이 강제한다. 실패한 발송은 로그에서 확인 가능해야 한다.
- Instagram API의 실패 응답만으로 사용자별 deliverability 실패와 시스템성 실패를 완벽히 구분하지 못할 수 있다. 분류가 불확실하면 공개 대댓글을 작성하지 않는 보수적 정책을 기본으로 한다.
- 댓글 좋아요 여부 판정은 연결된 Instagram 계정이 해당 댓글을 좋아요 했다는 명시적 필드 또는 API 응답이 있을 때만 사용한다. API가 총 좋아요 수만 제공하거나 내 계정의 좋아요 여부를 확인할 수 없으면 이 조건으로 DM을 skip하지 않는다.
- 댓글 좋아요 API는 Meta Instagram Platform changelog 기준 `instagram_manage_engagement` 권한이 필요하므로, 해당 권한을 사용할 수 없는 경우 DM 성공 표시용 좋아요 기능은 비활성화해야 한다.
