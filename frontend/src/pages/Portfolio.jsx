import { useState, useEffect, useCallback } from 'react'
import axios from 'axios'
import StockModal from '../components/StockModal'

export default function Portfolio() {
  const [stocks, setStocks] = useState([])
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState('')

  const fetchPortfolio = useCallback(async () => {
    const { data } = await axios.get('/api/portfolio')
    setStocks(data.stocks || [])
  }, [])

  useEffect(() => { fetchPortfolio() }, [fetchPortfolio])

  const handleSave = async (stockData) => {
    try {
      if (editing) {
        await axios.put(`/api/portfolio/${editing.ticker}`, stockData)
      } else {
        await axios.post('/api/portfolio', stockData)
      }
      setModalOpen(false)
      setEditing(null)
      setError('')
      fetchPortfolio()
    } catch (err) {
      setError(err.response?.data?.detail || '저장 실패')
    }
  }

  const handleDelete = async (ticker) => {
    if (!window.confirm(`${ticker}를 삭제하시겠습니까?`)) return
    await axios.delete(`/api/portfolio/${ticker}`)
    fetchPortfolio()
  }

  const openEdit = (stock) => { setEditing(stock); setModalOpen(true) }
  const openAdd = () => { setEditing(null); setModalOpen(true) }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h1 style={{ color: '#90caf9' }}>내 포트폴리오</h1>
        <button className="btn-primary" onClick={openAdd}>+ 종목 추가</button>
      </div>
      {error && <p style={{ color: '#ef5350', marginBottom: 8 }}>{error}</p>}
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
      {modalOpen && (
        <StockModal
          stock={editing}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditing(null) }}
        />
      )}
    </div>
  )
}
