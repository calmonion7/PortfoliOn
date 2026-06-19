---
last_mapped_commit: 163c29cbd89d9b1d2aa5a101670e9fa34ceb21c4
mapped: 2026-06-19
---

# CONCERNS — 기술 부채·버그·보안·성능·취약 영역

이 문서는 코드를 직접 읽어 확인한 위험 팩트만 담는다. 도메인 용어 정의는 `CONTEXT.md` 소관이다.
각 항목은 근거 파일·코드, 심각도(높음/중간/낮음), 수정 힌트를 붙인다.

---

## 1. 운영·배포 (Deployment)

### 1.1 자동 배포 폴러가 커밋 안 한 tracked 편집을 소실시킴 — 심각도: 높음
`scripts/auto-deploy-poll.sh`가 launchd로 2분마다 돌며, `origin/main`이 로컬 HEAD와 다르면
`git reset --hard origin/main` 후 `bash deploy.sh`를 실행한다(스크립트 28~37행).
→ 메인 체크아웃에서 **커밋 안 한(또는 push 안 한) tracked 편집은 다음 폴(≤2분)에 소실**된다.
`/tmp/portfolion-deploy.lock`만 동시 실행을 막을 뿐, 작업 중인 워킹트리는 보호하지 않는다.
- **수정 힌트**: 코드 변경은 commit + `git push origin main`을 즉시 묶을 것. 미커밋 실험은
  worktree(`.claude/worktrees/`)나 untracked 파일(`.forge/`)로 격리. `reset --hard`는 untracked는
  건드리지 않는다.

### 1.2 기동 시 인라인 DDL 마이그레이션이 조용히 실패해도 부팅 진행 — 심각도: 중간
`backend/main.py` `_migrate()`(54~142행)는 8개 테이블/컬럼을 `CREATE TABLE IF NOT EXISTS` /
`ADD COLUMN IF NOT EXISTS`로 만들되 **각 블록을 `try/except`로 감싸 실패 시 `print`만** 하고 계속
진행한다. DDL 실패(권한·문법·연결)는 로그 한 줄로만 남고 앱은 정상 기동된 것처럼 떠서, 이후 그
테이블을 읽는 엔드포인트가 런타임에 깨진다. `stock_recommendations`·`stock_insider_trades` 등 신규
테이블 생성도 여기에 의존.
- **수정 힌트**: DDL 실패를 부팅 실패로 격상할지(fail-fast) 검토하거나, 최소한 헬스체크에
  스키마 무결성 신호를 노출. 정식 마이그레이션 도구 부재가 근본 원인.

---

## 2. 데이터 직렬화·정합성 (Data Integrity)

### 2.1 NaN/inf JSON 직렬화 500 — 소스 가드 누락 시 재발 — 심각도: 높음
starlette `JSONResponse`는 `allow_nan=False`라 응답 dict에 `NaN`/`inf`가 있으면 직렬화 단계에서 500
(`Out of range float values are not JSON compliant`). 폴백이 증상을 *다르게* 가린다: PostgreSQL은
`json` 컬럼에 NaN 저장을 거부하지만 파이썬 `json.dumps`는 기본 `allow_nan=True`라 파일 폴백은 통과
→ DB저장 실패·파일성공·응답 직렬화 실패로 진단이 엇갈린다. 외부 시세(yfinance `Close` NaN, FX
`usdkrw` NaN)가 합산값을 오염시키는 게 전형.
- **현재 가드 상태**: `services/digest_service.py`(42~61행)는 소스에서 `math.isfinite`로 가드.
  `services/utils.py` `sanitize()`(29~36행)는 NaN/inf→None 재귀 치환 헬퍼 제공.
  `recommendation/funnel.py` `_avg_dollar_volume`(108~121행)도 `math.isfinite` 가드.
- **잔존 위험**: sanitize는 *호출하는 곳에서만* 동작하는 출력 일괄 처리라, 신규 엔드포인트가 float를
  응답에 실으면서 sanitize/소스가드를 빠뜨리면 재발한다. `recommendations.py`의 `weight_pct`·
  `pnl_pct`·`total_krw` 계산(131~160행)은 0 분모·결측을 None으로 막지만, 신규 float 필드 추가 시
  동일 점검 필요.
- **수정 힌트**: 가드는 **소스에서**(시세 없음 처리)가 출력 sanitize보다 깨끗. float 응답 추가 시
  DoD에 NaN/inf 점검 포함.

