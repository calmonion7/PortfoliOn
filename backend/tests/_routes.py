"""라이브 `app` 라우트 트리 평탄화 (task#233).

FastAPI 버전에 따라 `include_router`로 들어온 라우트의 노출 방식이 다르다 —
로컬 `.venv`(0.128.x)는 `app.routes`에 평탄하게 들어오지만, 배포 이미지(0.138+)는
`_IncludedRouter` 래퍼로 감싸 `.path`도 `.routes`도 노출하지 않고 `original_router`만 준다.
평탄 순회는 후자에서 **라우트 0개를 세며 조용히 통과**하므로(감사 스크립트가 실제로 그랬다)
라우트를 열거하는 테스트는 모두 이 헬퍼를 거쳐야 두 환경에서 같은 결과가 나온다.

`requirements.txt`가 핀 없는 `fastapi>=0.104.0`이라 이 발산은 계속 진행된다.
(main.py의 include_router는 prefix 인자를 쓰지 않으므로 원 라우터의 경로가 최종 경로다.)
"""


def walk_routes(routes):
    """`routes`·`original_router`를 재귀 하강해 `.path`를 가진 라우트만 yield."""
    for r in routes:
        for attr in ("routes", "original_router"):
            child = getattr(r, attr, None)
            if child is not None:
                yield from walk_routes(getattr(child, "routes", child) or [])
        if getattr(r, "path", None):
            yield r
