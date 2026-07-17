// 카테고리 아이콘: 서류가방 (포트폴리오). ADR-0026 에디토리얼 스케치 스타일.
export default function IconPortfolio({ size = 20, className = '', title }) {
  const t = title || '포트폴리오'
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      role="img"
    >
      <title>{t}</title>
      <path className="sk-path" pathLength="1" d="M9,8.2 C9.3,4.3 14.7,4.1 15,8.1" />
      <path
        className="sk-path"
        pathLength="1"
        d="M4.6,8.3 L18.9,7.9 Q21.3,7.9 21.3,10.4 L21,18.6 Q20.9,20.3 19,20.4 L5.2,20.7 Q3.1,20.6 3.2,18.5 L3.4,10.6 Q3.4,8.5 4.6,8.3 Z"
      />
      <path className="sk-path" pathLength="1" d="M3.6,14.1 L21,13.7" />
      <path className="sk-path" pathLength="1" d="M10.8,12.5 L13.4,12.4 L13.5,14.9 L10.7,15 Z" />
    </svg>
  )
}
