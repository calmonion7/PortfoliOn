# 2026-06-27 — NaN/inf 직렬화 500 가드 (macro-correlation·recommendations, task#109)

## Plan vs actual
- What went as planned: 계획대로 macro-correlation(corr isfinite·scatter skip)·recommendations(price_f 소스 가드 + 응답 sanitize 네트) 수정. 직접 실행. pytest 888 green(신규 2). 응답 shape 불변이라 doc-sync 무관.
- Divergences (낮음):
  - **fx 추가 가드 불필요 확정**: `usdkrw = _usdkrw_rate()`가 CONCERNS §1대로 이미 isfinite 가드 → fx-NaN은 소스에서 None. 계획의 "sanitize 네트가 fx 커버" 대신 *소스에서 이미 안전*임을 코드로 확인(별도 fx 가드 미추가).

## Learnings
- Do differently next time:
  - **다중 float 응답엔 소스 가드 + sanitize 네트 *둘 다*** — 소스 가드(price_f→None)는 불량 행을 격리해 sum(total_krw)에서 빼므로 *다른 종목의 weight_pct가 보존*된다. sanitize-only는 NaN이 total_krw를 오염시켜 *모든* 종목 weight를 None화한다. 그래서 소스 격리(정확성) + sanitize(안전망) 병행이 맞다(대시보드 `_build_all`과 동일 2겹).
  - **공유 소스 헬퍼의 가드는 소비처로 전파** — `_usdkrw_rate`가 isfinite 가드를 가지면 그걸 쓰는 recommendations는 fx를 또 가드할 필요 없다. 소스-가드 위치를 먼저 확인하면 중복 가드를 피한다(CONCERNS §1 "소스에서 가드" 원칙의 실익).

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none
- 승급 없음 — 학습은 모두 CONCERNS §1(NaN/inf→allow_nan=False 500, 소스 가드 우선) 재확인이라 기존 문서로 충분. retro 로그에만 격리-vs-sanitize 뉘앙스 기록.
