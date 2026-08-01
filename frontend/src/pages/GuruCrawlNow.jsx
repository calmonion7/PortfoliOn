import { useState, useEffect, useRef } from 'react'
import api from '../api'
import { useAuth } from '../contexts/AuthContext'

export default function GuruCrawlNow() {
  const { role } = useAuth() || { role: 'user' }
  const [crawling, setCrawling]   = useState(false)
  const [crawlMsg, setCrawlMsg]   = useState('')
  const [crawlOk, setCrawlOk]     = useState(true)
  const [progress, setProgress]   = useState({ done: 0, total: 0, current: '' })
  const [lastUpdated, setLastUpdated] = useState(null)
  const pollRef = useRef(null)

  useEffect(() => {
    api.get('/api/guru/managers').then(({ data }) => setLastUpdated(data.last_updated))
  }, [])

  const startPolling = () => {
    pollRef.current = setInterval(async () => {
      try {
        const { data } = await api.get('/api/guru/crawl/progress')
        setProgress({ done: data.done, total: data.total, current: data.current })
        // 종료 판정은 done>=total이 아니라 result다 — 크롤이 초반에 죽으면 total이 0이거나
        // done<total이라 옛 조건은 영영 발화하지 않고 스피너만 돈다(경고를 볼 방법이 없다).
        if (!data.running && data.result) {
          clearInterval(pollRef.current)
          setCrawling(false)
          // 초록은 'saved'(전원 갱신)에만. 'partial'은 데이터 절반이 직전값이므로 경고색이다.
          setCrawlOk(data.result === 'saved')
          setCrawlMsg(
            // ⚠️ done이 아니라 fresh다 — done은 루프 종료 시 on_progress(total,total,"")가 세팅한
            // **시도 총계**라, 40명만 저장돼도 "83명 수집됨"을 초록으로 단언했다(BH7-H1).
            // fresh 부재는 배포 창(nginx가 dist를 즉시 서빙 → 폴러 재배포 전 옛 백엔드)에서만
            // 생긴다. 그때 done으로 폴백하면 바로 그 틀린 숫자가 되살아나니, 숫자를 뺀다.
            data.result === 'saved'  ? (data.fresh != null ? `완료: ${data.fresh}명 갱신됨` : '완료: 매니저 데이터 갱신됨')
            : data.result === 'partial' ? `부분 완료: ${data.fresh}명 갱신 · ${data.stale}명 직전값 유지`
            : data.result === 'skipped' ? '수집 실패 — 직전 데이터 유지'
            : '크롤링 중단 — 직전 데이터 유지'
          )
          api.get('/api/guru/managers').then(({ data }) => setLastUpdated(data.last_updated))
        }
      } catch {}
    }, 2000)
  }

  const handleCrawlNow = async () => {
    setCrawling(true)
    setCrawlMsg('')
    setCrawlOk(true)
    setProgress({ done: 0, total: 0, current: '' })
    try {
      await api.post('/api/guru/crawl')
      startPolling()
    } catch (err) {
      setCrawlOk(false)
      setCrawlMsg(err.response?.data?.detail || '크롤링 실패')
      setCrawling(false)
    }
  }

  useEffect(() => () => clearInterval(pollRef.current), [])

  const pct = progress.total > 0 ? Math.round(progress.done / progress.total * 100) : 0

  return (
    <div style={{ maxWidth: 480 }}>
      <div className="s-group-h" style={{ paddingLeft: 0, paddingRight: 0, paddingTop: 8 }}>즉시 크롤링</div>
      <div className="list-card" style={{ margin: '0 0 6px' }}>
        <div style={{ padding: '14px 16px' }}>
          <p style={{ color: 'var(--text-3)', fontSize: 13, margin: '0 0 4px', lineHeight: 1.6 }}>
            dataroma 전체 매니저 데이터를 지금 수집합니다. 수 분 소요됩니다.
          </p>
          {lastUpdated && (
            <p style={{ color: 'var(--text-faint)', fontSize: 12, margin: '0 0 14px', lineHeight: 1.5 }}>
              마지막 갱신: {lastUpdated}
            </p>
          )}
          {role === 'admin' && (
            <button className="btn btn-primary" onClick={handleCrawlNow} disabled={crawling}
              style={{ width: '100%', justifyContent: 'center', marginTop: lastUpdated ? 0 : 14 }}>
              {crawling ? '수집 중...' : '지금 갱신'}
            </button>
          )}
          {crawling && (
            <div style={{ marginTop: 14 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--text-3)', marginBottom: 8 }}>
                <span>{progress.current ? `수집 중: ${progress.current}` : '준비 중...'}</span>
                <span className="mono tnum" style={{ color: 'var(--text)', fontWeight: 600 }}>
                  {progress.done} / {progress.total || '?'}
                </span>
              </div>
              <div style={{ background: 'var(--accent-soft)', borderRadius: 999, height: 4, overflow: 'hidden' }}>
                <div style={{ width: `${pct}%`, height: '100%', background: 'var(--text)', borderRadius: 999, transition: 'width 0.4s ease' }} />
              </div>
            </div>
          )}
          {crawlMsg && (
            <p data-testid="crawl-msg"
              style={{ marginTop: 8, color: crawlOk ? 'var(--color-success)' : 'var(--warn)', fontSize: 13 }}>
              {crawlMsg}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
