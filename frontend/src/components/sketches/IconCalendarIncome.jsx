// 카테고리 아이콘: 달력 + 동전 (캘린더·배당). ADR-0026 에디토리얼 스케치 스타일.
export default function IconCalendarIncome({ size = 20, className = '', title }) {
  const t = title || '캘린더·배당'
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
        d="M4.2,6.1 L18.6,5.8 Q20.3,5.8 20.3,7.6 L20.1,17 Q20,18.6 18.3,18.7 L5,19 Q3.4,18.9 3.4,17.2 L3.6,7.8 Q3.6,6.2 4.2,6.1 Z"
      />
      <path className="sk-path" pathLength="1" d="M7.6,6.3 L7.5,3.9 M15.6,6 L15.7,3.7" />
      <path className="sk-path" pathLength="1" d="M3.8,9.6 L20,9.4" />
      <path
        className="sk-path"
        pathLength="1"
        d="M14.3,18.4 C14.2,15.9 16.3,14.1 18.7,14.3 C21.1,14.5 22.6,16.6 22.3,19 C22,21.3 19.8,22.7 17.5,22.2 C15.5,21.8 14.4,20.4 14.3,18.4 Z"
      />
      <path className="sk-path" pathLength="1" d="M16.4,16.9 L17.7,15.7" />
    </svg>
  )
}
