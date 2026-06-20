export default function ReportFilters({
  activeTab, setActiveTab, holdingsCount, watchlistCount, ungeneratedCount, isAdmin, othersData,
  watchlistSub, setWatchlistSub, watchlistLowCount, watchlistHighCount, watchlistWarnCount,
  mCountAll, mCountKR, mCountUS, marketFilter, setMarketFilter,
  listLoading, ungeneratedTickers, reportList, generating, genProgress, generateBatch, tabEntries,
}) {
  return (
    <>
      <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: activeTab === 'watchlist' ? 0 : 12 }}>
        <button className={`tab-btn${activeTab === 'holdings' ? ' active' : ''}`} onClick={() => setActiveTab('holdings')}>보유<span className="tab-cnt">{holdingsCount}</span></button>
        <button className={`tab-btn${activeTab === 'watchlist' ? ' active' : ''}`} onClick={() => setActiveTab('watchlist')}>관심<span className="tab-cnt">{watchlistCount}</span></button>
        {ungeneratedCount > 0 && (
          <button className={`tab-btn${activeTab === 'ungenerated' ? ' active' : ''}`} onClick={() => setActiveTab('ungenerated')} style={{ color: activeTab === 'ungenerated' ? 'var(--accent)' : 'var(--warn)' }}>미생성<span className="tab-cnt">{ungeneratedCount}</span></button>
        )}
        {isAdmin && (
          <button className={`tab-btn${activeTab === 'others' ? ' active' : ''}`} onClick={() => setActiveTab('others')}>
            그외{othersData !== null ? <span className="tab-cnt">{Object.keys(othersData).length}</span> : ''}
          </button>
        )}
      </div>
      {activeTab === 'watchlist' && (
        <div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 8, marginTop: 4 }}>
          <button className="tab-btn sm" style={{ color: watchlistSub === 'low' ? 'var(--semantic-buy)' : 'var(--text-3)', borderBottomColor: watchlistSub === 'low' ? 'var(--semantic-buy)' : 'transparent', fontWeight: watchlistSub === 'low' ? 600 : 400 }} onClick={() => setWatchlistSub('low')}>목표≥40%<span className="tab-cnt">{watchlistLowCount}</span></button>
          <button className="tab-btn sm" style={{ color: watchlistSub === 'high' ? 'var(--semantic-sell)' : 'var(--text-3)', borderBottomColor: watchlistSub === 'high' ? 'var(--semantic-sell)' : 'transparent', fontWeight: watchlistSub === 'high' ? 600 : 400 }} onClick={() => setWatchlistSub('high')}>목표&lt;40%<span className="tab-cnt">{watchlistHighCount}</span></button>
          <button className="tab-btn sm" style={{ color: watchlistSub === 'warn' ? 'var(--warn)' : 'var(--text-3)', borderBottomColor: watchlistSub === 'warn' ? 'var(--warn)' : 'transparent', fontWeight: watchlistSub === 'warn' ? 600 : 400 }} onClick={() => setWatchlistSub('warn')}>⚠ 경고<span className="tab-cnt">{watchlistWarnCount}</span></button>
        </div>
      )}
      <div style={{ display: 'flex', gap: 4, marginBottom: 10, justifyContent: 'flex-start' }}>
        {[['ALL', '전체', mCountAll], ['KR', '🇰🇷 국내', mCountKR], ['US', '🇺🇸 해외', mCountUS]].map(([val, label, cnt]) => (
          <button
            key={val}
            onClick={() => setMarketFilter(val)}
            style={{
              padding: '3px 10px', fontSize: 10,
              background: marketFilter === val ? 'var(--surface-hover)' : 'transparent',
              border: `1px solid ${marketFilter === val ? 'var(--accent)' : 'var(--border)'}`,
              color: marketFilter === val ? 'var(--accent)' : 'var(--text-3)',
              borderRadius: 3, cursor: 'pointer', lineHeight: 1.6, whiteSpace: 'nowrap',
            }}
          >
            {label} <span style={{ fontSize: 9, opacity: 0.8 }}>({cnt})</span>
          </button>
        ))}
      </div>
      {activeTab === 'ungenerated' && !listLoading && ungeneratedCount > 0 && isAdmin && (
        <button
          onClick={() => generateBatch(ungeneratedTickers.filter(t => { const m = reportList[t]?.market; return marketFilter === 'ALL' || m === marketFilter }))}
          disabled={!!generating}
          style={{
            width: '100%', marginBottom: 10, padding: '5px 0', fontSize: 12,
            background: generating === '__batch__' ? 'var(--bg-elev)' : 'var(--accent)',
            color: generating === '__batch__' ? 'var(--accent)' : 'var(--bg)',
            border: '1px solid var(--accent)', borderRadius: 4, cursor: generating ? 'default' : 'pointer',
          }}
        >
          {generating === '__batch__'
            ? `생성 중 ${genProgress.done}/${genProgress.total || '?'}`
            : `모두 생성 (${tabEntries.length}개)`}
        </button>
      )}
    </>
  )
}
