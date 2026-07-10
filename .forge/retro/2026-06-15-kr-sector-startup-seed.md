# 2026-06-15 — KR 업종 모멘텀 기동 시드 (task #49)

## Plan vs actual

- **계획대로(코드)**: S1 `_seed_kr_sector_if_empty()` 신설(랭킹 `_seed_rankings_if_empty` 미러·graceful try/except)·S2 `start()` 배선. TDD 신규 3테스트 RED→GREEN, backend pytest 618 passed. 직접 인라인 실행(워크플로우/코드리뷰 생략). 커밋 ec7b4afc push. WHAT은 계획 일치.
- **결과 divergence(중대 — 라이브에서 드러남)**: 시드가 빈 캐시에서 `refresh()`를 호출하자 task #48의 **잠재 버그 2개를 증폭·가시화**했다:
  - **all-None 박제**: 기동/거래중 ka20006이 빈 종가를 반환 → `_fetch_one_sector`가 예외/빈값을 **조용히 삼켜** all-None dict 반환 → `save_momentum`이 그걸 박제 → 시드 가드(`if load_momentum(): return`)가 "채워짐"으로 오판해 재시드 안 함 → 분석탭에 업종 행은 뜨나 **수치 전부 None**.
  - **요청경로 라이브 키움(느림)**: `map_holdings_to_sectors→build_sector_index()`가 요청마다 24개 ka20002 라이브 직렬(get_sector 캐시 만료마다 수초).
  - 수동 트리거(장마감 후·토큰 warm)는 정상 종가를 받아 박제값을 덮어써 "수치 나옴" 확인. → 후속 task #50(kr-sector-precompute-fix)으로 풀 수정 그릴링.

## Learnings

- **Do differently next time**:
  - **테스트 통과 `verified: yes`가 라이브 prod 버그를 가린다 — 특히 외부 API·기동 경로**. #49 TDD는 시드 *함수 로직*(빈→refresh·present→skip·예외→graceful)만 고정했고, end-to-end 라이브(거동: 시드→refresh→거래중 ka20006 빈값→박제)는 repo 관행([[feedback-verification]])상 배포 후에야 드러남. **기동 시드가 견고하지 않은 외부 API 배치를 트리거하면 잠재 버그를 증폭한다** — 시드는 ① 빈/실패 결과 박제 방지 ② fetch 실패 로깅 ③ 견고한 입력(base_dt 완성일)과 반드시 짝지어야 한다. (이걸 안 갖춘 채 시드만 붙이면 "빈 화면"을 "틀린 수치"로 바꿀 뿐.)
  - **#48의 "dev 라이브 24업종 검증" ≠ prod 거동**: 단발 직접 호출 검증은 기동 cold·거래중 base_dt·요청경로 부하 타이밍을 못 덮는다. 키움 "라이브 대조" 교훈([[kiwoom-kr-1of3-price-charts]]·[[kis-backup-quote-source-2of2]])을 **"대표 1콜"이 아니라 "운영 시나리오(기동·거래중·반복요청)"로** 확장.
  - **시드/배치는 관측가능해야**: `_fetch_one_sector`의 silent swallow가 진단을 막았다(로그 0). 외부 fetch 실패는 최소 로깅(ADR-0001 계측 관측-전용 원칙의 fetch 버전).
- **검증 게이트**: #49는 자동 게이트(pytest 618·TDD)로 `verified: yes`였고 그 판정 자체는 코드 스펙엔 맞았다. 그러나 라이브가 운영 버그를 노출 → **#50이 응답**(re-grill 대신 후속 fix task). #49의 코드(시드)는 폐기 아님 — #50의 박제방지·견고 fetch와 결합하면 유효한 빌딩블록(시드는 유지).

## Doc updates

- CONTEXT.md promotion: none.
- ADR added: none.
- CLAUDE.md: **연기** — "배치-백킹 뷰는 키움(외부 API)을 요청·기동 경로 라이브 호출 금지·배치 사전계산, fetch 실패 삼킴/빈값 박제 금지(직전 양호값 유지)" gotcha는 그 패턴을 *코드에 확립하는 #50의 retro*에서 승격(고치기 전 문서화는 현실보다 앞섬 — 승격 규율).
- 코드: commit ec7b4afc(시드, main push). #49 자체는 추가 코드 없음(회고만).
