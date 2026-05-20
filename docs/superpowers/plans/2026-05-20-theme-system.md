# Theme System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add dark / beige / white / pastel theme support via CSS custom properties, switchable from a 4-swatch nav bar UI that persists to localStorage.

**Architecture:** CSS Custom Properties on `data-theme` attribute set on `<html>`. All 17 tokens defined in `index.css`. Hardcoded dark colors in `App.css` and all JSX inline styles replaced with `var(--token)`. Theme state lives in `App.jsx` with localStorage persistence.

**Tech Stack:** React 18, plain CSS custom properties (no Tailwind, no new deps)

---

## Token Reference

These are the 17 tokens used throughout all tasks:

| Token | Dark | Beige | White | Pastel |
|-------|------|-------|-------|--------|
| `--bg` | `#121212` | `#f5f0e8` | `#ffffff` | `#f0f4ff` |
| `--bg-nav` | `#1a1a2e` | `#ede5d8` | `#f8f9fa` | `#dde4ff` |
| `--bg-card` | `#1a1a2e` | `#ede8de` | `#f8f9fa` | `#e8eeff` |
| `--bg-surface` | `#1e1e2e` | `#e4ddd0` | `#f0f2f5` | `#d8e0ff` |
| `--bg-hover` | `#1e1e1e` | `#ddd6c8` | `#e8eaed` | `#ccd5ff` |
| `--text` | `#e0e0e0` | `#3d3530` | `#1a1a1a` | `#2d3561` |
| `--text-muted` | `#9ca3af` | `#7a6f68` | `#6b7280` | `#6b75a8` |
| `--text-heading` | `#90caf9` | `#6b4226` | `#1d4ed8` | `#3949ab` |
| `--border` | `#333333` | `#d4cfc6` | `#e5e7eb` | `#c5cae9` |
| `--accent` | `#4fc3f7` | `#b85c2a` | `#2563eb` | `#5c6bc0` |
| `--accent-btn` | `#1565c0` | `#8b4513` | `#2563eb` | `#3f51b5` |
| `--positive` | `#66bb6a` | `#3d7a45` | `#16a34a` | `#388e3c` |
| `--negative` | `#ef5350` | `#c0392b` | `#dc2626` | `#d32f2f` |
| `--overlay` | `rgba(0,0,0,0.7)` | `rgba(0,0,0,0.4)` | `rgba(0,0,0,0.4)` | `rgba(0,0,0,0.3)` |
| `--chart-grid` | `#1e2a3a` | `#ddd8ce` | `#eeeeee` | `#dde3f8` |
| `--input-bg` | `#1e1e2e` | `#fdf8f0` | `#ffffff` | `#f8f9ff` |
| `--input-border` | `#444444` | `#c8c2b8` | `#d1d5db` | `#9fa8da` |

---

## Task 1: CSS token definitions in index.css

**Files:**
- Modify: `frontend/src/index.css`

- [ ] **Step 1: Replace the entire contents of `index.css`**

