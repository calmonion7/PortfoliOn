---
status: accepted
---

# 프론트엔드 단위 테스트 하니스로 Vitest 채택

## Context

프론트엔드(React 19 + Vite 8/rolldown)에 단위 테스트 러너가 전무했다(`frontend/package.json`에 `test` 스크립트·Vitest/Jest/RTL 없음). UI 검증은 `scripts/`의 Playwright 디바이스 에뮬레이션 수동 UAT에만 의존(reference-frontend-uat). 이 공백이 코드맵 CONCERNS #16/#18에 기록됐고, `Reports.jsx` 종목관리 핸들러·필터/정렬 로직의 훅 추출(task#89 R4 후속, task 90/91)이 "회귀를 자동으로 못 잡는다"는 이유로 보류돼 있었다 — 즉 **테스트 하니스 도입이 그 추출의 선결 조건**이었다.

## Decision

프론트 단위 테스트 러너로 **Vitest**를 채택한다. 환경은 `jsdom`(훅/컴포넌트 테스트용 `renderHook` 대비), 라이브러리는 `@testing-library/react`(+`@testing-library/jest-dom` 매처). 설정은 별도 파일 없이 **`vite.config.js`의 `test` 블록**에 둔다(Vite 설정·플러그인·alias 재사용). 테스트는 소스 옆 콜로케이트(`*.test.js(x)`), 스크립트는 `"test": "vitest run"`. **도입 범위는 R4 추출 대상(`useReportFilters`/`useStockManagement`)으로 한정** — 프론트 전체 테스트 백필은 별건(CONCERNS #16 전체 해소는 이번 범위 아님).

## Considered Options

- **Jest + RTL** — React 생태계 표준이나, Vite/rolldown 변환·ESM·alias를 babel/ts-jest로 별도 재현해야 해 Vite8 환경과 이중 설정. Vitest는 `vite.config.js`를 그대로 재사용해 설정 표면이 작다.
- **Playwright UAT 유지(러너 미도입)** — task#89에선 통했으나, R4는 *로직*(sort 비교자·필터 분기 전수) 추출이라 UAT로는 전수 검증이 어렵다. characterization 단위 테스트가 "추출 전후 동일 입력→동일 출력"을 기계적으로 보장.

## Consequences

- Vitest는 한 번 채택하면 테스트 작성 관례(파일 위치·매처·렌더 API)가 고착되어 교체 비용이 크다(가역 어려움).
- `node_modules`/Docker 의존성 차이 주의(로컬 `.venv`엔 lxml 없던 사례처럼): devDependency는 `frontend/package.json`에 추가하되 빌드/배포(`npm run build`)엔 영향 없음(테스트는 CI/로컬 전용, dist 미포함).
