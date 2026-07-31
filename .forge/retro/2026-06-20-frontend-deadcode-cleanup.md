# 2026-06-20 — 프론트 dead-code 제거 (죽은 CSS + GuruStats 탭경로 + COLUMNS) (task#85, 일괄 승급 회고)

`fg-next all` 자동 스킵 봉인의 지연 승급. 원료: `done/2026-06-20-frontend-deadcode-cleanup/run.md`.

## 계획 ↔ 실제

- **계획대로**: ① `mobile.css`의 `.holdings-list`·`.m-cal-wk` 일가 삭제 ② `GuruStats`의 도달불가 탭경로(`TABS`·`innerTab`·`{!view && …}` 블록) 삭제 + `tab = view ?? 'popularity'`로 단일소스화 ③ `GuruManagers.jsx`의 미참조 `COLUMNS` 삭제. 각 심볼 grep 잔여 0건, 빌드 통과.
- **살려둔 것**: `WEIGHT_LEGEND`(weighted 뷰에서 사용)·`tdStyle`·`SORT_OPTIONS`(live) — "같은 파일에 있으니 함께 정리"를 하지 않았다.
- **Divergence**: 거의 없음 — 계획이 fg-ask 단계에서 코드 대조로 dead 검증을 마쳤기에 그대로 기계적 제거.

## 배운 것

- **다음엔 다르게**:
  1. **dead-code 제거의 UAT는 라이브 스모크가 아니라 "런타임에 닿지 않음의 증명"이다.** 제거분이 전부 ① 미렌더 CSS(className 사용 0) ② 도달불가 JS(`{!view && …}`는 view가 항상 truthy) ③ 미참조 const라면 **라이브 결과가 바뀔 수 없다** — 빌드 통과 + grep 잔여 0 + 코드 대조로 충족되고, 헤드리스 스모크는 추가 보증 가치가 낮다. 반대로 "닿지 않음"을 증명할 수 없는 제거라면 그건 dead-code가 아니라 기능 변경이므로 UAT가 필요하다. **이 구분이 UAT 생략의 유일한 정당한 근거다.**
  2. **도달불가 분기를 지울 땐 남는 표현식의 기본값을 명시적으로 둘 것** — `view ?? innerTab`에서 `innerTab`을 지우면 `view ?? 'popularity'`처럼 기본값이 드러나야 한다(유일 호출자가 항상 view를 넘기더라도 방어적으로).
- **후속(별도 task로 분리)**: `.ui-input` 단일소스화(시각 변경 동반), `fmtPrice` NaN/'N/A' 가드+한국어화, Reports 필터 공통 호스트 리프트, RecCard 종목명 클램프, CONCERNS #17 잔여(레거시 `.m-login input`/`.login-form input`).

## Doc updates

- CONTEXT.md promotion: none · ADR added: none
- CLAUDE.md 승급: none (dead-code UAT 논리는 유용하나 fg-run의 `n/a` 판정 규약과 겹친다 — retro에 보존)
