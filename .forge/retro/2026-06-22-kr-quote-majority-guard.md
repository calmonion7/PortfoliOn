# 2026-06-22 — KR 라이브 시세 발산 가드를 독립 피드 2-of-N 다수결로 (task#98)

## Plan vs actual
- What went as planned:
  - 3슬라이스(S1 순수 헬퍼+단위테스트 / S2 lazy-escalation 배선+통합테스트 / S3 doc-sync) 모두 TDD로 green, 전체 pytest 863 passed 무회귀.
  - 핵심 통찰("표는 참조 종류가 아니라 독립 현재가 피드 — prev_close/일봉은 NXT와 같은 피드라 별도 표 아님")이 구현에서 그대로 성립. ref_close는 가드에서 빠지고 변동률 계산용으로만 남김.
  - KRX-poison(KRX 단일 글리치)·NXT 자기일관 `_AL` 전체오염 둘 다 다수결로 해소(통합 테스트로 확인). 평소 NXT≈KRX 합의는 lazy 2콜 유지.
- Divergences (3건, 모두 그릴링 알고리즘을 실제 테스트와 대조하며 내린 판단):
  1. **escalation 트리거를 "불일치(disagreement)"로 한정** — plan은 degenerate를 "가용 피드 1개뿐→전부 fetch 후 폴백"으로 서술했으나, 키움 부재/단일(outage)은 *불일치가 아니므로* escalate 안 하고 기존 lazy 우선순위 체인으로 short-circuit(`_kr_pick_degenerate_lazy`). KRX-poison·NXT전체오염은 둘 다 NXT≠KRX 불일치라 영향 없이 잡힘.
  2. **`_price_sane`의 `krx_close`(③, task#96) 파라미터 제거** — 다수결이 ③ 단일 KRX 교차검증을 대체해 dead. task#94 3-arg 형태로 복귀. regular=True는 ①+②, degenerate는 ①만.
  3. **반환 우선순위 Naver(rank2) > 키움 KRX(rank3)** (plan 명시 우선순위대로) — task#96 코드는 전 라이브 실패 시 krx_ref 최후 반환했으나 다수결은 trusted 중 우선순위로 선택.

## Learnings
- Do differently next time:
  - **corroboration/다수결 가드를 설계할 땐 "불일치(disagreement)"와 "부재(absence/outage)"를 구분하라.** 둘 다 "합의 실패"지만 처리가 정반대다 — 불일치는 글리치 신호라 추가 피드를 fetch해 다수결로 outlier를 폐기해야 하고, 부재는 단순 장애라 escalate 없이 lazy short-circuit + 단일 self-check가 맞다. 이 구분을 안 하면 ① 비용목표("escalation은 글리치 시에만, 평소 2콜")가 깨지고 ② **기존 lazy 테스트가 깨진다**(이번엔 `test_get_quote_kr_uses_kis_when_kiwoom_fails`의 "키움 down→KIS답→Naver 미호출" 단언 — outage에도 무조건 escalate했으면 Naver가 추가 호출돼 깨졌을 것; CLAUDE.md "additive read가 mock.call_args 오염" 가토의 실사례).
  - **plan의 알고리즘 서술이 기존 테스트와 충돌할 땐 둘을 나란히 놓고 "어느 케이스가 어느 분기로 가는가"를 트레이스하라.** 이번엔 기존 테스트가 `get_quote.return_value`(NXT==KRX 동일값)를 쓰는지 `side_effect`(regular별 다른 값)를 쓰는지가 합의/불일치 분기를 갈라, 어떤 테스트는 무수정 통과·어떤 건 교체 필요였다. 머지 전 전수 트레이스가 "전부 green" 약속을 지키는 유일한 방법.
  - 단일피드 self-consistent 글리치(NXT 70k인데 KRX도 down)는 여전히 못 잡는다 — 2nd 피드가 없으면 다수결도 무력(wrong<missing floor). 이건 면역 불가의 본질적 한계지 버그 아님.

## Doc updates
- CONTEXT.md promotion: none (가드 메커닉은 글로서리 용어 아님 — plan에서 사전 확인)
- ADR added: none (가드 임계·알고리즘은 되돌리기 쉬움 — 되돌리기=all-must-pass 복귀; task#94/96 선례 따라 ADR 불필요. 알고리즘 자체는 CLAUDE.md "KR 시세 발산 가드" 가토에 S3 doc-sync로 반영됨)