```css
/* ── Theme tokens ── */
:root,
[data-theme="dark"] {
  --bg:           #121212;
  --bg-nav:       #1a1a2e;
  --bg-card:      #1a1a2e;
  --bg-surface:   #1e1e2e;
  --bg-hover:     #1e1e1e;
  --text:         #e0e0e0;
  --text-muted:   #9ca3af;
  --text-heading: #90caf9;
  --border:       #333333;
  --accent:       #4fc3f7;
  --accent-btn:   #1565c0;
  --positive:     #66bb6a;
  --negative:     #ef5350;
  --overlay:      rgba(0, 0, 0, 0.7);
  --chart-grid:   #1e2a3a;
  --input-bg:     #1e1e2e;
  --input-border: #444444;
}

[data-theme="beige"] {
  --bg:           #f5f0e8;
  --bg-nav:       #ede5d8;
  --bg-card:      #ede8de;
  --bg-surface:   #e4ddd0;
  --bg-hover:     #ddd6c8;
  --text:         #3d3530;
  --text-muted:   #7a6f68;
  --text-heading: #6b4226;
  --border:       #d4cfc6;
  --accent:       #b85c2a;
  --accent-btn:   #8b4513;
  --positive:     #3d7a45;
  --negative:     #c0392b;
  --overlay:      rgba(0, 0, 0, 0.4);
  --chart-grid:   #ddd8ce;
  --input-bg:     #fdf8f0;
  --input-border: #c8c2b8;
}

[data-theme="white"] {
  --bg:           #ffffff;
  --bg-nav:       #f8f9fa;
  --bg-card:      #f8f9fa;
  --bg-surface:   #f0f2f5;
  --bg-hover:     #e8eaed;
  --text:         #1a1a1a;
  --text-muted:   #6b7280;
  --text-heading: #1d4ed8;
  --border:       #e5e7eb;
  --accent:       #2563eb;
  --accent-btn:   #2563eb;
  --positive:     #16a34a;
  --negative:     #dc2626;
  --overlay:      rgba(0, 0, 0, 0.4);
  --chart-grid:   #eeeeee;
  --input-bg:     #ffffff;
  --input-border: #d1d5db;
}

[data-theme="pastel"] {
  --bg:           #f0f4ff;
  --bg-nav:       #dde4ff;
  --bg-card:      #e8eeff;
  --bg-surface:   #d8e0ff;
  --bg-hover:     #ccd5ff;
  --text:         #2d3561;
  --text-muted:   #6b75a8;
  --text-heading: #3949ab;
  --border:       #c5cae9;
  --accent:       #5c6bc0;
  --accent-btn:   #3f51b5;
  --positive:     #388e3c;
  --negative:     #d32f2f;
  --overlay:      rgba(0, 0, 0, 0.3);
  --chart-grid:   #dde3f8;
  --input-bg:     #f8f9ff;
  --input-border: #9fa8da;
}

body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font-family: system-ui, sans-serif;
}
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/index.css
git commit -m "feat: add CSS theme token definitions (dark/beige/white/pastel)"
```

---

## Task 2: App.css — replace hardcoded dark colors

**Files:**
- Modify: `frontend/src/App.css`

- [ ] **Step 1: Replace entire App.css**

```css
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: system-ui, sans-serif; background: var(--bg); color: var(--text); }
table { width: 100%; border-collapse: collapse; }
th, td { padding: 8px 12px; text-align: left; border-bottom: 1px solid var(--border); }
th { background: var(--bg-surface); color: var(--text-heading); font-weight: 600; }
tr:hover td { background: var(--bg-hover); }
button { cursor: pointer; padding: 6px 14px; border-radius: 4px; border: none; font-size: 14px; }
.btn-primary { background: var(--accent-btn); color: white; }
.btn-primary:hover { filter: brightness(1.15); }
.btn-danger { background: #c62828; color: white; }
.btn-danger:hover { background: #d32f2f; }
.btn-secondary { background: var(--bg-surface); color: var(--text); border: 1px solid var(--border); }
input, select, textarea {
  background: var(--input-bg); color: var(--text); border: 1px solid var(--input-border);
  padding: 6px 10px; border-radius: 4px; font-size: 14px; width: 100%;
}
.modal-overlay {
  position: fixed; inset: 0; background: var(--overlay);
  display: flex; align-items: center; justify-content: center; z-index: 100;
}
.modal { background: var(--bg-surface); padding: 24px; border-radius: 8px; width: 480px; max-width: 95vw; }
.modal h2 { margin-bottom: 16px; color: var(--text-heading); }
.form-field { margin-bottom: 12px; }
.form-field label { display: block; margin-bottom: 4px; font-size: 13px; color: var(--text-muted); }
.positive { color: var(--positive); }
.negative { color: var(--negative); }
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/App.css
git commit -m "feat: replace hardcoded colors in App.css with CSS vars"
```

---

## Task 3: App.jsx — theme state + swatch UI + nav colors

**Files:**
- Modify: `frontend/src/App.jsx`

- [ ] **Step 1: Replace App.jsx**

