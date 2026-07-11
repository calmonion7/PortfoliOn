import { useState, useEffect, useRef } from 'react'
import api from '../api'

const THIS_YEAR = new Date().getFullYear()
const YEARS = Array.from({ length: THIS_YEAR - 2019 }, (_, i) => 2020 + i)

export default function LeverageBackfillSettings() {
  const [coverage, setCoverage] = useState(null)
  const [coverageErr, setCoverageErr] = useState('')
  const [startYear, setStartYear] = useState(2021)
  const [endYear, setEndYear] = useState(THIS_YEAR)
  const [progress, setProgress] = useState({ running: false, done: 0, total: 0, current: '', error: '' })
  const [err, setErr] = useState('')
  const pollRef = useRef(null)

  const loadCoverage = async () => {
    try {
      const { data } = await api.get('/api/market/leverage/coverage')
      setCoverage(data)
      setCoverageErr('')
    } catch (e) {
      setCoverageErr(e?.response?.data?.detail || '데이터 현황을 불러오지 못했습니다.')
    }
  }

  useEffect(() => {
    loadCoverage()
    return () => clearInterval(pollRef.current)
  }, [])

  const runBackfill = async () => {
    setErr('')
    setProgress({ running: true, done: 0, total: 0, current: '', error: '' })
    clearInterval(pollRef.current)
    try {
      await api.post(`/api/market/leverage/backfill?start_year=${startYear}&end_year=${endYear}`)
      pollRef.current = setInterval(async () => {
        try {
          const { data } = await api.get('/api/market/leverage/backfill/progress')
          setProgress({ ...data })
          if (!data.running) {
            clearInterval(pollRef.current)
            loadCoverage()
          }
        } catch (e) {
          setErr(e?.response?.data?.detail || '진행 상황을 불러오지 못했습니다.')
          clearInterval(pollRef.current)
          setProgress(p => ({ ...p, running: false }))
        }
      }, 2000)
    } catch (e) {
      setProgress(p => ({ ...p, running: false }))
      setErr(e?.response?.data?.detail || '실행에 실패했습니다.')
    }
  }

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div style={{ maxWidth: 520 }}>
      <div className="s-group-h" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 8 }}>레버리지 데이터 현황</div>
      {coverage ? (
        <div className="list-card" style={{ margin: '0 0 6px' }}>
          <div style={{ padding: '14px 16px' }}>
            <div style={{ display: 'flex', gap: 24, marginBottom: 12, fontSize: 13 }}>
              <div>
                <div style={{ color: 'var(--text-3)', marginBottom: 2 }}>총 행수</div>
                <div style={{ fontWeight: 600 }}>{(coverage.total || 0).toLocaleString()}행</div>
              </div>
              <div>
                <div style={{ color: 'var(--text-3)', marginBottom: 2 }}>수집 범위</div>
                <div style={{ fontWeight: 600 }}>
                  {coverage.min_date ? `${coverage.min_date} ~ ${coverage.max_date}` : '없음'}
                </div>
              </div>
            </div>
            {coverage.by_year?.length > 0 && (
              // eco: list-card 내부라 .tbl-wrap(자체 bg/border)은 생략, 타이포/셀 규격만 .tbl 재사용
              <table className="tbl" style={{ fontSize: 12 }}>
                <thead>
                  <tr>
                    {['연도', '행수', '시작', '종료'].map(h => <th key={h} className={h === '행수' ? 'num' : undefined}>{h}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {coverage.by_year.map(r => (
                    <tr key={r.year}>
                      <td className="ticker-cell">{r.year}</td>
                      <td className="num">{r.count}</td>
                      <td style={{ color: 'var(--text-3)' }}>{r.min}</td>
                      <td style={{ color: 'var(--text-3)' }}>{r.max}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      ) : coverageErr ? (
        <div style={{ color: 'var(--color-error)', fontSize: 13, padding: '8px 0' }}>{coverageErr}</div>
      ) : (
        <div style={{ color: 'var(--text-3)', fontSize: 13, padding: '8px 0' }}>로딩 중...</div>
      )}

      <div className="s-group-h" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 16 }}>백필 실행</div>
      <div className="list-card" style={{ margin: '0 0 6px' }}>
        <div style={{ padding: '14px 16px' }}>
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '0 0 14px', lineHeight: 1.6 }}>
            KOFIA API에서 1년 단위로 데이터를 수집합니다. API 일일 한도 제한으로 연도 범위를 좁게 설정하세요.
          </p>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, fontSize: 13 }}>
            <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>시작</span>
            <select value={startYear} onChange={e => setStartYear(Number(e.target.value))}
              style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--text)', fontSize: 13 }}>
              {YEARS.map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
            <span style={{ color: 'var(--text-3)', flexShrink: 0 }}>종료</span>
            <select value={endYear} onChange={e => setEndYear(Number(e.target.value))}
              style={{ flex: 1, padding: '7px 10px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elev)', color: 'var(--text)', fontSize: 13 }}>
              {YEARS.filter(y => y >= startYear).map(y => <option key={y} value={y}>{y}년</option>)}
            </select>
          </div>
          <button className="btn btn-primary" onClick={runBackfill} disabled={progress.running}
            style={{ width: '100%', justifyContent: 'center' }}>
            {progress.running
              ? `${progress.current || '준비 중...'} (${progress.done}/${progress.total})`
              : `${startYear}~${endYear}년 백필 시작`}
          </button>
          {progress.running && progress.total > 0 && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
                <span>{progress.current || '준비 중...'}</span>
                <span style={{ color: 'var(--text)', fontWeight: 600 }}>{pct}%</span>
              </div>
              <div style={{ background: 'var(--accent-soft)', borderRadius: 999, height: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--text)', borderRadius: 999, transition: 'width 0.4s ease' }} />
              </div>
            </div>
          )}
          {!progress.running && progress.total > 0 && progress.done >= progress.total && (
            <p style={{ marginTop: 8, color: 'var(--color-success)', fontSize: 13 }}>완료: {progress.total}개 연도 처리됨</p>
          )}
          {progress.error && <p style={{ marginTop: 6, color: 'var(--color-error)', fontSize: 12 }}>{progress.error}</p>}
          {err && <p style={{ marginTop: 8, color: 'var(--color-error)', fontSize: 13 }}>{err}</p>}
        </div>
      </div>
    </div>
  )
}
