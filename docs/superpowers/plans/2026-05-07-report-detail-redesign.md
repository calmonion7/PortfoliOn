# 리포트 상세화면 탭형 리디자인 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 리포트 상세화면을 요약·기술적 분석·리포트 3탭 구조로 재편해 정보 밀도를 높이고 스크롤을 줄인다.

**Architecture:** `Reports.jsx` 단일 파일 내에서 상세화면(`view === 'detail'`) 부분만 수정한다. `activeDetailTab` 상태를 추가하고, 기존 `ConsensusTable`을 인라인 카드형 요약 탭으로 대체하며 `VolumeProfileTable`을 카드 3개짜리 컴포넌트로 교체한다. 목록화면과 좌측 사이드바는 변경하지 않는다.

**Tech Stack:** React 18 (useState), inline styles (기존 패턴 유지), 외부 라이브러리 추가 없음

---

### Task 1: `activeDetailTab` 상태 추가 + 탭 바 삽입

**Files:**
- Modify: `frontend/src/pages/Reports.jsx:223-234` (상태 선언부)
- Modify: `frontend/src/pages/Reports.jsx:490-530` (상세화면 JSX)

- [ ] **Step 1: `activeDetailTab` 상태를 `Reports` 컴포넌트에 추가**

`frontend/src/pages/Reports.jsx` 의 상태 선언부(234번 줄 `detailRefreshKey` 바로 아래)에 추가:

```jsx
const [activeDetailTab, setActiveDetailTab] = useState('summary')
```

- [ ] **Step 2: `openDetail` 함수가 호출될 때 탭을 `'summary'`로 초기화**

기존 `openDetail` (250~253번 줄):
```jsx
const openDetail = (ticker, date) => {
  setSelected({ ticker, date })
  setView('detail')
}
```
→ 아래로 교체:
```jsx
const openDetail = (ticker, date) => {
  setSelected({ ticker, date })
  setView('detail')
  setActiveDetailTab('summary')
}
```

- [ ] **Step 3: 상세화면 헤더에 탭 바 추가**

상세화면 JSX (490번 줄, `<div>` 바로 안쪽) 에서 기존 헤더 `<div>` (491~524번 줄) 끝난 직후, `{loading && ...}` 앞에 탭 바를 삽입:

```jsx
{/* 탭 바 */}
<div style={{ display: 'flex', borderBottom: '1px solid #2a3a4a', marginBottom: 16, marginTop: 4 }}>
  {[
    { key: 'summary', label: '📊 요약' },
    { key: 'technical', label: '📈 기술적 분석' },
    { key: 'report', label: '📄 리포트' },
  ].map(({ key, label }) => (
    <button
      key={key}
      onClick={() => setActiveDetailTab(key)}
      style={{
        background: 'transparent',
        border: 'none',
        borderBottom: activeDetailTab === key ? '2px solid #4fc3f7' : '2px solid transparent',
        color: activeDetailTab === key ? '#4fc3f7' : '#555',
        padding: '6px 16px',
        fontSize: 12,
        cursor: 'pointer',
        marginBottom: -1,
        fontWeight: activeDetailTab === key ? 600 : 400,
      }}
    >
      {label}
    </button>
  ))}
</div>
```

- [ ] **Step 4: 개발 서버에서 탭 바가 렌더링되는지 육안 확인**

상세화면 진입 후 탭 3개가 보이고, 클릭 시 파란 언더라인이 전환되면 OK.  
(아직 탭별 컨텐츠 분리는 하지 않은 상태 — 전체가 항상 보임)

- [ ] **Step 5: 커밋**

```bash
git add frontend/src/pages/Reports.jsx
git commit -m "feat: add 3-tab bar to report detail view"
```

---

### Task 2: 헤더에 생성 버튼 추가

**Files:**
- Modify: `frontend/src/pages/Reports.jsx:491-524` (상세화면 헤더)

- [ ] **Step 1: 헤더 flex 컨테이너에 생성 버튼 추가**

기존 헤더 div (491번 줄):
```jsx
<div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
  <button onClick={() => setView('list')} ...>← 목록으로</button>
  <div>
    {/* 종목명, 가격, 배지들 */}
  </div>
</div>
```
→ `</div>` (524번 줄의 닫는 태그) 바로 앞에 추가:

