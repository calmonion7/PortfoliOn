import { useState, useEffect } from 'react'
import api from '../../api'
import SupplyBadge from '../ui/SupplyBadge'
import Badge from '../ui/Badge'
import { SectionTitle } from './reportUtils.jsx'

// 수급 종합 스코어 헤더 (밴드 + 근거 플래그 칩). KR 전용 — 기술·수급 탭 상단에서
// InvestorTrendSection/ShortSellSection 위에 렌더. SupplyBadge가 band 표시 매핑을 단독 소유(중복 금지).
// GET /api/stocks/{ticker}/supply-score는 미산출(US·결측)이면 null → 헤더 자체를 숨김.
export default function SupplySection({ ticker }) {
  const [score, setScore] = useState(undefined)  // undefined=로딩, null=미산출
  useEffect(() => {
    let cancelled = false
    setScore(undefined)
    api.get(`/api/stocks/${ticker}/supply-score`)
      .then(({ data }) => { if (!cancelled) setScore(data) })
      .catch(() => { if (!cancelled) setScore(null) })
    return () => { cancelled = true }
  }, [ticker])

  // 로딩 중이거나 미산출(null)이면 헤더 숨김 (기존 섹션 빈상태 관습 따름).
  if (!score) return null

  return (
    <SectionTitle right={<>
      <SupplyBadge band={score.band} />
      {(score.flags || []).map((flag, i) => (
        <Badge key={i} variant="neutral">{flag}</Badge>
      ))}
    </>}>수급 종합</SectionTitle>
  )
}
