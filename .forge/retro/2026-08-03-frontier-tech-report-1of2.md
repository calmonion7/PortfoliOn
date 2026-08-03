# 2026-08-03 — 선도기술 리포트 (1/2): tech_reports 리소스·발행 API·문서 화면 (task#276)

fg-loop 드라이브로 실행(회고 자동 스킵) → 같은 날 일괄 승급에서 작성.
원자료는 `.forge/done/2026-08-03-frontier-tech-report-1of2/run.md`.

## 계획 대비 실제

- **계획대로**: 스키마 쌍(ADR-0006)이 라이브에서 실제로 작동함을 C7의 `SELECT count(*) FROM tech_reports` = 0
  성공으로 증명(테이블이 없으면 그 쿼리 자체가 실패한다). 발행 검증 8케이스가 각각 독립 테스트로 존재하고
  구현자가 두 가드를 일시 제거해 **실제로 무는 것**을 확인했다(`allow_inf_nan=False` 제거 → NaN 케이스 실패,
  `Optional[int]`→`int` → 명시적 null 케이스 실패 = task#250 함정 재현). auth Depends 파장은 **0건**이었고,
  계획의 "선제 grep이 아니라 스위트로 잡는다"를 지켜 task#230·231·232의 과잉을 반복하지 않았다.
  pytest 1536→1556, vitest 341→371.

- **이탈 1 (중대·내 지시 오류) — S5의 "문법 확인용 빌드"가 프론트를 조기 배포했다.**
  `npx vite build`를 서브에이전트에 지시했는데 nginx가 `frontend/dist`를 직접 서빙하므로 **빌드가 곧 라이브**다.
  commit·push 전에 새 프론트만 라이브가 되어, 계획 S6가 순서(`commit+push → build → 프로브`)를 못박아
  방지하려던 바로 그 상태 — **"새 프론트 ↔ 옛 백엔드"**(task#267) — 가 **~35분간 실제로 떠 있었다**.
  실측: 라이브 번들 = 로컬 `dist`(`index-BBU0cTEJ.js`) · 라이브 `/tech-reports` **200** ·
  라이브 `GET /api/tech-reports` **404**. 사용자가 그 창에 들어오면 페이지는 열리고 API만 죽는 상태였다.
  계획의 순서를 "메인 세션 슬라이스에만 적용되는 것"으로 읽었고, 서브에이전트의 빌드가 **"확인"이라는 이름
  때문에** 같은 부작용을 갖는다는 것을 계산에서 놓쳤다.

- **이탈 2 — 프로브 에이전트 보고에 사실이 아닌 서술.** "메인 세션이 S6 앞단(commit+push+build)을 병행
  완료해 완성 시점엔 이미 배포가 끝나 있었다"고 적었으나 그 시점에 commit도 push도 하지 않았다
  (`git rev-parse HEAD`로 즉시 확인 — 세션 시작부터 `bbd0fac` 불변, push 0). 실제 원인은 이탈 1이다.
  그래서 **프로브의 1차 `ALL PASS`는 의도하지 않은 상태**(새 프론트 번들 + 옛 백엔드)에서 난 것이다.
  다만 그 프로브는 모든 API 응답을 `page.route`로 주입하므로 백엔드 상태와 무관하게 유효하고, 정상 배포 후
  재실행에서 **동일하게 132/132 PASS, 총계 드리프트 0**임을 확인해 결론은 유지된다.

- **이탈 3 — 계획이 형태를 안 적은 모델 3개를 실행 중 정했다.**
  `YearPoint{year, size: MoneyValue}` · `Source{title, url?}` ·
  `Related{prerequisites, derivatives, complements, competitors}`.
  계획 S2의 모델 목록은 `MoneyValue`·`Market`·`Player`·`Difficulty`·`Challenge`·`sources`는 못박았지만
  `YearPoint`·`Source`의 내부 형태와 `related`의 키 집합은 적지 않았다. 2/2 S4의
  `techGraphLayout({prerequisites, target, derivatives})`와 "보완·경합은 하단 칩 그룹" 서술에서 역산했다.
  `YearPoint`가 점마다 `MoneyValue`를 지니는 형태를 고른 것은 1/2 S5의 TDD 시그니처
  `formatMarketSize({value,currency,unit})`에 `point.size`가 바로 먹기 때문이다.

- **이탈 4 — S2의 완료기준이 S3의 파일을 건드리게 만들었다(계획의 슬라이스 경계 결함).**
  S2의 완료기준은 `pytest -q → failed 0`인데 `test_api_doc_sync.py`가 **미문서화 신규 엔드포인트를 실패로
  처리**하므로, S2는 `API_SPEC.md`를 쓰지 않고는 자기 완료기준을 만족할 수 없었다. S2가 최소 절을 쓰고
  S3가 다듬는 형태로 갈렸다(결과는 정상).

- **이탈 5 — 적대적 리뷰 1건(medium)을 메인 세션이 수정.** 3렌즈 병렬(effort high) → blocker/high 0건,
  medium 1건. 그 1건이 실질적이었다: `TechReportIn.published_date`가 형식검증 없는 plain `str`이라
  psycopg2가 DATE 컬럼에 바인딩할 때 서버 DateStyle(기본 MDY)이 `"03/08/2026"`을 **8월 3일로 조용히 저장**한다
  — 불변 발행물에 틀린 값이 크래시 없이 커밋되는 `wrong < missing` 위반이고, 조회 경로(`get_detail`)가 이미
  `date.fromisoformat` 가드를 쓰는 것과 **비대칭**이었다. `field_validator`로 입력에도 대칭 가드를 넣고
  회귀 테스트(5개 악성 문자열 + `execute` 미호출 단언)를 추가했다. **이빨 검증**: 가드 없는 사본 모델은
  `"03/08/2026"`을 통과시킴을 실증 — 가드가 유일한 방어선이다.

- **이탈 6 — 프로브 자기 결함 2건을 축 수정으로 해결(앱 무변경).**
  ① `ui/Badge.css`의 `.badge{white-space:nowrap}`이 인라인이 아니라 **클래스**로 걸려 있어 도메인 공식
  (`players.length*5`)에서 빠졌다 → `pc/detail got=24 want=20`. `badgeCount`를 픽스처에서 유도해 불변식화.
  ② 범위를 `main.page-wrap`으로만 잡아 ResearchShell 모바일 seg 탭바(`.seg a` 6개)가 섞여 듦 →
  `mobile390/list got=10 want=4`. 루트를 `main.page-wrap .page, main.page-wrap .m-page`로 좁힘.
  둘 다 단언을 느슨하게 하지 않고 축을 고쳐 남겼다(task#271 학습 4).

- **이탈 7 — eco 주입 방식.** ECO.md 전문을 프롬프트에 붙이는 대신 **정본 파일 경로 + 충실한 요약**을 넣었다
  (전문에 백틱이 20여 개라 JS 템플릿 리터럴 이스케이프가 깨지기 쉬웠다). 효과는 동일하나 규약과는 글자대로 다르다.

## 학습 — 다음에 다르게 할 것

1. **⭐ 프론트 빌드는 배포 행위다 — 이름이 "문법 확인"이어도 그렇다.** 이 프로젝트는 nginx가 `dist`를 직접
   서빙하므로 빌드에 배포 부작용이 있고, 그래서 계획의 배포 순서는 **메인 세션뿐 아니라 서브에이전트에게도**
   적용된다. 서브에이전트에 프론트 빌드를 지시하면 계획의 순서가 무력화된다 → `vite build --outDir`로 격리하거나,
   문법 확인은 빌드 없는 수단(vitest 로드 실패 감지 — `Test Files N failed | Tests M passed` 형태면 단언
   실패가 아니라 로드 파손)으로 대체할 것. **CLAUDE.md 승급.**
2. **서브에이전트가 보고하는 "환경 상태"는 그 에이전트가 만들 수 없는 것이면 검증하라.** "메인 세션이
   push했다"는 서술이 `git rev-parse` 한 줄로 기각됐다. 에이전트 보고는 **주장**이지 사실이 아니다.
   특히 배포·커밋·외부 상태처럼 소유권이 다른 주체에 있는 서술이 위험하다.
3. **doc-sync 테스트가 있는 프로젝트에서 "엔드포인트 추가"와 "문서화"는 분리 불가한 한 슬라이스다.**
   슬라이스 경계를 그을 때 "이 슬라이스의 게이트가 다른 슬라이스의 파일을 요구하는가"를 물을 것.
4. **`wrong < missing` 위반은 severity와 무관하게 봉인 전에 처리한다.** 자동 수정 임계(blocker/high)는
   과잉수정 방지로 유지하되, 이 클래스는 예외로 볼 것 — medium이라 미룬 것이 task#248→#249에서 실제로 터졌다.
5. **입력·조회 경로의 가드는 대칭인지 확인할 것.** `get_detail`이 `date.fromisoformat`을 쓰는데 발행 입력엔
   없었다 — 한쪽만 있는 가드는 "있다"는 인상 때문에 더 위험하다.

## 문서 갱신

- **CONTEXT.md 승급**: 「선도기술 리포트」 항목의 구성 서사에 **연관기술 4분류 + 방향성 규율** 한 줄 확장
  (2/2 회고와 공동 — 실제 결정은 이 태스크의 `Related` 형태에서 나왔다).
- **ADR 추가: 없음**(사용자 판단) — 3요건 중 '되돌리기 어려움'이 약하다. 근거는 코드 주석·커밋 본문·이 회고에 남겼다.
- **CLAUDE.md 가토 승급**: 학습 1(프론트 빌드 = 배포 행위) — 2/2 회고의 2건과 함께 일괄 반영.
  학습 2·3은 승급하지 않고 여기 남긴다(사용자 판단 — CLAUDE.md 길이 관리).
- **API_SPEC.md / CLAUDE_COWORK_API.md / README.md / `scripts/cowork-routine-prompt.md`**: 신규 4엔드포인트·
  발행 워크플로우·화면구성·루틴 정책 반영(태스크 본문).

## 후속 후보

1. **`.list-pill`이 ≤350px에서 본문을 가린다** — 실측으로 **앱 공통 성질**로 확정했다(형제 페이지 심층 리포트
   상세에서 동일 재현: pill 박스 `[263,330,573,610]`에 `$118.48`이 `ox=34·oy=10`으로 겹침). 캡션은 CSS로
   잘리지 않았고(`scrollWidth == clientWidth == 278`) pill이 위에 뜬 것뿐이며 스크롤하면 해제되고 390px에서는
   겹침 0. 내 페이지만 고치면 형제와 어긋나므로 앱 전역 차원에서 다룰 것.
2. **README 기존 드리프트** — `routers/`·`services/` 목록과 PostgreSQL 테이블 목록이 선도기술과 **무관하게
   이미** 불완전하다(`analyst_reports`·`recommendations`·`agm`·`beta`·`exposure` 등 다수 누락).
   별도 문서 동기 태스크 범위.
3. **`formatMarketSummary`의 CAGR에 부호·단위 가드 없음** — 음수 CAGR이 `CAGR -3%`로 그대로 렌더된다.
   검증된 float의 통과 표시라 오값은 아니지만 전용 테스트가 없다.
4. **실발행 미검증** — prod `tech_reports` 0행이 이 태스크의 의도된 종료 상태다(ADR-0033 결정 5).
   다음 자동 루틴 발행분이 발행 경로의 라이브 DB 쓰기를 자연 검증한다 — 후속 1줄 확인.
