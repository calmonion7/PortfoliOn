// frontend/src/pages/ExposureTab.jsx
import { useState, useEffect, useCallback } from 'react'
import api from '../api'
import Card from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import Skeleton from '../components/ui/Skeleton'
import useIsMobile from '../hooks/useIsMobile'
import { Link } from 'react-router-dom'
import useTechIndex from '../hooks/useTechIndex'
import StockModal from '../components/StockModal'
import { useToast } from '../components/Toast'

const pctText = (v) => v == null ? '—' : `${v.toFixed(1)}%`

// 경고 배지 전용색(caution 주황) — success/danger 변형 금지(--up=빨강/--down=파랑 반전, SupplyBadge 규약).
// --warn/--warn-soft는 라이트/다크 모두 WCAG AA 튜닝된 토큰이라 그대로 드롭인.
const warnStyle = { background: 'var(--warn-soft)', color: 'var(--warn)', borderColor: 'var(--warn)' }

// 베타 설명 뱃지 전용색 — 가격방향(빨강/파랑)과 무관한 3색(SupplyBadge 규약과 동일 원칙).
// aggressive/defensive는 대응 토큰이 없어 라이트/다크 각각 WCAG AA(≥4.5:1) 튜닝된 hex를 직접 분기(rsiColor와 동일 패턴).
function betaStyles() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
  return {
    aggressive: isDark
      ? { background: 'rgba(206, 147, 216, 0.18)', color: '#ce93d8', borderColor: 'rgba(206, 147, 216, 0.36)' }
      : { background: 'rgba(123, 31, 162, 0.14)', color: '#7b1fa2', borderColor: 'rgba(123, 31, 162, 0.30)' },
    market: { background: 'rgba(120, 120, 120, 0.16)', color: 'var(--text-3)', borderColor: 'rgba(120, 120, 120, 0.32)' },
    defensive: isDark
      ? { background: 'rgba(77, 182, 172, 0.18)', color: '#4db6ac', borderColor: 'rgba(77, 182, 172, 0.36)' }
      : { background: 'rgba(0, 105, 92, 0.14)', color: '#00695c', borderColor: 'rgba(0, 105, 92, 0.30)' },
  }
}

function betaBadge(beta) {
  const styles = betaStyles()
  if (beta > 1.2) return { text: '공격적', style: styles.aggressive }
  if (beta < 0.8) return { text: '방어적', style: styles.defensive }
  return { text: '시장수준', style: styles.market }
}

const DATA_COLORS = ['var(--data-1)', 'var(--data-2)', 'var(--data-3)', 'var(--data-4)', 'var(--data-5)']

