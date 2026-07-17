// 카테고리 아이콘: 신문 (시장). ADR-0026 에디토리얼 스케치 스타일.
export default function IconMarket({ size = 20, className = '', title }) {
  const t = title || '시장'
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
      <path
        className="sk-path"
        pathLength="1"
        d="M4.3,4.4 C3.6,4.6 3.3,5.3 3.4,6.1 L4,19.2 C4,20.1 4.7,20.6 5.5,20.4 L20.2,19.6 C20.9,19.5 21.2,18.9 21.1,18.2 L20.3,5.6 C20.2,4.8 19.6,4.3 18.8,4.4 Z"
      />
      <path className="sk-path" pathLength="1" d="M6.2,7.4 L17.6,7.1 M6.3,8.6 L17.4,8.4" />
      <path
        className="sk-path"
        pathLength="1"
        d="M6,11.3 L17,11.1 M6,13.7 L14.6,13.5 M6,16.1 L17.2,16"
      />
      <path className="sk-path" pathLength="1" d="M6.3,18.3 L8.1,15.7 L9.6,17.2 L12,14" />
    </svg>
  )
}
