# 2026-07-10 — 버그 헌트: 6/27 이후 변경분 (task#164)

## Plan vs actual
- 계획대로 된 것: 7 finder fan-out(표면 그룹 정적 인코딩) → dedup → finding별 적대적 검증 → `.forge/bug-report.md` 교체(15건, HIGH 1·MED 11·LOW 3), 코드 미수정·#28 승계 전부 plan 준수. eco 모드(sonnet 캡+ECO 주입)로 22 에이전트 ~250만 토큰.
- Divergences (낮음):
  - **기각 0건** (이전 헌트 원시 50/기각 5 대비): finder에 CLAUDE.md Gotchas 버그 가족을 표면별 시드로 제공 + "빈 findings도 유효한 답" 지시 → 보수적 보고로 원시 15건 전원 검증 통과. 검증 판정문 전수 코드 인용 동반(고무도장 아님 — HIGH 건 메인 세션 spot-check 교차 확인).
  - **동일 패턴 잔존 클러스터 발견**: bare `date.today()` UTC 함정 4건(digest_service·leverage_service·consensus_pipeline·kospi_signal) — task#157이 신규 파일(kospi_futures·kis/futures)만 고치고 기존 코드 전수 스윕은 안 했던 잔존. 빈결과/부분실패 박제·클로버 3건(fx·recommendation store·us_supply)도 task#160 가토의 잔존 사례.

## Learnings
- Do differently next time:
  - **가토(패턴 버그)를 확립하는 수정 태스크는 같은 패턴의 기존 코드 전수 grep 스윕을 DoD에 포함할 것** — task#157이 트리거 파일만 고쳐 같은 패턴이 4곳에 살아남았다(`grep -rn "date.today()" backend/ --include="*.py"` 한 번이면 잡혔을 것). 로깅 스윕(task#163)처럼 가드 테스트(예: bare date.today() 금지 단언)까지 가면 재발도 차단.
  - **버그 헌트 finder에 알려진 버그 가족 시드 제공 + 빈 결과 허용 지시가 효율적** — 거짓양성이 안 나와 검증 비용이 순수 확인에만 쓰임. 다음 헌트도 이 방식 유지(단, 시드 밖 novel 버그 발굴력은 시드 무관 lens가 담당하므로 클래스 lens는 유지).
  - 후속 수정 우선순위: ① HIGH #1 교차 사용자 캐시 유출(report.py:251, 보안) ② date.today() 4건 일괄 스윕+가드(한 태스크로) ③ 박제/클로버 3건(fx·rec store·us_supply) ④ 나머지 성능·프론트 — 리포트 리뷰 후 항목별 fg-ask.

## Doc updates
- CONTEXT.md promotion: 없음
- ADR added: 없음
