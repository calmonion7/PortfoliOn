import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import StockModal from '../components/StockModal'
import PromoteModal from '../components/PromoteModal'

const TAB_STYLE = (active) => ({
  padding: '8px 20px',
  cursor: 'pointer',
  border: 'none',
  borderBottom: active ? '2px solid #4fc3f7' : '2px solid transparent',
  background: 'transparent',
  color: active ? '#4fc3f7' : '#888',
  fontWeight: active ? 600 : 400,
  fontSize: 15,
})

export default function Portfolio() {
  const [activeTab, setActiveTab] = useState('holdings')
  const [stocks, setStocks] = useState([])
  const [watchlist, setWatchlist] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [promoteTarget, setPromoteTarget] = useState(null)
  const [error, setError] = useState('')

  const fetchAll = useCallback(async () => {
    const [portfolioRes, watchlistRes] = await Promise.all([
      axios.get('/api/portfolio'),
      axios.get('/api/watchlist'),
    ])
    setStocks(portfolioRes.data.stocks || [])
    setWatchlist(watchlistRes.data || [])
  }, [])

  useEffect(() => { fetchAll() }, [fetchAll])

  const handleSave = async (stockData) => {
    try {
      if (activeTab === 'holdings') {
        if (editing) {
          await axios.put(`/api/portfolio/${editing.ticker}`, stockData)
        } else {
          await axios.post('/api/portfolio', stockData)
        }
      } else {
        if (editing) {
          await axios.put(`/api/watchlist/${editing.ticker}`, stockData)
        } else {
          await axios.post('/api/watchlist', stockData)
        }
      }
      setModalOpen(false)
      setEditing(null)
      setError('')
      fetchAll()
    } catch (err) {
      setError(err.response?.data?.detail || '저장 실패')
    }
  }

  const handleDelete = async (ticker) => {
    if (!window.confirm(`${ticker}를 삭제하시겠습니까?`)) return
    try {
      if (activeTab === 'holdings') {
        await axios.delete(`/api/portfolio/${ticker}`)
      } else {
        await axios.delete(`/api/watchlist/${ticker}`)
      }
      setError('')
      fetchAll()
    } catch (err) {
      setError(err.response?.data?.detail || '삭제 실패')
    }
  }

  const handlePromote = async ({ quantity, avg_cost }) => {
    try {
      await axios.post(`/api/watchlist/${promoteTarget}/promote`, { quantity, avg_cost })
      setPromoteTarget(null)
      setActiveTab('holdings')
      fetchAll()
    } catch (err) {
      setError(err.response?.data?.detail || '전환 실패')
      setPromoteTarget(null)
    }
  }

  const openEdit = (stock) => { setEditing(stock); setModalOpen(true) }
  const openAdd = () => { setEditing(null); setModalOpen(true) }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
        <h1 style={{ color: '#90caf9' }}>내 포트폴리오</h1>
        <button className="btn-primary" onClick={openAdd}>+ 종목 추가</button>
      </div>

      {/* 탭 */}
      <div style={{ display: 'flex', borderBottom: '1px solid #333', marginBottom: 16 }}>
        <button style={TAB_STYLE(activeTab === 'holdings')} onClick={() => setActiveTab('holdings')}>
          보유종목 ({stocks.length})
        </button>
        <button style={TAB_STYLE(activeTab === 'watchlist')} onClick={() => setActiveTab('watchlist')}>
          관심종목 ({watchlist.length})
        </button>
      </div>

      {error && <p style={{ color: '#ef5350', marginBottom: 8 }}>{error}</p>}

      {/* 보유종목 탭 */}
      {activeTab === 'holdings' && (
        <table>
          <thead>
            <tr>
              <th>티커</th><th>회사명</th><th>수량</th><th>평단가</th><th>경쟁사</th><th>관리</th>
            </tr>
          </thead>
          <tbody>
            {stocks.map(stock => (
              <tr key={stock.ticker}>
                <td><strong>{stock.ticker}</strong></td>
                <td>{stock.name}</td>
                <td>{stock.quantity}</td>
                <td>${stock.avg_cost?.toFixed(2)}</td>
                <td style={{ fontSize: 12, color: '#aaa' }}>{stock.competitors?.join(', ') || '-'}</td>
                <td>
                  <button className="btn-secondary" style={{ marginRight: 6 }} onClick={() => openEdit(stock)}>수정</button>
                  <button className="btn-danger" onClick={() => handleDelete(stock.ticker)}>삭제</button>
                </td>
              </tr>
            ))}
            {stocks.length === 0 && (
              <tr><td colSpan={6} style={{ textAlign: 'center', color: '#666', padding: 32 }}>종목을 추가해 주세요</td></tr>
            )}
          </tbody>
        </table>
      )}

      {/* 관심종목 탭 */}
      {activeTab === 'watchlist' && (
        <table>
          <thead>
            <tr>
              <th>티커</th><th>회사명</th><th>경쟁사</th><th>관리</th>
            </tr>
          </thead>
          <tbody>
            {watchlist.map(stock => (
              <tr key={stock.ticker}>
                <td><strong>{stock.ticker}</strong></td>
                <td>{stock.name}</td>
                <td style={{ fontSize: 12, color: '#aaa' }}>{stock.competitors?.join(', ') || '-'}</td>
                <td>
                  <button className="btn-secondary" style={{ marginRight: 6 }} onClick={() => openEdit(stock)}>수정</button>
                  <button
                    className="btn-primary"
                    style={{ marginRight: 6, background: '#2e7d32' }}
                    onClick={() => setPromoteTarget(stock.ticker)}
                  >
                    보유로 전환
                  </button>
                  <button className="btn-danger" onClick={() => handleDelete(stock.ticker)}>삭제</button>
                </td>
              </tr>
            ))}
            {watchlist.length === 0 && (
              <tr><td colSpan={4} style={{ textAlign: 'center', color: '#666', padding: 32 }}>관심종목을 추가해 주세요</td></tr>
            )}
          </tbody>
        </table>
      )}

      {modalOpen && (
        <StockModal
          stock={editing}
          mode={activeTab === 'watchlist' ? 'watchlist' : 'holding'}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditing(null) }}
        />
      )}

      {promoteTarget && (
        <PromoteModal
          ticker={promoteTarget}
          onConfirm={handlePromote}
          onClose={() => setPromoteTarget(null)}
        />
      )}
    </div>
  )
}
