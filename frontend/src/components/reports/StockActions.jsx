import { Pencil } from '../ui/icons'

// 보유/관심 종목 카드의 액션버튼(수정·승격·삭제·전체삭제) 단일 소스 (task#103).
// StockCard(그리드)·TickerListItem(사이드바)에 byte-identical로 중복돼 있던 블록을 통합 —
// 이제 액션버튼 변경은 여기 한 곳만. 가시성은 category가 아니라 is_mine으로 게이트(task#97):
// is_mine===false(타인 종목, 리서치 '그외' 탭)면 전체삭제(/api/admin)만, 본인 종목이면 수정·[승격]·삭제.
// layout: 'card'(그리드 카드 본문 흐름 — 전용 래퍼) | 'list'(사이드바, 이미 flex 행 안 — fragment).
export default function StockActions({
  info, ticker, market, touchStyle,
  openEdit, handleDelete, handleGlobalDelete, setPromoteTarget, handlePinToggle, layout = 'list',
}) {
  if (info.category !== 'holdings' && info.category !== 'watchlist') return null

  const buttons = info.is_mine === false ? (
    <button className="sc-act-btn" style={touchStyle} title="전체 삭제" onClick={e => { e.stopPropagation(); handleGlobalDelete(ticker) }}>×</button>
  ) : (<>
    <button className="sc-act-btn" style={{ ...touchStyle, opacity: info.pinned ? 1 : 0.4 }} title={info.pinned ? '고정 해제' : '고정'} onClick={e => { e.stopPropagation(); handlePinToggle(ticker, !info.pinned) }}>📌</button>
    <button className="sc-act-btn" style={touchStyle} title="수정" onClick={e => { e.stopPropagation(); openEdit(ticker, info.category) }}><Pencil /></button>
    {info.category === 'watchlist' && (
      <button className="sc-act-btn" style={touchStyle} title="보유로 이동" onClick={e => { e.stopPropagation(); setPromoteTarget({ ticker, market: market || 'US' }) }}>↑</button>
    )}
    <button className="sc-act-btn" style={touchStyle} title="삭제" onClick={e => { e.stopPropagation(); handleDelete(ticker, info.category === 'watchlist') }}>×</button>
  </>)

  return layout === 'card'
    ? <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>{buttons}</div>
    : <>{buttons}</>
}
