# RUN — 시장지표 「반도체」 카드 (task#403)

실행: 2026-10-22 · fg-loop 드라이브 · Dynamic Workflow `w2uek1lo6`(10 에이전트, 오류 0) + 메인 세션 통합·S7.

## 슬라이스 결과
- S1 파서 `parse_dramexchange` + 픽스처 2벌(홈 10-22 · Wayback `20260116052511`) — ✅ 계획대로(6분류 23종, 1월 DRAM 7종 id 집합 일치)
- S2 저장·일 배치 `memory_spot_fetch`(19:40 KST)·`GET /semiconductor`·`POST /refresh-memory-spot` — ⚠ 계약 외 보강 3(품목 단위 직전값 보존·avg None 비덮어쓰기·옛 스냅샷은 history만) + refresh 응답 `detail` 필드 추가
- S3 Wayback 백필 `POST /backfill-memory-spot` — ⚠ 별도 잡 id 없이 `memory_spot_fetch`(`trigger=manual`, `payload.backfill`)로 기록, 스냅샷마다 load→merge→save(134회)
- S4 SOX `_INDEX_SYMBOLS` — ✅ 계획대로
- S5 `SemiconductorSection.jsx` + Market.jsx 배치 — ⚠ red-first 미확인(컴포넌트·테스트 동시 작성), SOX 읽기 이중 경로를 메인이 `indices.sox` 하나로 정리
- S6 문서(API_SPEC·README·backend/CLAUDE.md) — ⚠ 배치 수 서술 35→36 정정(선재 드리프트), API_SPEC indices의 「`indices_fetch` 일배치」 서술과 backend/CLAUDE.md 「요청경로 증분」의 모순은 범위 밖으로 남김
- S7 dev 라이브 UAT — ⚠ UAT가 결함 3건을 잡아 fg-loop 제자리 보수 3라운드(r1 단종 품목 부활 · r2 Wayback 레이트리밋 · r3 m360 X축 라벨 겹침) 후 통과

## 계획 vs 실제
- 적대 검토 2렌즈 → critical/major 1건: `get_memory_spot()`이 graceful `_mc_load`라 DB 조회 실패가 200+빈 categories로 붕괴(프론트가 실패를 「없음」으로 말함). `_mc_load_strict`로 교체 + 회귀 테스트(`test_get_load_failure_propagates_not_empty`, red 미확인). minor 3건은 버림.
- 메인 통합에서 S5가 계약 미확정 대비로 둔 `r.data?.sox` 폴백을 제거하고, 그 폴백에 기대던 테스트 목(`{data:{sox}}`)을 실제 형태(`{data:{indices:{sox}}}`)로 고침 — 목이 실제와 다른 형태여서 그대로였으면 실제 형태를 한 번도 검증하지 않는 테스트였다.
- 프로브 `scripts/uat403-semiconductor.mjs`는 배포 전 저작(node --check만) — 선택자는 S5 소스에서 읽음, SOX 타일·색은 미단언(육안).
- 연도 없는 `Last Update` 형식은 라이브·픽스처 모두 연도가 있어 합성 입력 테스트로만 검증.

## DoD baseline → after
1. 백엔드 전체 pytest: 2591 passed → **2619 passed**
2. tests/test_semiconductor.py: 파일 없음 → **green(28)**
3. `grep -c '"sox"' indices.py`: 0 → **1**
4. test_api_doc_sync: green → green(회귀 가드, 불변)
5. vitest 전체 + build: (선재 green) → **1140 passed · build 성공**
6. dev 라이브 API: — → S7에서 판정
7. 육안 스크린샷: — → S7에서 판정
8. 문서: — → API_SPEC 3 엔드포인트 + sox, README DRAMeXchange 3건, backend/CLAUDE.md 1항목, batch_registry 항목. `grep -n "/api/market/" CLAUDE_COWORK_API.md` → 0건(대상 아님 확인)

## S7 UAT와 제자리 보수(fg-loop repair r1~r3)
- r1 (a66a102) — 백필 후 /semiconductor 품목 28≠23: 최신 페이로드에서 빠진 품목(단종)·옛 스냅샷에만 있는 품목이 현재 표에 1년 전 값으로 부활(dram:472·474, Module:15·9·3). S2가 「품목 누락 = 직전값 보존」으로 넣은 보강이 백필과 만나 생긴 결함. 최신 목록 밖 품목은 `stale`로 이력만 보존하고 GET·refresh 카운트에서 제외. red→green 테스트 2건 + refresh 카운트 단언.
- r2 (4045639) — 이력 18점 < 100: 1초 간격 백필이 134 스냅샷 중 116건을 web.archive.org `Connection refused`로 잃음(IA 레이트리밋 분당 ~15회 초과, 이후 200 회복). 간격 5초 + 연결 실패 60초 쿨다운 1회 재시도, job_runs payload에 병합/건너뜀 수. 결과 132 병합·2 건너뜀, dram:475 105점.
- r3 (06671ec) — S7 육안: m360 차트 X축 틱 라벨이 붙어 판독 불가(프로브 42축 ALL PASS 상태). 축 승격 `x-ticks-no-overlap`(틱 행을 기하로 골라 간격 ≥2px) — 옛 DOM red-first m360 minGap -2.2/-1.2(m390 2.9) → `interval="preserveStartEnd" minTickGap={16}`로 15.1/17.2.
- 멱등: 백필 재실행 후 날짜 중복 0·정렬 유지. dram·wafer 품목이 +1점(105→106) — 1차에서 건너뛴 스냅샷(1차 2건·2차 다른 3건 건너뜀)이 2차에서 받아져 **새 날짜가 채워진 것**이지 같은 날짜 중복이 아니다(병합은 날짜 키 덮어쓰기, 단위 테스트 `test_backfill_merges_sorted_unique_and_idempotent`). 계획 DoD 6의 「점 수 불변」은 스냅샷 수신이 매번 같다는 전제였고, 외부 아카이브 수신이 실행마다 다르므로 엄밀히는 「같은 날짜 재병합 시 불변」으로 읽어야 한다.
- 육안(m360·pc1440 카드 머리·표·차트): 「주요 지수」 바로 아래, SOX 타일 하락=파랑(KR 관례), 기본 선택 dram:475 좌측 바 강조, 분류별 갱신일, 품목명 어절 단위 줄바꿈(낱자 적층 없음).
- 범위 밖으로 남김: IndexSection 차트도 같은 고정 6틱 간격이다(이번 카드보다 플롯이 넓어 m360에서 겹침 미관측 — 잰 적 없음). API_SPEC indices의 「`indices_fetch` 일배치」 서술 모순(S6 보고).

## 최종 DoD after
1. 백엔드 pytest 2622 passed · 2. test_semiconductor 31 green · 3. sox grep 1 · 4. doc_sync green · 5. vitest 1140 + build · 6. dev 라이브: 분류 6·품목 23·updated_at 6/6·dram:475 106점(중복 0)·원문 61.100 일치·sox 251점 · 7. uat403 ALL PASS 45/45 + 육안 · 8. 문서 반영
