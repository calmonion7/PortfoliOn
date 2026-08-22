import { Link } from 'react-router-dom'
import { fmtPrice as fmt } from '../../utils'
import useTechIndex, { techsForTicker } from '../../hooks/useTechIndex'
import { MarketBadge, ChangeBadge } from '../ui/Badge'
import { SketchCircleMark } from '../sketches'
import './ReportDetail.css'

// 섹터·PER·PBR·PSR·EV/EBITDA 메타 칩 — 4곳이 byte-identical 스타일을 반복하던 것을 로컬 헬퍼로 정리(같은 파일 내, 신규 모듈 아님).
const MetaChip = ({ children }) => (
  <span className="mono tnum" style={{ color: 'var(--text-3)', fontSize: 11, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3 }}>{children}</span>
)

export default function ReportDetailHeader({
  detail, selected, setSelected, setView, isAdmin, generating, genProgress, generateOne, guruMap, reportList,
  publications = [], // 애널리스트 리포트 발행물(task#212) — 없으면 링크 숨김
}) {
  // 이 종목이 등장하는 기술 리포트(ADR-0043) — 6종뿐이라 상한이 필요 없다.
  // ⚠️ 주석 정정 — 훅은 조회 실패를 **빈 배열로 붕괴시키지 않는다**(task#307에서 `null` +
  //    `failed`로 갈랐다). 여기서 `failed`를 쓰지 않는 것은 **의도**다: 실패하면 `techIndex`가
  //    `[]`가 돼 칩만 사라지고, 이 화면은 「기술 없음」류 *문구*를 렌더하지 않으므로
  //    거짓 진술이 생기지 않는다(칩 부재는 행동을 권하지 않는다). 「없음」 문구나 액션을
  //    추가하는 순간 `failed`를 받아 그것을 가려야 한다 — ExposureTab이 그 사례다(B76).
  const { techIndex } = useTechIndex()
  const techs = techsForTicker(techIndex, selected.ticker)
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
        {/* 기술 리포트 역방향 연결 — 등장 0이면 칩 영역 자체를 렌더하지 않는다(빈 배지 잔존 0) */}
        {techs.map(t => (
          <Link
            key={t.slug}
            to={`/tech-report/${t.slug}`}
            data-testid="header-tech-chip"
            data-slug={t.slug}
            style={{ color: 'var(--accent)', fontSize: 11, marginLeft: 6, background: 'var(--bg-elev-2)', padding: '2px 7px', borderRadius: 3, textDecoration: 'none', border: '1px solid var(--border)', whiteSpace: 'nowrap' }}
          >
            {t.name} →
          </Link>
        ))}
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
