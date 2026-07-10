# 2026-06-15 — KR 업종 지수 모멘텀 (task #48)

## Plan vs actual

- **계획대로**: S1~S8 done, 적대적 리뷰 PASS. 키움 업종 조회 TR(ka10101 업종코드→KOSPI 24업종 큐레이션·ka20006 업종일봉 종가 series·ka20002 업종별주가)로 1주/1개월/3개월 모멘텀을 사전계산해 `kr_sector_fetch` 일배치(국내, 16:00 KST)가 market_cache(`kr_sector_momentum`)에 저장, `GET /api/analysis/sector?market=KR`가 저장값+보유종목 업종 하이라이트를 US와 동형 반환. US 경로 불변(캐시키 `user_id:market` 분리, `_calc_return` 재사용). SectorTab KR/US 토글(KRX 업종명·ETF컬럼 숨김). ADR-0009 경계 준수(주문/계좌 TR 0건, 라이브 검증). TDD 신규 5테스트 RED→GREEN, backend pytest 615 passed, npm build OK. Dynamic Workflow 4에이전트(백엔드 TDD 직렬 S1~S5→프론트∥문서→적대적 리뷰), task#46과 동일한 좁은 파이프라인이 결합도 높은 백엔드를 충돌 없이 완주.

- **Divergences(경미, 전부 계획 내/허용)**:
  - **S3 매핑 소스: ka10001→ka20002(계획 내 폴백)**. 계획은 "ka10001 raw 업종 필드 우선"이었으나 **라이브 전수 키 점검으로 ka10001에 업종 필드 부재 확인** → 계획이 명시한 폴백 ka20002(업종별주가) 역인덱스 채택.
  - KOSPI 업종만(코스닥 미포함) — 계획이 "코스닥 포함 여부 판단"으로 위임, simplicity로 KOSPI 24종. 코스닥 보유종목은 graceful 누락.
  - cache.get_sector 시그니처에 market 인자 추가 → test_analysis_router mock 3곳 갱신(orphan 정리, 기본값 US 하위호환).

## Learnings

- **Do differently next time**:
  - **키움 TR 응답 필드는 카탈로그가 아니라 라이브로 확정한다**. ka10001(주식기본정보)에 업종 필드가 있을 거라 가정했지만 실제 응답엔 없었다(전수 키 점검으로 확인) — 보유종목→업종은 ka20002(업종별주가) 역인덱스가 정답이었다. [[kiwoom-kr-1of3-price-charts]]·[[kis-backup-quote-source-2of2]]가 쌓은 "필드명/스케일은 stale 지식 아닌 라이브 대조"가 또 유효. 계획에 폴백을 미리 명시해 둔 게 분기를 매끄럽게 했다(폴백 없는 단정은 실행 중 막혔을 것).
  - **카탈로그 로드맵 문서(KIWOOM_API.md)는 통합 직후 상태를 갱신해야 한다** — 안 그러면 다음 "확장 추천" 그릴링(fg-ask)이 이미 한 surface를 또 추천한다. 이번 task가 "업종 지수 = 계획 Phase2"를 ✅ 적용으로 바꿨고 회고에서 즉시 반영. **확장-추천형 작업은 카탈로그 status read가 입력이므로 status write(완료 표시)도 루프에 포함**해야 함.
  - **분석탭 KR 확장 정착 패턴**: 키움 배치 사전계산→market_cache 저장→엔드포인트 `?market=` 분기(US 불변)+`_calc_return`/`get_sector_momentum` 출력형태 재사용. 키움 직렬 throttle을 요청경로 밖(일배치)으로 빼 latency 0. 향후 KR 분석 확장의 템플릿.
  - **(follow-up 후보, low) dual-market 캐시키 잠재 함정**: 섹터 캐시키가 `user_id:market` 복합키인데 `invalidate_sector(user_id)` 단일인자는 복합키를 못 지운다. 현 호출자 전부 무인자 전체clear라 영향 0이나, **user별 무효화 도입 시 깨짐**. CLAUDE.md 승격은 보류(아직 일반적이지 않음), user별 무효화 필요해지면 그때 처리.
  - **(low) 테스트 함수명 stale**: `test_lists_sixteen_batches`/`test_registry_has_sixteen_batches`가 17을 단언(이름만 옛수). 배치 추가마다 누적 — 이름 일반화(`*_all_batches`)는 별건.
- **검증 게이트**: repo 관행([[feedback-verification]]) 라이브는 배포 후. 자동 게이트 TDD 5테스트(S1~S5 완료기준)+pytest 615+npm build+적대적 리뷰 PASS(주문/계좌 0·batch 4표면·US 불변)+메인 세션 재확인으로 `verified: yes`. 워크플로우가 라이브 24업종 모멘텀 산출까지 확인(키움 키 환경). 커밋 a764e4c2 main push. 잔여 글랜스: 분석탭 토글 KR 렌더·국내 배치 카드.

## Doc updates

- CONTEXT.md promotion: none (KR 업종 모멘텀은 기능/지표, 신규 도메인 용어 아님 — [[키움 시세 소스]] 경계가 이미 커버).
- ADR added: none (ADR-0009 경계 *안*의 확장, 신규 하드결정 없음).
- **KIWOOM_API.md: 로드맵 line 53 갱신**(이 회고 학습 #2 승격) — "KR 업종/섹터 지수 = 계획 Phase2"→"✅ 적용(task#48, kr_sector_fetch 일배치·24업종 모멘텀)", 실사용 TR(ka20006/ka10101/ka20002) 명시, **ka10001엔 업종 필드 없음·하이라이트는 ka20002 역인덱스** 메모(학습 #1).
- CLAUDE.md: S7에서 키움 sector 모듈·kr_sector_fetch 배치 라인 추가(실행 중). cache gotcha는 retro에만(보류).
- 코드: commit a764e4c2(기능, main push) + 회고 KIWOOM_API.md 갱신(별도 커밋 예정).
