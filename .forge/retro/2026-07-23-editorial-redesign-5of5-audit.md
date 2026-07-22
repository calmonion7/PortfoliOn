# 2026-07-23 — 에디토리얼 리디자인 5/5: 전 화면 체계 감사 + 확정 결함 수정 (일괄 승급 사후 회고)

2026-07-17 실행·봉인(fg-next all auto-skip), run.md 기반 사후 회고.

## Plan vs actual
- What went as planned: 캡처 매트릭스 → 원시 28건 → dedup 판정 fix 15/defer 5/drop 4 → fix 전건 적용(rsiColor 테마 분기, 죽은 CSS 삭제, 터치타겟 44px 등). drop 4건 전부 실측 근거 기각.
- Divergences: **⚠️ 차단급 회귀를 게이트가 배포 전 포착** — Badge success/danger 의미색 교체가 ChangeBadge(전역 가격 등락 배지)의 가격색을 반전(상승=초록/하락=빨강 서구식). 판정 에이전트가 실소비처(value>=0→success) grep 없이 교체를 지시했고 fix 에이전트가 그대로 적용, vitest·빌드는 통과(색 의미는 테스트 밖) — **fix 후 스팟 시각 재캡처(게이트)가 유일하게 잡음**. 메인 세션 교정: `.badge--up/--down` 가격색 변형 신설 + ChangeBadge 전환 → **의미 배지(success/danger) vs 가격 배지(up/down) 완전 분리** + computed color 실측(up=#b3372b·down=#2b5c9e).

## Learnings
- Do differently next time: **공용 UI킷 변형(variant)의 색 의미를 바꿀 땐 소비처 전수 grep 선행** — "규칙 위반처럼 보이는 배선"이 실은 의도된 소비(가격 게이팅)일 수 있다. **fix 적용 후 스팟 시각 재검증 단계를 생략하지 말 것** — 이번 리뉴얼에서 배포 전 회귀를 잡은 마지막 그물이 두 번 다 시각 게이트였다(vitest/빌드는 색 의미에 블라인드).
- KR 색 가토의 완결형: 이제 `.badge--up/--down`(가격 전용)과 success/danger(의미 전용)가 분리돼 있다 — 이후 배지 작업은 이 구분을 전제(CLAUDE.md KR 색 가토 절 갱신 후보).

## Doc updates
- CONTEXT.md promotion: none (배지 분리는 UI 구현 규약 — CLAUDE.md 가토 갱신 후보로 별도 제안).
- ADR added: none.
