import Market from './Market'
import useIsMobile from '../hooks/useIsMobile'

export default function MarketHub() {
  const isMobile = useIsMobile()

  if (isMobile) return (
    <>
      <header className="appbar">
        <h1>시장</h1>
      </header>
      <div className="m-page">
        <Market />
      </div>
    </>
  )

  return (
    <div className="page">
      <div className="page-head">
        <h1 className="page-title">시장</h1>
      </div>
      <Market />
    </div>
  )
}
