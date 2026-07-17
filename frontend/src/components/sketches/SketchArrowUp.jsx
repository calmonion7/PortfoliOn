// Hand-drawn upward-trend arrow doodle (ADR-0026 editorial sketches). Decorative — aria-hidden unless a title is given.
export default function SketchArrowUp({ size = 32, className = '', title }) {
  return (
    <svg
      viewBox="0 0 60 60"
      width={size}
      className={className}
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : 'true'}
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {title && <title>{title}</title>}
      <path pathLength="1" className="sk-path" strokeWidth="2.4" d="M 10,50 C 16,42 24,34 34,26 C 39,22 42,18 46,14" />
      <path pathLength="1" className="sk-path" strokeWidth="2" d="M 46,14 L 34,18 M 46,14 L 42,26" />
      <path pathLength="1" className="sk-path" strokeWidth="1.6" d="M 9,52 C 7,50 8,48 10,49" />
    </svg>
  );
}
