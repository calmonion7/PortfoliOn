# 2026-06-22 — 리포트 박제-시 독립피드 게이트 (task#101)

## Plan vs actual
- What went as planned:
  - 근본원인 진단이 계획대로 적중: regular=True(KRX)는 NXT `_AL`만 차단할 뿐 KRX 두 TR(quote ka10001·일봉 ka10081) 자기일관 글리치엔 면역 아님. 네이버 creds-free 프로브로 005930=357,500(정상) 확인 → 일시적 글리치 박제(영속 버그 아님, task#94 패턴 KRX판)로 확정.
  - fix(저장 직전 KR 독립피드(네이버) 2x 교차검증 → 어긋나면 박제 스킵)·TDD(6 테스트 red→green)·문서(CLAUDE.md 정정+ADR-0020 amend) 전부 계획대로. 전체 872 passed 무회귀.
- Divergences (중간):
  1. **additive Naver-read 블라스트 반경** — 게이트가 KR generate_report마다 `_kr_basic_naver`를 호출 → 기존 `test_generate_report_resolves_ticker_like_name_from_quote`(`_mock_kr`)가 네이버 미mock이라 실제 호출→게이트 발동→깨짐. mock 추가로 보존. 다른 KR generate_report 테스트(라우터·배치)는 전부 generate_report를 통째 patch해 무영향(전수 grep 확인).
  2. **reload × 직접-import 패치 footgun** — 테스트의 `importlib.reload(report_generator)`가 패치 후 실행돼 `from services.db import execute`를 재바인딩 → `services.report_generator.execute` 패치 무효화. 소스 `services.db.execute`로 타겟 변경해 해결.

## Learnings
- Do differently next time:
  - **널리 호출되는 함수에 외부 read를 *추가*할 땐, 그 함수의 모든 테스트 호출처를 먼저 grep**하라(CLAUDE.md "additive read가 mock.call_args/테스트 오염" 가토의 또 다른 얼굴). 새 read가 ① 네트워크 플래키를 들이거나 ② 기존 mock이 새 read를 안 가려 거짓 실패를 낸다. 대응: 각 호출처가 새 read를 mock하거나 대상 함수를 통째 patch하는지 확인. 이번엔 `generate_report`에 네이버 read를 더해 `_mock_kr` 하나가 깨졌고(나머진 wholesale patch라 무사), 전수 확인이 블라스트 반경을 0으로 닫음.
  - **`importlib.reload` + `from x import y` 직접-import 패치 함정**: reload는 모듈 본문을 재실행해 직접-import한 *이름*을 원본으로 재바인딩하므로, 패치 후 reload하면 그 패치가 풀린다. 모듈-attr 패치(`mkt.get_quote` = 공유 모듈 객체의 attr)는 reload 생존하지만 직접-import 이름(`execute`/`query`/`sanitize`)은 아니다 → **소스 모듈(`services.db.execute`)을 패치**하라(reload가 패치된 걸 import).
  - **"regular=True면 리포트 안전"을 근본해결로 단정하지 말 것**: 거래소 분리(KRX vs NXT)는 *교차 피드* 오염은 막아도 *동일 피드 자기일관* 글리치는 못 막는다. 단일 피드 글리치 면역엔 항상 **독립 출처 교차검증**이 필요(task#96 NXT→task#98 대시보드 다수결→task#101 리포트 게이트, 같은 원리의 3번째 적용).
  - 잔존 한계: 단일 독립참조(네이버)라 네이버가 글리치하면 정상 리포트 false-skip 가능 — 스킵=직전 스냅샷 유지라 피해는 작음(wrong<missing). 다중 독립참조(KIS 등) 다수결은 비용 대비 미정당, 후속 후보로만.

## Doc updates
- CONTEXT.md promotion: none (새 도메인 용어 없음 — 게이트 메커닉)
- ADR added: none (신규 ADR 없음). 대신 **ADR-0020에 amendment**(2026-06-22) — "regular=True=근본해결" 전제 정정 + 박제-시 독립피드 게이트 보완 기록. CLAUDE.md L210 "근본해결" 문구도 정정(doc-sync). 게이트는 되돌리기 쉬워 amendment로 충분(task#94/96/98 선례).
