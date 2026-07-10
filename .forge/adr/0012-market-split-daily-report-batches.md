# 0012 — 일일 리포트 배치를 시장별(KR/US) 2종으로 분리, 각 장마감 시각에 정렬

- 상태: 채택 (Accepted)
- 날짜: 2026-06-14
- 관련: task #45 (daily-report-market-split-schedule), ADR-0007(통합 batch_schedules·제너릭 에디터), ADR-0010(KR 통합 SOR 시세=NXT), `.forge/CONTEXT.md` 장마감

## 맥락 (Context)

단일 `daily_report` 배치가 전 사용자의 KR+US 종목을 한 시각(기본 08:00 KST)에 모두 생성했다. 스냅샷 날짜는 `datetime.now(KST).date()`로 stamp된다. 이 단일 시각은 두 시장에 동시에 최적일 수 없다:

- **US**: 16:00 ET 마감 = KST 새벽 05~06시. 08:00 배치는 마감 직후라 **신선**.
- **KR**: 정규장 09:00 개장. 08:00 시점엔 오늘 세션 전이라 **어제 종가가 박제**된다(하루 지연).

"각 나라 장마감에 맞춰 가장 신선한 데이터를" 제공하려면 시장마다 다른 시각에 그 시장 종목만 생성해야 한다. 한 배치는 스케줄(크론) 1개와 1:1(ADR-0007)이므로, 시각을 둘로 가르려면 배치 자체를 둘로 가르는 게 모델과 일관된다.

## 결정 (Decision)

`daily_report`를 은퇴시키고 **`daily_report_kr` + `daily_report_us` 두 형제 배치**로 분리한다. 각각 `_generate_all(market=...)`로 자기 시장 종목만 생성하고 `consensus_pipeline.run_daily`를 disjoint 부분집합으로 호출한다(이미 market별 분기·부분집합 안전 확인).

시각(기본 시드, 둘 다 `Asia/Seoul`):
- **`daily_report_kr` = 20:30** — KR 장마감은 NXT 연장세션 기준 20:00(ADR-0010의 통합 SOR 시세가 NXT 가격 포착). 30분 버퍼로 마감 틱·정리 시간 확보. 스냅샷 현재가가 NXT 종가까지 반영된다.
- **`daily_report_us` = 07:00** — US 16:00 ET 마감은 KST 새벽 05(서머)~06(겨울)시. **겨울(EST) 마감 06:00 KST 이후**여야 안전하므로 07:00로 고정(여름엔 더 여유). 고정 KST 시각이라 서머타임과 무관하게 항상 마감 직후.

마이그레이션: 기동 시 기존 `daily_report` 스케줄 행의 `enabled`·`days`는 두 신규 배치에 그대로 승계하고, **시각만 위 신규 기본값으로 override**한다 → 배포 즉시 KR이 오후로 이동(이 기능의 의도된 거동 변경).

**기대 리포트 날짜(미생성 판정)는 시장별·시각인지**로 계산한다. `/api/report/list`의 `last_scheduled_date`는 **단일 문자열 → 객체 `{KR, US}`로 형태 교체**(후방호환 아님). 프론트는 종목 `market`으로 임계값을 골라 "미생성"을 판정한다.

## 고려한 대안 (Alternatives)

1. **단일 배치 유지 + 시각만 조정** — 한 시각으로는 KR·US 둘 다 마감 직후를 만족 불가. 기각.
2. **기존 daily_report를 US로 재해석 + daily_report_kr만 추가** — 마이그레이션은 적지만 `daily_report`=US·`daily_report_kr`=KR 비대칭으로 의미가 모호. 기각(대칭 분리 채택).
3. **US를 America/New_York tz로 마감 정렬** — DST 자동 추적이 이점이나, admin·사용자가 KST로 사고하는데 에디터가 NY 시각을 보여 혼동. KST 고정 07:00이 겨울 마감 이후라 이미 DST-안전. 기각.
4. **`last_scheduled_date` 문자열 유지 + 객체 필드 추가(후방호환)** — Cowork 무영향이 이점이나, 사용자가 형태 교체를 선택(Cowork 외부 클라이언트는 사용자가 함께 수정). 기각.

## 결과 (Consequences)

- KR 리포트가 당일 종가(+NXT 현재가)를 박제 → staleness 해소. US는 거동 거의 불변.
- 배치 현황·에디터에 리포트 카드가 2종으로 노출(제너릭 인프라 그대로, ADR-0007 덕에 신규 배선 최소).
- `_check_missed_report`가 시장별 2개로 일반화된다(각 배치 시각·요일·시장 누락분만 복구).
- **`last_scheduled_date` 형태 교체는 외부 계약 파괴**: Cowork 클라이언트가 문자열로 파싱 중이면 배포 시점에 깨진다 → Cowork 측 동시 수정 필요(이 repo 밖). API_SPEC.md·CLAUDE_COWORK_API.md 동시 갱신.
- KR 시각을 무심코 16:00(정규장)으로 "단순화"하면 NXT 현재가를 잃고, US를 06:00 이전으로 당기면 겨울에 마감 전 실행된다 — 본 ADR이 그 함정을 기록.
- 향후 제3시장(예: 도쿄) 추가 시 같은 패턴(배치 1종+시각)으로 확장 가능.
