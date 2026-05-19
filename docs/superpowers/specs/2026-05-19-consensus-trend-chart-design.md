# 컨센서스 추이 차트 — 설계 문서

**날짜**: 2026-05-19  
**대상 화면**: 리포트 상세 화면 > 📊 요약 탭 > 🏦 증권사 컨센서스 섹션

---

## 개요

리포트 상세 화면의 증권사 컨센서스 섹션 아래에 날짜별 컨센서스 추이 차트를 추가한다.
추이 데이터(평균목표가, 매수/중립/매도)는 리포트 생성과 독립적인 별도 엔드포인트로 수집하며,
수동 버튼 + 스케줄러 자동 실행 두 가지 방식으로 트리거된다.

---

## 1. 데이터 모델

### 저장 위치

```
backend/data/consensus/{ticker}.json
```

### 파일 형식

```json
[
  { "date": "2026-05-19", "target_mean": 352000, "buy": 25, "hold": 0, "sell": 0 },
  { "date": "2026-05-18", "target_mean": 348000, "buy": 24, "hold": 1, "sell": 0 }
]
```

- 날짜 내림차순 정렬 유지
- 같은 날짜 재수집 시 해당 항목 덮어쓰기
- `target_mean`, `buy`, `hold`, `sell` 모두 null이면 저장하지 않음

---

## 2. 백엔드 API

두 엔드포인트를 `backend/routers/report.py`에 추가한다.

### `POST /api/consensus/{ticker}`

해당 종목의 가장 최신 리포트 JSON(`backend/reports/{ticker}/YYYY-MM-DD.json`)에서
`target_mean`, `buy`, `hold`, `sell`을 읽어 오늘 날짜로 `consensus/{ticker}.json`에 기록한다.

- 최신 리포트 JSON이 없으면 400 반환
- 유효 데이터가 없으면 저장하지 않고 400 반환
- 성공 시 저장된 항목 반환

### `GET /api/consensus/{ticker}`

`consensus/{ticker}.json` 전체 배열 반환. 파일이 없으면 빈 배열 반환.

---

## 3. 스케줄러 연동

`backend/services/scheduler.py`의 리포트 생성 루프에서,
각 종목 리포트 생성 완료 후 컨센서스 수집 함수를 호출한다.

```
기존: 리포트 생성(ticker) → 완료
변경: 리포트 생성(ticker) → 완료 → 컨센서스 수집(ticker)
```

컨센서스 수집 실패는 예외를 잡아 무시한다 (리포트 생성 결과에 영향 없음).

---

## 4. 프론트엔드

### 위치

`DetailSummaryTab` 컴포넌트 내, 🏦 증권사 컨센서스 섹션 바로 아래에
`ConsensusChart` 컴포넌트를 추가한다.

### 차트 데이터 전처리 (중복 제거)

저장된 원본 배열은 날짜별 전체 수집 이력을 유지한다.
차트 렌더링 시에는 프론트엔드에서 아래 규칙으로 필터링한다:

- `target_mean`, `buy`, `hold`, `sell` 네 값이 이전 항목과 모두 동일하면 해당 항목은 차트에서 제외
- **첫 번째 등장 날짜**만 표시하고 이후 동일 값은 스킵
- 원본 데이터는 그대로 유지 (저장 시 중복 제거 안 함, 표시 시에만 필터링)

### 차트 구성

**차트 ① — 평균목표가 추이 (LineChart)**
- X축: 날짜 / Y축: 목표가 (₩/$ 포맷)
- 라인 색: `#ffcc80`
- 높이: 120px

**차트 ② — 투자의견 추이 (BarChart, stacked)**
- X축: 날짜
- 스택: 매수 `#43a047` / 중립 `#424242` / 매도 `#b71c1c`
- Y축: 애널리스트 수
- 높이: 120px

두 차트 세로 배치, recharts 기존 라이브러리 사용.

### 수집 버튼

🏦 증권사 컨센서스 섹션 타이틀 오른쪽에 "수집" 버튼 추가.
- 클릭 시 `POST /api/consensus/{ticker}` → 완료 후 `GET /api/consensus/{ticker}` 재조회
- 로딩 중 비활성화

### 데이터 페칭

`openDetail` 호출 시 (리포트 상세 진입 시점) `GET /api/consensus/{ticker}` 자동 호출.
데이터 0건이면 차트 미표시, "아직 수집된 데이터가 없습니다." 안내 + 수집 버튼 표시.

---

## 5. 엣지 케이스

| 상황 | 처리 |
|------|------|
| 같은 날 중복 수집 | 해당 날짜 항목 덮어쓰기 |
| 최신 리포트 JSON 없음 | 400 반환, 프론트 "리포트를 먼저 생성하세요" 안내 |
| 유효 데이터 없음 (전부 null) | 저장 안 함, 400 반환 |
| 수집 데이터 0건 | 차트 미표시, 안내 문구만 |
| 스케줄러 수집 실패 | 예외 무시, 리포트 생성 결과에 영향 없음 |

---

## 6. 변경 파일 요약

```
backend/
  data/consensus/              ← 신규 디렉토리 (gitignore 대상 아님)
  routers/report.py            ← POST/GET /api/consensus/{ticker} 추가
  services/scheduler.py        ← 컨센서스 수집 호출 추가
frontend/
  src/pages/Reports.jsx        ← ConsensusChart 컴포넌트 + 수집 버튼 추가
```
