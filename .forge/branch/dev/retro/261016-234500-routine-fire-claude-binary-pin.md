# 2026-10-16 — 루틴 fire 리스너 네이티브 claude 절대경로 고정 + fire마다 사전 점검 (task#389)

## Plan vs actual
- What went as planned: S1~S5 전부 계획대로 착지. TDD 빨강(ⓐⓑⓒ 3 failed)→초록(26 passed), 전체 2558 green, PR #20 머지·배포(`9473576`), npm claude-code 제거, ASML 발행 1행, 야간 enrich 22종목 전부 갱신.
- Divergences:
  - ⓑ(단일 모드 500)는 현 코드에서도 이미 통과할 수 있어, 「점검이 스폰 전이라 workdir이 안 생긴다」 단언을 더해 빨강을 냈다.
  - ASML 1차 fire는 루틴이 7일 게이트 재량으로 건너뛰어(200인데 발행 0) 트리거 text로 ASML을 명시한 2차 fire로 메웠다 — 계획이 「깨질 수 있는 방식」으로 미리 적어둔 그대로였다.
  - DoD 6의 `청크 k/k 완료` 로그 판정이 거짓 음성을 냈다: 마지막 청크(5/5) 줄이 없었다. 다른 세션의 PR #23 배포가 리스너를 재기동한 시점과 겹친 것으로 보이며(추정), DB의 `enriched_at` 대조로 22종목 완료를 확인했다.

## Learnings
- Do differently next time:
  - 리스너를 거치는 장시간 작업(야간 enrich ~40분)의 완료 판정은 로그 줄이 아니라 **데이터 대조**(`job_runs.payload.tickers` × `tickers.enriched_at ≥ started_at`)를 1차 증거로 삼을 것. 로그는 리스너 재기동에 끊긴다.
  - 도는 동안 타 세션의 prod 배포가 리스너를 재기동할 수 있다(허브 다중 세션). 장시간 fire 중에는 배포를 미루도록 사전 조율하거나, 계획에 「재기동 시 끊김 → 데이터 대조로 판정」을 완료기준에 미리 쓸 것.
  - 「서비스가 `200 queued`로 먼저 응답」하는 구조는 실행기 고장을 거짓 성공으로 기록한다 — fire 수신 시점 사전 점검이 그 가드다(이번에 추가). 비슷한 비동기 접수형 엔드포인트는 접수 전에 의존 실행기를 점검할 것.
  - 호스트의 글로벌 npm 패키지 자동 업그레이드가 postinstall 미실행으로 실행 파일을 깨뜨릴 수 있다 — 서비스는 PATH가 아닌 절대경로로 고정한다.

## Doc updates
- CONTEXT.md promotion: none
- ADR added: none (되돌리기 쉬운 결정 — 계획 비목표대로)
