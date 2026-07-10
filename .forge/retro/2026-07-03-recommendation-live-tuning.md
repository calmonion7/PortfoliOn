<!-- forge-slug: recommendation-live-tuning -->
# 2026-07-03 — 추천 라이브 관찰 후속 수정 (task#132)

## Plan vs actual

- 계획대로: 3슬라이스 전부 TDD(red 10건 실확인→green)로 충족. **워크플로우 생략, 메인 세션 직접 TDD**(소규모 3파일 — fg-run 비용 원칙). 전체 pytest 1013 green. 커밋 825bfc59 배포 → 라이브 UAT 즉시 통과(NVDA enriched=true·관심 20/20 true, 000660 익절 액션). ① enriched 판정 `tickers.enriched_at` 정본으로 교체(+watchlist용 스냅샷 read 제거 — additive-read 자체 소멸), ② `_YF_THROTTLE_S=0.35` 직렬 스로틀(결측분 fetch 직전에만), ③ `LO_SCORE` 40→45.
- Divergences: 사실상 없음(저-divergence). 유일한 현장 결정 = 직접 실행 방식. 리뷰 잔재물(noop with 블록)은 같은 파일을 스치면서도 Non-goal 준수로 미수정(이월 유지).
- S2 스로틀 효과(이름·목표가 결측 감소)는 다음 추천 배치 재계산부터 점진 관측 — 원래 비게이트.

## Learnings

- Do differently next time:
  1. **신규 판정/표시 필드는 정본 저장 위치를 기존 소비처 grep으로 확정하고, 테스트가 실구조를 단언해야 한다** — task#131의 enriched가 `snapshots.data` JSON에 있다고 *가정*돼 항상 False였고, 테스트도 그 가정의 fixture라 green(fixture-pass-live-fail의 *내부 저장* 판 — 외부소스 파싱 판은 #111/#117). 이번 수정 테스트는 SQL에 `FROM tickers`·`enriched_at` 포함을 단언해 재발을 구조로 차단. 종목명 dual-source 가토와 같은 "이중 저장소 혼동" 가족 → CLAUDE.md 승급(사용자 확인).
  2. **라이브 프로브 주도 그릴링이 수정 태스크를 값싸게 만든다** — fg-ask 단계에서 재계산 폴링(백그라운드 90s)→응답 프로브→로컬 yfinance 단건 대조로 버그 3건·원인(rate-limit 정황·판정 위치)을 계획 전에 확정. 실행은 30분 직접 TDD로 종료(워크플로우 6에이전트 대비 ~1/10 비용). "관찰 후 튜닝" 클래스는 이 순서(프로브→그릴→직접 수정)가 기본형.
  3. **요청경로 계산 vs 배치 계산의 UAT 시점 분리를 계획에 명시하면 핸드오프가 깔끔** — S1·S3은 배포 즉시 라이브 검증, S2는 재계산 의존을 DoD에 갈라 적어 verified 근거가 명확했다.
- 관찰(후속 후보, 차단 아님):
  - 다음 추천 배치(내일 07:00/20:30 또는 수동 refresh) 후 이름·목표가 결측 감소와 발굴 비구루 진입(구루 동질성 완화 — 그릴링에서 보류한 가중 조정의 판단 근거) 재관찰.
  - 리뷰 잔재물 3건(dead test·noop with·docstring) — fg-quick 이월 유지.

## Doc updates

- CONTEXT.md promotion: none — 신규 도메인 용어 없음.
- ADR added: none — 임계 45·스로틀 0.35는 가역적 튜닝(ADR 3조건 미충족), 정본 위치는 결정이 아니라 사실.
- CLAUDE.md: **"이중 저장소 판정 필드" 가토 1줄 승급**(enriched_at 정본=tickers 컬럼, 신규 판정 필드는 소비처 grep으로 정본 확정 — 사용자 확인).
