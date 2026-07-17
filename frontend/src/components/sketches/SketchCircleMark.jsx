// Hand-drawn emphasis circle scribble, like marking up a page (ADR-0026 editorial sketches). Decorative — aria-hidden unless a title is given.
export default function SketchCircleMark({ size = 56, className = '', title }) {
  return (
    <svg
      viewBox="0 0 80 80"
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
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="2.2"
        d="M 40,10 C 60,8 72,25 70,42 C 68,60 50,72 32,68 C 14,64 8,46 14,30 C 18,18 28,10 40,10"
      />
      <path pathLength="1" className="sk-path" strokeWidth="1.8" d="M 40,10 C 46,9 50,9 52,11" />
    </svg>
  );
}