```jsx
<button
  onClick={() => generateOne(selected.ticker)}
  disabled={!!generating}
  style={{
    marginLeft: 'auto',
    background: 'transparent',
    border: '1px solid #444',
    color: generating === selected.ticker ? '#4fc3f7' : generating ? '#555' : '#aaa',
    borderRadius: 4,
    padding: '4px 12px',
    fontSize: 12,
    cursor: generating ? 'default' : 'pointer',
    flexShrink: 0,
  }}
>
  {generating === selected.ticker
    ? `${genProgress.done}/${genProgress.total || '?'}`
    : '생성'}
</button>
```

- [ ] **Step 2: 육안 확인**

상세화면 헤더 오른쪽 끝에 "생성" 버튼이 표시되고 클릭 시 기존과 동일하게 동작하면 OK.

- [ ] **Step 3: 커밋**

```bash
git add frontend/src/pages/Reports.jsx
git commit -m "feat: add generate button to report detail header"
```

---

### Task 3: `DetailSummaryTab` 컴포넌트 작성 (요약 탭)

**Files:**
- Modify: `frontend/src/pages/Reports.jsx` — `ConsensusTable` 함수(161~194번 줄) 교체

- [ ] **Step 1: `ConsensusTable` 함수 전체를 `DetailSummaryTab`으로 교체**

161~194번 줄의 `ConsensusTable` 함수를 삭제하고, 같은 위치에 아래 코드를 삽입:

```jsx
function DetailSummaryTab({ summary }) {
  if (!summary) return null
  const { buy = 0, hold = 0, sell = 0 } = summary
  const total = buy + hold + sell
  const pct = (n) => total > 0 ? `${Math.round(n / total * 100)}%` : '—'
  const gap = summary.target_mean != null && summary.price != null
    ? ((summary.target_mean - summary.price) / summary.price * 100)
    : null

  const MetricCard = ({ label, value, sub, valueColor }) => (
    <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px' }}>
      <div style={{ color: '#546e7a', fontSize: 9, marginBottom: 3 }}>{label}</div>
      <div style={{ fontWeight: 700, fontSize: 13, color: valueColor ?? '#ccc' }}>{value}</div>
      {sub && <div style={{ color: '#546e7a', fontSize: 9, marginTop: 1 }}>{sub}</div>}
    </div>
  )

  const SectionTitle = ({ children }) => (
    <div style={{ color: '#80cbc4', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
      {children}
    </div>
  )

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>

      {/* 왼쪽: 증권사 컨센서스 */}
      <div style={{ background: '#111827', borderRadius: 6, padding: 14 }}>
        <SectionTitle>증권사 컨센서스</SectionTitle>
        {/* 프로그레스 바 */}
        {total > 0 && (
          <>
            <div style={{ display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 4 }}>
              <div style={{ width: `${Math.round(buy / total * 100)}%`, background: 'linear-gradient(90deg,#1b5e20,#43a047)' }} />
              <div style={{ width: `${Math.round(hold / total * 100)}%`, background: '#424242' }} />
              <div style={{ width: `${Math.round(sell / total * 100)}%`, background: '#b71c1c' }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#888', marginBottom: 12 }}>
              <span style={{ color: '#81c784' }}>Buy {buy} ({pct(buy)})</span>
              <span>Hold {hold} ({pct(hold)})</span>
              <span style={{ color: '#ef9a9a' }}>Sell {sell} ({pct(sell)})</span>
            </div>
          </>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          {/* 평균 목표가 — 전체 폭 */}
          <div style={{ background: '#0d1f0d', border: '1px solid #1e3a1e', borderRadius: 6, padding: '8px 10px', gridColumn: '1/-1' }}>
            <div style={{ color: '#546e7a', fontSize: 9, marginBottom: 3 }}>평균 목표가</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span style={{ fontWeight: 700, fontSize: 16, color: '#fff' }}>{fmt(summary.target_mean)}</span>
              {gap != null && (
                <span style={{ fontSize: 11, color: gap >= 0 ? '#81c784' : '#ef9a9a' }}>
                  {gap >= 0 ? '+' : ''}{gap.toFixed(1)}% 상승 여력
                </span>
              )}
            </div>
          </div>
          <MetricCard label="최고 목표가" value={fmt(summary.target_high)} valueColor="#81c784" />
          <MetricCard label="최저 목표가" value={fmt(summary.target_low)} valueColor="#ef9a9a" />
          <MetricCard
            label="Finviz 추천지수"
            value={summary.finviz_recom ?? 'N/A'}
            sub="1=강매수, 5=강매도"
            valueColor={summary.finviz_recom != null && summary.finviz_recom <= 2 ? '#81c784' : '#ccc'}
          />
          <MetricCard
            label="애널리스트 수"
            value={total > 0 ? `${total}명` : 'N/A'}
          />
        </div>
      </div>

      {/* 오른쪽: 밸류에이션 + 매물대·RSI 현황 */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

        {/* 밸류에이션 */}
        <div style={{ background: '#111827', borderRadius: 6, padding: 14 }}>
          <SectionTitle>밸류에이션</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 6 }}>
            <MetricCard label="PER (Trailing)" value={summary.per != null ? summary.per.toFixed(1) : '—'} valueColor="#b0bec5" sub="Trailing" />
            <MetricCard label="Fwd PER" value={summary.forward_per != null ? summary.forward_per.toFixed(1) : '—'} valueColor="#78909c" sub="Forward" />
            <MetricCard label="PBR" value={summary.pbr != null ? summary.pbr.toFixed(2) : '—'} valueColor="#78909c" sub="Price/Book" />
          </div>
        </div>

        {/* 매물대 & RSI 현황 */}
        <div style={{ background: '#111827', borderRadius: 6, padding: 14 }}>
          <SectionTitle>매물대 &amp; RSI 현황</SectionTitle>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
            <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ color: '#546e7a', fontSize: 9, marginBottom: 3 }}>POC (Volume Profile)</div>
              <div style={{ fontWeight: 700, fontSize: 13, color: '#80cbc4' }}>{fmt(summary.volume_profile?.poc)}</div>
              {summary.volume_profile?.hvn?.length > 0 && (
                <div style={{ color: '#81c784', fontSize: 9, marginTop: 2 }}>
                  HVN {summary.volume_profile.hvn.map(v => `$${Number(v).toFixed(2)}`).join(' / ')}
                </div>
              )}
            </div>
            <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px' }}>
              <div style={{ color: '#546e7a', fontSize: 9, marginBottom: 4 }}>RSI 현황</div>
              {[
                { label: '일봉', rsi: summary.daily_rsi?.rsi },
                { label: '주봉', rsi: summary.weekly_rsi?.rsi },
                { label: '월봉', rsi: summary.monthly_rsi?.rsi },
              ].map(({ label, rsi }) => (
                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, marginBottom: 1 }}>
                  <span style={{ color: '#546e7a' }}>{label}</span>
                  <span style={{ color: rsiColor(rsi), fontWeight: label === '일봉' ? 700 : 400 }}>
                    {rsi != null ? rsi.toFixed(1) : '—'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
```