### 2.2 단위 파싱 실패 시 '안전 기본값' 폴백이 ×100 대형 오저장 — 심각도: 높음
수주잔고(`services/backlog.py`)·내부자(`services/insider_trades.py`) 등 외부 원문 파싱 경로에서 단위
캡션('억원' vs 'USD천' 등) 추출 실패 시 기본값으로 폴백하면 ×100 규모 오저장이 난다. 현 코드는
'wrong < missing' 원칙을 따라 추출 실패를 **pending/None/skip**으로 처리한다:
`insider_trades.py` `_num()`(65~78행)·`_parse_items()`(98행, `shares_change` None이면 행 skip).
- **잔존 위험**: 파서가 만나지 못한 실데이터 케이스(외화·캡션 줄바꿈 분리·연결 전 분기 회사컬럼 표)는
  fixture 단위 테스트가 전부 통과해도 운영 재적재에서만 드러난다.
- **수정 힌트**: 파싱 로직 변경은 **배포 후 전 종목 재적재 UAT 필수**. 추출 실패는 기본값이 아니라
  반드시 누락(pending/None)으로 처리.

### 2.3 KR 색 관례 반전 — 의미 배지에 success/danger 변형 금지 — 심각도: 중간(UI)
`frontend/src/styles/tokens.css`에서 `--up`=빨강(상승)·`--down`=파랑(하락)이라, `ui/Badge.css`의
`.badge--success`=빨강·`.badge--danger`=파랑이다. 가격 방향이 아닌 **의미 상태 배지에 success/danger를
쓰면 Western(녹=좋음/빨=경고) 의도와 반전**된다(수급 배지 우호=빨·경계=파 버그 전례).
`warning` 변형은 `--color-warning`/`--warning-tint` 미정의로 깨져 있다.
- **백엔드 측 회피 설계 확인**: `recommendation/scoring.py`(8~9행)·`actions.py`(4~5행)는 플래그/액션을
  `{label, kind}` 문자열·enum으로만 내보내고 **색은 프론트가 결정**하도록 위임 — 백엔드는 가격 토큰
  미사용. 이 경계가 무너지면 위 버그가 재발.
- **수정 힌트**: 의미 배지는 `ui/SupplyBadge.jsx`처럼 전용 색 명시. UI 리뷰는 variant 이름 통념이
  아니라 토큰 실제값 대조.

---

## 3. 보안 (Security)

### 3.1 Cowork API 키 비교가 타이밍-언세이프 — 심각도: 중간
`backend/auth.py` `get_current_user_or_api_key`(43행 부근)는 `api_key == expected` **단순 문자열
비교**로 검증한다. `hmac.compare_digest` 같은 상수시간 비교를 쓰지 않아 이론상 타이밍 사이드채널에
노출(원격 환경에선 네트워크 지터에 묻혀 실효성은 낮음).
- **수정 힌트**: `secrets.compare_digest(api_key, expected)`로 교체.

### 3.2 시크릿 관리 — env 키 미설정이 안전 기본값(휴면) — 심각도: 낮음(설계상 의도)
`.gitignore`가 `backend/.env.docker`·`.env`·`backend/.venv/`를 제외(확인). 시크릿은 환경변수로만
주입(`JWT_SECRET`/`SESSION_SECRET`/`COWORK_API_KEY`/`DART_API_KEY`/`KOFIA_API_KEY`/
`KIWOOM_*`/`KIS_*` 등). 키 미설정 시 동작:
- `JWT_SECRET`/`SESSION_SECRET`/`DATABASE_URL` 미설정은 `os.environ[...]` 직접 접근이라 **기동 시
  KeyError로 부팅 실패**(auth_service.py 19행, db.py 26행, main.py 157행) — fail-loud, 양호.
- `COWORK_API_KEY` 빈 문자열이면 API 키 인증 자체를 거부(auth.py: `expected and api_key == expected`).
- 외부 데이터 키(DART/KOFIA/KIWOOM/KIS/FRED)는 미설정 시 해당 배치만 휴면/실패하고 저장값 무변경 —
  코드 머지는 무해.
- **잔존 위험**: 휴면이 조용하면 "데이터가 안 채워지는데 에러도 없는" 진단 지연. 키 미설정 휴면은
  로깅으로 가시화 권장.

