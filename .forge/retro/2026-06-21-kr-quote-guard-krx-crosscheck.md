# 2026-06-21 — KR 시세 가드에 독립 KRX 교차검증 추가 (task#96)

## Plan vs actual
- What went as planned: `_price_sane`에 ③ KRX 교차검증(±2x) 추가, `_kr_pick_basic`이 regular=False일 때 `_kr_basic_kiwoom(regular=True)`로 독립 KRX 참조 1콜 fetch → 교차검증, 모든 라이브 소스 실패 시 글리치 NXT 대신 KRX 참조 반환. regular=True(리포트)는 krx_ref=None으로 스킵(비용 무변). 대시보드 핫패스 무변경. 라이브 무회귀 확인(NXT 350.5k/KRX 354k), 854 테스트 그린.
- Divergences:
  - **CLAUDE.md mock-pollution 가토 재발**: `test_guard_discards_diverging_source_and_falls_back`가 `kq.get_quote`를 단일 return_value(70k)로 모킹 → 신규 krx_ref가 *같은* 70k를 KRX 참조로 받아 올바른 Naver(354k)를 ③로 잘못 폐기, 글리치 70k 반환해 깨짐. 수정: `regular`-aware side_effect(regular=True→KRX 354k 깨끗 / False→NXT 70k 글리치). 나머지 가드 테스트 4건은 krx_close가 우연히 ±2x 내라 미수정 통과.
  - **자기검토 발견 — KRX-poison 잔존**: 가드가 ③에서 KRX를 앵커로 신뢰(all-must-pass + 폴백 krx_ref)하므로, *KRX 평문코드*가 글리치(70k)나고 NXT가 정상(350k)이면 정상 NXT가 ③에서 false-reject되고 글리치 KRX가 반환되는 *새* 실패모드. task#94 근거(KRX 안정, 글리치는 NXT `_AL` 특정)로 관측된 NXT-글리치 노출을 이론적 KRX-글리치 노출과 맞바꾼 net-positive로 채택.

## Learnings
- Do differently next time:
  - **additive 외부 read를 함수에 추가하면, 그 함수가 호출하는 하위 콜을 *단일 return_value*로 모킹한 기존 테스트를 전수 감사하라** — 신규 read가 같은 콜을 다시 호출하면 그 단일값을 신규 read에도 먹여, 다른 입력을 기대하는 분기를 조용히 오염시킨다(이번엔 krx_ref가 NXT 글리치값을 "깨끗한 KRX"로 받아 정상 폴백을 폐기). 수정 패턴 = 호출 구분 인자(여기선 `regular`) 기반 `side_effect`. **이건 CLAUDE.md에 이미 있는 mock-pollution 가토의 *재발 실증* — 신규 문서화 불필요, 기존 가토가 정확했음을 확인.**
  - **단일 앵커 신뢰 가드(all-must-pass)는 그 앵커 자신의 글리치를 false-reject로 증폭한다**: ②(NXT 일봉)·③(KRX) 중 어느 하나가 글리치나면 정상 소스가 거부된다. "2-of-3 다수결"(①② 통과면 ③ 단독 실패 무시)이면 단일 참조 글리치에 면역 — 단 ①②도 같은 all-must-pass 의미를 바꿔야 해 단순성 트레이드오프. 현재는 미채택(KRX 안정 가정), 후속 후보.
  - **그릴링이 사용자 멘탈모델과 실제 코드경로의 불일치를 잡았다**: 사용자는 "대시보드 가드 참조 보강"을 원했으나, 실제 대시보드 핫패스(`get_quotes_batch`/`_changes_from_closes`)는 `_price_sane` 가드를 *안 탄다*(NXT 일봉 종가 직접 사용). 코드 확인으로 범위를 단건 가드(`get_quote_kr` regular=False)로 정확히 한정 — "보강 대상을 가정 말고 어디서 값이 오는지 grep으로 확인".
- 후속 큐 후보(task 미생성): **2-of-3 다수결 가드** — KRX-poison 잔존 제거 + 단일 참조 글리치 면역. 별도 그릴링(①② 의미 변경 수반).

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음 — KRX/NXT/정규장은 ADR-0020/CLAUDE.md 기존)
- ADR added: none (task#94 선례: 가드는 임계 튜닝 쉬워 ADR 미충족 — ③ 교차검증도 동일, 되돌리기=③ 제거)
- CLAUDE.md: 기존 task#93·94/95 가드 가토에 ③ KRX 교차검증(자기일관적 `_AL` 전체오염 차단) + KRX-poison 잔존/2-of-3 후속 한 줄 추가(doc-sync — 가드 동작이 ①②→①②③로 확장).
