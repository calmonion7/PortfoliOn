import { useEffect, useState } from 'react'
import {
  isStandalone, isIOS, isAndroid, isIOSInAppBrowser,
  isInstallSuppressed, suppressInstall,
} from '../utils/pwa'

function CloseIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 20 20" fill="none">
      <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

// iOS 공유 버튼 글리프 (사각형 + 위쪽 화살표)
function ShareIcon() {
  return (
    <svg aria-hidden="true" className="install-prompt-share" width="16" height="16" viewBox="0 0 20 20" fill="none">
      <path d="M10 2.5v9M10 2.5L7 5.5M10 2.5l3 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M5.5 8.5H4.5v8h11v-8h-1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export default function InstallPrompt() {
  const [deferred, setDeferred] = useState(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (isStandalone() || isInstallSuppressed()) return

    // iOS: beforeinstallprompt 미지원 → 감지 즉시 안내 노출
    if (isIOS()) {
      setVisible(true)
      return
    }

    // Android: beforeinstallprompt 캡처 시에만 노출 (데스크톱은 미노출)
    if (!isAndroid()) return

    const onBeforeInstall = (e) => {
      e.preventDefault()
      setDeferred(e)
      setVisible(true)
    }
    const onInstalled = () => {
      suppressInstall()
      setVisible(false)
    }
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  if (!visible) return null

  const close = () => {
    suppressInstall()
    setVisible(false)
  }

  const install = async () => {
    if (!deferred) return
    deferred.prompt()
    await deferred.userChoice
    suppressInstall()
    setVisible(false)
  }

  const inApp = isIOSInAppBrowser()
  const ios = isIOS()

  return (
    <div className="install-prompt mobile-only" role="dialog" aria-label="앱 설치 안내">
      <button className="install-prompt-close" onClick={close} aria-label="닫기"><CloseIcon /></button>
      <div className="install-prompt-icon" aria-hidden="true">
        <img src="/favicon.svg" alt="" width="24" height="24" />
      </div>
      <div className="install-prompt-body">
        {inApp ? (
          <>
            <p className="install-prompt-title">PortfoliOn 앱으로 설치</p>
            <p className="install-prompt-desc">
              지금 브라우저에선 설치가 안 됩니다. 우측 상단 메뉴에서 <b>Safari로 열기</b> 후
              공유 → <b>홈 화면에 추가</b>를 선택하세요.
            </p>
          </>
        ) : ios ? (
          <>
            <p className="install-prompt-title">홈 화면에 추가하면 앱처럼 쓸 수 있어요</p>
            <p className="install-prompt-desc">
              하단의 공유 버튼<ShareIcon />을 누르고 <b>‘홈 화면에 추가’</b>를 선택하세요.
            </p>
          </>
        ) : (
          <>
            <p className="install-prompt-title">PortfoliOn을 설치하세요</p>
            <p className="install-prompt-desc">홈 화면에 추가하면 앱처럼 빠르게 열 수 있어요.</p>
            <div className="install-prompt-actions">
              <button className="install-prompt-btn" onClick={install}>설치</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