### 3.3 인증 토큰 수명·폐기 — 심각도: 낮음
`auth_service.py`: access JWT 1시간(`_ACCESS_EXPIRE`)·refresh 30일(`_REFRESH_EXPIRE`). refresh 토큰은
`secrets.token_urlsafe(64)`로 DB 저장(평문). `consume_refresh_token`은 만료만 검사하고 **로테이션
없이** 재사용 가능(폐기는 명시적 `revoke_refresh_token` 호출 시에만). 30일 평문 refresh 토큰 유출 시
장기 악용 여지.
- **수정 힌트**: 사용 시 로테이션(1회용) 또는 해시 저장 검토. 현 규모(소수 사용자)에선 우선순위 낮음.

### 3.4 CORS — allow_credentials 미설정 — 심각도: 낮음(현 동작 정상)
`backend/main.py`(161~166행)는 `allow_origins`만 지정하고 `allow_credentials`는 미설정(기본 False).
인증을 쿠키가 아닌 Bearer 헤더로 하므로 현재는 문제없음. 추후 쿠키 기반 인증 도입 시 origin 화이트
리스트·credentials 조합 재점검 필요.

---

## 4. 성능 (Performance)

### 4.1 추천 배치 Stage-2가 후보 100+개를 직렬 외부 fetch — 심각도: 중간
`recommendation/funnel.py` `run_recommendation_batch`(307행)는 `for cand in candidates:` **직렬 루프**로
후보(`CANDIDATE_TOP_K=100` + 구루 멤버, 26행)마다 `_enrich_one`을 호출하고, 그 안에서 종목당
`market.get_history_df`(OHLCV, KR=키움→yfinance) + consensus + KR이면 investor_service·insider_trades
read를 한다(232~277행). 후보 100개 × (외부 시세 1콜 + DB read 수콜)이 직렬이라 배치 1회가 수 분
소요될 수 있다. KIS/키움 throttle(`_MIN_INTERVAL` 0.25s/0.05s)이 추가 지연.
- **완화 요인**: 배치 경로 전용(요청·기동 경로 라이브 호출 0 — 설계상 보장). KR/US 별도 크론
  (`recommendation_kr`/`recommendation_us`, `batch_registry.py` 359·374행)으로 분리.
- **수정 힌트**: 후보 수 증가 시 `_enrich_one`을 ThreadPool 병렬화 검토하되 **§4.2 DB 풀(maxconn=20)
  한도 내**로 워커 수 제한. silent except 금지 원칙 유지(현 코드는 종목별 실패를 stderr 로깅).

### 4.2 ThreadPool 동시성 vs DB 커넥션 풀 — 심각도: 중간
`services/db.py`는 `ThreadedConnectionPool(minconn=1, maxconn=20)`. psycopg2 풀은 소진 시 **블록이
아니라 `PoolError`를 던진다**(주석 23~25행이 명시). 현 ThreadPool 사용처: calendar(max 30,
CLAUDE.md), analysis(11), `parallel.py` `parallel_map`(기본 10), short_sell 배치 ThreadPool.
- **위험**: calendar의 max 30 워커가 각자 `query()`로 커넥션을 잡으면 동시 30 > maxconn 20 →
  PoolError 가능. calendar는 yfinance만 병렬이고 DB 접근은 캐시 경로라 현재는 충돌이 드물지만, 워커가
  DB를 동시에 잡는 신규 배치 추가 시 즉시 한도 초과.
- **수정 힌트**: 신규 ThreadPool 배치는 워커 수 ≤ (maxconn − 여유)로 설계. `parallel.py`는
  `max_workers` 기본 10이라 안전하지만 호출자가 더 키우면 위험.

### 4.3 인메모리 캐시 TTL·LRU — 심각도: 낮음
`services/cache.py` 6종: snapshot(LRU 200), list(TTL 5s), dashboard(TTL 300s), correlation(300s),
sector(300s), macro(300s). 종목 추가/수정/삭제 시 dashboard·correlation·sector·macro 자동 무효화.
프로세스 인메모리라 **다중 워커/재시작 시 캐시 미공유**(현 단일 컨테이너 단일 프로세스라 무해).
멀티프로세스(gunicorn 등)로 확장하면 캐시 일관성 깨짐.

---

## 5. 외부 의존·환경 차이 (External / Environment)

