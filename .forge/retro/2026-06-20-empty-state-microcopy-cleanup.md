# 2026-06-20 — 빈상태·마이크로카피·라벨 정리 (task#84)

> task#78 UI/UX 진단이 자동 분해한 fix 클러스터 6건(#79~84) 중 하나. 커밋 e83ac0ec.

## Plan vs actual
- What went as planned:
  - S1~S3 완료. Digest 'Daily Digest'→'다이제스트' 한국어화 + 빈상태 중앙정렬 아이콘+설명+인라인 CTA, Calendar 에러 '다시 시도'+빈 달 안내. 단위/맥락 라벨(순매수 '주'·'다음 예정:'·가중치 설명·RSI 툴팁·산점도 '최근 90일'). asOf 가시성 상향, 매크로 신호 닫힌 헤더 역전/신용 힌트, 'N/A'→'—'. 적대리뷰 PASS(표시 텍스트 한정·로직 무변경·critical 0).
- Divergences:
  - 거의 무이벤트(표시 텍스트/라벨/툴팁/빈상태 한정, 데이터·계산 무변경).
  - **갱신시각 포맷 통일 1건 메인세션 추가**: 워크플로우는 라벨만 통일하고 포맷은 'marketUtils 담당'으로 미뤘으나 marketUtils엔 해당 표시가 없었다(소비 컴포넌트에 있음) → GuruManagers PC도 `.slice(0,10)`로 직접 통일.
  - Ranking `fmtNet` null 폴백은 '-' 유지(형제 포매터와 일관 — 'N/A'가 아니라 범위 외).

## Learnings
- Do differently next time:
  - **"X가 담당"이라고 미루기 전 그 파일에 실제 표시 코드가 있는지 grep 확인** — 갱신시각 포맷을 marketUtils로 미뤘으나 거기 없어서 메인세션 후속이 필요했다. 표시는 소비 컴포넌트에 있는 경우가 많다.
  - 매크로 신호 힌트(역전/신용주의)는 signals active일 때만 표시 → 현재 비활성이라 라이브 미노출, 코드 가드+리뷰로 검증.

## Doc updates
- CONTEXT.md promotion: none (마이크로카피/라벨은 구현 디테일)
- ADR added: none
- 후속 후보: GuruManagers COLUMNS 영문 배열 dead code, utils.js `fmtPrice`의 'N/A'/'₩NaN' 폴백 한국어화.
