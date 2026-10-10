# PortfoliOn — Project Context

> **이 파일은 매 세션 항상 로드된다.** 작업별·디렉터리별 지식은 필요할 때만 읽히도록 아래로 분리돼 있다 —
> 해당 작업에 들어가면 **그쪽을 먼저 읽을 것**:
>
> | 어디 | 무엇 | 언제 로드되나 |
> |---|---|---|
> | `backend/CLAUDE.md` | 백엔드 모듈·외부 데이터소스(키움·KIS·DART·FRED) 인벤토리 | `backend/` 아래 작업 시 자동 |
> | `frontend/CLAUDE.md` | Vite·색 토큰·nav 단일소스·차트 규약 | `frontend/` 아래 작업 시 자동 |
> | `.claude/skills/live-uat-probes/` | 라이브 UAT 프로브 결함 9클래스·판정축·신뢰성 20규칙 | 프로브 저작·시각 검증 시 **호출** |
> | `.claude/skills/subagent-orchestration/` | 병렬 서브에이전트 오염 6방향 사례사 | 워크플로우 설계 시 **호출** |
> | `.claude/skills/verification-gates/` | 정지조건·감사·baseline·fault injection 설계 규율 | 게이트 설계·검증 시 **호출** |
> | `.claude/skills/deploy-ops/` | 배포 메커니즘·라이브 장애 진단 런북 | 배포·502·러너/폴러 진단 시 **호출** |
> | `backend/services/` · `routers/` · `tests/` 의 `CLAUDE.md` | 외부소스·저장 가드 / Pydantic·응답 계약 / 테스트 함정 | 해당 폴더 작업 시 자동 |
>
> 코드 리뷰·구현 태도(가정 명시·최소 구현·수술적 변경·검증 가능한 완료기준)는 **조직 정책으로 매 세션 주입되므로**
> 여기 중복해 싣지 않는다.

## Commands

```bash
# Backend tests
cd backend && .venv/bin/python -m pytest
```

## Architecture

**Backend** — Python/FastAPI (port 8000) · **Frontend** — React 19 + Vite (port 5173), plain CSS (no TailwindCSS)

디렉터리·모듈 목록은 `ls`로 확인할 것. 코드만 봐서는 **틀리게 읽기 쉬운 것**만 남긴다:

