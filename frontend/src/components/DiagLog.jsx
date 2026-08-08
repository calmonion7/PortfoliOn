import { useState } from 'react'
import { readDiag, clearDiag } from '../utils/diag'

// task#284 진단 로그 뷰어 — 콜드스타트 첫 구글 로그인 잔상 진단용.
// 복사가 핵심 기능이다(사용자가 폰에서 로그를 채취해 붙여넣는 것이 이 작업의 산출물).
function legacyCopy(text) {
  const ta = document.createElement('textarea')
  ta.value = text
  document.body.appendChild(ta)
  ta.select()
  try {
    document.execCommand('copy')
  } finally {
    document.body.removeChild(ta)
  }
}

// 부재뿐 아니라 **거절**도 폴백시킨다 — 안드로이드 PWA에서 writeText()가 권한·
// permissions-policy로 reject되면 폴백이 없을 때 사용자는 피드백도 대체 동작도 못 받는다.
function copyText(text) {
  if (navigator.clipboard?.writeText) {
    return navigator.clipboard.writeText(text).catch(() => legacyCopy(text))
  }
  return Promise.resolve(legacyCopy(text))
}

export default function DiagLog() {
  const [log, setLog] = useState(() => readDiag())
  const [copied, setCopied] = useState(false)
  const text = JSON.stringify(log, null, 2)

  const handleCopy = () => {
    copyText(text)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  const handleClear = () => {
    clearDiag()
    setLog([])
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={handleCopy}>
          {copied ? '복사됨' : '로그 복사'}
        </button>
        <button className="btn" onClick={handleClear}>지우기</button>
      </div>
      <pre
        data-testid="diag-log-pre"
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          fontSize: 12,
          color: 'var(--text)',
          background: 'var(--bg-elev)',
          border: '1px solid var(--border)',
          borderRadius: 8,
          padding: 12,
          maxHeight: '70vh',
          overflow: 'auto',
        }}
      >
        {text}
      </pre>
    </div>
  )
}