```jsx
import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import Portfolio from './pages/Portfolio'
import Reports from './pages/Reports'
import Guru from './pages/Guru'
import Settings from './pages/Settings'
import './App.css'

const THEMES = [
  { key: 'dark',   swatch: '#1a1a2e', label: '다크' },
  { key: 'beige',  swatch: '#d4b896', label: '베이지' },
  { key: 'white',  swatch: '#e8e8e8', label: '화이트' },
  { key: 'pastel', swatch: '#9fa8da', label: '파스텔' },
]

export default function App() {
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') ?? 'dark')

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('theme', theme)
  }, [theme])

  return (
    <BrowserRouter>
      <nav style={{
        padding: '12px 24px',
        background: 'var(--bg-nav)',
        display: 'flex',
        alignItems: 'center',
        gap: 24,
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ color: 'var(--text)', fontWeight: 'bold', marginRight: 16 }}>Portfolio Manager</span>
        {[['/', '종목 관리'], ['/reports', '리포트'], ['/guru', '구루'], ['/settings', '설정']].map(([to, label]) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            style={({ isActive }) => ({
              color: isActive ? 'var(--accent)' : 'var(--text-muted)',
              textDecoration: 'none',
              fontWeight: isActive ? 600 : 400,
            })}
          >
            {label}
          </NavLink>
        ))}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, alignItems: 'center' }}>
          {THEMES.map(t => (
            <button
              key={t.key}
              title={t.label}
              onClick={() => setTheme(t.key)}
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: t.swatch,
                border: theme === t.key ? '2px solid white' : '2px solid transparent',
                outline: theme === t.key ? '1px solid #888' : 'none',
                cursor: 'pointer',
                padding: 0,
                flexShrink: 0,
              }}
            />
          ))}
        </div>
      </nav>
      <main style={{ padding: 24, background: 'var(--bg)', minHeight: 'calc(100vh - 49px)' }}>
        <Routes>
          <Route path="/" element={<Portfolio />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/guru" element={<Guru />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
    </BrowserRouter>
  )
}
```

- [ ] **Step 2: Verify dev server shows swatches in nav**

Open `http://localhost:5173`. Four colored circles should appear at the right end of the nav bar. Clicking each should change the page background/text colors immediately.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/App.jsx
git commit -m "feat: add theme switcher with 4-swatch nav UI and localStorage persistence"
```

---

## Task 4: MarkdownViewer.jsx — replace inline colors

**Files:**
- Modify: `frontend/src/components/MarkdownViewer.jsx`

- [ ] **Step 1: Replace the return block's inline colors**

Replace the entire `return (` block:

```jsx
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
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/components/MarkdownViewer.jsx
git commit -m "feat: replace hardcoded colors in MarkdownViewer with CSS vars"
```

---

## Task 5: Portfolio.jsx + StockModal.jsx

**Files:**
- Modify: `frontend/src/pages/Portfolio.jsx`
- Modify: `frontend/src/components/StockModal.jsx`

- [ ] **Step 1: Replace TAB_STYLE and structural inline colors in Portfolio.jsx**

Replace `TAB_STYLE` constant:
```jsx
const TAB_STYLE = (active) => ({
  padding: '6px 14px',
  cursor: 'pointer',
  border: 'none',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  background: 'transparent',
  color: active ? 'var(--accent)' : 'var(--text-muted)',
  fontWeight: active ? 600 : 400,
  fontSize: 13,
})
```

Replace h1:
```jsx
<h1 style={{ color: 'var(--text-heading)' }}>내 포트폴리오</h1>
```

Replace tab border div:
```jsx
<div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 12 }}>
```

Replace search input inline style:
```jsx
style={{
  flex: 1, padding: '7px 12px', background: 'var(--input-bg)',
  border: '1px solid var(--input-border)', borderRadius: 4,
  color: 'var(--text)', fontSize: 13,
}}
```

Replace market filter buttons:
```jsx
{['ALL', 'US', 'KR'].map(m => (
  <button
    key={m}
    onClick={() => setMarketFilter(m)}
    style={{
      padding: '6px 12px', border: '1px solid var(--border)', borderRadius: 4, cursor: 'pointer', fontSize: 12,
      background: marketFilter === m ? 'var(--bg-surface)' : 'var(--bg-card)',
      color: marketFilter === m ? 'var(--accent)' : 'var(--text-muted)',
    }}
  >
    {m === 'ALL' ? `전체 (${activeTab === 'holdings' ? stocks.length : watchlist.length})`
      : m === 'US' ? `🇺🇸 US (${activeTab === 'holdings' ? usHoldings : usWatch})`
      : `🇰🇷 KR (${activeTab === 'holdings' ? krHoldings : krWatch})`}
  </button>
))}
```

Replace error color:
```jsx
{error && <p style={{ color: 'var(--negative)', marginBottom: 8 }}>{error}</p>}
```

Replace muted cell colors (`color: '#aaa'` → `color: 'var(--text-muted)'`, `color: '#666'` → `color: 'var(--text-muted)'`):
```jsx
<td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stock.competitors?.join(', ') || '-'}</td>
```
```jsx
<tr><td colSpan={7} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>종목을 추가해 주세요</td></tr>
```
```jsx
<td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{stock.competitors?.join(', ') || '-'}</td>
```
```jsx
<tr><td colSpan={5} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: 32 }}>관심종목을 추가해 주세요</td></tr>
```

- [ ] **Step 2: Replace INPUT_STYLE and dropdown colors in StockModal.jsx**

Replace `INPUT_STYLE` constant:
```jsx
const INPUT_STYLE = {
  width: '100%', padding: '6px 10px', background: 'var(--input-bg)',
  border: '1px solid var(--input-border)', borderRadius: 4, color: 'var(--text)', fontSize: 13, boxSizing: 'border-box',
}
```

Replace search dropdown container:
```jsx
<div style={{
  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 9999,
  background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 4,
  maxHeight: 240, overflowY: 'auto', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  marginTop: 2,
}}>
```

Replace dropdown item style:
```jsx
style={{
  padding: '8px 12px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
  display: 'flex', alignItems: 'center', gap: 8,
}}
onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-hover)'}
onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
```

Replace result text colors:
```jsx
<div style={{ fontSize: 13, color: 'var(--text)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
```
```jsx
<div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 1 }}>
```

Replace search icon color:
```jsx
<span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 14, pointerEvents: 'none' }}>
```

- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Portfolio.jsx frontend/src/components/StockModal.jsx
git commit -m "feat: replace hardcoded colors in Portfolio and StockModal with CSS vars"
```

