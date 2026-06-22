# 2026-06-22 — 액션버튼 2-렌더러 중복 제거 (StockActions, task#103)

## Plan vs actual
- What went as planned: byte-identical 중복 블록을 단일 `StockActions`(layout prop=card/list, self-gate)로 추출. StockCard·TickerListItem 교체, 미사용 Pencil import 정리, CLAUDE.md 가토 갱신. build green, 렌더 byte-identical, Pencil orphan 0.
- Divergences: **사실상 없음**(매우 낮음). 코드로 중복이 byte-identical임을 사전 확인 후 설계가 그대로 적중. 순수 추출.

## Learnings
- Do differently next time:
  - **identical-duplicate UI 블록 추출 패턴**: 두 렌더러에 동일 블록이 래퍼만 다를 때(여기선 div vs fragment), 차이는 `layout` prop으로 흡수하고 **self-gate를 래퍼보다 먼저** 두면(비해당 시 null) 기존 "빈 래퍼 미렌더"까지 보존돼 렌더 byte-identical 추출이 된다.
  - **중복은 그 자체로 버그 토양**: 이 액션버튼 중복이 task#97(그외탭 삭제 404)의 재발 토양이었다(한쪽만 고치면 다른 화면에서 깨짐). 동일 블록이 두 곳에 보이면 "지금은 안 깨졌어도" 단일화가 미래 회귀를 막는다.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (순수 컴포넌트 추출 — 게이트 미충족). CLAUDE.md task#97 가토를 "단일 StockActions로 통합, 한 곳만 수정"으로 S3에서 갱신(doc-sync).
