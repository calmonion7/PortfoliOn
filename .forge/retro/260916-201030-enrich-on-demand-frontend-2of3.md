# 2026-09-16 — 리포트 상세 온디맨드 갱신 요청 + 유계 폴링 토스트 (task#355, fg-loop 일괄 승급)

## 계획 대비 실제
- 계획대로 된 것: 훅 + Reports 배선, 테스트가 Reports 페이지를 렌더해 배선까지 8축, fault injection으로 상한 3축(언마운트·MAX_TICKS·실패 상한)이 각각 FAIL함을 확인.
- 어긋난 것:
  - 완료 판정 baseline은 계획의 「시작값(부모 detail의 enriched_at)」이 아니라 **첫 폴의 값** — 부모 상태는 이 이펙트와 비동기로 채워져 「미조회 null」과 「진짜 null」을 구별 못 한다.
  - 첫 전체 vitest에서 형제 4건 파손: `report-detail-stale`·`reports-deep-link-navkey`가 `api`를 `{get}`만 또는 `post: vi.fn()`(undefined 반환)으로 mock → 새 `api.post(...).then`이 TypeError. 기존 가토 「additive 호출이 `mock.call_args`를 오염」의 **프론트판**(깨지는 건 호출 시퀀스가 아니라 mock의 *형태*). 해법은 형제 수정이 아니라 신규 호출을 `Promise.resolve().then(() => api.post(...))` 체인 안에 두는 것 — 동기 throw·비-promise 반환이 전부 `.catch`로 모여 상세 렌더를 깨뜨리지 않는다.

## 학습
- 다음에 다르게: 페이지에 새 API 호출을 additive로 붙이면 그 페이지를 렌더하는 형제 테스트의 `vi.mock('../api', …)`를 grep해 새 메서드가 있는지 볼 것 — 없으면 훅 쪽에서 방어(Promise 체인)하고 형제는 건드리지 않는다(스위트가 게이트, grep은 어디를 볼지).
- 부수: 첫 토스트 type `warning`, 완료 `success`; 404(옛 백엔드)는 경고도 내지 않음.

## 문서 갱신
- CONTEXT.md 승급: 없음
- ADR 추가: 없음
