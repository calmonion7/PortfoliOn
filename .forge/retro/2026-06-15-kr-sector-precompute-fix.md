# 2026-06-15 — KR 업종 모멘텀 수치 None·느림 수정 (task #50)

## Plan vs actual

- **계획대로**: S1~S4 done, 적대적 리뷰 PASS. S1 저장 `{sectors,index}` 확장(`save`·`load_sector_index`)·`refresh`가 momentum+`build_sector_index` 사전계산·**all-None이면 save 생략(박제 방지)**·`_fetch_one_sector` 로깅. S2 `map_holdings_to_sectors`가 저장 인덱스만 읽어 **요청경로 ka20002 라이브 0**(테스트 monkeypatch로 호출 0 단언). S3 `fetch_sector_closes` base_dt 마지막 완성 거래일+빈값 폴백, 라이브 momentum 비-None 확인(화학 +11.49%). backend pytest 631·리뷰 PASS(요청경로 키움0·박제방지·US불변·ADR-0009 주문/계좌0). Dynamic Workflow 2에이전트(백엔드 TDD 직렬→적대적 리뷰).
- **Divergences**:
  - **(중요) base_dt가 확정 근본원인 아님 — 진짜 방어선은 anti-poison 가드**: 라이브 ka20006이 일요일 explicit base_dt에도 600행 반환 → "인트라데이 base_dt 빈값" 가설 미재현. 그래도 **all-None이면 미저장** 가드가 원인 무관하게 박제 재발을 차단(핵심). base_dt 견고화는 strictly safer 보강. 추가 `[kr_sector]` 로깅으로 운영 중 실제 트리거 추후 특정.
  - **(메인 세션 §3 orphan 정리)** `save_momentum`(레거시 단일키 라이터)가 내 변경(refresh→`save(sectors,index)`)으로 prod 호출 0 = orphan·footgun(호출 시 index 덮어써 ★소실). 리뷰는 [low] 잔존시켰으나 §3대로 제거 + roundtrip 테스트 `save(sectors,{})` 전환 + 하위호환 테스트 삭제(632→631).

## Learnings

- **Do differently next time**:
  - **(CLAUDE.md 승격, #49서 연기) 배치-백킹 뷰의 외부 API 3원칙**: ① 외부 API(키움)를 *요청·기동 경로*에서 라이브 호출 말고 배치 사전계산·요청은 캐시읽기 ② fetch 실패 조용히 삼키지 말고 로깅 ③ 빈/all-None 결과 박제 금지(미저장·직전값 유지). 이 KR 업종 모멘텀은 **3-타석 함정**이었다 — #48이 ①②③ 모두 위반(요청경로 build_sector_index 라이브 + `_fetch_one_sector` silent swallow), #49 기동시드가 그걸 증폭·가시화(all-None 박제), #50이 확립. → CLAUDE.md 승격(랭킹 등 모든 배치-백킹 뷰에 적용).
  - **의심 트리거가 아니라 실패 클래스를 가드하라**: base_dt(의심 트리거)를 고치는 대신 all-None(실패 클래스)을 가드하니 근본원인 미재현이어도 재발이 막혔다. 디버깅이 근본원인에 막힐 때, 증상 클래스에 대한 방어가 더 견고할 수 있다.
  - **dev "대표 1콜 라이브 검증" ≠ 운영 시나리오**: #48의 "24업종 라이브 검증"은 기동 cold·요청경로 부하·박제 경로를 못 덮었다. 라이브 검증을 "운영 시나리오(기동·반복요청·실패주입)"로 확장.
- **검증 게이트**: 자동 게이트 pytest 631·TDD(S1~S3)·적대적 리뷰 PASS·라이브 ka20006 momentum 비-None·메인 세션 재확인으로 `verified: yes`. 커밋 b5dd77b8 push. 배포 후 글랜스: KR 토글 즉시로드+수치표시(재기동 시 #49 시드가 fix된 refresh로 적재).

## Doc updates

- CONTEXT.md promotion: none (신규 도메인 용어 없음).
- ADR added: none (ADR-0009 경계 내 버그픽스 패턴 — ADR 3조건 미충족, gotcha가 적합).
- **CLAUDE.md: "배치-백킹 뷰는 외부 API를 요청·기동 경로 라이브 호출 금지·배치 사전계산, fetch 실패 로깅, 빈/all-None 박제 금지, 실패클래스 가드" gotcha 추가**(#49서 연기→#50서 패턴 확립 후 승격). kiwoom/kis 불릿 다음 위치.
- 코드: commit b5dd77b8(기능, main push). 회고 CLAUDE.md gotcha는 별도 커밋 예정.