- [ ] **Step 2: 상세화면 JSX에서 `<ConsensusTable>`을 `<DetailSummaryTab>`으로 교체**

526번 줄:
```jsx
{!loading && detail.summary && <ConsensusTable summary={detail.summary} />}
```
→
```jsx
{!loading && detail.summary && activeDetailTab === 'summary' && <DetailSummaryTab summary={detail.summary} />}
```

- [ ] **Step 3: 육안 확인**

상세화면 "요약" 탭: 컨센서스 프로그레스 바, 목표가 카드, 밸류에이션 카드, VP/RSI 카드가 2열 그리드로 표시되면 OK.

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/Reports.jsx
git commit -m "feat: add DetailSummaryTab component for report detail summary tab"
```

---

### Task 4: `VolumeProfileCards` 컴포넌트 작성 + 기술적 분석 탭 구성

**Files:**
- Modify: `frontend/src/pages/Reports.jsx` — `VolumeProfileTable` 교체 + 기술적 분석 탭 JSX

- [ ] **Step 1: `VolumeProfileTable` 함수(196~221번 줄)를 `VolumeProfileCards`로 교체**

삭제 후 같은 위치에 삽입:

```jsx
function VolumeProfileCards({ vp }) {
  if (!vp || vp.poc == null) return null
  const hvnStr = vp.hvn?.length ? vp.hvn.map(v => `$${Number(v).toFixed(2)}`).join(' / ') : '—'
  const lvnStr = vp.lvn?.length ? vp.lvn.map(v => `$${Number(v).toFixed(2)}`).join(' / ') : '—'
  return (
    <div style={{ marginBottom: 14, background: '#111', borderRadius: 6, padding: '10px 12px' }}>
      <div style={{ color: '#80cbc4', fontWeight: 700, fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 }}>
        매물대 분석 (Volume Profile, 1년 일봉)
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 8 }}>
        <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ color: '#546e7a', fontSize: 9, marginBottom: 4 }}>POC</div>
          <div style={{ fontWeight: 700, fontSize: 13, color: '#80cbc4' }}>{fmt(vp.poc)}</div>
        </div>
        <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ color: '#81c784', fontSize: 9, marginBottom: 4 }}>HVN (지지·저항)</div>
          <div style={{ color: '#81c784', fontSize: 11 }}>{hvnStr}</div>
        </div>
        <div style={{ background: '#111827', border: '1px solid #1e2a3a', borderRadius: 6, padding: '8px 10px', textAlign: 'center' }}>
          <div style={{ color: '#ffcc80', fontSize: 9, marginBottom: 4 }}>LVN (매물 공백)</div>
          <div style={{ color: '#ffcc80', fontSize: 11 }}>{lvnStr}</div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: 상세화면 JSX에서 기술적 분석 탭 + 리포트 탭 컨텐츠 분리**