- `backend/scheduler/`는 APScheduler 설정 **패키지**다(services 아님, 루트 레벨 — `__init__.py`(잡 배선·`_JOB_FUNCS`)·`jobs.py`·`schedule.py`·`_state.py`). 단일 `scheduler.py`가 **아니다**(task#120 정정).
- `backend/data/`는 **정적 참조 데이터만**(sp500_tickers.json·kospi_tickers.json). 런타임 데이터는 전부 Docker PostgreSQL.
- 캘린더 라이브 캐시는 PostgreSQL `calendar_cache` 테이블 — **레거시 파일 캐시는 task#167에서 제거**됐다.
- `backend/snapshots/`(gitignored)·`backend/reports/`(legacy, read-only)는 옛 스냅샷 JSON 폴백 경로다.
- 프론트 화면은 **허브 2종**으로 묶여 있다: Research(홈 `/` — 리포트·랭킹·다이제스트·캘린더, 리포트 탭이 보유/관심 종목 관리를 흡수), MarketHub(=Market, 시장지표·수급지표 2탭). 섹터·매크로 탭은 Portfolio 분석탭으로 통합됐다.

## Deployment

- **인프라**: Mac 로컬 Docker 3-컨테이너 — postgres(compose)·backend·nginx(`deploy.sh`의 `docker run`) (Render/Vercel/Supabase 제거)
- **nginx**: HTTP(80) 서빙, /api/* → backend:8000 프록시
- **TLS**: Cloudflare 터널이 종단한다 — nginx는 루프백 :80만 받고 인증서 컨테이너는 없다(task#384에서 은퇴).
- **Cloudflare Tunnel**: portfolion.taebro.com → localhost:80 (cloudflared는 compose 컨테이너가 아니라 launchd로 실행)
- **launchd 자동실행**: cloudflared + docker compose
- **환경변수**: `backend/.env.docker` (DATABASE_URL, JWT_SECRET, SESSION_SECRET, OAuth, FRED_API_KEY, KOFIA_API_KEY) · `backend/.env` (로컬 venv·pytest용 DATABASE_URL) · `.env` (루트 — **`POSTGRES_PASSWORD`**, docker-compose 보간 전용). ⚠️ **DB 비밀번호를 바꾸면 이 3개를 함께 갱신해야 한다**(`scripts/rotate-postgres-password.sh`). `POSTGRES_PASSWORD`는 `backend/.env.docker`가 아니라 **루트 `.env`**에 있고, task#334에서 폴백을 제거해 **미설정이면 `docker compose`가 실패**한다(전엔 tracked 폴백값으로 조용히 떴고 그 값이 공개 저장소에 커밋돼 실운영 크리덴셜이었다 — B21).
- **배포 핵심 규칙 — 상세 런북·증상별 진단은 `.claude/skills/deploy-ops`(배포·라이브 장애를 다룰 땐 먼저 호출)**:
  - `git push origin main`이 곧 배포다 — self-hosted 러너(`~/actions-runner-portfolion`, arm64)와 launchd 폴러(2분 주기) 중 먼저 온 쪽이 배포하고 다른 쪽은 배포 기록을 보고 건너뛴다. 둘 다 **origin/main(=push된 것)만** 배포하므로 **commit과 push를 묶을 것**. 수동 `bash deploy.sh`는 선택(기록과 무관한 강제 재배포, 겹치면 잠금 exit 2로 거부).
  - `docker compose build` / `docker compose up` 같은 **ad-hoc 재빌드 금지**. 백엔드 컨테이너 재생성이 필요하면 정식 스크립트 `bash deploy.sh` 1회.
  - 배포 판정은 exit 0·`/health` ok가 아니라 **`배포된 커밋: <SHA> <제목>` 줄**, 폴러 로그 `~/Library/Logs/com.portfolion.auto-deploy-poll.log`의 `Deploy complete: <SHA>`, `~/.portfolion-deployed-sha`로 한다.
  - `deploy.sh`가 `npm run build`까지 돌리므로 **push 하나로 프론트도 ~20초 뒤 라이브**다 — 라이브를 재는 에이전트가 도는 동안에는 push·빌드·`deploy.sh`·컨테이너 재기동이 전부 배포성 행위라 하지 말 것. 라이브 red-first가 필요하면 push **전에** 돌린다.
  - 러너 재설치·등록(`config.sh`·`svc.sh`)은 에이전트 하드 차단 — 사람 몫이다(`!`로 실행할 스크립트로 넘길 것).
  - 폴러는 **작업트리의** `scripts/auto-deploy-poll.sh`를 그대로 실행한다 — 그 파일을 고치기 전에 `~/.portfolion-deployed-sha` == origin/main(no-op 상태)인지 확인할 것.
  - **`.forge/CONTEXT.md`·`.forge/adr/`·`.forge/retro/`는 tracked다**(forge 스킬들의 「gitignored」 전제와 다르다) — 코드와 같은 커밋에 담을 것. `.forge/done/`·`backlog/`·`loop.md` 등은 untracked.
  - 배포가 안 된 것 같으면 폴러 footgun을 단정하기 전에 `gh run list`(시각은 **UTC**)·러너 상태·폴러 로그부터 볼 것.

## Key Files

- `API_SPEC.md` — full REST API reference (source of truth for endpoints)
- `CLAUDE_COWORK_API.md` — external API for Claude AI to read/write stock analysis
- `backend/auth_schema.sql` — Docker PostgreSQL 인증 스키마 (users, refresh_tokens); 반드시 app_schema.sql보다 먼저 실행
- `backend/app_schema.sql` — Docker PostgreSQL 앱 스키마
- `backend/.venv/` — Python virtual environment (macOS: `backend/.venv/bin/python`, Windows: `backend/.venv/Scripts/python`)

## Data Model

Docker PostgreSQL이 기본 저장소. 로컬 JSON 파일은 런타임 캐시 용도.
**테이블·컬럼의 정본은 `backend/app_schema.sql`(앱)·`backend/auth_schema.sql`(인증)이다** — 목록을 여기 복제하지 않는다.

- **스키마 실행 순서: `auth_schema.sql` → `app_schema.sql`** (역순이면 FK가 깨진다).
- 로컬 파일 캐시(gitignored)는 `backend/data/consensus/` per-ticker 컨센서스 하나뿐이다. **캘린더는 로컬 파일 캐시가 없다** — 라이브는 `calendar_cache` DB 테이블(task#167에서 파일 캐시 제거).

## Gotchas

- **라이브 UAT 프로브의 결함 클래스·판정축·신뢰성 규율은 `.claude/skills/live-uat-probes` 스킬로 분리됐다 (task#225~304 누적)** — 프로브(`scripts/uat*.mjs`)를 새로 짜거나 고칠 때, **시각·레이아웃을 바꾸는 변경을 검증할 때**, 프로브가 ALL PASS인데 화면이 깨져 보일 때는 **먼저 그 스킬을 호출할 것**. 담고 있는 것: 시각 결함 9클래스(넘침·잘림 ellipsis·flex 접힘·요소 간 간격·색 미적용·SVG 좌표계·AT 프루닝·min-content·이웃 열로의 비용 이전), 프로브 신뢰성 20규칙(ⓐ~ⓣ — 커버리지 카운터·정의역 sentinel·대조군·identity·성분 분해), 하니스 제약(SW가 `/api/*`를 가로채니 `serviceWorkers:'block'` 필수 / bfcache·탭 전환은 자동화로 관측 불가 → 핀 단언으로 박제), admin 표면 UAT 4대안, jsdom·recharts 한계. **핵심 2줄만 여기 남긴다:** ⓐ 시각을 바꾸는 변경은 프로브 PASS 후에도 **육안 스크린샷 1장**을 완료기준에 넣을 것(그것이 유일한 포착 수단이었던 사례 6회). ⓑ 완료기준은 대리지표가 아니라 **목표 자체**로 쓰고, "이 단언이 통과하면서도 깨질 수 있는 방식"을 계획 시점에 한 줄 적을 것.

- **⭐ LLM 세션에 「프로덕션에 쓰지 마라」는 가드가 아니다 — 무부작용 실험은 *구조적으로* 불가능하게 만들고, 그 가드의 차단 카운트를 산출로 남길 것(task#350 실측 36건)**: A/B 섀도 하네스의 원안은 「섀도 프롬프트(저장하지 마라) + 사후 prod 행 카운트」였다. 착수 전 **쓰기 차단 프록시 + 더미 API 키 2겹**으로 바꿨더니 본 실행 20표본에서 프록시가 **쓰기 36건을 실제로 차단**했다 — 원안대로였으면 그만큼이 prod에 들어갔고, 기술 리포트는 `slug` upsert라 복구 불가였다. 사후 카운트는 사고를 *발견*하지 *방지*하지 못하고, 프롬프트 지시는 모델이 따를 때만 작동한다. 실천 3가지: ⓐ 외부 세션(루틴·OpenCode·`claude -p`)이 prod API를 볼 수 있는 실험은 **쓰기 메서드를 물리적으로 막는 계층**(프록시·읽기전용 키·별도 DB)을 먼저 세울 것 ⓑ 그 계층의 **차단 카운트를 산출물에 포함**할 것 — 0이면 「무해했다」가 아니라 「가드를 안 탔다」일 수 있다(대조군: 진짜 키 GET 200·더미 키 POST 401을 쌍으로) ⓒ 우회 지시(발행 게이트 무시 등)는 트리거에 넣되 **「어차피 저장되지 않는다」는 모델에게 알리지 말 것** — 알면 덜 노력해 품질 측정이 오염된다. 부수: 본 실행 전 **파일럿 1건은 필수**다 — 표본 선정과 대상 시스템의 게이트(7일 발행 게이트)가 충돌해 첫 발사가 38초 빈손 종료했고, 「분량」 축이 DB 블롭 vs 요청 본문을 비교해 4배 오표기했던 것을 파일럿만이 잡았다.

- **⭐ 병렬 서브에이전트에게 `git stash`·`checkout`·`restore`·`reset`과 프론트 빌드(`npm run build`·`vite build`)를 금지할 것 — 작업트리 전역 변형은 형제의 *측정 대상*을 바꾸고, 그 오염은 "재현 불가 flake"로 오귀속된다.** 프론트 빌드는 nginx가 `frontend/dist`를 직접 서빙하므로 이름이 "문법 확인"이어도 **배포 행위**다. **그리고 오케스트레이터 자신도 같은 규칙의 적용 대상이다** — 라이브를 재는 에이전트가 도는 동안 메인 세션도 배포성 행위(빌드·`deploy.sh`·컨테이너 재기동)를 하지 말 것. 나머지 4대 원칙: ① 파일 내 fault-injection은 **파일당 주입자가 1명일 때만** 안전하다 ② 병렬 wave의 완료기준은 **자기 소유 파일의 표적 테스트**로 좁힐 것(전체 스위트는 파일이 안 겹쳐도 형제의 미완 상태를 본다) ③ **문서·프로브 갱신 슬라이스는 코드 wave와 적대 검토가 끝난 뒤 직렬 단계**로 둘 것(형제의 미완 상태가 박제되고, 리뷰가 계약을 바꾸면 프로브가 통째로 스테일해진다) ④ 프롬프트에 코드 예시를 인용할 땐 `${`를 `\${`로 이스케이프할 것(평가되면 thunk가 죽고 **`agents_error: 0`으로 조용히** 보고된다 — 완료 시 `<failures>`와 결과 키의 null을 반드시 확인). **6가지 오염 방향의 실측 사례사와 처방 근거는 `.claude/skills/subagent-orchestration` 스킬에 있다.**

- **백엔드 모듈·외부 데이터소스 인벤토리는 `backend/CLAUDE.md`로 분리됐다** (키움·KIS·DART·FRED·KOFIA·관세청·yfinance 연동, `market_indicators/` 패키지, 캐시 6종, 라우터·서비스 지도 — 21항목). `backend/` 아래 파일을 만질 때 자동 로드된다. **외부 소스의 파싱 규약이 필요하면 그 파일을 먼저 읽을 것** — 응답 봉투·필드 스케일·필수 파라미터 함정이 거기 있다.

- **프론트 전용 규약은 `frontend/CLAUDE.md`로 분리됐다** (Vite 8 = rolldown 청크 분할, KR 색 관례 토큰(가격 up/down ↔ 의미 success/danger 교차 사용 금지), `navSections.js` nav 단일 소스, market 차트 dual-axis·`krFmt` 단위, Vite proxy — 5항목). `frontend/` 아래 파일을 만질 때 자동 로드된다.

- **루트에서 분리된 Gotchas (2026-10-10)**: 검증·게이트 설계 규율은 `.claude/skills/verification-gates`(정지조건·감사·fault injection 작업 시 **호출**), 배포·운영 런북은 `.claude/skills/deploy-ops`, 외부소스 파싱·저장 가드는 `backend/services/CLAUDE.md`, Pydantic·응답 계약은 `backend/routers/CLAUDE.md`, 테스트 함정은 `backend/tests/CLAUDE.md`(각 폴더 작업 시 자동 로드).

- **테스트는 conftest `_block_real_db` autouse 가드가 실 DB 접근을 막는다 — 가드가 raise하면 풀지 말고 `services.db`(query/execute)를 mock할 것**(로컬 `DATABASE_URL`이 라이브 DB를 가리킨다; 상세 사례는 `backend/tests/CLAUDE.md`).

- **신규 DB 컬럼은 `app_schema.sql`만으론 배포에 반영 안 됨 — `main.py _migrate`에 `ADD COLUMN IF NOT EXISTS`를 쌍으로 추가 필수(DoD)**: 스키마 파일은 신규 설치용이고 라이브 DB는 기동 idempotent 마이그레이션(ADR-0006)만 탄다. 한쪽만 고치면 배포 직후 그 컬럼을 쓰는 INSERT/SELECT가 컬럼 부재로 깨진다(`stock_recommendations.name`이 app_schema.sql에만 추가돼 배치 INSERT 파손 직전 — 배포 전 포착, task#130). 컬럼 추가 슬라이스의 완료기준에 두 파일 쌍을 명시하고, 리뷰도 변경 파일 밖 배선 계층(main._migrate·include_router·batch_registry)까지 봐야 한다.

- **API 변경 시 명세서 2개 모두 갱신**: 엔드포인트 추가/삭제·요청/응답 스키마·인증 게이팅을 바꾸면 `API_SPEC.md`(전체 REST 레퍼런스)와 `CLAUDE_COWORK_API.md`(외부 Cowork API)를 **항상 함께** 업데이트(DoD에 포함). 한쪽만 고치면 다른 쪽이 stale돼 Cowork/소비자가 잘못된 명세로 호출한다. **엔드포인트 *존재* drift(method+path 추가/삭제/개명)는 `backend/tests/test_api_doc_sync.py`가 자동검출**(라이브 `app.routes` ↔ 두 문서 `### \`METHOD /path\`` 헤더 대조, task#99) — 새 엔드포인트를 `API_SPEC.md`에 안 적으면 테스트 실패. 미문서화 기존 23개는 `KNOWN_UNDOCUMENTED` exact-match 베이스라인으로 동결(문서화하면 거기서 빼야 통과). 단 **요청/응답 스키마·인증 게이팅 동기는 여전히 수동 DoD**(테스트는 존재만 검증, prose 파싱 안 함). **단, "2문서 모두"는 Cowork 관련 엔드포인트에 한한다** — `CLAUDE_COWORK_API.md`는 외부 Cowork의 enrich/backlog 워크플로우 전용 스코프라, 사용자 대면 read 엔드포인트(`/api/portfolio/*`·admin 배치 refresh 등)는 `API_SPEC.md`에만 넣는다(형제격 `/api/portfolio/rebalance`도 Cowork 문서에 없음). 신규 엔드포인트가 Cowork 소비 대상인지 먼저 판별해 DoD를 좁힐 것(기계적 "둘 다"는 과함 — task#149·#150·#151에서 노출·베타·F&G 모두 API_SPEC만). **인증 게이팅을 바꾸는 슬라이스는 착수 시 `grep -n '불필요' API_SPEC.md`(⚠️ **콜론 무관 — 패턴을 좁히지 말 것, 아래 재발 참조**)를 먼저 돌려 "곧 틀릴 표기"를 세고, 문서 갱신을 *슬라이스로 명시*할 것(task#230·231·232)**: 3부작에서 `**Auth:** 불필요` **8곳**(1/3:3 · 2/3:4 · 3/3:1)이 오표기로 남아 게이팅 직후 곧바로 틀린 문서가 됐는데, doc-sync 테스트는 엔드포인트 *존재*만 보므로 이 auth 산문 drift를 잡지 못한다. 더 나쁜 건 **세 계획 모두 문서 슬라이스가 아예 없었다**는 점(fg-ask 그릴링이 이 DoD를 계획에 옮기지 못했다) — 그래서 계획을 믿지 말고 착수 시 직접 grep해야 한다. 남아도 되는 `불필요`는 `GET /api/auth/oauth/token` 등 `auth.py` 공개 엔드포인트뿐이다(ADR-0029). **⚠️ 감사 패턴을 좁히면 그 감사는 통과해도 무의미하다 — 실측 재발 1건(task#263 → 7차 버그헌트 L3)**: 3부작이 도구로 못박은 `grep -n '\*\*Auth:\*\* 불필요'`(콜론 독립 줄)는 **문장 중간형 `**Auth 불필요.**`(콜론 없음)를 원리적으로 볼 수 없다.** 실제로 그 형태 3곳(`/backlog`·`/disclosures`·`/insider-trades`)이 같은 섹션 안에서 `**Auth:** Bearer token 필요`와 **문자 그대로 모순**인 채 생존했고(task#263이 삭제), `git show e148592~1:API_SPEC.md`에 좁은 패턴은 **1건**·넓은 패턴은 **4건**이 걸린다. 이건 "프로브 판정축이 부족하면 ALL PASS가 무의미"(아래 ⑧ⓐ·④)의 **문서 감사판**이고, `test_api_doc_sync.py`는 엔드포인트 *존재*만 대조하므로 스위트 초록 상태로 무기한 생존한다. **더 중요한 메타 교훈 — 승급하지 않은 교훈은 지시 문서로 번진다**: task#263 run.md가 "패턴을 넓힐 것"을 승급 후보로 *적어만 두고* 승급하지 않은 사이, 같은 날 생성된 `.claude/agents/doc-sync.md:35`가 **좁은 패턴을 에이전트 지시로 박제**했다(카드 `4e204a3` 00:13 < 발견 `e148592` 10:45). 같은 사이클에서 실증된 교훈은 회고를 기다리지 말고 **가토·카드 같은 *지시 문서*에 즉시 전파**할 것. **⚠️ 구체 사실 — `CLAUDE_COWORK_API.md`는 한 엔드포인트를 *두 곳*에 적는다(task#318)**: `GET /api/tech-reports`가 **① 워크플로우 0단계**(「(조건 확인) GET /api/tech-reports → …」, 파일 앞부분의 발행 절차 블록)와 **② 엔드포인트 절**(`### \`GET /api/tech-reports\``, 예시 응답 포함) 양쪽에 서술돼 있다. task#318 계획서는 ①만 지목했고 **적대적 리뷰가 ②를 찾았다** — 계획대로 했으면 엔드포인트 절의 예시 응답이 `{"reports": [...]}`만 보이는 채로 stale하게 남았을 자리다. `test_api_doc_sync.py`는 엔드포인트 *존재*만 대조하므로 이 응답 스키마 drift는 자동 게이트가 원리적으로 못 잡는다. 실천: Cowork 문서를 고칠 땐 그 method+path를 **파일 전체에서 grep해 히트 수를 세고** 전부 갱신할 것(절 제목만 찾으면 워크플로우 서술을 놓치고, 워크플로우만 찾으면 예시 응답을 놓친다). **⭐ 그리고 그 판정을 「무엇이 바뀌었나」로 하면 문서를 *열지도 않는다* — 계약이 전부 무변경이어도 산문은 stale해진다(task#324)**: 위 항목들이 「문서의 *어디*를 볼지」였다면 이건 **「문서를 볼지 말지」**의 오판이다. 화면 개명(enrich 탭 「심층분석」 → 「사업분석」)에서 엔드포인트·요청/응답 스키마·인증이 **정말로 전부 무변경**이었고, 그래서 계획서가 「`API_SPEC.md`·`CLAUDE_COWORK_API.md`는 갱신 대상이 아님을 **확인**한다」를 완료기준으로 적었다. 그런데 두 문서는 enrich 필드 3종(`key_resource`·`competitor_edge`·`market_outlook`)의 **화면 위치를 서술한다** — 「저장 후 리포트 **심층분석 탭** … 섹션에 표시」(API_SPEC 3건) · 「리포트 "…" 섹션(**심층분석 탭**)에 표시」(COWORK 3건). 개명 순간 6건이 통째로 거짓이 됐고, `test_api_doc_sync.py`는 엔드포인트 *존재*만 대조하므로 **스위트 초록 상태로 무기한 생존**한다. **더 넓게 새어나간 곳이 있다** — 개명 대상을 「`frontend/src` 8곳」으로 셌는데 실제는 **20곳**이었다: frontend 8 · API_SPEC 3 · COWORK 3 · `.forge/CONTEXT.md` 2 · **레거시 캡처·프로브 스크립트 4종 9건**(`capture-report-detail.js`·`capture-ux.js`·`uat-79.js`·`uat79-reports.js`가 `'심층분석'` 라벨을 **클릭**한다 → 개명 후 조용히 못 찾는다, task#317의 「문자열이 코드 경로를 가둔다」 계열). 실천 2가지: ⓐ **사용자 대면 이름·화면 위치를 바꾸는 변경의 감사 단위는 「계약」이 아니라 「그 문자열」이다** — `grep -rn '<옛 이름>' .` 를 **프로젝트 전역**으로 한 번 돌려 히트를 전부 분류할 것(코드·테스트·문서·스크립트·`.forge`). ⓑ **「갱신 대상이 아님을 확인한다」류 완료기준은 그 확인을 *어떻게* 하는지까지 적어야 한다** — 「계약이 안 바뀌었으니 무관」은 확인이 아니라 추론이고, 이번엔 그 추론이 틀렸다. 남겨도 되는 히트는 「그 개명 자체를 서술하는 문장」과 `.forge/done/` 아카이브(봉인된 과거 기록)뿐이다.

- **기능 표면을 바꾸면 `README.md` 해당 절도 같은 PR에서 갱신(DoD)**: README가 문서화하는 표면 — ① 화면 구성(nav 탭/화면 기능) ② 환경변수(env/데이터 소스 키) ③ 기술 스택(라이브러리/외부 연동) ④ 아키텍처(router/service/table) ⑤ 배치 — 중 하나라도 추가·삭제·개명되어 기존 절이 stale해지는 변경은 README의 그 절을 함께 손본다. README는 **overview 레벨**이라 엔드포인트/요청·응답 스키마 세부는 여기 중복하지 말고 `API_SPEC.md`/`CLAUDE_COWORK_API.md`에만 둘 것(위 doc-sync 규칙과 역할 분담). 안 지키면 README가 드리프트해 신규 합류자·외부 소비자가 옛 화면구성/키/스택으로 오인한다(task#47 README 전수 재조정이 누적 드리프트를 한 번에 청소한 사례).

- CORS origins: `localhost:3000`, `localhost:5173`, `FRONTEND_URL` env var (`backend/main.py`). 배포 시 `FRONTEND_URL`을 `.env.docker`에 설정.

- **Admin 역할 설정**: `UPDATE users SET role = 'admin' WHERE email = '...'` (Docker postgres 직접). admin만 리포트 생성·Guru 크롤 가능.

- **user_menu_permissions**: 사용자별 메뉴 표시 제어. `PUT /api/admin/users/:id/permissions`로 관리. 프론트 `AuthContext`가 로그인 시 로드해 nav 필터링. 허용 메뉴 목록은 `admin.py`의 `ALL_MENUS`에 정의.

- **문서 갱신 슬라이스를 "필드 N개 추가"로 잡으면 그 절이 *이미* stale한지는 안 본다 — 착수 시 그 절 전체를 실응답과 대조할 것(task#274)**: 위 인증 문서 가토의 「감사 패턴을 좁히면 그 감사는 통과해도 무의미하다」와 같은 가족이되, 이쪽은 *감사*가 아니라 **갱신 범위**가 좁은 경우다. task#274 계획은 `API_SPEC.md`의 `GET /api/guru/crawl/progress` 응답에 `dropped`·`held` **추가**만 지시했는데, 실제 문서는 그보다 두 세대 뒤처져 `result`/`fresh`/`stale`(task#262·#267에 추가된 필드)조차 없이 `{running, done, total, current}`만 적고 있었다 — **지시받은 두 필드만 넣었으면 여전히 틀린 문서**가 됐을 자리다(실제로는 응답 전체를 필드 표로 다시 썼다). `test_api_doc_sync.py`는 엔드포인트 *존재*만 대조하므로 이런 **응답 스키마 drift는 스위트가 원리적으로 못 잡는다**. 실천: 문서 슬라이스에 착수하면 고칠 필드만 보지 말고 **그 절의 예시 응답을 실제 코드가 반환하는 것과 한 번 대조**할 것(엔드포인트 1개면 1콜, 아니면 반환 dict 직독). 부수 — 그 절에 `done`/`total`처럼 **의미를 오해하기 쉬운 필드**가 있으면 표에 함정을 명시할 것(여기선 "저장 건수가 아니라 **시도** 기준" — BH7-H1이 정확히 그 오해로 났던 버그다).

- **⭐ 동시성 — 「단일 프로세스」가 「경합 없음」을 뜻하지 않고, 동시성 프리미티브를 넣으면 그것이 **새 단일 장애점**이 된다(task#336·#337)**: 두 방향이 한 쌍이다. **ⓐ 백엔드 — sync `def` 핸들러는 스레드풀에서 *진짜로* 병렬 실행된다.** `backend/Dockerfile`의 `CMD`에 `--workers`가 없어 uvicorn이 단일 프로세스인 것은 **워커 수**의 이야기이고, `routers/auth.py::login`·`::register`처럼 **`async def`가 아닌 `def`** 핸들러는 Starlette가 `run_in_threadpool`로 **실제 OS 스레드에서 동시에** 돌린다. 그래서 프로세스 전역 상태(`services/rate_limit.py`의 `_buckets` dict + deque)를 락 없이 「판정-후-기록」하면 **세 가지로** 깨진다 — ⓘ **과다 허용**(20스레드 강제 동시 진입에서 `allowed=13`, limit=10: 여러 스레드가 각자 `len(bucket) < limit`을 보고 아무도 아직 append하지 않았다) ⓘⓘ **`popleft`가 빈 deque에서 `IndexError`**(만료 prune의 `while bucket and now - bucket[0] > window` 조건을 둘이 함께 True로 읽는다) → **로그인이 500**(20스레드 중 19건 재현) ⓘⓘⓘ **신규 키 버킷 생성의 확인-후-대입**으로 기록 소실. 셋 다 `threading.Lock`으로 크리티컬 섹션을 묶어 해소했고, **재현은 barrier를 심어 강제**해야 했다(pytest가 스레드를 저절로 겹치게 하지 않으므로 이 클래스는 **일반 테스트로는 원리적으로 안 잡힌다**). **실천: 프로세스 전역 가변 상태를 도입하면 그 핸들러가 `def`인지 `async def`인지 먼저 보고, `def`면 락을 기본값으로 둘 것**(「단일 프로세스라 카운터가 정확하다」는 ADR 문장을 「경합이 없다」로 읽지 말 것 — 그 ADR은 워커만 다룬다). **ⓑ 프론트 — 공유 in-flight promise는 새 결합을 만든다.** `api.js`의 모듈 레벨 단일비행(`refreshInFlight`)에 타임아웃이 없으면 half-hang에서 그 값이 **영구 non-null**로 남아, 이후 발생하는 **모든 401이 로그아웃도 재시도도 못 한 채 그 promise를 영원히 기다린다.** 종전엔 401마다 동기 로그아웃이라 **어떤 요청도 남의 상태에 걸려 멈추지 않았다** — 즉 「1회만 나가게 하기」가 곧 「하나가 멈추면 전부 멈춤」이다. `AbortController` + 10초로 닫았다(⚠️ `AbortSignal.timeout`은 **Safari 16+ 전용**이라 구형 iOS PWA를 지원하는 이 앱에서는 쓰지 말 것). 그리고 in-flight는 **성공·실패 무관하게 `finally`에서 비울 것** — 안 비우면 첫 실패가 세션 내내 갱신을 막는다.
