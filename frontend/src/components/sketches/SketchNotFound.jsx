// 상태 스케치: 길 잃은 나침반과 지도 (404 등 찾을 수 없음). ADR-0026 에디토리얼 스케치 스타일.
export default function SketchNotFound({ size = 160, className = '', title }) {
  const t = title || '페이지를 찾을 수 없어요 — 길 잃은 나침반과 지도 낙서'
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 160 160"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
    >
      <title>{t}</title>
      {/* 접힌 지도(해진 가장자리) */}
      <path
        className="sk-path"
        pathLength="1"
        d="M22,38 C40,35 60,33 80,32 C100,31 120,29 138,27 C136,55 134,85 133,113 C133,125 132,136 131,146 C110,148 88,149 66,148 C48,147 30,145 16,142 C17,120 18,95 19,70 C19,59 20,48 22,38 Z"
      />
      {/* 접힌 자국 */}
      <path className="sk-path" pathLength="1" strokeWidth="1.3" d="M78,33 C77,63 76,93 75,145" />
      <path className="sk-path" pathLength="1" strokeWidth="1.3" d="M20,88 C55,90 95,89 134,86" />
      {/* 접힘 그림자 해칭 */}
      <path className="sk-path" pathLength="1" strokeWidth="1" d="M25,84 L30,80 M25,94 L30,98" />
      {/* 강줄기 낙서 */}
      <path
        className="sk-path"
        pathLength="1"
        strokeWidth="1.4"
        d="M35,60 C42,55 46,65 40,72 C34,79 30,90 38,95 C46,100 55,98 60,105 C64,111 58,118 62,124"
      />
      {/* 길을 잃은 점선 경로 */}
      <path className="sk-path" pathLength="1" strokeWidth="1.6" d="M45,130 L54,124" />
      <path className="sk-path" pathLength="1" strokeWidth="1.6" d="M60,119 L69,114" />
      <path className="sk-path" pathLength="1" strokeWidth="1.6" d="M75,110 L84,106" />
      <path className="sk-path" pathLength="1" strokeWidth="1.6" d="M90,103 L98,100" />
      {/* 경로가 끊긴 자리 표시 */}
      <path className="sk-path" pathLength="1" strokeWidth="1.6" d="M100,92 L108,100 M108,92 L100,100" />
      {/* 나침반 겹 원 */}
      <path
        className="sk-path"
        pathLength="1"
        d="M129,55 C129,66 121,76 110,77 C99,77 90,68 89,57 C89,46 98,36 109,35 C120,35 129,44 129,55 Z"
      />
      <path
        className="sk-path"
        pathLength="1"
        strokeWidth="1.3"
        d="M122,55 C122,62 117,68 110,68 C103,68 97,62 97,55 C97,48 103,42 110,42 C117,42 122,48 122,55 Z"
      />
      {/* 나침반 눈금(N·E·S·W) */}
      <path
        className="sk-path"
        pathLength="1"
        strokeWidth="1.4"
        d="M109,33 L109,38 M109,72 L109,77 M87,55 L92,55 M126,55 L131,55"
      />
      {/* 흔들리는 나침반 바늘(정북을 못 가리킴) */}
      <path className="sk-path" pathLength="1" strokeWidth="1.6" d="M116,44 L119,58 L104,72 L101,58 Z" />
      <path className="sk-path" pathLength="1" fill="currentColor" stroke="none" d="M116,44 L119,58 L101,58 Z" />
      {/* 잃어버린 위치 핀 */}
      <path
        className="sk-path"
        pathLength="1"
        d="M32,118 C32,112 37,108 42,108 C47,108 52,112 52,118 C52,126 42,138 42,138 C42,138 32,126 32,118 Z"
      />
      <path
        className="sk-path"
        pathLength="1"
        strokeWidth="1.3"
        d="M42,113 C44,113 46,115 46,117 C46,119 44,121 42,121 C40,121 38,119 38,117 C38,115 40,113 42,113 Z"
      />
    </svg>
  )
}
