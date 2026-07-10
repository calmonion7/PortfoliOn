# 2026-06-21 — 리포트 스냅샷 = KRX 정규장 종가 (라이브 대시보드는 NXT 유지) (task#95)

## Plan vs actual
- What went as planned: 키움 단일 분기점 `integrated_code(stk_cd, regular=False)`에서 시세 체인·차트 체인으로 `regular` 전파, 기본값 False=NXT 무변화. 리포트 스냅샷 writer에만 `regular=True` opt-in. 캐시 키에 regular 포함. 전체 850 테스트 그린(신규 5건). ContextVar 미사용(ThreadPoolExecutor footgun, ADR-0020 결정대로 명시 파라미터).
- Divergences (둘 다 계획 의도에 부합하는 정밀화):
  - **백필 함수 price 소스는 L240 daily_df**(`d_trim["Close"]`)였다 — 플랜이 명시한 L259 quote는 sector/name만 쓰고 price 미사용. 그래서 L240 daily_df에 regular=True를 부여해야 백필 스냅샷 price가 KRX가 됨. weekly/monthly_df(L241/242)는 RSI만 소비 → NXT 유지(불필요 전파 회피).
  - **`report.py:444`(`refresh_analyst`) 경계 케이스**: `UPDATE snapshots`로 price를 박제하므로 snapshot-writer로 판정 → regular=True. 부수효과로 이 엔드포인트의 high_20d(yfinance=KRX)와 기준 일치.

## Learnings
- Do differently next time:
  - **"갑자기 또 N배" 박제는 라이브 소스 버그로 단정 말고 *배포 타이밍*부터 의심**: 배포 직후 "005930 다시 7만원" 보고가 왔지만, 프로브 결과 라이브 소스 둘 다 정상(KRX 354k / NXT 350.5k)이고 70k는 어디에도 없었다. 정체는 **task#95 배포 *전* 옛 NXT 코드 일배치가 그 순간 `_AL` 일시 글리치를 박제한 stale 스냅샷**. "fix 배포는 이미 박제된 스냅샷을 소급 치료하지 않는다" — 배포 후 stale 종목은 *재생성*해야 덮인다(재생성 prod 005930: price 70000→354000 확인).
  - **재생성 전 프로브로 라이브 소스가 깨끗한지 먼저 확인**: transient 글리치 중에 재생성하면 또 박제된다. 컨테이너 프로브(`docker exec -i portfolion-backend-1 python - < probe.py`)로 KRX 평문 vs `_AL` raw + task#95 정규화 경로를 한 번에 대조 → 깨끗 확인 후 재생성. 이 순서가 유효했다.
  - **가드(task#93·94)는 자기일관적 `_AL` 전체오염엔 맹점**: 오늘 70k 박제는 그 시점 `_AL`이 quote·prev_close·일봉ref를 *모두* 같은 오스케일(70k대)로 반환해 ±30%·±2x 검증을 둘 다 통과했다는 뜻(가드는 "나쁜 소스 vs 좋은 참조 *불일치*"일 때만 발동). 부분오염엔 강하나 전체오염엔 약함. **task#95의 KRX 평문코드 소스가 리포트 박제의 근본해결**(리포트가 `_AL` 글리치 자체에 노출 안 됨 → 오늘 밤 일배치부터 재발 없음). 가드는 대시보드(NXT 유지) 백스톱으로 잔존.
  - **prod 쓰기 게이팅 재확인**: 재생성(snapshots UPDATE)은 분류기가 차단 → 사용자 명시 재승인("직접 실행하고 확인해줘") 후 통과. 읽기 프로브는 통과. (reference-prod-writes-need-user 패턴 그대로.)
- 후속 큐 후보(task 미생성, 사용자 결정 대기): **대시보드(NXT) 잔존 노출** — `_AL`이 다시 전체오염 글리치를 내면 대시보드가 순간 오값을 보일 수 있음(가드 맹점). task#95가 KRX fetch를 이미 가능케 했으니, 필요 시 fg-ask로 "가드 참조를 `_AL` 대신 KRX 교차검증으로 보강" 그릴링.

## Doc updates
- CONTEXT.md promotion: none (이원화 개념은 ADR-0020이 이미 담음, 새 용어 없음)
- ADR added: none (핵심 결정=ADR-0020 기존. 가드 맹점은 결정이 아니라 관찰이라 retro 로그로 충분)
- CLAUDE.md: 기존 task#93·94 가토(KR 시세 vs 일봉 스케일)에 task#95 이원화(리포트=KRX 정규장 `regular=True` / 대시보드=NXT) + "박제 70k는 stale 가능—배포타이밍 의심·재생성으로 치료" 한 줄 추가(doc-sync).