### 5.1 로컬 `.venv` ≠ Docker 의존성 — `lxml` 부재 — 심각도: 중간
`requirements.txt`에 `lxml>=4.9.0`(10행)이 있고 Docker엔 설치되지만 **로컬 `backend/.venv`엔 없다**.
HTML/XML 파싱은 전부 stdlib `html.parser`로 작성됨(확인: `backlog.py` 382·445·466행, `scraper.py`
19행, `guru_scraper.py` 56·79행; `backlog.py` 30행 주석이 이유 명시). 신규 코드가
`BeautifulSoup(html, "lxml")`을 쓰면 로컬 pytest에서 파서 미존재로 깨진다.
- **수정 힌트**: 로컬 검증 대상 파싱은 `"html.parser"` 사용(로컬·프로덕션 모두 동작).

### 5.2 배치-백킹 뷰의 silent except·all-None 박제 위험 — 심각도: 중간
배치가 사전계산→`market_cache`/테이블 저장, 요청은 저장값만 읽는 패턴(랭킹·KR 업종·추천). 과거
회귀 클래스: ① 외부 fetch 실패를 silent except로 삼켜 진단 불가, ② 빈/all-None 결과를 캐시에 박제해
시드 가드가 "채워짐"으로 오판·고착.
- **현재 준수 상태**: `recommendation/funnel.py`는 종목별 실패를 stderr 로깅(243·252·260·265·298행),
  전부 산출 불가면 `replace_recommendations` 생략(331행 `if scored:`), `_has_signal`로 all-None 후보
  제외(275행). `universe.py`도 소스별 실패 로깅(124~143행).
- **잔존 위험**: 신규 배치가 이 규율을 빠뜨리면 회귀. **의심 트리거가 아니라 실패 클래스(all-None)를
  가드**해야 근본원인 미상이어도 재발 방지.

### 5.3 LLM 호출 없음 — anthropic 미설치 — 심각도: 정보성
백엔드 `report_generator`는 시장 데이터 스냅샷만 만들고 **LLM/Anthropic 호출 없음**(requirements.txt에
anthropic 없음 — 확인). AI 분석 텍스트는 외부 Cowork 클라이언트가 enrich API로 작성. `.env.docker`의
`ANTHROPIC_API_KEY`는 잔존하나 백엔드 미사용 — 혼동 주의(데드 설정).

---

## 6. 라우팅·계약 취약성 (Routing / API Contract)

### 6.1 FastAPI 라우터 순서 — 구체 경로가 catch-all `{ticker}`보다 먼저 — 심각도: 중간
`routers/report.py`에서 `/report/{ticker}/{date_str}`(373행) catch-all 앞에 구체 경로를 등록해야
한다: `/report/{ticker}/backlog`(350행)·`/disclosures`(358행)·`/insider-trades`(367행)는 주석
(347·356·364행)으로 순서 의존을 명시하고 catch-all보다 위에 둠. 동일 패턴: CLAUDE.md가 경고하는
`PUT /api/stocks/enrich/batch`는 `PUT /api/stocks/{ticker}/enrich`보다 먼저.
- **위험**: 신규 `/report/{ticker}/<segment>` 경로를 catch-all 아래에 추가하면 `<segment>`가
  `date_str`로 라우팅돼 조용히 깨진다(과거 `/{ticker}/backlog` 500 전례).
- **수정 힌트**: `{ticker}` 하위 신규 경로는 항상 `{date_str}` catch-all 위에 등록.

### 6.2 비-additive reshape 시 프론트 소비처 전수 grep 필요 — 심각도: 중간
응답을 배열→객체 등 비-additive로 바꾸면 그 엔드포인트를 fetch하는 **모든** 프론트 소비처를
`grep -rn '<경로>' frontend/src/`로 찾아 전부 갱신해야 한다. 독립 fetcher(훅과 별개로 직접 fetch하는
화면)가 옛 형태로 취급해 조용히 깨진 전례(대시보드 배열→객체 변경 시 상관관계 탭 "보유종목 없음").
- **현재 추천 응답 설계**: `recommendations.py` GET은 `{as_of, discovery, watchlist, holdings}` 섹션
  키 객체로, watchlist/holdings는 additive(키 추가)로 붙임(주석 24~28행) — 비-additive 회피.
- **수정 힌트**: additive(필드 추가) 선호. reshape 불가피하면 소비처 전수 감사 DoD 포함.