현재 527~529번 줄:
```jsx
{!loading && detail.summary?.daily_rsi && <RsiTable dailyRsi={detail.summary.daily_rsi} weeklyRsi={detail.summary.weekly_rsi} monthlyRsi={detail.summary.monthly_rsi} price={detail.summary.price} />}
{!loading && detail.summary?.volume_profile && <VolumeProfileTable vp={detail.summary.volume_profile} />}
{!loading && detail.content && <MarkdownViewer content={detail.content} ticker={selected.ticker} />}
```
→ 아래로 교체:
```jsx
{!loading && activeDetailTab === 'technical' && (
  <>
    <RsiTable
      dailyRsi={detail.summary?.daily_rsi}
      weeklyRsi={detail.summary?.weekly_rsi}
      monthlyRsi={detail.summary?.monthly_rsi}
      price={detail.summary?.price}
    />
    <VolumeProfileCards vp={detail.summary?.volume_profile} />
  </>
)}
{!loading && activeDetailTab === 'report' && detail.content && (
  <MarkdownViewer content={detail.content} ticker={selected.ticker} />
)}
```

- [ ] **Step 3: 육안 확인**

- "기술적 분석" 탭: RSI 타점 테이블과 VP 카드 3개(POC·HVN·LVN)가 표시됨
- "리포트" 탭: 마크다운 본문이 표시됨
- "요약" 탭: DetailSummaryTab만 표시됨 (다른 컨텐츠 없음)
- 각 탭 전환 시 스크롤 위치 초기화됨 (자연스럽게)

- [ ] **Step 4: 커밋**

```bash
git add frontend/src/pages/Reports.jsx
git commit -m "feat: split detail view into summary/technical/report tabs"
```

---

### Task 5: 로딩 상태 + 빈 데이터 처리

**Files:**
- Modify: `frontend/src/pages/Reports.jsx` — 상세화면 로딩/빈 상태

- [ ] **Step 1: 로딩 중 표시를 탭 바 아래로 이동하고 각 탭에 빈 상태 처리 추가**

현재 525번 줄:
```jsx
{loading && <p style={{ color: '#aaa' }}>로딩 중...</p>}
```
이 줄은 그대로 유지 (탭 바 아래에 이미 위치함).

요약 탭에 데이터 없을 때 처리 — Task 3의 `<DetailSummaryTab>` 조건문을 아래로 수정:
```jsx
{!loading && activeDetailTab === 'summary' && (
  detail.summary
    ? <DetailSummaryTab summary={detail.summary} />
    : <p style={{ color: '#666', fontSize: 13 }}>요약 데이터가 없습니다.</p>
)}
```

기술적 분석 탭에 RSI 데이터 없을 때:
```jsx
{!loading && activeDetailTab === 'technical' && (
  detail.summary?.daily_rsi
    ? (
      <>
        <RsiTable
          dailyRsi={detail.summary.daily_rsi}
          weeklyRsi={detail.summary.weekly_rsi}
          monthlyRsi={detail.summary.monthly_rsi}
          price={detail.summary.price}
        />
        <VolumeProfileCards vp={detail.summary.volume_profile} />
      </>
    )
    : <p style={{ color: '#666', fontSize: 13 }}>기술적 분석 데이터가 없습니다.</p>
)}
```

리포트 탭에 컨텐츠 없을 때:
```jsx
{!loading && activeDetailTab === 'report' && (
  detail.content
    ? <MarkdownViewer content={detail.content} ticker={selected.ticker} />
    : <p style={{ color: '#666', fontSize: 13 }}>리포트 파일이 없습니다.</p>
)}
```

- [ ] **Step 2: 육안 확인**

리포트가 있는 종목과 없는 종목 각각에서 탭 전환이 깔끔하게 동작하면 OK.

- [ ] **Step 3: 최종 커밋**

```bash
git add frontend/src/pages/Reports.jsx
git commit -m "feat: handle empty states in detail view tabs"
```
