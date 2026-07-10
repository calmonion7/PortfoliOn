# 2026-06-14 — 가격 변동 플래시 애니메이션

## Plan vs actual
- What went as planned: 3 슬라이스 그대로. S1 공통 메커니즘(`flashDirection` 순수함수 + `usePriceFlash` 훅 + `FlashValue` 래퍼 + `PriceFlash.css`), S2 4면 배선(대시보드 카드 가격행·보유 평가손익 데스크탑/모바일·KPI 평가금액 데스크탑/모바일), S3 검증(node 10/10·빌드 OK·가상 장중 UAT 8/8). 직전 틱 기준 방향·배경 틴트 페이드 0.7s·reduced-motion off·`priceTick` 라이브 게이팅 전부 계획대로. main 2b1acd31 배포.
- Divergences:
  - **(중) 기존 죽은 필드 불일치 발견 → 1줄 교정**: `refreshLivePrices`의 대시보드 머지가 아무도 안 읽는 `c.price`를 갱신(카드는 `current_price`를 읽음). 즉 **폴링이 대시보드 카드의 가격을 갱신한 적이 없던 기존 버그**. 카드 가격 플래시(명시 선택)의 전제라 `current_price`로 교정. 계획 4면 외 추가 편집이나 요구에 직결.
  - **(낮) UAT 대상 dev→preview 전환**: dev(5173)는 StrictMode 이중 마운트로 초기 fetchAll 2회 → 모킹 `/prices` 시퀀스가 밀려 "down 먼저" 관측. production preview(4173)로 전환하니 정상(up@15·down@45·up@60). 메커니즘은 dev에서도 정상이었음.

## Learnings
- Do differently next time:
  - **"백그라운드 갱신이 돈다"와 "표시가 갱신된다"는 다르다 — 머지가 쓰는 필드 = 컴포넌트가 읽는 필드인지 확인**. 폴링 머지가 `c.price`를 쓰는데 카드는 `current_price`를 읽어 카드 가격이 폴링 내내 정적이었다(조용한 데이터-흐름 단절). [[2026-06-14-realtime-price-freshness-ui]]의 "백그라운드 자동화엔 가시 상태를 함께"의 데이터층 버전: 가시 상태를 새로 입힐 땐 그 값이 **실제로 흐르는지**(머지 키 == 렌더 키)를 먼저 검증. "폴링 호출됐다"가 아니라 **렌더된 결과를 관측**하는 UAT라서 잡혔다.
  - **호출 순서/카운터에 의존하는 프론트 UAT는 dev가 아니라 production preview로** — React StrictMode가 dev에서 effect를 이중 호출해 모킹 엔드포인트 소비 순서를 밀어버린다. `npm run build` + `vite preview`(별도 포트)로 실제 배포 번들을 검증하면 이중호출이 없어 시퀀스가 정확. [[reference-frontend-uat]]에 반영.
  - **전이형(짧게 떴다 사라지는) 애니메이션은 `MutationObserver`로 누적 포착** — 750ms 플래시는 폴링/스냅샷으론 놓치기 쉽다. `observe(body, {subtree,childList,attributes,attributeFilter:['class']})`로 클래스 부착 순간을 배열에 쌓고 끝에 읽으면 양성(방향별)·음성(무발화 개수)·순서까지 결정적으로 검증된다. FlashValue가 flash.id를 key로 remount하므로 addedNodes로 잡힌다.

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음 — "플래시"는 UI 표기)
- ADR added: none (죽은 필드 교정=버그 수정, 플래시=가역적 UI — 되돌리기 어려운 트레이드오프 아님)
- 메모리: [[reference-frontend-uat]]에 "StrictMode 회피용 preview 검증" + "MutationObserver 전이 애니메이션 포착" 기법 추가
