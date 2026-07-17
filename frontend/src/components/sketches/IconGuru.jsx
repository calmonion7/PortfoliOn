// 카테고리 아이콘: 둥근 안경 (구루). ADR-0026 에디토리얼 스케치 스타일.
export default function IconGuru({ size = 20, className = '', title }) {
  const t = title || '구루'
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
        d="M3.7,12.2 C3.6,9.7 5.6,7.8 8,7.9 C10.4,8 12.2,10 12.1,12.4 C12,14.7 10,16.5 7.6,16.4 C5.3,16.3 3.8,14.5 3.7,12.2 Z"
      />
      <path
        className="sk-path"
        pathLength="1"
        d="M11.9,12.1 C11.8,9.6 13.8,7.7 16.2,7.8 C18.6,7.9 20.4,9.9 20.3,12.3 C20.2,14.6 18.2,16.4 15.8,16.3 C13.5,16.2 12,14.4 11.9,12.1 Z"
      />
      <path className="sk-path" pathLength="1" d="M11.6,11.4 Q12,10.6 12.4,11.4" />
      <path className="sk-path" pathLength="1" d="M3.8,12.2 L1.5,11.2 M20.2,12.2 L22.5,11.2" />
    </svg>
  )
}
