# 컨센서스 목표가 표시 정본 = daily_consensus_mart (as-of-date 조회)

## Status

accepted

## Context / Decision

리포트 상세의 평균목표가가 세 화면에서 **서로 다른 테이블**에서 읽혀 값이 어긋나고 히스토리가 희소했다:
요약탭은 `snapshots`의 동결값(리포트 생성 시점 yfinance/Naver 집계), 지표탭 컨센서스 차트는 `daily_consensus_mart`(raw_reports 브로커별 90일 최신 평균, 매일 1행), 히스토리탭은 `consensus_history`(수동 수집/백필로만 채워져 희소).

**`daily_consensus_mart`를 목표가·의견수 표시의 단일 정본으로 정한다.** 매일 자동 적재돼 dense하고, 지표탭 차트가 이미 쓰는 출처라 통일 시 두 증상(값 불일치 + 히스토리 희소)이 동시에 해결된다. 요약탭 `get_report`는 mart를 **as-of-date**(`base_date <= 리포트날짜`의 최신행)로 조회해 목표가 3종 + 의견수 3종을 함께 주입한다 — 최신 리포트에선 지표 차트 끝점과 일치하고, 과거 리포트에선 그 시점 값이라 히스토리 비교 테이블의 변화율까지 정상 동작한다. mart 값이 없으면 `consensus_history` → snapshot 동결값으로 폴백한다(특히 raw_reports 커버리지가 약한 US).

## Considered Options

- **snapshots 동결값** — 요약 현재값이지만 daily만 갱신돼 dense하지 않음. 히스토리 희소 미해결.
- **consensus_history** — 히스토리 현재 출처이나 스케줄 적재가 없어 희소한 legacy.
- **mart 최신행(날짜 무시) 덮어쓰기** — 구현은 더 단순하나 히스토리 비교 테이블의 두 날짜가 같은 값으로 죽음.
- **mart as-of-date (채택)** — 최신 리포트 일치 + 과거 비교 정상 + dense.

## Consequences

- `consensus_history`는 mart가 빈 종목의 **폴백 소스**로 강등(특히 US). 쓰기 경로(종목 추가 백필·지표탭 백필 버튼)의 mart 일원화는 데이터 소스 변경이라 별도 작업으로 분리하고 전 종목 재적재 UAT를 게이트로 둔다.
- 지표탭 **수집 버튼**(`POST /consensus/{ticker}`, snapshot→consensus_history 복사)은 정합 후 중복이 되어 제거한다.
