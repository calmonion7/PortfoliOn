# 매물대 (Volume Profile) 설계

**날짜:** 2026-05-05  
**상태:** 승인됨

## 배경

현재 지표 데이터(RSI, EMA, 52주 고저)는 가격 기반이며 거래량 정보가 없다. 매물대(거래량 집중 구간)를 추가해 지지/저항 예측 정확도를 높인다.

## 목표

- 1년 일봉 거래량 프로파일에서 POC / HVN / LVN 추출
- 목록화면 POC 컬럼 + 상세화면 매물대 테이블 표시
- 마크다운 리포트에 ⑧ 매물대 섹션 추가

## 계산 알고리즘

### `get_volume_profile(df, bins=50)` — `indicators.py` 신규

1. `df["Close"]`와 `df["Volume"]`로 가격 범위를 50개 균등 구간으로 분할
2. 각 구간에 해당하는 일봉의 거래량 합산
3. **POC**: 최대 거래량 구간의 중심가
4. **HVN**: 비인접 조건을 만족하는 상위 3개 구간 중심가 (가격 오름차순 정렬)
   - 비인접 조건: 인접 빈(±1)은 같은 HVN으로 취급하지 않음
5. **LVN**: 전체 구간 중 거래량 하위 20%이면서 두 HVN 사이에 위치한 구간 중심가 (가격 오름차순)
6. df가 비어있거나 계산 불가 시 `{"poc": None, "hvn": [], "lvn": []}` 반환

```python
def get_volume_profile(df: pd.DataFrame, bins: int = 50) -> dict:
    ...
    return {
        "poc": float | None,
        "hvn": list[float],   # 최대 3개, 가격 오름차순
        "lvn": list[float],   # 가변, 가격 오름차순
    }
```

## 데이터 파일

### `backend/reports/{TICKER}/{date}.json` 확장

`volume_profile` 필드 추가:

```json
{
  "ticker": "LLY",
  ...
  "daily_rsi": { ... },
  "volume_profile": {
    "poc": 875.0,
    "hvn": [820.0, 875.0, 930.0],
    "lvn": [845.0, 905.0]
  }
}
```

## 백엔드 변경

### `indicators.py`

`get_volume_profile(df, bins=50)` 신규 추가. `generate_report`에서 이미 가져오는 1년 일봉 `daily_df`를 그대로 전달.

### `report_generator.py`

`generate_report`에서 `indicators.get_volume_profile(daily_df)` 호출 후:

1. `summary` dict에 `"volume_profile": vp` 추가
2. `_section8(vp)` 신규 함수 → 마크다운 ⑧ 섹션 생성

```python
def _section8(vp: dict) -> str:
    # POC / HVN / LVN 테이블 렌더링
```

### `report.py`

변경 없음. summary JSON을 그대로 전달하므로 자동 포함.

## 프론트엔드 변경

### `Reports.jsx`

**목록화면** — 현재가 옆에 `POC` 컬럼 추가:

| ... | 현재가 | POC | 평균목표가 | ... |

**상세화면** — `RsiTable` 아래 `VolumeProfileTable` 컴포넌트 추가:

```
[ 매물대 분석 (Volume Profile, 1년 일봉) ]
| POC    | HVN                    | LVN (매물 공백)    |
| $875   | $820 / $875 / $930     | $845 / $905       |
```

- `summary.volume_profile` 없으면 미표시 (기존 리포트 호환)

## 변경 파일 목록

| 파일 | 변경 내용 |
|---|---|
| `backend/services/indicators.py` | `get_volume_profile` 신규 |
| `backend/tests/test_indicators.py` | POC/HVN/LVN 테스트 추가 |
| `backend/services/report_generator.py` | VP 호출, summary 추가, `_section8` 신규 |
| `backend/tests/test_report_generator.py` | mock 확장, VP 저장/섹션 테스트 추가 |
| `frontend/src/pages/Reports.jsx` | POC 컬럼, `VolumeProfileTable` 컴포넌트 |
