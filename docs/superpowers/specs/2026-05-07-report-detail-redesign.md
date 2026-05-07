# 리포트 상세화면 탭형 리디자인

**날짜:** 2026-05-07  
**범위:** `frontend/src/pages/Reports.jsx` — 상세화면(`view === 'detail'`) 전용

---

## 목표

현재 상세화면은 컨센서스·RSI·매물대·마크다운이 위에서 아래로 단순 나열되어 있다. 이를 **3탭 구조**로 개편해 정보 밀도를 높이고 스크롤을 줄인다.

---

## 레이아웃 구조

### 헤더 (탭 위, 항상 표시)

현재와 동일하게 유지:

```
← 목록으로   엔비디아 (NVDA)  2026-05-07  $207.83  [Technology·Semiconductors]  [PER 42.4 / Fwd 18.5]  [PBR 32.11]   [생성 버튼]
```

- "생성" 버튼을 헤더 오른쪽 끝으로 이동 (현재는 좌측 사이드바에만 있음)

### 탭 바

```
📊 요약  |  📈 기술적 분석  |  📄 리포트
```

- 활성 탭: `border-bottom: 2px solid #4fc3f7`, 색상 `#4fc3f7`
- 비활성 탭: 색상 `#555`

---

## 탭별 내용

### 탭 1 — 📊 요약

2열 그리드 (`1fr 1fr`):

**왼쪽: 증권사 컨센서스**
- Buy/Hold/Sell 비율 프로그레스 바 (Buy=녹색, Hold=회색, Sell=빨강)
- 비율 텍스트: `Buy N (X%) · Hold N · Sell N`
- 카드 4개 (2×2 그리드):
  - 평균 목표가 (전체 폭, `grid-column: 1/-1`): 값 + 현재가 대비 % 상승 여력
  - 최고 목표가 (`target_high`, 녹색)
  - 최저 목표가 (`target_low`, 빨강)
  - Finviz 추천지수 + "1=강매수" 설명
  - 애널리스트 수 (buy+hold+sell 합계)

**오른쪽: 밸류에이션 + 매물대·RSI**
- 밸류에이션 카드 3개 (3열): PER(Trailing) · Fwd PER · PBR
- 매물대 & RSI 현황 카드 2개 (2열):
  - POC + HVN 목록
  - RSI 일봉/주봉/월봉 현재값 (색상은 기존 `rsiColor` 함수 사용)

### 탭 2 — 📈 기술적 분석

기존 `RsiTable` + `VolumeProfileTable` 컴포넌트를 그대로 사용, 탭 안으로 이동.  
VolumeProfileTable은 현재 테이블 대신 **카드 3개(POC·HVN·LVN)**로 개선.

### 탭 3 — 📄 리포트

기존 `MarkdownViewer` 컴포넌트를 그대로 사용.

---

## 컴포넌트 변경 계획

| 컴포넌트 | 변경 내용 |
|---|---|
| `ConsensusTable` | 삭제 → 요약 탭 인라인으로 흡수 |
| `VolumeProfileTable` | 테이블 → 카드 3개로 재작성 |
| `RsiTable` | 유지, 기술적 분석 탭으로 이동 |
| `MarkdownViewer` | 유지, 리포트 탭으로 이동 |
| 상세화면 JSX | 탭 상태(`activeDetailTab`) 추가, 전체 재구성 |

### 새 상태

```js
const [activeDetailTab, setActiveDetailTab] = useState('summary')
// 'summary' | 'technical' | 'report'
```

탭 전환 시 스크롤 위치는 유지하지 않음 (탭마다 독립 스크롤).

---

## 데이터 의존성

요약 탭에서 `target_high`, `target_low`를 표시한다. 이 필드는 이미 `report_generator.py`에 추가되어 있으나 기존 JSON에는 없으므로 `null` 처리(`N/A` 표시).

---

## 범위 외

- 목록화면(`view === 'list'`) 변경 없음
- 좌측 사이드바 변경 없음
- 백엔드 변경 없음
