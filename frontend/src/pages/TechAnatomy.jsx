import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import api from '../api'
import Skeleton from '../components/ui/Skeleton'
import { TECH_NAMES } from '../components/reports/techReportUtils'
import { deriveAxes, joinLeaders, formatShare } from '../components/tech/techAnatomyUtils'
import './TechAnatomy.css'

// 기술 해부 (ADR-0042, task#306) — [[주요기술 리포트]]와 같은 기술 slug를 대상으로 하는
// **두 번째 시선**이다. 그쪽이 「지금 누가 어디까지 왔나」(지형)라면 이건 「이 기술 하나를
// 완성하려면 무엇이 얼마나 필요한가」(구조)다.
//
// 데이터는 발행 페이로드의 선택 필드 `composition` 하나에서 온다(전용 엔드포인트 없음 —
// 기술 축이 같은 페이로드의 `players[]`를 참조하므로 둘이 한 요청 본문에 있어야 발행 시점에
// 실재를 검증할 수 있다, ADR-0042 결정 1).
//
// ⚠️ 세 축은 **분모가 서로 다르다.** 합쳐서 하나로 읽으면 안 되고, 그래서 축마다 별도 막대이고
// 「기준」 문구가 **상시 노출**된다(접기·툴팁 아님). 세 축을 합친 요약 지표는 원리적으로 없다.
//
// ⚠️ 이 페이지는 「해부 없음」을 **섹션째 무음 생략하지 않는다.** 해부가 본문이라 생략하면
// 페이지 전체가 사라져 목록의 링크가 「고장난 링크」로 읽힌다 — `key_points`류의 무음 생략
// 관례와 갈리는 지점이니 그대로 베끼지 말 것(S4).

function LeaderChips({ chips }) {
  if (!chips || chips.length === 0) return null
  return (
    <div className="tech-anatomy__chips" data-testid="anatomy-leader-chips">
      {chips.map((c) => (
        <span key={c.name} className="tech-anatomy__chip" data-testid="anatomy-leader-chip">
          {c.name}
          {Number.isFinite(c.tech_level) && (
            <span className="tech-anatomy__chip-lv" data-testid="anatomy-leader-level">{c.tech_level}단계</span>
          )}
        </span>
      ))}
    </div>
  )
}

function ProducerChips({ producers }) {
  if (!producers || producers.length === 0) return null
  return (
    <div className="tech-anatomy__chips" data-testid="anatomy-producer-chips">
      {producers.map((p) => (
        <span key={p.name} className="tech-anatomy__chip" data-testid="anatomy-producer-chip">
          {p.name}{p.country ? `(${p.country})` : ''}
          {Number.isFinite(p.share_pct) && (
            <span className="tech-anatomy__chip-lv">{formatShare(p.share_pct)}</span>
          )}
        </span>
      ))}
    </div>
  )
}

function MineralMeta({ item }) {
  const parts = []
  if (item.top_source_country) {
    parts.push(`주요 산지 ${item.top_source_country}${Number.isFinite(item.top_source_pct) ? ` ${formatShare(item.top_source_pct)}` : ''}`)
  }
  if (Array.isArray(item.used_in) && item.used_in.length > 0) parts.push(`쓰임 → ${item.used_in.join(' · ')}`)
  if (parts.length === 0) return null
  return <div className="tech-anatomy__meta" data-testid="anatomy-mineral-meta">{parts.join(' · ')}</div>
}

