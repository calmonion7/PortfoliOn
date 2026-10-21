"""prod 심층 리포트 판을 dev 스택(127.0.0.1:8084)에 복사한다 — 라이브 프로브 표본 확보용(task#395).

dev 백엔드 컨테이너 **안에서** 돈다(admin 토큰을 dev JWT_SECRET으로 만들어 그 자리에서 쓰고 출력하지 않는다):
    docker exec -i portfolion-dev-backend-1 python - 000660 LHX:2026-10-21 < scripts/dev-seed-analyst-report.py

- prod에는 GET만 한다(테스트 계정). dev에는 COWORK_API_KEY가 없고 테스트 계정은 user라 admin JWT가 필요하다.
- 조회 응답은 발행 본문이 아니다: 서버 필드(computed·tally·base_rate·gauge.origin/near_boundary)를 빼고,
  계산 렌즈(3·4·5·8)의 signal·flip·gauge·conditions는 서버가 켜므로 빼며, 렌즈 3 basis는 computed.basis에서 되살린다.
- ⚠️ 발행일은 원본 날짜가 아니라 **dev 서버의 오늘(KST)** 이다(publish_report가 정한다). 같은 날 재실행은 그 판을 덮는다.
- dev에 그 종목 스냅샷이 없으면 409. 날짜 생략 시 prod 최신 판.
"""
import os
import sys
from datetime import datetime, timedelta, timezone

import requests
from jose import jwt

from routers.analyst_reports import LensIn
from services.analyst_lenses import COMPUTED_LENSES
from services.db import query

PROD, DEV = "https://portfolion.taebro.com", "http://127.0.0.1:8000"
UA = {"User-Agent": "curl/8.7.1"}   # Cloudflare가 python 기본 UA를 막는다(비 JSON 응답)
LENS_KEYS = set(LensIn.model_fields)


def to_body(rep):
    lenses = []
    for l in rep["lenses"]:
        x = {k: v for k, v in l.items() if k in LENS_KEYS and v is not None}
        if l["id"] in COMPUTED_LENSES:
            for k in ("signal", "flip", "gauge", "conditions"):
                x.pop(k, None)
            if l["id"] == 3 and (l.get("computed") or {}).get("basis"):
                x["basis"] = l["computed"]["basis"]
        elif "gauge" in x:
            x["gauge"] = {k: v for k, v in x["gauge"].items() if k not in ("origin", "near_boundary")}
        lenses.append(x)
    return {"format": 2, "title": rep["title"], "structure": rep["structure"], "lenses": lenses}


def main(args):
    if not args:
        sys.exit(__doc__)
    admin = query("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1")[0]["id"]
    dev_tok = jwt.encode({"sub": str(admin), "exp": datetime.now(timezone.utc) + timedelta(minutes=10)},
                         os.environ["JWT_SECRET"], algorithm="HS256")
    login = requests.post(f"{PROD}/api/auth/login", headers=UA, timeout=20,
                          json={"email": "test@portfolion.com", "password": "test1234"}).json()
    ph = {**UA, "Authorization": f"Bearer {login['access_token']}"}
    for arg in args:
        ticker, _, date = arg.partition(":")
        if not date:
            date = requests.get(f"{PROD}/api/analyst-reports/{ticker}", headers=ph, timeout=20).json()["reports"][0]["published_date"]
        rep = requests.get(f"{PROD}/api/analyst-reports/{ticker}/{date}", headers=ph, timeout=20)
        if rep.status_code != 200:
            print(f"{ticker} {date} prod GET {rep.status_code}")
            continue
        r = requests.post(f"{DEV}/api/analyst-reports/{ticker}", json=to_body(rep.json()), timeout=60,
                          headers={"Authorization": f"Bearer {dev_tok}"})
        print(f"{ticker} (prod {date}) → dev {r.status_code} {r.text[:300]}")


if __name__ == "__main__":
    main(sys.argv[1:])
