// OAuth 이탈~복귀 구간 스플래시(task#285 S3/S4).
// index.html의 인라인 사본(oauth-splash:start~end)과 바이트 동일해야 한다 — 콜백 문서(/?oauth=)의
// 스플래시와 LoginPage가 떠나기 직전 그리는 스플래시가 픽셀 단위로 같아야 문서가 바뀌는 순간
// 화면에 아무 변화가 없다. CSS는 index.html <head>의 <style> 한 벌뿐이므로(번들 CSS 로드 전에
// 떠야 함) 이 마크업도 그 클래스(.oauth-splash 등)를 그대로 재사용한다 — CSS 중복 0.
export const SPLASH_HTML = '<div class="oauth-splash"><img src="/favicon.svg" class="oauth-splash__mark" alt="" /><div class="oauth-splash__spinner" aria-hidden="true"></div><p class="oauth-splash__text">로그인 중…</p></div>'
