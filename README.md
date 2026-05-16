# PortfoliOn

주식 포트폴리오 관리 & 리포트 생성 앱

## 빠른 시작

```bash
./start.sh
```

서버 두 개를 실행하고 브라우저를 자동으로 엽니다.

## 서버 종료

```bash
./stop.sh
```

## 수동 실행

### 백엔드 (FastAPI · 포트 8000)

```bash
cd backend
source .venv/bin/activate
uvicorn main:app --reload --port 8000
```

### 프론트엔드 (Vite · 포트 5173)

```bash
cd frontend
npm run dev
```

## 접속 주소

| 서비스 | 주소 |
|--------|------|
| 프론트엔드 | http://localhost:5173 |
| 백엔드 API | http://localhost:8000 |
| API 문서 | http://localhost:8000/docs |

## 로그

실행 중 로그는 `/tmp/` 에 저장됩니다.

```
/tmp/portfolion-backend.log
/tmp/portfolion-frontend.log
```

## 프로젝트 구조

```
PortfoliOn/
├── start.sh              # 서버 실행 + 브라우저 오픈
├── stop.sh               # 서버 종료
├── backend/
│   ├── main.py
│   ├── routers/          # portfolio, report, watchlist, stocks
│   ├── services/         # indicators, market, charts, scraper, storage, report_generator
│   ├── scheduler.py      # 자동 리포트 스케줄러
│   └── tests/
└── frontend/
    └── src/
        ├── pages/        # Portfolio, Reports, Settings
        └── components/   # StockModal, PromoteModal, MarkdownViewer
```
