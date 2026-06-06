# Instagram 댓글 자동 DM 응답 MVP 설계

작성일: 2026-06-06
상태: 구현 계획 작성 전 승인된 설계

## 요약

로컬에서 실행되는 가벼운 self-hosted Node.js 웹 서버를 만든다. 서버는 SQLite 파일 DB에 데이터를 저장하고, 기본 60초마다 Instagram 댓글을 polling한다. 선택된 게시물에 조건과 일치하는 댓글이 달리면 설정된 메시지를 Instagram Private Reply 방식으로 자동 발송한다.

MVP에서는 OAuth, Webhook, 커스텀 도메인, 공개 HTTPS endpoint를 사용하지 않는다. 관리자는 웹 UI에서 Instagram Creator 또는 Business 계정의 long-lived access token을 직접 붙여넣어 계정을 연결한다.

## 목표

- `npm start`만으로 로컬에서 실행한다.
- 외부 DB 서버 없이 SQLite 파일 DB를 사용한다.
- Instagram Creator 또는 Business 계정 1개만 지원한다.
- 계정 연결은 access token 직접 입력 방식으로 처리한다.
- 설정과 운영을 위한 친화적인 웹 UI를 제공한다.
- 연결된 Instagram 계정의 게시물 목록을 보여준다.
- 관리자가 자동응답 룰을 생성, 수정, 일시중지, 재개, soft delete 할 수 있게 한다.
- 관리자가 게시물을 선택하고, 반응할 댓글 조건과 보낼 DM 메시지를 입력할 수 있게 한다.
- 기본 60초마다 댓글을 확인한다.
- 조건과 일치하는 댓글에 대해 Private Reply를 1회 발송한다.
- 이미 처리한 댓글과 발송 시도를 저장해 중복 발송을 방지한다.
- 성공, 실패, 어떤 룰에 의해 발송됐는지를 로그로 남긴다.

## MVP에서 제외하는 것

- OAuth 로그인 흐름.
- Instagram Webhook.
- 공개 도메인, HTTPS callback, ngrok, Cloudflare Tunnel 필수 요구사항.
- 팔로우 여부 확인.
- 다중 Instagram 계정 지원.
- 여러 관리자 계정 또는 팀 관리.
- SaaS 배포.
- AI 기반 답변 생성.
- 시각적 캠페인 빌더.

## 필요한 Instagram 토큰

앱은 외부에서 발급된 long-lived Instagram access token을 입력받는다. 이 토큰은 Instagram Professional 계정, 즉 Creator 또는 Business 계정에 속해야 한다.

필요 권한:

- `instagram_business_basic`: 계정 및 게시물 기본 정보 조회.
- `instagram_business_manage_comments`: 댓글 조회 및 관리.
- `instagram_business_manage_messages`: Private Reply 발송.

앱은 Instagram username/password를 저장하지 않는다. 사용자가 붙여넣은 access token만 암호화해서 저장한다.

## 실행 설정

환경변수:

```env
PORT=3000
DATABASE_PATH=./data/app.db
ENCRYPTION_KEY=<32-byte encryption key>
POLLING_INTERVAL_SECONDS=60
```

설명:

- `PORT`: 로컬 웹 UI 포트. 기본값은 `3000`.
- `DATABASE_PATH`: SQLite DB 파일 경로. 서버 시작 시 상위 폴더와 스키마를 자동 생성한다.
- `ENCRYPTION_KEY`: Instagram access token을 SQLite에 저장하기 전에 암호화할 때 사용하는 키.
- `POLLING_INTERVAL_SECONDS`: 댓글 polling 주기. 기본값은 `60`.

## 사용자 경험

### 계정 연결

로컬 관리자는 `http://localhost:3000`에 접속한 뒤 계정 연결 페이지에서 long-lived access token을 붙여넣고 **검증 후 연결** 버튼을 누른다. MVP는 로컬 전용 사용을 전제로 하므로 별도 관리자 로그인 화면은 포함하지 않는다.

서버는 입력된 토큰으로 Instagram API를 호출해 계정 정보를 가져오고, 기본 게시물 조회가 가능한지 확인한다. 성공하면 UI에 다음 정보를 보여준다.

- Instagram username.
- Instagram account id.
- 확인 가능한 경우 account type.
- token 상태.
- 마지막 검증 시각.

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
- 발송할 reply message.
- 활성 또는 일시중지 상태.

MVP 매칭 방식:

- `contains_any`: 쉼표로 구분된 단어 중 하나라도 댓글에 포함되면 매칭한다.
- 대소문자는 구분하지 않는다.
- 각 키워드의 앞뒤 공백은 제거한다.

reply message는 plain text만 지원한다. 링크는 일반 텍스트로 포함할 수 있다. 이미지, 버튼, quick reply 같은 rich message는 MVP 범위에 포함하지 않는다.

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

### 로그

발송 로그 UI는 다음 정보를 보여준다.

