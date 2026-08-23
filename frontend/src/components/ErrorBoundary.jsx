import { Component } from 'react'
import Card from './ui/Card'
import Button from './ui/Button'
import { logDiag } from '../utils/diag'

// B48 — 렌더 트리 어디든 예외 1건이 앱 전체를 백지로 만드는 것을 막는 최소 경계.
// ⚠️ 한계: 렌더·라이프사이클 throw만 잡는다(React 공식 한계) — 이벤트 핸들러 내부의 throw,
// Promise 거부, setTimeout 콜백의 throw는 여기 걸리지 않는다. 그 경로는 각자 try/catch·
// .catch()가 필요하다 — "경계가 있으니 다 잡힌다"로 읽지 말 것. 자동 새로고침도 하지 않는다
// (렌더 throw가 재발하면 throw→reload→throw 무한 루프가 된다) — 복구는 이 폴백의 버튼뿐이다.
// props: children — 감쌀 트리.
export default class ErrorBoundary extends Component {
  state = { error: null }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error) {
    console.error('[ErrorBoundary] 렌더 오류:', error)
    // 스택은 싣지 않는다 — diag 링버퍼 50건 상한을 한 항목이 잡아먹지 않게(utils/diag.js MAX=50).
    logDiag('render-error', { name: error?.name, msg: error?.message })
  }

  handleRetry = () => this.setState({ error: null })

  render() {
    if (this.state.error) {
      return (
        <Card padding="lg" role="alert" style={{ textAlign: 'center' }}>
          <p style={{ margin: '0 0 12px', color: 'var(--text-3)' }}>
            화면을 표시하는 중 문제가 발생했습니다.
          </p>
          <Button variant="secondary" size="sm" onClick={this.handleRetry}>다시 시도</Button>
        </Card>
      )
    }
    return this.props.children
  }
}
