import './TechLevelBand.css'
import { TECH_LEVEL_LABELS } from '../reports/techReportUtils'

const LEVELS = [1, 2, 3, 4, 5]

// 선도기술 리포트 상세(task#277 S3) — 업체 × 5단계 기술수준 가로 밴드. div 기반(recharts 아님).
// props: players: [{ name, tech_level: 1~5|null, gap_years: int|null, leader_name: str|null }]
// 선두 판정은 CLAUDE_COWORK_API.md의 gap_years 정의("0=선두 자신")를 정본으로 쓴다 —
// leader_name은 리더 본인 행에서는 CEO 등 인명으로 채워지는 실사례가 있어(TechReport.jsx 픽스처
// 'Elon Musk') 이름 일치만으로는 리더를 못 잡는다. leader_name===name 일치는 보조 신호로만 둔다.
// ⚠️ 채움색 위에 텍스트를 얹지 않는다(밴드 밖에 둔다) — 다크테마 대비가 무너지는 함정을 원천 회피
// (task#275 적대 리뷰: #fff 하드코딩이 라이트 5.9:1→다크 2.23:1로 붕괴, 라이트만 보면 안 잡힘).
export default function TechLevelBand({ players = [] }) {
  return (
    <div className="tech-level-band" data-testid="tech-level-band">
      <div className="tech-level-band__legend" aria-hidden="true">
        {LEVELS.map((lv) => (
          <span key={lv} className="tech-level-band__legend-item">{lv} {TECH_LEVEL_LABELS[lv]}</span>
        ))}
      </div>
      {players.map((p, i) => {
        const level = typeof p.tech_level === 'number' ? p.tech_level : null
        const isLeader = level != null && (p.gap_years === 0 || p.leader_name === p.name)
        return (
          <div className="tech-level-band__row" key={p.name ?? i} data-testid="tech-level-band-row">
            <span className="tech-level-band__name">{p.name}</span>
            {level == null ? (
              <span className="tech-level-band__empty">—</span>
            ) : (
              <>
                <div
                  className="tech-level-band__cells"
                  role="img"
                  aria-label={`${p.name} 기술수준 ${level}단계 (${TECH_LEVEL_LABELS[level]})`}
                >
                  {LEVELS.map((lv) => (
                    <span
                      key={lv}
                      className={`tech-level-band__cell${lv <= level ? ' tech-level-band__cell--filled' : ''}`}
                    />
                  ))}
                </div>
                <span className="tech-level-band__meta">
                  {isLeader
                    ? <span className="tech-level-band__leader">현재 선두</span>
                    : p.gap_years != null && p.gap_years > 0
                      ? <span className="tech-level-band__gap">선두 대비 {p.gap_years}년</span>
                      : null}
                </span>
              </>
            )}
          </div>
        )
      })}
    </div>
  )
}