- 룰 이름.
- 게시물 캡션 미리보기 또는 media id.
- 댓글 내용.
- 가능한 경우 댓글 작성자 username 또는 id.
- 발송 상태.
- 실패 시 error message.
- 시각.

## 데이터 모델

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

### 중복 발송 방지

앱은 다음 조합에 대해 uniqueness를 보장해 중복 발송을 막는다.

- `rule_id`
- `instagram_comment_id`

서버가 재시작되더라도 기존 `reply_logs`와 `comment_events`를 기준으로 같은 댓글에 대한 반복 발송을 방지한다.

## Polling 흐름

기본 60초마다 다음 과정을 실행한다.

1. 활성 상태이고 삭제되지 않은 룰을 불러온다.
2. 룰을 선택된 media 기준으로 그룹화한다.
3. 각 media id에 대해 최근 댓글을 조회한다.
4. 새로 관측된 댓글을 `comment_events`에 저장한다.
5. 각 댓글을 해당 media의 활성 룰과 매칭한다.
6. 같은 룰과 댓글 조합의 발송 로그가 이미 있으면 건너뛴다.
7. 룰의 `reply_message`로 Instagram Private Reply를 발송한다.
8. 성공 또는 실패 결과를 `reply_logs`에 저장한다.

Polling loop는 중첩 실행을 피해야 한다. 이전 polling이 아직 실행 중이면 다음 tick은 건너뛰고 로그를 남긴다.

## 에러 처리

- 유효하지 않은 토큰: 연결 에러를 보여주고 토큰을 저장하지 않는다.
- 만료된 토큰: 계정을 disconnected 상태로 표시하고 재연결 안내를 보여준다.
- 권한 부족: media 조회, 댓글 조회, 메시지 발송 중 어떤 기능이 실패했는지 보여준다.
- API rate limit: 에러를 로그에 남기고 다음 polling 주기에 다시 시도한다.
- Private Reply 실패: 실패 내용을 `reply_logs`에 저장한다. 명시적인 retry 정책이 추가되기 전까지 자동 재시도는 하지 않는다.
- DB 에러: 서버 로그에 기록하고 UI에는 일반적인 에러 메시지를 보여준다.

## 보안

- Instagram username/password는 절대 저장하지 않는다.
- Access token은 SQLite에 저장하기 전에 암호화한다.
- Access token을 로그에 출력하지 않는다.
- MVP는 로컬 전용 사용을 전제로 하므로 서버는 기본적으로 localhost에 bind한다.
- `.env`와 SQLite DB 파일은 git에 포함하지 않는다.
- request/response payload 로그에는 댓글 내용과 식별자가 포함될 수 있으므로 민감 정보로 취급한다.

## 구현 접근

작은 Node.js 서버로 구현한다.

- HTTP route: Express 또는 Fastify.
- UI: 서버 렌더링 HTML + 최소한의 client-side JavaScript.
- DB: `better-sqlite3`.
- 서버 시작 시 DB schema를 생성 또는 갱신하는 migration step 실행.
- 같은 Node process 안에서 background polling loop 실행.

MVP에는 React, Next.js, OAuth library, webhook infrastructure, 외부 queue system이 필요하지 않다.

## 검증 계획

MVP 완료 판단 전에 다음을 확인한다.

- 깨끗한 checkout에서 서버가 시작되는지 확인한다.
- SQLite DB 파일과 테이블이 자동 생성되는지 확인한다.
- 잘못된 토큰을 입력했을 때 친화적인 에러가 표시되는지 확인한다.
- 유효한 토큰을 입력했을 때 계정 metadata가 표시되는지 확인한다.
- 게시물 목록을 가져오고 게시물을 선택할 수 있는지 확인한다.
- 룰 생성, 수정, 일시중지, 재개, soft delete가 동작하는지 확인한다.
- soft-deleted 룰은 실행되지 않지만 DB에는 남아 있는지 확인한다.
- 통제된 테스트 게시물에서 polling loop를 실행한다.
- 매칭되지 않는 댓글에는 reply가 발송되지 않는지 확인한다.
- 매칭되는 댓글에는 Private Reply 발송 시도가 1회 기록되는지 확인한다.
- 서버 재시작 후 같은 댓글에 다시 reply가 발송되지 않는지 확인한다.

## 남은 리스크

- Meta API 동작과 권한 정책은 변경될 수 있으므로 토큰 발급 가이드는 최신 상태로 관리해야 한다.
- Access token 직접 입력 방식은 OAuth보다 사용자 친화적이지 않지만, 로컬-only MVP 제약에는 가장 잘 맞는다.
- Polling 방식은 실시간이 아니다. 기본 설정에서는 최대 약 60초와 API latency만큼 응답이 지연될 수 있다.
- Private Reply 제약은 Instagram이 강제한다. 실패한 발송은 로그에서 확인 가능해야 한다.
