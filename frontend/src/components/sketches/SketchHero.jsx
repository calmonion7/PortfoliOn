// Desk still-life: open newspaper with a rising chart, coffee, pencil, glasses (ADR-0026 editorial sketches).
export default function SketchHero({ className = '', title = '펼친 신문 위에 상승 차트가 그려진 책상 정물 스케치' }) {
  return (
    <svg
      viewBox="0 0 480 280"
      width="100%"
      className={className}
      role="img"
      fill="none"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <title>{title}</title>

      {/* desk shadow */}
      <path pathLength="1" className="sk-path" strokeWidth="1.6" d="M 20,262 C 120,266 300,258 450,264" />

      {/* newspaper */}
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="2.2"
        d="M 32,68 C 30,66 70,58 150,60 C 230,58 268,64 272,70 L 276,222 C 270,230 230,236 150,234 C 72,236 34,230 28,220 Z"
      />
      <path pathLength="1" className="sk-path" strokeWidth="1.8" d="M 152,64 C 150,110 154,170 151,230" />
      <path pathLength="1" className="sk-path" strokeWidth="1.8" d="M 40,82 C 90,80 200,84 268,81" />
      <path pathLength="1" className="sk-path" strokeWidth="1.8" d="M 40,96 C 95,94 205,98 266,95" />
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="1.5"
        d="M 44,112 L 140,110 M 44,124 L 138,123 M 44,136 L 142,135 M 44,148 L 120,149 M 44,160 L 136,159"
      />
      <path pathLength="1" className="sk-path" strokeWidth="1.5" d="M 44,180 L 130,178 M 44,192 L 100,193" />
      <path pathLength="1" className="sk-path" strokeWidth="1.5" d="M 50,238 L 70,234 M 200,238 L 220,234" />

      {/* rising chart embedded in the paper */}
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="1.8"
        d="M 160,110 L 260,108 L 262,198 L 158,200 Z"
      />
      <path pathLength="1" className="sk-path" strokeWidth="1.8" d="M 168,118 L 166,190 L 254,192" />
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="1.8"
        d="M 168,188 L 182,170 L 196,178 L 210,150 L 224,158 L 238,130 L 250,124"
      />
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="1.5"
        d="M 168,188 L 170,184 M 182,170 L 184,166 M 196,178 L 198,174 M 210,150 L 212,146 M 224,158 L 226,154 M 238,130 L 240,126 M 250,124 L 252,120"
      />
      <path pathLength="1" className="sk-path" strokeWidth="1.6" d="M 246,116 L 253,110 L 251,119" />

      {/* reading glasses resting on the paper */}
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="2.2"
        d="M 190,74 C 199,74 204,80 204,88 C 204,96 199,102 190,102 C 181,102 176,96 176,88 C 176,80 181,74 190,74 Z"
      />
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="2.2"
        d="M 228,72 C 237,72 242,78 242,86 C 242,94 237,100 228,100 C 219,100 214,94 214,86 C 214,78 219,72 228,72 Z"
      />
      <path pathLength="1" className="sk-path" strokeWidth="1.8" d="M 204,88 C 208,85 210,85 214,86" />
      <path pathLength="1" className="sk-path" strokeWidth="1.8" d="M 242,86 C 250,84 256,80 254,74" />

      {/* coffee cup */}
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="2.2"
        d="M 336,155 C 334,154 396,152 400,156 L 396,205 C 380,214 356,214 342,206 Z"
      />
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="1.8"
        d="M 398,168 C 412,166 416,180 408,190 C 402,196 396,192 397,186"
      />
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="1.8"
        d="M 325,215 C 335,210 400,210 412,216 C 400,222 335,222 325,215 Z"
      />
      <path pathLength="1" className="sk-path" strokeWidth="1.5" d="M 358,148 C 350,130 366,120 358,100" />
      <path pathLength="1" className="sk-path" strokeWidth="1.5" d="M 378,148 C 372,128 386,118 380,100" />
      <path
        pathLength="1"
        className="sk-path"
        strokeWidth="1.5"
        d="M 335,224 L 345,220 M 355,226 L 365,222 M 375,226 L 385,222"
      />

      {/* pencil */}
      <path pathLength="1" className="sk-path" strokeWidth="1.8" d="M 300,252 L 424,206" />
      <path pathLength="1" className="sk-path" strokeWidth="1.8" d="M 302,258 L 426,212" />
      <path stroke="none" fill="currentColor" d="M 424,206 L 438,201 L 426,212 Z" />
    </svg>
  );
}
