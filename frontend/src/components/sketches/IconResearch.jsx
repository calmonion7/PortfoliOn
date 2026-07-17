// 카테고리 아이콘: 펼친 책 + 돋보기 (리서치). ADR-0026 에디토리얼 스케치 스타일.
export default function IconResearch({ size = 20, className = '', title }) {
  const t = title || '리서치'
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
        d="M2.6,10.3 L10.8,8.6 L10.9,19.8 L2.7,21.2 Z M21.3,10.4 L13.1,8.7 L13,19.9 L21.2,21.3 Z"
      />
      <path className="sk-path" pathLength="1" d="M12,8.5 Q11.85,14.2 12.05,20.1" />
      <path
        className="sk-path"
        pathLength="1"
        d="M13.6,6.1 C13.5,4.2 15,2.6 16.9,2.7 C18.8,2.8 20.3,4.4 20.2,6.3 C20.1,8.1 18.6,9.6 16.7,9.5 C14.8,9.4 13.5,7.9 13.6,6.1 Z M18.8,8.6 L21.4,11.1"
      />
    </svg>
  )
}
