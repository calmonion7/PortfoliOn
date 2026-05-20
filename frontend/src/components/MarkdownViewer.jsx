import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

const TARGET_SECTIONS = ['경제적 해자', '장기 성장 계획', '장기성장계획', '장기성장 계획', '최근 공시']

function splitSentencesBySection(markdown) {
  const lines = markdown.split('\n')
  let inTarget = false
  return lines.map(line => {
    const headingMatch = line.match(/^(#{1,3})\s+(.+)/)
    if (headingMatch) {
      if (headingMatch[1].length <= 2) {
        inTarget = TARGET_SECTIONS.some(k => headingMatch[2].includes(k))
      }
      return line
    }
    if (inTarget && line.trim()) {
      return line.replace(/\.\s+(?=[^\s])/g, '.\n\n')
    }
    return line
  }).join('\n')
}

export default function MarkdownViewer({ content, ticker }) {
  const CIRCLE_TO_EMOJI = { '①':'1️⃣','②':'2️⃣','③':'3️⃣','④':'4️⃣','⑤':'5️⃣','⑥':'6️⃣','⑦':'7️⃣','⑧':'8️⃣','⑨':'9️⃣','⑩':'🔟' }
  const processedContent = splitSentencesBySection(
    (ticker
      ? content.replace(/!\[([^\]]*)\]\(\.\/([^)]+)\)/g, `![$1](http://localhost:8000/reports/${ticker}/$2)`)
      : content
    ).replace(/[①-⑩]/g, c => CIRCLE_TO_EMOJI[c] ?? c)
  )

  return (
    <div style={{ lineHeight: 1.8, maxWidth: 900, fontSize: 14, color: 'var(--text)' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 style={{ color: 'var(--text-heading)', fontSize: 22, fontWeight: 700, borderBottom: '1px solid var(--border)', paddingBottom: 8, marginBottom: 16, marginTop: 0 }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ color: 'var(--accent)', fontSize: 17, fontWeight: 700, marginTop: 28, marginBottom: 12, paddingBottom: 4, borderBottom: '1px solid var(--border)' }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ color: 'var(--text-muted)', fontSize: 14, fontWeight: 600, marginTop: 18, marginBottom: 8 }}>{children}</h3>,
          p: ({ children }) => <p style={{ fontSize: 13, marginBottom: 10, color: 'var(--text)' }}>{children}</p>,
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>{children}</table>
            </div>
          ),
          th: ({ children }) => <th style={{ padding: '6px 12px', textAlign: 'left', borderBottom: '1px solid var(--border)', color: 'var(--text-heading)', fontWeight: 600, whiteSpace: 'nowrap', background: 'var(--bg-surface)' }}>{children}</th>,
          td: ({ children }) => <td style={{ padding: '5px 12px', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}>{children}</td>,
          img: ({ src, alt }) => (
            <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: 6, margin: '16px 0', display: 'block' }} />
          ),
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--accent)', textDecoration: 'none' }}>{children}</a>,
          strong: ({ children }) => <strong style={{ color: 'var(--text)', fontWeight: 700 }}>{children}</strong>,
          code: ({ children }) => <code style={{ background: 'var(--bg-surface)', color: 'var(--positive)', padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>{children}</code>,
          li: ({ children }) => <li style={{ marginBottom: 4, fontSize: 13, color: 'var(--text)' }}>{children}</li>,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
