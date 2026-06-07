// PWA 설치 유도 배너용 감지·억제 유틸 (모바일 전용)

const SUPPRESS_KEY = 'pwa-install-dismissed-at'
const SUPPRESS_MS = 14 * 24 * 60 * 60 * 1000 // 닫으면 14일간 재노출 안 함

// 이미 설치되어 standalone(홈화면 앱)으로 실행 중인가
export function isStandalone() {
  return (
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.navigator.standalone === true
  )
}

export function isIOS() {
  const ua = window.navigator.userAgent || ''
  const iOSDevice = /iPad|iPhone|iPod/.test(ua)
  // iPadOS 13+ 는 Mac으로 위장 → 터치 지원으로 판별
  const iPadOS = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1
  return iOSDevice || iPadOS
}

export function isAndroid() {
  return /Android/i.test(window.navigator.userAgent || '')
}

// iOS 인앱 브라우저(카카오톡·인스타 등)는 '홈 화면에 추가'가 불가 → Safari 안내 필요
export function isIOSInAppBrowser() {
  if (!isIOS()) return false
  const ua = window.navigator.userAgent || ''
  return /KAKAOTALK|Instagram|FBAN|FBAV|FB_IAB|Line\/|NAVER|DaumApps|Snapchat|Twitter/i.test(ua)
}

export function isInstallSuppressed() {
  try {
    const at = Number(localStorage.getItem(SUPPRESS_KEY))
    if (!at) return false
    return Date.now() - at < SUPPRESS_MS
  } catch {
    return false
  }
}

export function suppressInstall() {
  try {
    localStorage.setItem(SUPPRESS_KEY, String(Date.now()))
  } catch {
    /* localStorage 불가 시 무시 */
  }
}
