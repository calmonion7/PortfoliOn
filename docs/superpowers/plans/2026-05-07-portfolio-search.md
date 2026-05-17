# Portfolio Search Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a unified search box to `frontend/src/pages/Portfolio.jsx` that filters both 보유종목 and 관심종목 tabs by ticker or company name in real time.

**Architecture:** Client-side only — add `searchQuery` state, derive filtered lists from existing `stocks`/`watchlist` state, insert a search input between the tab bar and the table. No API calls, no backend changes.

**Tech Stack:** React (useState already in use), inline styles matching existing dark theme

---

### Task 1: Add search state, filtered lists, and search input UI

**Files:**
- Modify: `frontend/src/pages/Portfolio.jsx:17-109`

- [ ] **Step 1: Add `searchQuery` state after existing state declarations (line 24)**

Current state block ends at line 24:
```jsx
const [error, setError] = useState('')
```

Add one line after it:
```jsx
const [searchQuery, setSearchQuery] = useState('')
```

- [ ] **Step 2: Add filtered derived lists after the `openAdd` helper (after line 92)**

Add these two constants right before the `return (` on line 94:
```jsx
const q = searchQuery.trim().toLowerCase()
const filteredStocks = stocks.filter(s =>
  !q || s.ticker.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
)
const filteredWatchlist = watchlist.filter(s =>
  !q || s.ticker.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
)
```

- [ ] **Step 3: Insert search input between tab bar and error message**

Current structure after tab bar (lines 110-111):
```jsx
      </div>

      {error && <p style={{ color: '#ef5350', marginBottom: 8 }}>{error}</p>}
```

Replace with:
```jsx
      </div>

      <input
        type="text"
        value={searchQuery}
        onChange={e => setSearchQuery(e.target.value)}
        placeholder="🔍 티커 또는 회사명 검색..."
        style={{
          width: '100%',
          padding: '8px 12px',
          marginBottom: 12,
          background: '#0d1117',
          border: '1px solid #2a3a4a',
          borderRadius: 4,
          color: '#ccc',
          fontSize: 14,
          boxSizing: 'border-box',
        }}
      />

      {error && <p style={{ color: '#ef5350', marginBottom: 8 }}>{error}</p>}
```

- [ ] **Step 4: Replace `stocks.map` with `filteredStocks.map` in holdings table (line 122)**

Change:
```jsx
            {stocks.map(stock => (
```
To:
```jsx
            {filteredStocks.map(stock => (
```

- [ ] **Step 5: Replace empty-check `stocks.length === 0` with `filteredStocks.length === 0` (line 135)**

Change:
```jsx
            {stocks.length === 0 && (
```
To:
```jsx
            {filteredStocks.length === 0 && (
```

- [ ] **Step 6: Replace `watchlist.map` with `filteredWatchlist.map` in watchlist table (line 151)**

Change:
```jsx
            {watchlist.map(stock => (
```
To:
```jsx
            {filteredWatchlist.map(stock => (
```

- [ ] **Step 7: Replace empty-check `watchlist.length === 0` with `filteredWatchlist.length === 0` (line 169)**

Change:
```jsx
            {watchlist.length === 0 && (
```
To:
```jsx
            {filteredWatchlist.length === 0 && (
```

- [ ] **Step 8: Keep tab counts showing total (not filtered) counts — verify lines 104 and 107 still reference `stocks.length` and `watchlist.length`**

These lines should remain unchanged:
```jsx
          보유종목 ({stocks.length})
          관심종목 ({watchlist.length})
```

- [ ] **Step 9: Manually verify in browser**

Start dev server if not running:
```bash
cd frontend && npm run dev
```

Check:
- Search box appears between tabs and table
- Typing a ticker (e.g. "NFLX") filters both tabs
- Switching tabs while search is active keeps the filter
- Clearing search restores full list
- Tab counts show total, not filtered count
- Empty search shows correct "종목을 추가해 주세요" message

- [ ] **Step 10: Commit**

```bash
git add frontend/src/pages/Portfolio.jsx
git commit -m "feat: add unified search box to portfolio page"
```
