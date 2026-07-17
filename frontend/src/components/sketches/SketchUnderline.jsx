// Hand-drawn wavy underline, elongated horizontally (ADR-0026 editorial sketches). Decorative — aria-hidden unless a title is given.
export default function SketchUnderline({ size = 200, className = '', title }) {
  return (
    <svg
      viewBox="0 0 200 20"
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
        d="M 4,12 C 30,4 60,16 90,8 C 120,2 150,14 178,7 C 188,5 194,9 196,6"
      />
      <path pathLength="1" className="sk-path" strokeWidth="1.6" d="M 10,15 C 50,10 100,16 150,10" />
    </svg>
  );
}
