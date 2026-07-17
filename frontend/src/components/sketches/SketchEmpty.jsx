// 상태 스케치: 빈 종이 위 돋보기 + 물음표 낙서 (데이터 없음). ADR-0026 에디토리얼 스케치 스타일.
export default function SketchEmpty({ size = 160, className = '', title }) {
  const t = title || '찾는 내용이 없어요 — 빈 종이를 돋보기로 살펴보는 손그림'
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
      {/* 빈 종이 */}
      <path
        className="sk-path"
        pathLength="1"
        d="M37,31 C58,29 98,28 121,27 C123,58 125,96 127,133 C95,136 62,137 33,137 C32,101 33,65 37,31 Z"
      />
      {/* 접힌 모서리(도그이어) */}
      <path className="sk-path" pathLength="1" strokeWidth="1.5" d="M99,29 L120,47" />
      <path className="sk-path" pathLength="1" strokeWidth="1.4" d="M102,32 L118,46" />
      {/* 빈 내용 자리표시 낙서 줄 */}
      <path className="sk-path" pathLength="1" strokeWidth="1.5" d="M48,50 C60,48 72,49 82,50" />
      <path className="sk-path" pathLength="1" strokeWidth="1.5" d="M48,62 C58,61 66,62 72,62" />
      {/* 물음표 */}
      <path
        className="sk-path"
        pathLength="1"
        d="M50,78 C50,72 56,68 62,70 C68,72 68,80 62,84 C58,86 58,90 58,93"
      />
      <path className="sk-path" pathLength="1" strokeWidth="3" fill="currentColor" stroke="none" d="M58,99 a2.4,2.4 0 1,0 0.1,0" />
      {/* 돋보기 렌즈(겹선) */}
      <path
        className="sk-path"
        pathLength="1"
        d="M121,94 C121,105 111,116 99,117 C88,117 79,106 79,96 C78,85 89,74 101,73 C112,73 121,84 121,94 Z"
      />
      <path
        className="sk-path"
        pathLength="1"
        strokeWidth="1.4"
        d="M116,95 C116,103 108,111 99,111 C91,111 84,103 84,95 C84,87 91,79 99,79 C108,79 116,87 116,95 Z"
      />
      {/* 렌즈 반사광 */}
      <path className="sk-path" pathLength="1" strokeWidth="1.4" d="M89,86 C91,83 95,82 98,82" />
      {/* 손잡이 */}
      <path className="sk-path" pathLength="1" strokeWidth="2.2" d="M114,109 C120,115 126,121 135,130" />
      {/* 손잡이 그립 해칭 */}
      <path className="sk-path" pathLength="1" strokeWidth="1.3" d="M122,118 L127,113" />
      <path className="sk-path" pathLength="1" strokeWidth="1.3" d="M127,124 L132,119" />
      {/* 반짝임(찾는 중) */}
      <path className="sk-path" pathLength="1" strokeWidth="1.4" d="M126,74 L126,82" />
      <path className="sk-path" pathLength="1" strokeWidth="1.4" d="M122,78 L130,78" />
    </svg>
  )
}
