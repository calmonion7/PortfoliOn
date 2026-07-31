# 2026-07-04 — PWA 설치 배너 비침습화 (task#143, 일괄 승급 회고)

`fg-next all` 자동 스킵 봉인의 지연 승급. 원료: `done/2026-07-04-pwa-banner-noninvasive/run.md`.

## 계획 ↔ 실제

- **계획대로**: `InstallPrompt`를 하단 fixed 오버레이 → **콘텐츠 상단 인라인 카드**로. `App.jsx`에서 `MobileNav` 뒤 → `<main className="page-wrap">`의 첫 자식(Routes 앞)으로 이동 → 전 라우트 공통으로 한 번만 렌더. `mobile.css`에서 `position: fixed`/`z-index` 제거 → `position: relative` + margin.
- **Divergences (낮음)**:
  1. **dismiss 지속은 이미 동작하고 있었다.** `pwa.js`의 `suppressInstall`(localStorage `pwa-install-dismissed-at`, 14일)/`isInstallSuppressed`가 이미 존재해, DoD의 "X로 닫으면 리로드 후 재노출 안 됨"이 **코드 변경 없이 충족**됐다. 이번 변경은 배치만 손봤고 UAT에서 재확인(`PERSISTED_GONE`).
  2. **UAT 범위를 5화면 → 3라우트로 좁혔다.** 배너가 `App.jsx`에서 Routes 위에 **한 번만** 렌더되는 전역 배치라, 3개 최상위 라우트에서 확인한 불변식(banner.bottom ≪ tabbar.top, banner.top = 콘텐츠 상단)이 나머지에 전이된다. 리포트 상세·캘린더는 `/`의 하위 뷰이지 별도 배너가 아니다.

## 배운 것

- **다음엔 다르게**:
  1. **"없다고 가정한 기능"을 만들기 전에 먼저 grep할 것.** dismiss 지속이 이미 있었고, 확인하지 않았으면 중복 구현이 됐다. DoD 항목 중 일부는 이미 충족돼 있을 수 있다.
  2. **UAT 범위 축소는 "표면 수"가 아니라 "불변식의 전이 가능성"으로 정당화할 것.** 전역에 한 번 렌더되는 요소는 라우트를 늘려 찍어도 같은 노드를 다시 재는 것이다 — 대신 *왜* 전이되는지(렌더 위치가 Routes 위)를 근거로 적어야 다음 사람이 축소를 게으름으로 오인하지 않는다. (반대로 라우트마다 별도 인스턴스라면 전이가 성립하지 않으므로 이 논리를 기계적으로 재사용하면 안 된다.)

## Doc updates

- CONTEXT.md promotion: none · ADR added: none
- CLAUDE.md 승급: none (전역 1회 렌더 요소의 UAT 전이 논리는 유용하나 이 표면 국소 — 재관측되면 승급 후보)
