import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api'
import { fmtPrice as fmt } from '../../utils'
import { MarketBadge, ChangeBadge } from '../ui/Badge'
import { SketchCircleMark } from '../sketches'
import { useToast } from '../Toast'
import './ReportDetail.css'

// 섹터·PER·PBR·PSR·EV/EBITDA 메타 칩 — 4곳이 byte-identical 스타일을 반복하던 것을 로컬 헬퍼로 정리(같은 파일 내, 신규 모듈 아님).
const MetaChip = ({ children }) => (
  <span className="mono tnum" style={{ color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>{children}</span>
)

export default function ReportDetailHeader({
  detail, selected, setSelected, setView, isAdmin, generating, genProgress, generateOne, guruMap, reportList,
  publications = [], // 애널리스트 리포트 발행물(task#212) — 없으면 링크 숨김
}) {
  const { showToast } = useToast()
  // 애널 발행 대상 토글(task#214) — 정본은 detail.summary.analyst_target, 토글 시 낙관 갱신
  const [analystTarget, setAnalystTarget] = useState(false)
  const [firing, setFiring] = useState(false)
  useEffect(() => {
    setAnalystTarget(!!detail.summary?.analyst_target)
  }, [detail.summary?.analyst_target, selected.ticker])

  const toggleTarget = async () => {
    const next = !analystTarget
    setAnalystTarget(next)
    try {
      await api.put(`/api/admin/analyst-targets/${selected.ticker}`, { enabled: next })
      showToast(next ? '애널리스트 리포트 자동 발행 대상으로 지정했습니다.' : '자동 발행 대상에서 해제했습니다.')
    } catch (e) {
      console.error('[ReportDetailHeader] 애널 대상 토글 실패:', e)
      setAnalystTarget(!next)
      showToast('대상 지정 실패 — 잠시 후 다시 시도하세요.', 'error')
    }
  }

  const fireAnalystReport = async () => {
    setFiring(true)
    try {
      await api.post('/api/admin/cowork/fire', {
        text: `지시: ${selected.ticker} 1종목의 애널리스트 리포트를 발행하라 — 기본 정책의 7일 조건·대상 지정 여부는 이 지시에서 무시한다. enrich는 하지 마라.`,
      })
      showToast('발행을 지시했습니다 — 분석에 수 분 걸리며, 완료되면 발행물 목록에 나타납니다.')
    } catch (e) {
      console.error('[ReportDetailHeader] 애널 발행 fire 실패:', e)
      showToast(e.response?.status === 503 ? '루틴 fire 미설정 상태입니다.' : '발행 지시 실패 — 서버 로그를 확인하세요.', 'error')
    } finally {
      setFiring(false)
    }
  }

  return (
    <div className="detail-header" style={{ marginBottom: 16, paddingBottom: 12, borderBottom: '1px solid var(--border)' }}>
      {/* 행1: 네비 버튼 */}
      <div className="detail-header-nav">
        <button
          onClick={() => setView('list')}
          style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
        >
          ← 목록으로
        </button>
        {isAdmin && (
          <button
            onClick={() => generateOne(selected.ticker)}
            disabled={!!generating}
            className="mono tnum"
            style={{ background: 'transparent', border: '1px solid var(--border)', color: generating === selected.ticker ? 'var(--accent)' : 'var(--text-3)', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: generating ? 'default' : 'pointer' }}
          >
            {generating === selected.ticker ? `${genProgress.done}/${genProgress.total || '?'}` : '생성'}
          </button>
        )}
        {isAdmin && (
          <button
            onClick={toggleTarget}
            title="애널리스트 리포트 자동 발행 대상 지정 (opt-in — 지정 종목만 루틴이 자동 발행 후보로 봄)"
            style={{ background: analystTarget ? 'var(--accent)' : 'transparent', border: '1px solid ' + (analystTarget ? 'var(--accent)' : 'var(--border)'), color: analystTarget ? 'var(--bg)' : 'var(--text-3)', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: 'pointer' }}
          >
            애널 대상{analystTarget ? ' ✓' : ''}
          </button>
        )}
        {isAdmin && (
          <button
            onClick={fireAnalystReport}
            disabled={firing}
            title="이 종목의 애널리스트 리포트를 지금 발행하도록 루틴에 지시 (수 분 소요)"
            style={{ background: 'transparent', border: '1px solid var(--border)', color: firing ? 'var(--accent)' : 'var(--text-3)', borderRadius: 4, padding: '4px 12px', fontSize: 12, cursor: firing ? 'default' : 'pointer' }}
          >
            {firing ? '지시 중…' : '애널 발행'}
          </button>
        )}
      </div>
      {/* 행2: 종목명 + 뱃지 */}
      <div className="detail-header-title">
        <span style={{ color: 'var(--text)', fontWeight: 700, fontSize: 18, fontFamily: 'var(--font-serif)' }}>
          {detail.summary?.name || selected.ticker}
        </span>
        <span className="mono" style={{ color: 'var(--text-3)', fontSize: 13, marginLeft: 6 }}>({selected.ticker})</span>
        <span style={{ marginLeft: 6 }}><MarketBadge market={detail.summary?.market || 'US'} exchange={detail.summary?.exchange} /></span>
        {guruMap[selected.ticker] && (
          <span style={{ color: 'var(--warn)', fontSize: 11, marginLeft: 6, background: 'var(--warn-soft)', padding: '2px 7px', borderRadius: 3 }}>
            구루 {guruMap[selected.ticker]}명
          </span>
        )}
        {publications.length > 0 && (
          <Link
            to={`/analyst-report/${selected.ticker}/${publications[0].published_date}`}
            style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 6, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3, textDecoration: 'none', border: '1px solid var(--border)' }}
          >
            애널리스트 리포트 →
          </Link>
        )}
      </div>
      {/* 행3: 날짜 + 현재가 + 고점대비 */}
      <div className="detail-header-price">
        {reportList[selected.ticker]?.dates?.length > 1 ? (
          <select
            value={selected.date}
            onChange={e => setSelected({ ticker: selected.ticker, date: e.target.value })}
            className="mono"
            style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--border)', color: 'var(--text-3)', borderRadius: 4, padding: '2px 6px', fontSize: 12, cursor: 'pointer' }}
          >
            {reportList[selected.ticker].dates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        ) : (
          <span className="mono" style={{ color: 'var(--text-3)', fontSize: 12 }}>{selected.date}</span>
        )}
        {detail.summary?.price != null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
            <SketchCircleMark size={18} className="rpt-price-mark" />
            <span className="mono tnum" style={{ color: 'var(--text)', fontSize: 16, fontWeight: 700 }}>
              {fmt(detail.summary.price, detail.summary.market)}
            </span>
          </span>
        )}
        {detail.summary?.drop_from_high_20d != null && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            {detail.summary.drop_from_high_20d < -10 && <span style={{ fontSize: 11 }}>⚠</span>}
            <span className="mono" style={{ fontSize: 10, color: 'var(--text-3)' }}>20일고점</span>
            <ChangeBadge value={detail.summary.drop_from_high_20d} />
          </span>
        )}
      </div>
      {/* 행4: 섹터 + PER + PBR */}
      <div className="detail-header-meta">
        {detail.summary?.sector && (
          <span style={{ color: 'var(--accent)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>
            {detail.summary.sector}{detail.summary.industry ? ` / ${detail.summary.industry}` : ''}
          </span>
        )}
        {detail.summary?.per != null && (
          <MetaChip>
            PER {detail.summary.per.toFixed(1)}
            {detail.summary.forward_per != null && <span style={{ marginLeft: 4 }}>/ Fwd {detail.summary.forward_per.toFixed(1)}</span>}
          </MetaChip>
        )}
        {detail.summary?.pbr != null && <MetaChip>PBR {detail.summary.pbr.toFixed(2)}</MetaChip>}
        {detail.summary?.psr != null && <MetaChip>PSR {detail.summary.psr.toFixed(2)}</MetaChip>}
        {detail.summary?.ev_ebitda != null && <MetaChip>EV/EBITDA {detail.summary.ev_ebitda.toFixed(1)}</MetaChip>}
      </div>
    </div>
  )
}