---

## Task 6: Settings.jsx + ReportSchedule.jsx + GuruCrawlSettings.jsx

**Files:**
- Modify: `frontend/src/pages/Settings.jsx`
- Modify: `frontend/src/pages/ReportSchedule.jsx`
- Modify: `frontend/src/pages/GuruCrawlSettings.jsx`

- [ ] **Step 1: Replace inline colors in Settings.jsx**

Replace `tabStyle` function:
```jsx
const tabStyle = (active) => ({
  padding: '8px 16px', border: 'none',
  borderBottom: active ? `2px solid var(--accent)` : '2px solid transparent',
  background: 'none', color: active ? 'var(--accent)' : 'var(--text-muted)',
  cursor: 'pointer', fontWeight: active ? 600 : 400, fontSize: 14,
})
```

Replace h1:
```jsx
<h1 style={{ color: 'var(--text-heading)', marginBottom: 20 }}>설정</h1>
```

Replace tab container border:
```jsx
<div style={{ display: 'flex', borderBottom: '1px solid var(--border)', marginBottom: 24 }}>
```

- [ ] **Step 2: Replace inline colors in ReportSchedule.jsx**

Replace both `<section>` background colors:
```jsx
<section style={{ background: 'var(--bg-surface)', padding: 20, borderRadius: 8, marginBottom: 24 }}>
```
```jsx
<section style={{ background: 'var(--bg-surface)', padding: 20, borderRadius: 8 }}>
```

Replace section headings (both `#80cbc4`):
```jsx
<h2 style={{ color: 'var(--text-heading)', marginBottom: 16, fontSize: 14 }}>자동 리포트 스케줄</h2>
```
```jsx
<h2 style={{ color: 'var(--text-heading)', marginBottom: 12, fontSize: 14 }}>즉시 리포트 생성</h2>
```

Replace muted text (`color: '#aaa'`):
```jsx
<p style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 12 }}>보유 및 관심 종목 전체...</p>
```

Replace day-of-week buttons:
```jsx
style={{
  padding: '4px 8px', borderRadius: 4, border: 'none',
  cursor: schedule.enabled ? 'pointer' : 'default',
  background: schedule.days.includes(key) ? 'var(--accent-btn)' : 'var(--bg-hover)',
  color: schedule.days.includes(key) ? 'white' : 'var(--text-muted)',
  opacity: schedule.enabled ? 1 : 0.5, fontSize: 13,
}}
```

