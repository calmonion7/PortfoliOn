# Theme System Design — 2026-05-20

## Overview

Add 4 themes (dark, beige, white, pastel) to the PortfoliOn frontend. Theme is selected via color swatches in the nav bar and persisted to localStorage.

## Approach

CSS Custom Properties on `data-theme` attribute on `<html>`. Theme palettes defined in `index.css`. All hardcoded inline colors replaced with `var(--token)` references. No new dependencies.

## Color Tokens (17)

| Token | Purpose |
|-------|---------|
| `--bg` | Page background |
| `--bg-nav` | Navigation bar background |
| `--bg-card` | Card / section background |
| `--bg-surface` | Table header, modal, input |
| `--bg-hover` | Hover state |
| `--text` | Primary text |
| `--text-muted` | Secondary / muted text |
| `--text-heading` | Heading and label accent |
| `--border` | Borders and dividers |
| `--accent` | Active links, focus ring |
| `--accent-btn` | Primary button background |
| `--positive` | Profit / buy |
| `--negative` | Loss / sell |
| `--overlay` | Modal backdrop |
| `--chart-grid` | Chart grid lines |
| `--input-bg` | Form input background |
| `--input-border` | Form input border |

## Theme Palettes

### dark (default — current design)
```
--bg:           #121212
--bg-nav:       #1a1a2e
--bg-card:      #1a1a2e
--bg-surface:   #1e1e2e
--bg-hover:     #1e1e1e
--text:         #e0e0e0
--text-muted:   #9ca3af
--text-heading: #90caf9
--border:       #333333
--accent:       #4fc3f7
--accent-btn:   #1565c0
--positive:     #66bb6a
--negative:     #ef5350
--overlay:      rgba(0,0,0,0.7)
--chart-grid:   #1e2a3a
--input-bg:     #1e1e2e
--input-border: #444444
```

### beige (warm paper)
```
--bg:           #f5f0e8
--bg-nav:       #ede5d8
--bg-card:      #ede8de
--bg-surface:   #e4ddd0
--bg-hover:     #ddd6c8
--text:         #3d3530
--text-muted:   #7a6f68
--text-heading: #6b4226
--border:       #d4cfc6
--accent:       #b85c2a
--accent-btn:   #8b4513
--positive:     #3d7a45
--negative:     #c0392b
--overlay:      rgba(0,0,0,0.4)
--chart-grid:   #ddd8ce
--input-bg:     #fdf8f0
--input-border: #c8c2b8
```

### white (clean light)
```
--bg:           #ffffff
--bg-nav:       #f8f9fa
--bg-card:      #f8f9fa
--bg-surface:   #f0f2f5
--bg-hover:     #e8eaed
--text:         #1a1a1a
--text-muted:   #6b7280
--text-heading: #1d4ed8
--border:       #e5e7eb
--accent:       #2563eb
--accent-btn:   #2563eb
--positive:     #16a34a
--negative:     #dc2626
--overlay:      rgba(0,0,0,0.4)
--chart-grid:   #eeeeee
--input-bg:     #ffffff
--input-border: #d1d5db
```

### pastel (soft blue-purple)
```
--bg:           #f0f4ff
--bg-nav:       #dde4ff
--bg-card:      #e8eeff
--bg-surface:   #d8e0ff
--bg-hover:     #ccd5ff
--text:         #2d3561
--text-muted:   #6b75a8
--text-heading: #3949ab
--border:       #c5cae9
--accent:       #5c6bc0
--accent-btn:   #3f51b5
--positive:     #388e3c
--negative:     #d32f2f
--overlay:      rgba(0,0,0,0.3)
--chart-grid:   #dde3f8
--input-bg:     #f8f9ff
--input-border: #9fa8da
```

## Theme Switcher UI

Location: right end of navigation bar.

Four 18px circles, 6px gap. Selected theme has a white 2px ring. `title` attribute shows theme name on hover.

Swatch colors:
- dark: `#1a1a2e`
- beige: `#d4b896`
- white: `#e8e8e8` (light border to distinguish from nav bg on white theme)
- pastel: `#9fa8da`

```
[ Portfolio Manager ]  종목 관리  리포트  구루  설정     ⬤ ○ ○ ○
```

## State Management

- `App.jsx` holds `theme` state, initialized from `localStorage.getItem('theme') ?? 'dark'`
- On mount and on change: `document.documentElement.setAttribute('data-theme', theme)`
- On change: `localStorage.setItem('theme', theme)`

## Files to Change

| File | Change |
|------|--------|
| `src/index.css` | Add `:root` (dark) + `[data-theme="beige/white/pastel"]` blocks |
| `src/App.css` | Replace hardcoded colors with `var(--token)` |
| `src/App.jsx` | Add theme state + swatch UI; replace inline colors |
| `src/pages/Portfolio.jsx` | Replace inline hardcoded colors |
| `src/pages/Reports.jsx` | Replace inline hardcoded colors |
| `src/pages/Settings.jsx` | Replace inline hardcoded colors |
| `src/pages/Guru.jsx` | Replace inline hardcoded colors |
| `src/pages/GuruManagers.jsx` | Replace inline hardcoded colors |
| `src/pages/GuruStats.jsx` | Replace inline hardcoded colors |
| `src/pages/GuruCrawlSettings.jsx` | Replace inline hardcoded colors |
| `src/pages/ReportSchedule.jsx` | Replace inline hardcoded colors |
| `src/components/StockModal.jsx` | Replace inline hardcoded colors |
| `src/components/PromoteModal.jsx` | Replace inline hardcoded colors |
| `src/components/MarkdownViewer.jsx` | Replace inline hardcoded colors |

## Out of Scope

- Chart fill/stroke colors inside recharts components (these are data visualization colors that stay fixed per semantic meaning — positive/negative already tokenized)
- Specific `--80cbc4` teal colors used in consensus chart headers (leave as-is for now, they're decorative)
