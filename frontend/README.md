# PortfoliOn Frontend

React 18 + Vite 기반 프론트엔드. 백엔드 API(`localhost:8000`)와 통신합니다.

## 실행

```bash
npm install
npm run dev
```

http://localhost:5173 에서 확인

## 빌드

```bash
npm run build
```

## 구조

```
src/
├── pages/        # Portfolio, Reports, Settings, Guru 등
├── components/   # StockModal, PromoteModal
├── utils.js      # 공통 유틸 (TAB_STYLE, fmtPrice)
├── App.jsx       # 라우팅
└── main.jsx      # 진입점
```