function Axis({ axis, players, mineralsBasis }) {
  // 기술 축만 players[]와 이름으로 조인한다(다른 두 축은 참조가 없다).
  const items = axis.key === 'tech' ? joinLeaders(axis.items, players) : axis.items
  // 막대의 aria-label — role="img"는 ARIA leaf라 자손이 접근성 트리에서 프루닝되지만,
  // 같은 값이 바로 아래 목록에 **텍스트로 전부** 있으므로 정보 손실이 없다(task#281 ⑭와 대비되는
  // 안전한 사용례: 거기선 SVG 텍스트가 화면 어디에도 중복되지 않아 정보가 통째로 사라졌다).
  const label = `${axis.title} 지분(${axis.basis}) — ` + items.map((i) => `${i.name} ${formatShare(i.share_pct)}`).join(', ')
  return (
    <section className="tech-anatomy__axis" data-testid="anatomy-axis" data-axis={axis.key}>
      <h2 className="tech-anatomy__axis-title" data-testid="anatomy-axis-title">{axis.title}</h2>
      <p className="tech-anatomy__basis" data-testid="anatomy-basis">{axis.basis}</p>

      <div className="tech-anatomy__bar" role="img" aria-label={label} data-testid="anatomy-bar">
        {items.map((it, idx) => (
          // 조각 안에 텍스트 없음 — 라벨은 전부 아래 목록에 있다(CSS 헤더 주석 참조).
          <span
            key={`${it.name}-${idx}`}
            className="tech-anatomy__seg"
            data-testid="anatomy-seg"
            style={{ flex: `0 0 ${it.share_pct}%`, background: it.color }}
          />
        ))}
      </div>

      <ul className="tech-anatomy__items">
        {items.map((it, idx) => (
          <li key={`${it.name}-${idx}`} className="tech-anatomy__item" data-testid="anatomy-item">
            <div className="tech-anatomy__head">
              <span className="tech-anatomy__swatch" style={{ background: it.color }} aria-hidden="true" />
              <span className="tech-anatomy__name" data-testid="anatomy-item-name">{it.name}</span>
              <span className="tech-anatomy__pct" data-testid="anatomy-item-pct">{formatShare(it.share_pct)}</span>
            </div>
            {it.rationale && <p className="tech-anatomy__rationale" data-testid="anatomy-rationale">{it.rationale}</p>}
            {axis.key === 'minerals' && <MineralMeta item={it} />}
            {axis.key === 'tech' && <LeaderChips chips={it.leaderChips} />}
            {axis.key === 'minerals' && <ProducerChips producers={it.producers} />}
          </li>
        ))}
      </ul>

      {/* 광물 점유의 기준 문구 — 어느 채굴사든 점유율을 실으면 발행이 이걸 요구한다.
          `market.share_basis`(그 기술 *시장*의 점유)와 자가 다르므로 따로 표기한다. */}
      {axis.key === 'minerals' && mineralsBasis && (
        <p className="tech-anatomy__basis" data-testid="anatomy-minerals-basis">채굴·정제 점유율: {mineralsBasis}</p>
      )}
    </section>
  )
}

export default function TechAnatomy() {
  const { slug } = useParams()
  const [report, setReport] = useState(undefined)  // undefined=로딩, null=발행물 없음, object=있음
  const [error, setError] = useState(null)          // 실패는 빈 상태와 구별(에러 정직성)

  useEffect(() => {
    let ignore = false
    setReport(undefined)
    setError(null)
    api.get(`/api/tech-reports/${slug}`)
      .then(({ data }) => { if (!ignore) setReport((data.reports || [])[0] ?? null) })
      .catch((e) => {
        if (ignore) return
        console.error('[TechAnatomy] 리포트 조회 실패:', e)
        setError(e.response?.status === 422 ? '존재하지 않는 기술입니다.' : '리포트를 불러오지 못했습니다.')
      })
    return () => { ignore = true }
  }, [slug])

  const name = TECH_NAMES[slug] || slug

  if (error) return (
    <div className="tech-anatomy" style={{ padding: '48px 16px', textAlign: 'center', color: 'var(--text-3)' }}>
      <p>{error}</p>
      <Link to="/tech-reports" style={{ color: 'var(--accent)' }}>← 주요기술 리포트로 돌아가기</Link>
    </div>
  )

  if (report === undefined) return <div className="tech-anatomy" style={{ padding: '24px 16px' }}><Skeleton variant="row" count={6} /></div>

  const axes = deriveAxes(report?.composition)

  return (
    <div className="tech-anatomy" data-testid="tech-anatomy">
      <p className="tech-anatomy__nav">
        <Link to={`/tech-report/${slug}`} data-testid="anatomy-to-report">← {name} 리포트</Link>
      </p>
      <h1 style={{ fontFamily: 'var(--font-serif)', color: 'var(--text)', fontSize: 18, margin: '0 0 4px' }}>
        {name} 해부
      </h1>
      <p style={{ color: 'var(--text-3)', fontSize: 'var(--font-size-xs)', margin: '0 0 20px' }}>
        이 기술 하나를 완성하려면 무엇이 얼마나 필요한가 — 축마다 분모가 다르니 합쳐 읽지 마세요.
      </p>

      {axes.length === 0 ? (
        // S4 빈 상태 — 백지가 아니라 안내. 무엇이 없는지 + 리포트로 가는 길을 명시한다.
        <div data-testid="anatomy-empty" style={{ padding: '32px 0', color: 'var(--text-3)', fontSize: 'var(--font-size-sm)' }}>
          <p style={{ margin: '0 0 6px', color: 'var(--text)', fontWeight: 600 }}>아직 해부되지 않았습니다.</p>
          <p style={{ margin: '0 0 12px' }}>
            {report === null
              ? `${name}은(는) 아직 발행된 리포트가 없습니다.`
              : `${name} 리포트는 있지만 필요 기술·핵심 광물·전문가 지분이 아직 기입되지 않았습니다. 자동 수집 소스가 없어 전량 조사·기입이라 시간이 걸립니다.`}
          </p>
          <Link to={`/tech-report/${slug}`} style={{ color: 'var(--accent)' }}>{name} 리포트 보기 →</Link>
        </div>
      ) : (
        axes.map((axis) => (
          <Axis key={axis.key} axis={axis} players={report.players || []} mineralsBasis={report.composition?.minerals_share_basis} />
        ))
      )}
    </div>
  )
}