Replace progress bar container:
```jsx
<div style={{ background: 'var(--bg-hover)', borderRadius: 4, height: 8, overflow: 'hidden' }}>
```

Replace accent progress text:
```jsx
<span style={{ color: 'var(--accent)', fontWeight: 600 }}>{progress.done} / {progress.total}</span>
```

Replace count color (`color: '#555'`):
```jsx
<div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, textAlign: 'right' }}>{pct}%</div>
```

Replace genMsg color:
```jsx
{genMsg && <p style={{ marginTop: 8, color: 'var(--positive)', fontSize: 13 }}>{genMsg}</p>}
```

- [ ] **Step 3: Apply same color replacements to GuruCrawlSettings.jsx**

Both `<section>` elements:
```jsx
<section style={{ background: 'var(--bg-surface)', padding: 20, borderRadius: 8, marginBottom: 20 }}>
<section style={{ background: 'var(--bg-surface)', padding: 20, borderRadius: 8 }}>
```

Section headings (`#80cbc4` → `var(--text-heading)`), muted text (`#aaa` → `var(--text-muted)`), `#666` → `var(--text-muted)`.

Day-of-week buttons (same pattern as ReportSchedule):
```jsx
background: schedule.day === key ? 'var(--accent-btn)' : 'var(--bg-hover)',
color: schedule.day === key ? 'white' : 'var(--text-muted)',
```

Progress bar container: `background: 'var(--bg-hover)'`

Accent count: `color: 'var(--accent)'`

Percent text: `color: 'var(--text-muted)'`

CrawlMsg: `color: 'var(--positive)'`

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Settings.jsx frontend/src/pages/ReportSchedule.jsx frontend/src/pages/GuruCrawlSettings.jsx
git commit -m "feat: replace hardcoded colors in Settings pages with CSS vars"
```

---

## Task 7: Guru.jsx + GuruManagers.jsx + GuruStats.jsx

**Files:**
- Modify: `frontend/src/pages/Guru.jsx`
- Modify: `frontend/src/pages/GuruManagers.jsx`
- Modify: `frontend/src/pages/GuruStats.jsx`

- [ ] **Step 1: Replace inline colors in Guru.jsx**

Replace `tabStyle` function:
```jsx
const tabStyle = (active) => ({
  padding: '6px 14px', borderRadius: 16,
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  background: active ? 'var(--accent-btn)' : 'transparent',
  color: active ? 'white' : 'var(--text-muted)',
  cursor: 'pointer', fontSize: 13,
})
```

Replace h3:
```jsx
<h3 style={{ color: 'var(--text-heading)', marginBottom: 8 }}>구루 매니저</h3>
```

- [ ] **Step 2: Replace inline colors in GuruManagers.jsx**

Replace `tdStyle` constant:
```jsx
const tdStyle = { padding: '8px 12px', color: 'var(--text)' }
```

Replace search input style:
```jsx
style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, width: 260 }}
```

Replace table header row:
```jsx
<tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-heading)' }}>
```

Replace `th` sort colors:
```jsx
color: sort.key === col.sortKey ? 'var(--accent)' : 'var(--text-heading)',
```

Replace table row border:
```jsx
<tr key={m.id} style={{ borderBottom: '1px solid var(--border)' }}>
```

Replace firm cell:
```jsx
<td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{m.firm}</td>
```

Replace last updated text:
```jsx
<p style={{ color: 'var(--text-muted)', fontSize: 12, marginBottom: 8 }}>마지막 갱신: {data.last_updated}</p>
```

Replace query count text:
```jsx
<span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{sorted.length} / {data.managers.length}명</span>
```

Replace loading/empty text:
```jsx
if (loading) return <p style={{ color: 'var(--text-muted)' }}>로딩 중...</p>
```
```jsx
<p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
  데이터 없음 — "크롤링 설정" 탭에서 데이터를 가져오세요.