### 6.3 additive read 추가가 `mock.call_args` 단언 오염 — 심각도: 중간(테스트)
엔드포인트에 read/외부호출을 additive로 추가하면 호출 *시퀀스*가 늘어, 마지막 호출 인자를
`mock.call_args`로 단언하는 기존 테스트가 거짓통과/오류. `recommendations.py` GET이
`read_recommendations`를 **3회** 호출(discovery 35행, watchlist 63행, holdings 87행)하는 게 그 사례 —
빈 watchlist/holdings면 호출 생략(`if wl_tickers:`·`if holdings_tickers:`)으로 기존 테스트 보존.
- **수정 힌트**: 기존 단언은 `call_args_list[i].kwargs`로 인덱스 명시 마이그레이션, 신규 호출은 입력
  비면 생략, 신규 테스트는 `call_count`로 시퀀스 못박음.

---

## 7. 추천·내부자 신규 서브시스템 특이 위험 (Recommendation / Insider)

### 7.1 추천 점수 결측군 중립(0.5) 채움 — 점수 해석 주의 — 심각도: 낮음(설계 의도, 가시성 위험)
`scoring.py` `score_stock`(132~144행)은 결측 팩터군을 재정규화로 분모에서 빼지 않고 **중립
0.5로 채운다**(136~139행 주석). 단일 가용군만으로 만점 도달을 막는 의도지만, 근거가 거의 없는 종목도
점수가 50 근방으로 수렴해 "데이터 부족"과 "실제 중립"이 점수만으로는 구분 안 된다(플래그
`kind:"missing"`로만 구분 — `derive_flags` 167·183·197행). 144행 `else` 분기는 denom이 항상 1.0이라
dead code(주석이 명시, 무해 잔존).
- **수정 힌트**: 소비 UI가 `missing` 플래그를 반드시 노출해 점수만으로 오판 방지.

### 7.2 내부자 신호 — 주식수 합산이 종목 분할/액면 변경에 취약 — 심각도: 낮음
`insider_trades.py` `compute_net_signal`(245~270행)은 윈도 내 `shares_change` 단순 SUM의 부호로
buy/sell 방향 판정. 주식수(금액 아님) 합이라 액면분할·무상증자로 주식수 단위가 바뀐 보고가 섞이면
합산이 왜곡될 수 있다. `direction`만 쓰고 규모는 안 쓰므로 영향은 제한적.
- **부가**: `_row_hash`(81행)가 `rcept_no|kind|repror|change|after|rate` 조합 MD5 PK라, 같은 보고가
  정정 공시로 값이 바뀌면 다른 해시로 **중복 행** 생성 가능(멱등은 동일 값일 때만). 순매수 합이
  정정 전후 이중 계상될 여지.
- **수정 힌트**: 정정 공시 처리가 필요하면 `rcept_no` 단위 dedup/최신 우선 정책 추가 검토.

### 7.3 추천 저장이 DELETE→INSERT 통째 교체 — 트랜잭션 경계 — 심각도: 낮음
`store.py` `replace_recommendations`(15~52행)는 시장 단위 `DELETE` 후 행별 `execute` INSERT. `db.py`
`execute`는 호출마다 `get_connection`으로 **각각 커밋**(31~41행)한다 — 즉 DELETE와 N개 INSERT가
**별도 트랜잭션**. 중간에 한 INSERT가 실패하면 그 시장 추천이 부분 비워진 상태로 남는다. 호출측
(`funnel.py` 331행)이 `if scored:`로 빈 교체는 막지만, 부분 실패 원자성은 보장 안 됨.
- **수정 힌트**: 통째 교체는 단일 트랜잭션(하나의 connection 내 DELETE+executemany)으로 묶는 게 안전.
  현 규모·배치 빈도에선 영향 낮음.

---

## 8. 알려진 미해결 관찰 (Open Observations)

- **JS 404 리소스 요청 1건**: 배포 후 브라우저 콘솔에 404 1건, 기능 영향 없으나 원인 미확인
  (user memory `project-js-404.md`). 코드 근거 미확정 — 추적 필요.
- **PC OAuth SW 가로채기**: SW navigate가 OAuth callback을 가로채던 버그 수정 배포됨(472cea0),
  PC 재검증 미완(user memory `project-oauth-sw-fix.md`).
- **forge 동시 세션 슬롯 충돌**: 여러 세션이 `.forge` 활성 슬롯 공유 시 동시 fg-run/cleanup이 슬롯
  탈취·오봉인(user memory). 코드 위험은 아니나 작업 프로세스 주의.
