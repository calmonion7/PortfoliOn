import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import api from '../api'
import { useAuth } from '../contexts/AuthContext'
import Badge from '../components/ui/Badge'
import Skeleton from '../components/ui/Skeleton'
import { useToast } from '../components/Toast'
import { RATING_META } from './AnalystReport'

// 심층 리포트 탭 (task#215) — 발행물 목록(전 사용자) + 대상 관리(admin: 지정 추가/해제/즉시 발행).
// 백엔드는 task#214 완비 — GET /api/analyst-reports, GET /api/stocks(analyst_target),
// PUT /api/admin/analyst-targets/{ticker}, POST /api/admin/cowork/fire 재사용.

const rowStyle = { display: 'flex', alignItems: 'center', gap: 8, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 4, fontSize: 13 }

export default function AnalystReports() {
  const { role } = useAuth() || { role: 'user' }
  const isAdmin = role === 'admin'
  const { showToast } = useToast()
  const [pubs, setPubs] = useState(null)      // null=로딩, []=없음
  const [stocks, setStocks] = useState([])    // 추적 종목(analyst_target 포함) — admin 관리용
  const [firing, setFiring] = useState(null)  // 발행 지시 중인 ticker
  const [addPick, setAddPick] = useState('')

  useEffect(() => {
    api.get('/api/analyst-reports')
      .then(({ data }) => setPubs(data.reports || []))
      .catch((e) => {
        console.error('[AnalystReports] 발행물 목록 조회 실패:', e)
        setPubs([])
      })
  }, [])

  useEffect(() => {
    if (!isAdmin) return
    api.get('/api/stocks')
      .then(({ data }) => setStocks(data || []))
      .catch((e) => console.warn('[AnalystReports] 종목 목록 조회 실패:', e))
  }, [isAdmin])

  const targets = stocks.filter(s => s.analyst_target)
  const candidates = stocks.filter(s => !s.analyst_target)

  const setTarget = async (ticker, enabled) => {
    try {
      await api.put(`/api/admin/analyst-targets/${ticker}`, { enabled })
      setStocks(prev => prev.map(s => s.ticker === ticker ? { ...s, analyst_target: enabled } : s))
      showToast(enabled ? `${ticker} 자동 발행 대상으로 추가했습니다.` : `${ticker} 대상에서 해제했습니다.`)
    } catch (e) {
      console.error('[AnalystReports] 대상 지정 실패:', e)
      showToast('대상 지정 실패 — 잠시 후 다시 시도하세요.', 'error')
    }
  }

  const firePublish = async (ticker) => {
    setFiring(ticker)
    try {
      await api.post('/api/admin/cowork/fire', {
        text: `지시: ${ticker} 1종목의 애널리스트 리포트를 발행하라 — 기본 정책의 7일 조건·대상 지정 여부는 이 지시에서 무시한다. enrich는 하지 마라.`,
      })
      showToast('발행을 지시했습니다 — 분석에 수 분 걸리며, 완료되면 발행물 목록에 나타납니다.')
    } catch (e) {
      console.error('[AnalystReports] 발행 지시 실패:', e)
      showToast(e.response?.status === 503 ? '루틴 fire 미설정 상태입니다.' : '발행 지시 실패 — 서버 로그를 확인하세요.', 'error')
    } finally {
      setFiring(null)
    }
  }

  return (
    <div style={{ maxWidth: 860, margin: '0 auto' }}>
      {/* 발행물 목록 — 전 사용자 */}
      <h3 style={{ fontFamily: 'var(--font-serif)', color: 'var(--text)', fontSize: 16, margin: '0 0 10px' }}>발행물</h3>
      {pubs === null ? (
        <Skeleton variant="row" count={4} />
      ) : pubs.length === 0 ? (
        <p style={{ color: 'var(--text-3)', fontSize: 13 }}>발행된 애널리스트 리포트가 없습니다.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {pubs.map(p => (
            <Link
              key={`${p.ticker}-${p.published_date}`}
              to={`/analyst-report/${p.ticker}/${p.published_date}`}
              style={{ ...rowStyle, textDecoration: 'none' }}
            >
              <span className="mono" style={{ color: 'var(--text-3)', fontSize: 11, flexShrink: 0 }}>{p.published_date}</span>
              <span style={{ color: 'var(--text)', fontWeight: 600, flexShrink: 0 }}>{p.name || p.ticker}</span>
              <Badge variant={(RATING_META[p.rating] || RATING_META.neutral).variant}>{(RATING_META[p.rating] || RATING_META.neutral).label}</Badge>
              <span style={{ color: 'var(--text-2, var(--text))', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.title}</span>
            </Link>
          ))}
        </div>
      )}

      {/* 대상 관리 — admin 전용 */}
      {isAdmin && (
        <>
          <h3 style={{ fontFamily: 'var(--font-serif)', color: 'var(--text)', fontSize: 16, margin: '28px 0 6px' }}>자동 발행 대상 관리</h3>
          <p style={{ color: 'var(--text-3)', fontSize: 12, margin: '0 0 10px' }}>
            지정한 종목만 루틴이 자동 발행 후보로 봅니다(비어있으면 자동 발행 안 함). 발행 버튼은 즉시 발행을 지시합니다(수 분 소요).
          </p>
          {targets.length === 0 ? (
            <p style={{ color: 'var(--text-3)', fontSize: 13 }}>지정된 종목이 없습니다 — 아래에서 추가하세요.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {targets.map(s => (
                <div key={s.ticker} style={rowStyle}>
                  <span style={{ color: 'var(--text)', fontWeight: 600 }}>{s.name}</span>
                  <span className="mono" style={{ color: 'var(--text-3)', fontSize: 11 }}>({s.ticker})</span>
                  <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => firePublish(s.ticker)}
                      disabled={firing === s.ticker}
                      style={{ background: 'transparent', border: '1px solid var(--border)', color: firing === s.ticker ? 'var(--accent)' : 'var(--text-3)', borderRadius: 4, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}
                    >
                      {firing === s.ticker ? '지시 중…' : '발행'}
                    </button>
                    <button
                      onClick={() => setTarget(s.ticker, false)}
                      style={{ background: 'transparent', border: '1px solid var(--border)', color: 'var(--text-3)', borderRadius: 4, padding: '3px 10px', fontSize: 12, cursor: 'pointer' }}
                    >
                      해제
                    </button>
                  </span>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
            <select
              value={addPick}
              onChange={e => setAddPick(e.target.value)}
              style={{ background: 'var(--bg-elev-2)', border: '1px solid var(--border)', color: 'var(--text)', borderRadius: 4, padding: '5px 8px', fontSize: 13, flex: 1, maxWidth: 320 }}
            >
              <option value="">종목 선택 (보유·관심)</option>
              {candidates.map(s => (
                <option key={`${s.ticker}-${s.type}`} value={s.ticker}>{s.name} ({s.ticker})</option>
              ))}
            </select>
            <button
              onClick={() => { if (addPick) { setTarget(addPick, true); setAddPick('') } }}
              disabled={!addPick}
              style={{ background: 'var(--accent)', border: '1px solid var(--accent)', color: 'var(--bg)', borderRadius: 4, padding: '5px 14px', fontSize: 13, cursor: addPick ? 'pointer' : 'default', opacity: addPick ? 1 : 0.5 }}
            >
              추가
            </button>
          </div>
        </>
      )}
    </div>
  )
}