function WeightBar({ label, weight, color = 'var(--accent)', warn = false }) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 3 }}>
        <span style={{ color: 'var(--text)' }}>{label}</span>
        <span className="tnum mono" style={{ color: warn ? '#f57c00' : 'var(--text-3)', fontWeight: warn ? 600 : 400 }}>{pctText(weight)}</span>
      </div>
      <div style={{ height: 8, borderRadius: 4, background: 'var(--bg-elev)', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(weight, 100)}%`, height: '100%', background: color }} />
      </div>
    </div>
  )
}


/**
 * 기술 노출 **상한** 계산 (ADR-0043) — 보유 종목만, 관심은 넣지 않는다.
 *
 * 값 = 그 기술 `players[].ticker`에 실린 내 **보유** 종목의 포트폴리오 비중 합.
 * 한 종목이 여러 기술에 등장하면 **양쪽 모두에 계상**되므로 기술 간 합은 100%를 넘는다 —
 * 그것이 오류가 아니라 이 지표의 정의다(분모가 기술마다 다르다).
 *
 * ⚠️ 관심종목은 `quantity`가 없어 비중을 만들 수 없다. 0으로 섞으면 "노출 0"과
 * 구별되지 않으므로 **막대에서 통째로 제외**하고 개수만 부기로 알린다.
 */
export function computeTechExposure(techIndex, holdings, watchTickers = []) {
  const wByTicker = new Map((holdings || []).map(h => [h.ticker, h.weight || 0]))
  const watch = new Set(watchTickers || [])
  const rows = (techIndex || []).map(t => {
    const tickers = t.tickers || []
    const mine = tickers.filter(k => wByTicker.has(k))
    return {
      slug: t.slug,
      name: t.name || t.slug,
      weight: mine.reduce((sum, k) => sum + wByTicker.get(k), 0),
      holdingCount: mine.length,
      watchCount: tickers.filter(k => watch.has(k) && !wByTicker.has(k)).length,
      // 미매칭 = 티커가 아예 없는 업체(비상장·미기재). 내 보유와의 불일치가 아니다.
      unmatched: Math.max((t.players_total || 0) - tickers.length, 0),
    }
  })
  // ⚠️ 로케일 고정 — 인자 없는 localeCompare는 Node와 Chrome이 갈린다(실측:
  // 'AI 데이터센터 설비' vs '온디바이스 AI' → Node +1 · **Chrome -1** · 'ko'는 둘 다 +1).
  // 라이브에서 두 기술이 56.9%로 **동률**이라 이 tiebreaker가 실제로 순서를 결정하며,
  // 고정하지 않으면 Node 기반 테스트·프로브가 단언하는 순서와 화면이 어긋난다
  // (선재 결함이었고 task#323의 `bar-slugs` 축이 드러냈다 — 아래 후보 정렬과 같은 규약).
  return rows.sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name, 'ko'))
}

const MAX_CHIPS = 3

/**
 * 「내가 안 가진 업체」 후보 (task#323) — **노출>0 기술마다** 그 기술의 상장 업체 중
 * 내 보유·관심 **둘 다에 없는** 곳. 진단(자본이 이 기술에 얼마나 걸렸나)에서
 * 행동(그럼 무엇을 더 볼까)으로 한 걸음만 잇는다.
 *
 * ⚠️ **노출 0인 기술은 후보를 내지 않는다** — 그건 「보강」이 아니라 「미개척 기술 확장」이고
 * 노출 *진단* 카드의 성격을 넘는다(현행 「나머지 N개 기술엔 노출 없음」 한 줄로 남긴다).
 *
 * ⚠️ 관심종목도 제외한다 — 카드가 이미 「관심 N종목」으로 부기하므로 「이미 알고 있음」으로
 * 다뤄지고, 그래서 칩의 액션이 「관심 추가」 하나로 단순해진다.
 *
 * 정렬은 `tech_level↓ → gap_years↑(결측 맨 뒤) → name↑`. **마지막 키가 결정적**이라
 * 같은 입력이 늘 같은 순서를 낸다(이 저장소의 페이지네이션 tiebreaker 교훈).
 * `share_pct`는 채움률 9%라 정렬 축으로 쓰지 않고, `players` 게재 순서도 쓰지 않는다
 * (루틴 프롬프트가 나열 순서를 규정하지 않으므로 근거가 없다).
 */
export function computeTechCandidates(techIndex, holdings, watchTickers = []) {
  const mine = new Set([
    ...(holdings || []).map(h => h.ticker),
    ...(watchTickers || []),
  ].filter(Boolean))
  // 노출 판정은 computeTechExposure **하나**에만 둔다 — 비중 계산을 두 벌 두면 조용히 갈라진다.
  const exposed = new Set(
    computeTechExposure(techIndex, holdings, watchTickers)
      .filter(r => r.weight > 0)
      .map(r => r.slug)
  )
  const out = new Map()
  for (const t of techIndex || []) {
    if (!exposed.has(t.slug)) continue
    // `listed`가 없는 옛 응답(프론트 먼저 라이브 ↔ 백엔드 재배포 전 창)에도 죽지 않는다.
    // 옛 필드로 폴백하지 않는다 — 후보 0으로 비우고, 화면은 「없음」이라 말하지 않는다.
    const pool = (t.listed || []).filter(p => p.ticker && !mine.has(p.ticker))
    pool.sort((a, b) => {
      // 결측 gap_years는 맨 뒤로 밀어야 하므로 큰 sentinel을 쓴다.
      // ⚠️ `Infinity`가 아니라 MAX_SAFE_INTEGER인 이유를 정확히 적어 둔다(실측으로 확인):
      //    Infinity면 둘 다 결측일 때 `Infinity-Infinity=NaN`이 되는데, **NaN은 falsy라
      //    `||` 체인이 그것을 삼키고 다음 키(name)로 그냥 넘어간다** — 즉 이 위치에서는
      //    관측 결과가 같고 비교자가 불안정해지지도 않는다(주입 실측: 0 fail).
      //    MAX_SAFE_INTEGER는 그 우연한 falsy 폴스루에 기대지 않고 gap_years 키가
      //    **끝까지 유효한 수 비교로 남게** 하려는 것이다. 훗날 `||` 체인을 명시 return으로
      //    바꾸면 Infinity판은 NaN을 그대로 반환해 순서가 엔진 의존이 된다.
      const ga = a.gap_years ?? Number.MAX_SAFE_INTEGER
      const gb = b.gap_years ?? Number.MAX_SAFE_INTEGER
      return (b.tech_level || 0) - (a.tech_level || 0)
        || ga - gb
        // ⚠️ 로케일을 **반드시 명시**한다. 인자 없는 localeCompare는 런타임 기본 로케일에
        // 의존해 **Node와 Chrome이 갈린다**(실측: 'HD현대일렉트릭' vs '효성중공업' →
        // Node +1 · Chrome -1). 그러면 vitest(Node)가 단언한 순서와 프로덕션(Chrome)이
        // 렌더하는 순서가 달라져 «fixture는 통과하고 라이브만 다른» 상태가 된다.
        // 'ko'는 두 런타임이 일치함을 실측으로 확인했다(둘 다 +1).
        || String(a.name || '').localeCompare(String(b.name || ''), 'ko')
    })
    if (!pool.length) continue
    out.set(t.slug, {
      chips: pool.slice(0, MAX_CHIPS).map(p => ({
        ticker: p.ticker,
        name: p.name || p.ticker,
        techLevel: p.tech_level ?? null,
        category: p.category || null,
        // 시장은 **티커 형태**로 추론한다(`country`가 아니라) — 루틴 프롬프트가 못박은 규칙이 그것이다.
        market: /^\d{6}$/.test(p.ticker) ? 'KR' : 'US',
      })),
      more: Math.max(pool.length - MAX_CHIPS, 0),
    })
  }
  return out
}

/**
 * 노출>0 기술 막대 아래의 「안 가진 업체」 후보 칩 (task#323).
 *
 * ⚠️ **후보가 없으면 구역 자체를 그리지 않는다** — 「후보 없음」이라 말하지 않는다.
 * 조회 실패(`techFailed`)면 이 컴포넌트가 있는 카드 자체가 렌더되지 않으므로
 * (task#307 결정 — `useTechIndex` docstring) 실패와 0건이 화면에서 구별된다.
 *
 * ⚠️ 업체명은 **말줄임하지 않는다**(실측 최대 35자). 278px에서 2~3줄로 접히는 것은
 * 정상 동작이다 — 잘라내면 어느 업체인지 알 수 없어지고, 「잘림 ellipsis」는 이
 * 저장소 시각 결함 9클래스 중 하나다.
 *
 * ⚠️ 색은 의미 토큰만 쓴다 — 가격 방향 토큰(`--up`/`--down`)을 쓰지 않는다(KR 색 관례).
 */
function TechCandidateChips({ entry, slug, onPick }) {
  // eco: `!entry`만으로 충분하다 — computeTechCandidates가 pool이 비면 키를 만들지 않으므로
  // chips.length===0인 entry는 현재 **발생하지 않는다**(주입 실측 0 fail = 이 절은 도달 불가).
  // 미래에 호출자가 빈 chips를 넘길 때의 크래시 보험으로만 남긴다 — load-bearing이 아니다.
  if (!entry || !entry.chips.length) return null
  return (
    <div
      data-testid="tech-cand-row"
      data-slug={slug}
      style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', margin: '0 0 12px' }}
    >
      <span data-testid="tech-cand-label" style={{ color: 'var(--text-3)', fontSize: 11 }}>
        안 가진 업체
      </span>
      {entry.chips.map(c => {
        // 메타줄 = `섹터 · Lv3`. 섹터(category)는 실측 88% 채움이라 없을 수 있고,
        // 그때는 Lv만 쓴다(빈 `—` 구멍을 만들지 않는다).
        // ⚠️ 섹터가 빠지면 이 지표가 조용히 거짓이 된다 — `tech_level`은 섹터 안에서만
        //    비교 가능한데 우리는 기술 전체를 통짜로 정렬하므로, 섹터 표기가 그 사실을
        //    독자에게 넘기는 유일한 장치다(계획서의 「정직한 한계」).
        const meta = [c.category, c.techLevel != null ? `Lv${c.techLevel}` : null]
          .filter(Boolean).join(' · ')
        return (
          <button
            key={c.ticker}
            type="button"
            data-testid="tech-cand-chip"
            data-ticker={c.ticker}
            data-market={c.market}
            aria-label={`${c.name} 관심종목 추가`}
            onClick={() => onPick({
              ticker: c.ticker, name: c.name, market: c.market,
              // 거래소는 비워 사용자가 모달에서 고르게 한다(KR은 KOSPI/KOSDAQ 선택이 뜬다).
              exchange: '', security_type: 'EQUITY',
            })}
            style={{
              display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 2,
              // 탭 타깃 — 인라인이 아닌 flex 자식이라 세로 padding이 실제 높이에 반영된다.
              padding: '7px 12px',
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 8, cursor: 'pointer', textAlign: 'left',
              maxWidth: '100%',
            }}
          >
            <span style={{
              color: 'var(--text)', fontSize: 12, fontWeight: 600, lineHeight: '18px',
              // 말줄임 금지 — 긴 이름은 접힌다.
              whiteSpace: 'normal', overflowWrap: 'anywhere',
            }}>{c.name}</span>
            {meta && (
              <span style={{ color: 'var(--text-3)', fontSize: 11, lineHeight: '16px' }}>{meta}</span>
            )}
          </button>
        )
      })}
      {entry.more > 0 && (
        <span data-testid="tech-cand-more" style={{ color: 'var(--text-3)', fontSize: 11 }}>
          +{entry.more}
        </span>
      )}
    </div>
  )
}

export default function ExposureTab() {
  const isMobile = useIsMobile()
  const { showToast } = useToast()
  const { techIndex, ready: techReady, failed: techFailed } = useTechIndex()
  const [watchTickers, setWatchTickers] = useState([])
  // 후보 칩 → 관심 추가 프리필(task#323). null이면 모달을 그리지 않는다.
  const [candPrefill, setCandPrefill] = useState(null)
  const [open, setOpen] = useState(true)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const load = useCallback(() => {
    setLoading(true)
    api.get('/api/portfolio/exposure')
      .then(r => { setData(r.data); setError(null); setLoading(false) })
      .catch(e => { setError(e.message); setLoading(false) })
  }, [])

  useEffect(load, [load])

  // 관심종목은 막대에 넣지 않지만(비중 없음) 「관심 N종목」 부기에는 필요하다.
  // 실패해도 부기만 사라지고 카드는 그대로 — 본문을 막지 않는다.
  const loadWatch = useCallback(() => (
    api.get('/api/watchlist')
      .then(r => setWatchTickers((Array.isArray(r.data) ? r.data : []).map(w => w.ticker).filter(Boolean)))
      .catch(e => { console.warn('[ExposureTab] 관심목록 조회 실패 — 관심 부기만 생략한다:', e.message) })
  ), [])

  useEffect(() => { loadWatch() }, [loadWatch])

  // 후보를 관심에 담으면 그 칩은 더 이상 후보가 아니다 — 저장 후 관심목록을 재조회해
  // 칩이 사라지는 것까지가 이 흐름의 끝이다(화면이 방금 한 일을 반영하지 않으면 또 누른다).
  const saveCandidate = async (payload) => {
    try {
      await api.post('/api/watchlist', payload)
      showToast(`${payload.ticker} 관심종목에 추가됐습니다`)
      setCandPrefill(null)
      await loadWatch()
    } catch (err) {
      showToast(err?.response?.data?.detail || '추가 실패', 'error')
      throw err
    }
  }

  if (loading) return <Skeleton variant="card" count={3} />
  if (error) return <div style={{ color: 'var(--color-error)' }}>오류: {error}</div>
  if (!data || !data.holdings.length) return (
    <div style={{ color: 'var(--text-3)' }}>보유 종목이 없습니다.</div>
  )

  const { currency, sector, holdings, concentration, warnings, no_fx, portfolio_beta, beta_coverage_pct, beta_missing } = data
  const sectorEntries = Object.entries(sector).sort((a, b) => b[1].weight - a[1].weight)
  const otherSector = sectorEntries.find(([name]) => name === '기타')

  const techRows = computeTechExposure(techIndex, holdings, watchTickers)
  const techCandidates = computeTechCandidates(techIndex, holdings, watchTickers)
  const techExposed = techRows.filter(r => r.weight > 0)
  const techZero = techRows.filter(r => r.weight <= 0)
  // 부기 2종은 **노출된 기술** 기준으로만 센다 — 노출 0인 기술의 미매칭까지 더하면
  // 화면에 없는 막대의 각주가 되어 독자가 무엇에 대한 수인지 알 수 없다.
  const techWatchCount = techExposed.reduce((n, r) => n + r.watchCount, 0)
  const techUnmatched = techExposed.reduce((n, r) => n + r.unmatched, 0)

  const body = (
    <>
      <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 16 }}>
        보유 종목 기준, 전체 포트폴리오 KRW 환산 비중으로 통화·섹터·단일종목 쏠림을 봅니다.
      </p>

      {(warnings.single_name || warnings.sector) && (
        <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
          {warnings.single_name && <Badge variant="neutral" size="sm" style={warnStyle}>⚠ 단일종목 25% 초과</Badge>}
          {warnings.sector && <Badge variant="neutral" size="sm" style={warnStyle}>⚠ 섹터 40% 초과</Badge>}
        </div>
      )}

      <Card padding="sm" style={{ marginBottom: 12 }}>
        <h3 style={{ color: 'var(--text)', fontSize: 14, marginBottom: 10 }}>포트폴리오 베타</h3>
        {portfolio_beta == null ? (
          <p style={{ color: 'var(--text-3)', fontSize: 12 }}>베타 데이터 없음(리포트/백필 필요)</p>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 6 }}>
              <span className="tnum mono" style={{ color: 'var(--text)', fontSize: 20, fontWeight: 600 }}>{portfolio_beta.toFixed(2)}</span>
              <Badge variant="neutral" size="sm" style={betaBadge(portfolio_beta).style}>{betaBadge(portfolio_beta).text}</Badge>
            </div>
            <p style={{ color: 'var(--text-3)', fontSize: 12 }}>
              커버리지 {pctText(beta_coverage_pct)} · 베타없음 {beta_missing.length}종목
              {beta_coverage_pct < 60 && <Badge variant="neutral" size="sm" style={{ ...warnStyle, marginLeft: 6 }}>참고용</Badge>}
            </p>
          </>
        )}
      </Card>

      <Card padding="sm" style={{ marginBottom: 12 }}>
        <h3 style={{ color: 'var(--text)', fontSize: 14, marginBottom: 10 }}>통화 노출</h3>
        {Object.entries(currency).sort((a, b) => b[1].weight - a[1].weight).map(([mkt, g], i) => (
          <WeightBar key={mkt} label={mkt} weight={g.weight} color={DATA_COLORS[i % DATA_COLORS.length]} />
        ))}
      </Card>

      <Card padding="sm" style={{ marginBottom: 12 }}>
        <h3 style={{ color: 'var(--text)', fontSize: 14, marginBottom: 10 }}>섹터 노출</h3>
        {sectorEntries.map(([name, g], i) => (
          <WeightBar
            key={name}
            label={name}
            weight={g.weight}
            color={DATA_COLORS[i % DATA_COLORS.length]}
            warn={g.weight > 40}
          />
        ))}
        {otherSector && (
          <p style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4 }}>
            기타: 섹터 미분류 종목 — 리포트 생성 시 채워짐
          </p>
        )}
      </Card>

      <Card padding="sm">
        <h3 style={{ color: 'var(--text)', fontSize: 14, marginBottom: 4 }}>단일종목 집중도</h3>
        <p style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 10 }}>
          상위 3종목 {pctText(concentration.top3_pct)} · 상위 5종목 {pctText(concentration.top5_pct)}
          {concentration.max_single && <> · 최대 단일종목 {concentration.max_single.ticker} ({pctText(concentration.max_single.weight)})</>}
        </p>
        {holdings.map(h => (
          <WeightBar
            key={h.ticker}
            label={h.name && h.name !== h.ticker ? `${h.ticker} ${h.name}` : h.ticker}
            weight={h.weight}
            warn={h.weight > 25}
          />
        ))}
        {no_fx.count > 0 && (
          <p style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4 }}>
            환산불가 {no_fx.count}종목 ({no_fx.tickers.join(', ')}) — 환율 없어 집계에서 제외
          </p>
        )}
      </Card>

      {techReady && !techFailed && (
        <Card padding="sm" style={{ marginTop: 12 }} data-testid="tech-exposure-card">
          <h3 style={{ color: 'var(--text)', fontSize: 14, marginBottom: 4 }}>기술 노출</h3>
          {/* ⚠️ 기준 문구 2문장은 지표의 *구성요소*다 — 빠지면 지표가 거짓이 된다(ADR-0043).
              값이 상한이라는 것과 기술 간 합이 100%를 넘는다는 것을 함께 말해야 해석이 성립한다. */}
          <p data-testid="tech-exposure-basis" style={{ color: 'var(--text-3)', fontSize: 12, marginBottom: 10 }}>
            해당 업체의 전사 비중을 더한 값이라 실제 기술 노출의 <strong>상한</strong>입니다.
            한 종목이 여러 기술에 들어가므로 <strong>기술 간 합은 100%를 넘을 수 있습니다.</strong>
          </p>
          {techRows.filter(r => r.weight > 0).map((r, i) => (
            // data-testid는 프로브가 막대를 **구조 휴리스틱 없이** 세도록 준다 —
            // 이 래퍼가 생기면서 「자식 div + % span」 방식이 기술당 2개를 세게 됐다.
            <div key={r.slug} data-testid="tech-exposure-bar" data-slug={r.slug}>
              <WeightBar
                label={r.name}
                weight={r.weight}
                color={DATA_COLORS[i % DATA_COLORS.length]}
              />
              <TechCandidateChips
                entry={techCandidates.get(r.slug)}
                slug={r.slug}
                onPick={setCandPrefill}
              />
            </div>
          ))}
          {techExposed.length === 0 && (
            <p data-testid="tech-exposure-empty" style={{ color: 'var(--text-3)', fontSize: 12 }}>
              보유 종목과 겹치는 기술이 없습니다. <Link to="/tech-reports" style={{ color: 'var(--accent)' }}>기술 리포트 목록 →</Link>
            </p>
          )}
          {techZero.length > 0 && (
            <p data-testid="tech-exposure-zero" style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4 }}>
              나머지 {techZero.length}개 기술엔 노출 없음 · <Link to="/tech-reports" style={{ color: 'var(--accent)' }}>목록 →</Link>
            </p>
          )}
          {techWatchCount > 0 && (
            <p data-testid="tech-exposure-watch" style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4 }}>
              관심 {techWatchCount}종목 — 보유수량이 없어 막대에서 제외
            </p>
          )}
          {techUnmatched > 0 && (
            <p data-testid="tech-exposure-unmatched" style={{ color: 'var(--text-3)', fontSize: 11, marginTop: 4 }}>
              미상장·미매칭 {techUnmatched}개 제외 — 업체 표에 티커가 없는 곳
            </p>
          )}
        </Card>
      )}
      {candPrefill && (
        <StockModal
          mode="watchlist"
          prefill={candPrefill}
          onSave={saveCandidate}
          onClose={() => setCandPrefill(null)}
        />
      )}
    </>
  )

  return (
    <div>
      {isMobile ? (
        <button className="accordion-header" onClick={() => setOpen(o => !o)}>
          <span style={{ color: 'var(--text)', fontWeight: 600 }}>노출</span>
          <span>{open ? '∧' : '∨'}</span>
        </button>
      ) : (
        <h2 style={{ color: 'var(--text)', marginBottom: 8 }}>노출</h2>
      )}
      {(!isMobile || open) && body}
    </div>
  )
}
