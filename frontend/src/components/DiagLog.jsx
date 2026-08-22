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
    // B56 — execCommand는 실패를 **예외로 던지지 않고 `false`를 반환**한다. 반환값을 확인하지
    // 않으면 아무것도 복사되지 않은 채 성공으로 보고되고, 화면이 「복사됨」이라는 거짓 진술을
    // 한다. 이 컴포넌트의 산출물이 「폰에서 채취한 로그」이므로 그 거짓 진술은 사용자가 빈
    // 클립보드를 붙여넣게 만든다 — wrong < missing.
    if (!document.execCommand('copy')) throw new Error('execCommand("copy") returned false')
  } finally {
    document.body.removeChild(ta)
  }
}

// 부재뿐 아니라 **거절**도 폴백시킨다 — 안드로이드 PWA에서 writeText()가 권한·
// permissions-policy로 reject되면 폴백이 없을 때 사용자는 피드백도 대체 동작도 못 받는다.
// async라 legacyCopy의 동기 throw도 rejected promise가 된다(호출측 .catch가 받는다).
async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // 거절 — 아래 폴백으로 내려간다.
    }
  }
  legacyCopy(text)
}

export default function DiagLog() {
  const [log, setLog] = useState(() => readDiag())
  // 'idle' | 'copied' | 'failed' — 「복사됨」과 「실패」는 서로 다른 상태다. 하나의 boolean으로
  // 접으면 실패가 성공으로 붕괴한다(B56).
  const [status, setStatus] = useState('idle')
  const text = JSON.stringify(log, null, 2)

  const handleCopy = () => {
    copyText(text)
      .then(() => {
        setStatus('copied')
        setTimeout(() => setStatus('idle'), 1500)
      })
      .catch((e) => {
        // 빈 catch로 삼키면 실패가 화면에 「복사됨」으로 남는다. 실패는 자동 소멸시키지 않고
        // 다음 시도까지 유지한다 — 사용자가 대체 동작(직접 선택)으로 넘어가야 하기 때문이다.
        console.warn('[DiagLog] 로그 복사 실패:', e)
        setStatus('failed')
      })
  }

  const handleClear = () => {
    clearDiag()
    setLog([])
    // 실패 안내는 「아래 로그를 직접 선택해 복사하세요」인데 그 로그를 방금 지웠다 — 가리킬 대상이
    // 없는 안내가 남으면 화면이 거짓 지시를 한다. 3상태 도입 시 이 리셋이 빠져 있었다.
    setStatus('idle')
  }

  const label = status === 'copied' ? '복사됨' : status === 'failed' ? '복사 실패' : '로그 복사'

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button className="btn btn-primary" onClick={handleCopy}>
          {label}
        </button>
        <button className="btn" onClick={handleClear}>지우기</button>
      </div>
      {status === 'failed' && (
        <div
          role="alert"
          data-testid="diag-copy-error"
          style={{ color: 'var(--color-danger)', fontSize: 13, marginBottom: 12 }}
        >
          클립보드 복사가 차단됐습니다. 아래 로그를 직접 선택해 복사하세요.
        </div>
      )}
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
