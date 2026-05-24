# 로그인 및 다중 사용자 지원 설계

**날짜:** 2026-05-25  
**상태:** 승인됨  

---

## 목표

현재 단일 사용자 JSON 파일 기반 PortfoliOn에 다중 사용자 인증 및 데이터 분리를 도입한다.

- 사용자 규모: 10명+
- 인증 방식: Google / GitHub OAuth (Supabase Auth)
- DB: Supabase PostgreSQL
- 배포: Frontend → Vercel, Backend → Railway

---

## 아키텍처

```
[User Browser]
     │ Google/GitHub OAuth
     ▼
[Supabase Auth] ──JWT──▶ [React (Vercel)]
                               │ Authorization: Bearer <jwt>
                               ▼
                     [FastAPI (Railway)]
                               │ supabase-py (user_id 필터)
                               ▼
                     [Supabase PostgreSQL]
```

**인증 흐름:**
1. 사용자가 LoginPage에서 "Google로 로그인" 클릭
2. Supabase Auth가 OAuth 리디렉션 처리
3. 성공 시 Supabase JWT 발급 → 프론트엔드 세션 저장
4. 모든 API 요청에 `Authorization: Bearer <jwt>` 헤더 포함
5. FastAPI 미들웨어에서 JWT 검증 → `user_id` 추출 → DB 쿼리 필터링

---

## 데이터 모델

### 공유 테이블 (전체 사용자 읽기 공유)

```sql
-- 종목 마스터
CREATE TABLE tickers (
  ticker    text PRIMARY KEY,
  name      text,
  market    text,
  sector    text,
  data      jsonb
);

-- 종목별 스냅샷/리포트 (공유)
CREATE TABLE snapshots (
  ticker    text REFERENCES tickers(ticker),
  date      date,
  data      jsonb NOT NULL,
  PRIMARY KEY (ticker, date)
);
```

### 사용자별 테이블

```sql
-- 사용자 보유/관심 종목
CREATE TABLE user_stocks (
  user_id    uuid REFERENCES auth.users(id),
  ticker     text REFERENCES tickers(ticker),
  type       text NOT NULL,  -- 'holding' | 'watchlist'
  shares     numeric,
  avg_price  numeric,
  data       jsonb,          -- 기타 개인 데이터
  PRIMARY KEY (user_id, ticker)
);

-- 리포트 스케줄
CREATE TABLE schedules (
  user_id  uuid PRIMARY KEY REFERENCES auth.users(id),
  data     jsonb NOT NULL
);

-- Guru 운용역 데이터
CREATE TABLE guru_managers (
  user_id  uuid PRIMARY KEY REFERENCES auth.users(id),
  data     jsonb NOT NULL
);

-- 일일 다이제스트
CREATE TABLE digests (
  user_id     uuid REFERENCES auth.users(id),
  date        date,
  data        jsonb NOT NULL,
  PRIMARY KEY (user_id, date)
);
```

**설계 원칙:**
- `tickers` + `snapshots`: 종목 데이터는 사용자 간 공유. 동일 종목의 리포트/재무 데이터는 한 번만 저장.
- `user_stocks`: 보유량, 단가 등 개인 포트폴리오 데이터만 분리.
- 캐시 데이터(calendar/, consensus/)는 서버 로컬 파일 캐시 유지, user_id 접두사 폴더로 분리.

---

## 백엔드 변경 사항

### 새로 추가

**`backend/auth.py`** — JWT 검증 FastAPI Dependency
```python
async def get_current_user(token: str = Depends(oauth2_scheme)) -> str:
    # Supabase JWT 검증 → user_id 반환
    # 실패 시 401 반환
```

**`backend/services/db.py`** — Supabase 클라이언트
```python
from supabase import create_client
supabase = create_client(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY)
```

**`backend/scripts/migrate_to_supabase.py`** — 1회성 마이그레이션 스크립트

### 수정

**`backend/services/storage.py`** — JSON 파일 I/O → Supabase DB 쿼리로 전면 교체. 함수 시그니처에 `user_id` 파라미터 추가.

**모든 라우터** — `user_id: str = Depends(get_current_user)` 파라미터 추가, storage 호출에 `user_id` 전달.

### 환경변수 추가
```
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=
```

---

## 프론트엔드 변경 사항

### 새로 추가

**`frontend/src/supabase.js`**
```js
import { createClient } from '@supabase/supabase-js'
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
)
```

**`frontend/src/pages/LoginPage.jsx`** — Google / GitHub 로그인 버튼 UI

**`frontend/src/api.js`** — axios 인스턴스, Authorization 헤더 자동 첨부 인터셉터

### 수정

**`frontend/src/App.jsx`**
- Supabase 세션 상태 구독
- 비로그인 시 `<LoginPage />` 렌더, 로그인 시 기존 네비/라우팅 렌더
- 기존 페이지 컴포넌트 변경 없음

### 환경변수 추가
```
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
```

---

## 데이터 마이그레이션

**스크립트:** `backend/scripts/migrate_to_supabase.py`

1. `stocks.json` → `tickers` 테이블 INSERT (ticker, name, market, sector)
2. `stocks.json` → `user_stocks` 테이블 INSERT (기존 데이터는 초기 관리자 user_id로)
3. `backend/snapshots/` 폴더 순회 → `snapshots` 테이블 INSERT
4. `schedule.json` → `schedules` 테이블
5. `guru_managers.json` → `guru_managers` 테이블

기존 JSON 파일은 삭제하지 않고 보관 (롤백 대비).

---

## 배포 설정

### Railway (Backend)
- `backend/` 폴더를 루트로 배포
- `Procfile` 또는 Railway 설정: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- 환경변수: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `ANTHROPIC_API_KEY`, `FRED_API_KEY`, `KITA_API_KEY`

### Vercel (Frontend)
- `frontend/` 폴더를 루트로 배포
- 환경변수: `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_API_BASE_URL` (Railway URL)
- `vite.config.js`: 프록시 설정을 Railway URL로 변경

---

## 구현 범위 요약

| 영역 | 작업 유형 |
|------|---------|
| Supabase 프로젝트 설정 + DB 스키마 | 신규 |
| `backend/auth.py` (JWT 미들웨어) | 신규 |
| `backend/services/db.py` (Supabase 클라이언트) | 신규 |
| `backend/services/storage.py` (DB 교체) | 전면 수정 |
| 모든 라우터 (`user_id` 파라미터 추가) | 부분 수정 |
| `frontend/src/supabase.js` | 신규 |
| `frontend/src/pages/LoginPage.jsx` | 신규 |
| `frontend/src/api.js` (axios 인터셉터) | 신규 |
| `frontend/src/App.jsx` (인증 게이트) | 부분 수정 |
| `backend/scripts/migrate_to_supabase.py` | 신규 |
| Railway + Vercel 배포 설정 | 신규 |
