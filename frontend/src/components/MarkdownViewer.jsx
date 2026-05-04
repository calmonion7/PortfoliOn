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
    <div style={{ lineHeight: 1.7, maxWidth: 900 }}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 style={{ color: '#90caf9', borderBottom: '1px solid #333', paddingBottom: 8, marginBottom: 16 }}>{children}</h1>,
          h2: ({ children }) => <h2 style={{ color: '#80cbc4', marginTop: 24, marginBottom: 12 }}>{children}</h2>,
          h3: ({ children }) => <h3 style={{ color: '#b0bec5', marginTop: 16, marginBottom: 8 }}>{children}</h3>,
          table: ({ children }) => <table style={{ marginBottom: 16 }}>{children}</table>,
          img: ({ src, alt }) => (
            <img src={src} alt={alt} style={{ maxWidth: '100%', borderRadius: 4, margin: '12px 0' }} />
          ),
          a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#4fc3f7' }}>{children}</a>,
          p: ({ children }) => <p style={{ marginBottom: 8 }}>{children}</p>,
        }}
      >
        {processedContent}
      </ReactMarkdown>
    </div>
  )
}