</p>
```

- [ ] **Step 3: Replace inline colors in GuruStats.jsx**

Replace `tdStyle` constant:
```jsx
const tdStyle = { padding: '8px 12px', color: 'var(--text)' }
```

Replace `tabStyle` function:
```jsx
const tabStyle = (active) => ({
  padding: '6px 14px', borderRadius: 16,
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
  background: active ? 'var(--accent-btn)' : 'transparent',
  color: active ? 'white' : 'var(--text-muted)',
  cursor: 'pointer', fontSize: 13,
})
```

Replace search input style:
```jsx
style={{ padding: '5px 10px', borderRadius: 4, border: '1px solid var(--input-border)', background: 'var(--input-bg)', color: 'var(--text)', fontSize: 13, width: 260 }}
```

Replace `WatchlistBtn` component styles:
```jsx
background: inWatchlist ? 'var(--bg-hover)' : 'var(--bg-surface)',
color: inWatchlist ? 'var(--negative)' : 'var(--positive)',
```

Replace table header rows (`#333` → `var(--border)`, `#80cbc4` → `var(--text-heading)`):
```jsx
<tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--text-heading)' }}>
```

Replace row borders (`#222` → `var(--border)`, `#333` → `var(--border)`):
```jsx
<tr key={...} style={{ borderBottom: '1px solid var(--border)' }}>
```

Replace accent ticker colors (`#4fc3f7` → `var(--accent)`):
```jsx
<td style={{ ...tdStyle, fontWeight: 600, color: 'var(--accent)' }}>{row.ticker}</td>
```

Replace muted text (`#aaa` → `var(--text-muted)`, `#666` → `var(--text-muted)`):
```jsx
<td style={{ ...tdStyle, color: 'var(--text-muted)' }}>{row.name}</td>
<span style={{ color: 'var(--text-muted)', fontSize: 11 }}> {h.name_kr}</span>
<span style={{ color: 'var(--text-muted)', fontSize: 11 }}> ({h.count}명)</span>
```

Replace weight legend badge:
```jsx
<span key={rank} style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-surface)', padding: '2px 6px', borderRadius: 3 }}>
```

Replace query count spans:
```jsx
<span style={{ color: 'var(--text-muted)', fontSize: 12 }}>...</span>
```

Replace loading/empty text:
```jsx
if (loading) return <p style={{ color: 'var(--text-muted)' }}>로딩 중...</p>
if (!popularity.length) return <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>데이터 없음 — 크롤링을 먼저 실행하세요.</p>
```

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/Guru.jsx frontend/src/pages/GuruManagers.jsx frontend/src/pages/GuruStats.jsx
git commit -m "feat: replace hardcoded colors in Guru pages with CSS vars"
```

---

## Task 8: Reports.jsx — structural color replacement

**Files:**
- Modify: `frontend/src/pages/Reports.jsx`

Reports.jsx is 1364 lines with many inline dark colors. Replace structural colors (bg, text, border) with CSS vars. **Do NOT change chart data colors** (`#ffcc80`, `#43a047`, `#616161`, `#b71c1c`, `#81c784`, `#ef9a9a`) — these convey semantic data meaning.

- [ ] **Step 1: Replace top-level constants**

Replace `TAB_STYLE`:
```jsx
const TAB_STYLE = (active) => ({
  padding: '6px 14px',
  cursor: 'pointer',
  border: 'none',
  borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
  background: 'transparent',
  color: active ? 'var(--accent)' : 'var(--text-muted)',
  fontWeight: active ? 600 : 400,
  fontSize: 13,
})
```

Replace `TH` and `TD` constants (near top of file, lines ~17-18):
```jsx
const TH = { padding: '6px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', whiteSpace: 'nowrap', fontSize: 11, color: 'var(--text-muted)', position: 'sticky', top: 0, zIndex: 2, background: 'var(--bg-surface)' }
const TD = { padding: '5px 10px', textAlign: 'right', borderBottom: '1px solid var(--border)', fontSize: 12 }
```

- [ ] **Step 2: Replace TargetTooltip popup colors**

In `TargetTooltip` component (around line 63-78), replace the popup `<div>` style:
```jsx
<div style={{
  position: 'fixed',
  top: pos.top,
  left: pos.left,
  zIndex: 9999,
  background: 'var(--bg-card)',
  border: '1px solid var(--border)',
  borderRadius: 6,
  padding: '10px 14px',
  minWidth: 200,
  fontSize: 12,
  color: 'var(--text)',
  boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
  pointerEvents: 'none',
  lineHeight: 1.8,
}}>
  <div style={{ color: 'var(--accent)', fontWeight: 700, marginBottom: 6, fontSize: 11 }}>목표가 근거</div>
```

