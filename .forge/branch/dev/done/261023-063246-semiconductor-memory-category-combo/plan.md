<!-- forge-slug: semiconductor-memory-category-combo -->
<!-- task: 404 -->
<!-- tdd: off -->

# 시장지표 반도체 카드 — 메모리 현물가를 분류 콤보로 압축

## 목표
모바일에서 반도체 카드의 메모리 현물가 영역이 6개 분류, 23개 행을 모두 펼쳐 놓아 카드가 약 1,300px까지 길어진다. 게다가 행을 눌러도 바뀌는 차트가 맨 아래에 있어서 화면에서 반응이 보이지 않는다.
**분류 콤보(select) 하나 → 그 분류 표(≤7행) → 바로 아래 차트** 구조로 바꿔, 행을 누르면 바로 아래 차트가 바뀌는 것이 한 화면 안에서 보이게 한다.

## 결정(그릴링)
- 구조: 상단에 네이티브 `<select>`(분류 6종: DRAM 현물·모듈·Flash·GDDR·웨이퍼·메모리카드)와 그 분류의 `updated_at`을 두고, 아래에 선택된 분류의 표 1개만, 그 바로 아래에 차트를 둔다. 분류 칩·품목 콤보·아코디언 안은 기각했다.
- 분류 전환: 그 분류의 **첫 품목을 자동 선택**해 표와 차트가 항상 같은 분류를 보이게 한다. 초기 상태는 지금과 같이 `dram:475`(DRAM 현물 첫 품목)이다.
  - 엣지: `DEFAULT_ITEM`이 응답에 없으면 첫 분류의 첫 품목으로 대체한다(현재 코드는 이 경우 차트가 사라진다).
- select의 탭 타깃은 `minHeight: 44`로 기존 행(`ROW_BASE`)과 맞추고, 스타일은 기존 인라인 select 관용(`ReportDetailHeader.jsx:55`)을 따른다. 접근성을 위해 `aria-label="메모리 분류"`를 단다.
- 설명 문구(DESC)를 「분류를 고르고 행을 누르면 바로 아래 차트가 해당 품목으로 바뀝니다」로 갱신한다.

## 정본
- 용어 [[메모리 현물가]] — `.forge/branch/dev/CONTEXT.md`(이번 변경은 용어 무변경)
- 응답 계약 `GET /api/market/semiconductor` → `{categories:[{key,label,updated_at,items:[{id,name,avg,change_pct,history}]}]}` — 무변경(프론트 전용 변경)

## 슬라이스
1. **S1 `SemiconductorSection.jsx` 재구성** — `selectedCat` 상태와 select를 추가하고, 표는 선택된 분류만 렌더한다. 분류를 바꾸면 그 분류의 첫 품목을 선택하고, 차트를 표 바로 뒤로 옮긴다. `data-testid`는 `semi-cat-select`(select)를 신설하고 `semi-cat-<key>`·`semi-row-<id>`·`semi-chart`는 유지한다.
   - 완료: vitest 갱신 및 추가 — ① 초기에는 DRAM 표만 렌더(`semi-cat-module` 부재) ② select를 module로 바꾸면 module 행만 보이고 차트 `data-item`이 module 첫 품목 ③ 분류 안에서 행을 누르면 차트가 그 품목으로 바뀜(기존) ④ `DEFAULT_ITEM`이 없는 응답에서도 차트가 렌더됨.
2. **S2 프로브 `scripts/uat403-semiconductor.mjs` 축 갱신** — 「모든 분류가 동시에 DOM에 있다」를 전제로 한 축(`identity-labels`·`updated-at-labels`·`rows-count`·`name-not-clipped`·`row-spacing`)을 **select로 6분류를 순회하며 분류별로** 재도록 바꾼다(분류별 행 수 == API, 합계 == API 23 리터럴과는 별도로 정지조건 C5식 리터럴 대조를 유지). 새 축 2개:
   - `chart-follows-table`: 차트 top − 표 bottom ≤ 24px
   - `tap-chart-in-view`: m360에서 표 마지막 행을 탭한 뒤 스크롤 없이 차트 상단이 뷰포트 안에 있음
   `EXPECT_PER_VP`를 갱신한다.
3. **S3 dev 배포 + 라이브 검증** — dev push 후 dev 스택(8084)에서 프로브 ALL PASS, **m360 육안 스크린샷 1장**(select·표·차트가 한 화면에 들어오는지, select가 낱자 적층 없이 한 줄인지)을 확인한다.

4. **S4 README 1줄** — `README.md:152`의 「메모리 현물가 6분류 표와 행 탭으로 전환되는 품목 추이 차트」를 「분류 콤보(6분류)로 고른 표와 행 탭으로 전환되는 품목 추이 차트」로 바꾼다.

## 완료기준(DoD)
- `cd frontend && npx vitest run src/components/market/SemiconductorSection.test.jsx` 전부 통과
  - 사전 상태: 기존 4개 통과(회귀 가드 — 바뀌지 않는 행 탭 → 차트 축이다). 신규 ①②④는 아직 없음(forward).
- `BASE=http://127.0.0.1:8084 node scripts/uat403-semiconductor.mjs` ALL PASS(3뷰포트)
  - 사전 상태: 신규 축 `chart-follows-table`은 현재 23행 뒤에 차트가 있어 FAIL해야 한다(red-first 이빨)
- m360 육안 스크린샷 1장
- 이 단언이 통과하면서도 깨질 수 있는 방식: select가 네이티브라 iOS Safari 피커의 렌더는 Chromium 프로브로 볼 수 없다 → 스타일을 최소로 둬(appearance 미변경) 위험을 줄인다.

## 비목표
- 백엔드·API·수집 로직 변경 없음(API_SPEC·COWORK 갱신 불요 — 응답 계약 무변경)
- SOX 영역, `IndexSection` 틱 문제(task#403 잔존) 미포함
- 분류·품목 선택을 URL이나 localStorage에 기억하지 않음
