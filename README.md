# PortfoliOn

주식 포트폴리오 관리 & 리포트 생성 앱

## 빠른 시작

### Windows

```bat
start.bat
```

### macOS / Linux

```bash
./start.sh
```

백엔드(8000)와 프론트엔드(5173) 서버를 백그라운드로 실행합니다.

## 서버 종료

### Windows

```bat
stop.bat
```

### macOS / Linux

```bash
./stop.sh
```

## 수동 실행

### Windows

```bat
cd backend
venv\Scripts\python -m uvicorn main:app --reload --port 8000
```

```bat
cd frontend
npm run dev
```

### macOS / Linux

```bash
cd backend
source venv/bin/activate
uvicorn main:app --reload --port 8000
```

```bash
cd frontend
npm run dev
```

## 로그

**Windows**: `%TEMP%\portfolion-backend.log`, `%TEMP%\portfolion-frontend.log`

**macOS / Linux**: `/tmp/portfolion-backend.log`, `/tmp/portfolion-frontend.log`

## 접속 주소

| 서비스 | 주소 |
|--------|------|
| 프론트엔드 | http://localhost:5173 |
| 백엔드 API | http://localhost:8000 |
| API 문서 | http://localhost:8000/docs |

## GitHub SSH 설정

처음 clone하거나 새 머신에서 작업할 때 SSH 키를 등록해야 합니다.

### 1. SSH 키 생성

```bash
ssh-keygen -t ed25519 -C "your@email.com" -f ~/.ssh/id_ed25519 -N ""
```

### 2. 공개키 복사

**Windows (PowerShell)**
```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub
```

**macOS / Linux**
```bash
cat ~/.ssh/id_ed25519.pub
```

### 3. GitHub에 등록

→ https://github.com/settings/ssh/new 에서 공개키 붙여넣기

### 4. 연결 테스트

```bash
ssh -T git@github.com
# Hi calmonion7! You've successfully authenticated...
```

### 5. Remote URL을 SSH로 전환

```bash
git remote set-url origin git@github.com:calmonion7/PortfoliOn.git
```

이후 `git push` 시 토큰 없이 동작합니다.

## 프로젝트 구조

```
PortfoliOn/
├── start.bat / start.sh  # 서버 실행
├── stop.bat  / stop.sh   # 서버 종료
├── backend/
│   ├── main.py
│   ├── routers/          # portfolio, watchlist, stocks, report, guru
│   ├── services/         # storage, market, charts, indicators
│   │                     # report_generator, scraper, guru_scraper, guru_stats
│   ├── data/             # JSON 파일 저장소 (holdings, watchlist, stocks, schedule)
│   └── reports/          # 생성된 Markdown 리포트 (정적 파일 제공)
└── frontend/
    └── src/
        ├── pages/        # Portfolio, Reports, Settings
        │                 # Guru, GuruCrawlSettings, ReportSchedule
        └── components/   # StockModal, PromoteModal, MarkdownViewer
```