Replace all `color: '#78909c'` in that tooltip grid with `color: 'var(--text-muted)'`.

- [ ] **Step 3: Replace GapCell highlight background**

In `GapCell` component (around line 109):
```jsx
<td style={{ ...TD, color: baseColor, background: highlight ? 'var(--bg-hover)' : undefined, border: highlight ? '2px solid var(--accent)' : undefined, fontWeight: highlight ? 700 : undefined }}>
```

- [ ] **Step 4: Replace all remaining structural dark colors**

Use find-and-replace in `Reports.jsx` for these mappings:

| Find (exact string in style props) | Replace with |
|-------------------------------------|--------------|
| `'#111827'` | `'var(--bg-card)'` |
| `'#1a1a2e'` | `'var(--bg-card)'` |
| `'#1e1e2e'` | `'var(--bg-surface)'` |
| `'#0d1117'` | `'var(--bg)'` |
| `'#1a2a3a'` | `'var(--bg-surface)'` |
| `'#2a3a4a'` | `'var(--border)'` |
| `'#3a4a6a'` | `'var(--border)'` |
| `'1px solid #333'` | `'1px solid var(--border)'` |
| `'1px solid #2a3a4a'` | `'1px solid var(--border)'` |
| `'1px solid #1e1e1e'` | `'1px solid var(--border)'` |
| `'1px solid #1a2a3a'` | `'1px solid var(--border)'` |
| `color: '#e0e0e0'` | `color: 'var(--text)'` |
| `color: '#ccc'` | `color: 'var(--text)'` |
| `color: '#aaa'` | `color: 'var(--text-muted)'` |
| `color: '#888'` | `color: 'var(--text-muted)'` |
| `color: '#666'` | `color: 'var(--text-muted)'` |
| `color: '#555'` | `color: 'var(--text-muted)'` |
| `color: '#78909c'` | `color: 'var(--text-muted)'` |
| `color: '#546e7a'` | `color: 'var(--text-muted)'` |
| `color: '#90caf9'` | `color: 'var(--text-heading)'` |
| `color: '#80cbc4'` | `color: 'var(--accent)'` |
| `color: '#4fc3f7'` | `color: 'var(--accent)'` |
| `strokeDasharray="3 3" stroke="#1e2a3a"` | `strokeDasharray="3 3" stroke="var(--chart-grid)"` |
| `stroke="#333"` | `stroke="var(--border)"` |
| `fill: '#78909c'` | `fill: 'var(--text-muted)'` |
| `'rgba(0,0,0,0.6)'` in boxShadow | `'rgba(0,0,0,0.4)'` |

**Do NOT replace** these chart data colors: `#ffcc80`, `#43a047`, `#616161`, `#b71c1c`, `#81c784`, `#ef9a9a`, `#b0bec5`, `rsiColor(...)`.

- [ ] **Step 5: Verify in browser**

Open `http://localhost:5173/reports`, select a stock report. Switch between all 4 themes and confirm:
- Background, text, borders change correctly
- Charts still show readable data (grid lines change, data colors stay)
- Consensus chart section renders in all themes

- [ ] **Step 6: Commit**

```bash
git add frontend/src/pages/Reports.jsx
git commit -m "feat: replace hardcoded colors in Reports.jsx with CSS vars"
```

---

## Task 9: Final verification + commit

- [ ] **Step 1: Run the dev server and manually verify all 4 themes across all pages**

Open each page and switch through all 4 themes:
- `http://localhost:5173/` — 종목 관리 (Portfolio)
- `http://localhost:5173/reports` — 리포트 (open a stock)
- `http://localhost:5173/guru` — 구루
- `http://localhost:5173/settings` — 설정

Check: text readable, inputs visible, buttons styled, charts legible.

- [ ] **Step 2: Reload page and confirm theme persists**

Reload at `http://localhost:5173`. The last-selected theme should be active immediately (no flash of dark theme).

- [ ] **Step 3: Final commit if anything was missed**

```bash
git add -p  # review any remaining changes
git commit -m "feat: finalize theme system — all pages themed"
```
