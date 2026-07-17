// 상태 스케치: 찢어진 차트 종이 + 당황한 낙서 표정 (오류). ADR-0026 에디토리얼 스케치 스타일.
export default function SketchError({ size = 160, className = '', title }) {
  const t = title || '문제가 생겼어요 — 찢어진 차트 종이와 당황한 낙서 표정'
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
      {/* 위쪽 종이 조각(아래쪽은 찢긴 지그재그) */}
      <path
        className="sk-path"
        pathLength="1"
        d="M32,20 C60,18 96,17 126,19 L129,60 C128,75 129,88 130,96 L118,92 L108,101 L96,90 L84,100 L72,91 L60,99 L48,90 L36,97 L33,60 C32,47 32,33 32,20 Z"
      />
      {/* 아래쪽 종이 조각(떨어져 나감) */}
      <path
        className="sk-path"
        pathLength="1"
        d="M40,105 L52,97 L64,106 L76,96 L88,107 L100,97 L112,108 L124,99 L126,140 C95,143 62,144 34,142 C35,130 37,117 40,105 Z"
      />
      {/* 차트 축 */}
      <path className="sk-path" pathLength="1" strokeWidth="1.4" d="M42,30 L42,88" />
      <path className="sk-path" pathLength="1" strokeWidth="1.4" d="M42,88 L118,88" />
      {/* 급락하는 차트 라인 */}
      <path
        className="sk-path"
        pathLength="1"
        strokeWidth="2"
        d="M45,50 C55,42 62,55 70,45 C78,35 85,48 92,40 L100,60 L108,80"
      />
      {/* 찢긴 틈에서 뻗은 균열 */}
      <path className="sk-path" pathLength="1" strokeWidth="1.3" d="M70,91 L74,78" />
      <path className="sk-path" pathLength="1" strokeWidth="1.3" d="M95,90 L91,76" />
      {/* 찢긴 자리 그림자 해칭 */}
      <path className="sk-path" pathLength="1" strokeWidth="1.1" d="M55,95 L58,90 M63,96 L66,91 M80,97 L83,92" />
      {/* 당황한 표정: 눈썹 */}
      <path className="sk-path" pathLength="1" strokeWidth="1.6" d="M133,104 L139,107" />
      <path className="sk-path" pathLength="1" strokeWidth="1.6" d="M151,107 L145,104" />
      {/* 눈(작은 점) */}
      <path className="sk-path" pathLength="1" fill="currentColor" stroke="none" d="M136,111 a2,2 0 1,0 0.1,0" />
      <path className="sk-path" pathLength="1" fill="currentColor" stroke="none" d="M148,111 a2,2 0 1,0 0.1,0" />
      {/* 물결치는 곤란한 입 */}
      <path
        className="sk-path"
        pathLength="1"
        strokeWidth="1.6"
        d="M134,120 C138,117 141,123 145,119 C148,116 150,121 152,118"
      />
      {/* 식은땀 */}
      <path
        className="sk-path"
        pathLength="1"
        strokeWidth="1.5"
        d="M155,102 C157,105 157,109 154,110 C151,109 152,104 155,102 Z"
      />
      {/* 느낌표 낙서 */}
      <path className="sk-path" pathLength="1" strokeWidth="2" d="M20,110 C19,115 20,120 19,124" />
      <path className="sk-path" pathLength="1" fill="currentColor" stroke="none" d="M19,130 a2,2 0 1,0 0.1,0" />
    </svg>
  )
}
