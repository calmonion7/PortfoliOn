# 공개 read 없음 — 모든 엔드포인트는 인증 뒤에 둔다

> Status: accepted · **구현 완료(개정 노트 2026-07-28)**. 정책·게이트 선택(authn만)·Cowork 예외는 불변. 아래 "구현 결과" 절이 3부작(task#230·231·232) 종료 시점의 실측을 기록한다.

PortfoliOn은 Cloudflare Tunnel로 공개 인터넷(`portfolion.taebro.com`)에 노출돼 있는데, 전수 감사(2026-07-28, AST 기준)에서 138개 엔드포인트 중 **46개가 무인증**이었다 — 9개는 정당한 공개 엔드포인트(register/login/refresh/logout/OAuth 콜백)이고 나머지 **37개는 전부 GET read**였다(구루 5·시장지표 17·리포트 read 9·수급 2·랭킹 1·공매도 1·검색·뉴스 2). mutation은 task#108 이후 전부 인증돼 있고 사용자별 비공개 데이터가 새는 경로는 없었지만, ① nav를 `user_menu_permissions`로 게이팅하면서 API는 열어두면 그 권한 게이트가 장식이 되고 ② 외부 fetch를 유발하는 read(검색·뉴스·컨센서스)가 비용·레이트리밋 표면이 되며 ③ `GET /report/{ticker}/{date_str}`는 외부 Cowork가 작성한 AI 분석 본문 전체를 무인증으로 내준다. 그래서 **"공개 read는 없다"를 프로젝트 정책으로 확정**하고 37개 전부에 인증을 건다(task#230·231·232 3부 진행).

게이트는 **인증(authn)만** — `Depends(get_current_user)`이며, 메뉴 권한(authz)까지 강제하지는 않는다. 엔드포인트↔메뉴 매핑은 새 개념이고 admin 우회·권한 변경 시 강제 로그아웃 같은 부수가 커서, 기존 인증 엔드포인트 92개와 동일한 관용구를 쓰는 쪽을 택했다. `user_menu_permissions`는 지금도 UI 노출 제어 용도로 남는다.

**예외 — 외부 Cowork가 읽는 엔드포인트는 `get_current_user_or_api_key`**를 쓴다(`X-API-Key` 통과). `CLAUDE_COWORK_API.md`가 문서화한 read 중 `GET /api/report/{ticker}/{date_str}`가 이 그룹이며, `get_current_user`만 걸면 Cowork enrich 워크플로우가 조용히 깨진다(형제 `GET /api/report/list`·`GET /api/report/backlog/pending`은 이미 이 의존성을 쓴다).

## 검토한 대안

- **위험군만 닫기**(AI 분석 본문 + 외부 fetch 유발 read 소수) — 가장 싸지만 "어느 것은 왜 열렸나"가 함께 기록되지 않으면 다음 사람이 헷갈리고, 부분만 닫힌 표면이 남는다.
- **구루 5개만** — 최초 발견 지점이라는 이유뿐이고 구루를 특별대우할 근거가 없어 기각.
- **정책·회귀 게이트만 세우고 코드는 그대로** — 리스크 0이지만 지금 열린 37개는 영구히 열린 채 남는다.

## 결과

- 이 정책 이후 **신규 엔드포인트는 기본이 "인증"** 이다. `auth.py`의 공개 엔드포인트(로그인·OAuth 콜백)만 예외이며, 새 공개 read를 추가하려면 그 이유를 명시해야 한다.
- 인증 의존성 추가는 자체-app 테스트(`FastAPI()`를 직접 만들어 `dependency_overrides`로 우회하는 패턴)를 401/403으로 깨뜨린다 — 감사 시점 기준 대상 테스트 파일은 17개다(CLAUDE.md의 auth-Depends 가토 참조).
- 프론트는 `api.js` 인터셉터가 토큰을 항상 붙이므로 로그인 사용자에겐 투명하다. 대신 토큰 만료 시 401 인터셉터가 강제 로그아웃시키는 기존 동작의 적용 범위가 read까지 넓어진다.

## 구현 결과 (개정 노트 2026-07-28 — task#230·231·232 완료)

3부작으로 **37개 read 전부**에 인증을 걸었다(구루·랭킹·수급·공매도 9 / 시장지표 17 / 리포트 read 9 + 검색·뉴스 2). 종료 시점 실측:

- **`/api` 138개 중 무인증 9개 = `auth.py` 공개 엔드포인트뿐**(register·login·refresh·logout + OAuth 5). 로컬 `.venv`와 **배포 컨테이너 양쪽**에서 동일 결과.
- **상시 게이트: `scripts/audit_unauth_endpoints.py`** — AST 파싱이 아니라 **라이브 `app`의 라우트를 돌며** 각 엔드포인트 함수 default가 4개 인증 의존성(`get_current_user`·`get_current_user_or_api_key`·`require_admin`·`require_admin_or_api_key`) 중 하나인지 검사한다(데코레이터·주입 실수까지 포착). ⚠️ 라우트 트리 형태가 FastAPI 버전에 따라 다르다 — 배포 이미지(0.138.1)는 include된 라우트를 `_IncludedRouter`로 감싸 `.path`를 숨기므로 `original_router`까지 재귀 하강해야 하며, 그러지 않으면 **총계 0을 내며 거짓 통과처럼 보인다**. 이 스크립트는 아직 untracked 수동 실행이라 회귀를 자동으로 막지 못한다 → **pytest 승격이 후속 과제**.
- **Cowork 예외는 `GET /api/report/{ticker}/{date_str}` 하나로 확정**됐다. 라이브에서 `X-API-Key` 정상키 200 / 잘못된 키 401 양쪽을 검증했다. `{ticker}/backlog`는 Cowork의 *쓰기*(PUT) 대상이라 read는 `get_current_user`로 충분하다.
- **위 Context의 근거 ②가 실측으로 보강됐다** — 무인증 read는 실제로 외부 API(yfinance·FRED·CNN) 호출을 유발하고 있었다. 시장지표 17개에 게이팅을 건 직후 해당 테스트 실행시간이 **21.6s → 0.14s**로 줄었는데, 이는 게이팅 전 무인증 요청이 핸들러를 지나 외부 fetch까지 도달했다는 뜻이다(비용·레이트리밋 표면이 실재했다).
- **"자체-app 테스트 17개가 깨진다"는 위 예상은 과대추정이었다.** 실제 변경은 3파일뿐(1/3에서 3, 2/3·3/3은 0) — 형제 read가 먼저 인증돼 있어 대부분 override가 선재했다. 상세는 `.forge/retro/2026-07-28-close-public-reads-3of3.md`.
