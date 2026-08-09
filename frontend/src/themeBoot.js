// 첫 페인트 전 테마 부트스트랩(task#286 S1).
// index.html의 인라인 사본(theme-boot:start~end)과 바이트 동일해야 한다 — 번들 CSS·React가
// 로드되기 전에 <html>에 data-theme을 세워야 다크 사용자가 라이트로 한 번 칠해지는 플래시가
// 없다(useTheme.js:22 lazy init은 번들 실행 이후라 늦다). data-theme 없음(기본)=라이트는
// index.html의 인라인 배경 CSS가 이미 담당하므로 이 스크립트는 dark 분기만 처리한다.
// try/catch로 감싼다 — 사파리 프라이빗 모드 등에서 localStorage 접근이 던지면 부팅 자체가 죽는다.
export const THEME_BOOT_JS = "try{if(localStorage.getItem('theme')==='dark'){document.documentElement.setAttribute('data-theme','dark');var m=document.querySelector('meta[name=theme-color]');if(m){m.setAttribute('content','#171310')}}}catch(e){}"
