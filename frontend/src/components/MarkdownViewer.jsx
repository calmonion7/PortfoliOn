import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export default function MarkdownViewer({ content, ticker }) {
  const processedContent = ticker
    ? content.replace(
        /!\[([^\]]*)\]\(\.\/([^)]+)\)/g,
        `![$1](http://localhost:8000/reports/${ticker}/$2)`
      )
    : content

  return (
    <div style={{ lineHeight: 1.8, maxWidth: 900, fontSize: 14, color: '#ccc' }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 style={{ color: '#90caf9', fontSize: 22, fontWeight: 700, borderBottom: '1px solid #2a3a4a', paddingBottom: 8, marginBottom: 16, marginTop: 0 }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ color: '#80cbc4', fontSize: 17, fontWeight: 700, marginTop: 28, marginBottom: 12, paddingBottom: 4, borderBottom: '1px solid #1a2a3a' }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ color: '#b0bec5', fontSize: 14, fontWeight: 600, marginTop: 18, marginBottom: 8 }}>{children}</h3>,
          p: ({ children }) => <p style={{ fontSize: 13, marginBottom: 10, color: '#bdbdbd' }}>{children}</p>,
          table: ({ children }) => (
            <div style={{ overflowX: 'auto', marginBottom: 16 }}>
              <table style={{ borderCollapse: 'collapse', fontSize: 12, width: '100%' }}>{children}</table>
            </div>
          ),
          th: ({ children }) => <th style={{ padding: '6px 12px', textAlign: 'left', borderBottom: '1px solid #333', color: '#90caf9', fontWeight: 600, whiteSpace: 'nowrap', background: '#1a2a3a' }}>{children}</th>,
          td: ({ children }) => <td style={{ padding: '5px 12px', borderBottom: '1px solid #1e1e1e', color: '#ccc' }}>{children}</td>,
          img: ({ src, alt }) => (
            <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: 6, margin: '16px 0', display: 'block' }} />
          ),
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#4fc3f7', textDecoration: 'none' }}>{children}</a>,
          strong: ({ children }) => <strong style={{ color: '#e0e0e0', fontWeight: 700 }}>{children}</strong>,
          code: ({ children }) => <code style={{ background: '#1a2a1a', color: '#81c784', padding: '1px 5px', borderRadius: 3, fontSize: 12 }}>{children}</code>,
          li: ({ children }) => <li style={{ marginBottom: 4, fontSize: 13, color: '#bdbdbd' }}>{children}</li>,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
