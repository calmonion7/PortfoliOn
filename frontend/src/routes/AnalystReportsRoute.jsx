import { Navigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'
import AnalystReports from '../pages/AnalystReports'

// `/analyst-reports`는 사용자 대면 목록이 아니라 **admin 발행 관리 화면**으로 성격이 바뀌었다
// (task#324, ADR-0047 — 종목 축은 리포트 상세 탭으로 합쳤고 목록엔 관리 정체성만 남겼다).
// 비-admin은 종목 리포트로 보낸다. 관리 수단 3종(대상 지정·즉시 발행·종목 단위 삭제)은 그 화면에
// 그대로 있어야 한다 — 리다이렉트로 잃으면 ADR-0027 ②가 무력화된다.
// App.jsx가 아니라 독립 파일인 이유: 이 게이트를 단독으로 렌더해 「admin은 튕기지 않는다」 대조군을
// 재려면 App 전체를 임포트하지 않고 마운트할 수 있어야 한다.
export default function AnalystReportsRoute() {
  const { role, loading } = useAuth() || {}
  if (loading) return null                      // 권한 확정 전 리다이렉트하면 admin도 튕긴다
  return role === 'admin' ? <AnalystReports /> : <Navigate to="/reports" replace />
}
