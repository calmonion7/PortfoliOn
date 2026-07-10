# 0017 — 거대 파일 → 패키지 분리 규약: `__init__` re-export로 표면 보존 + 내부 patch 경로만 이전

- 상태: 채택 (Accepted)
- 날짜: 2026-06-19
- 관련: task #72(backlog_parser 추출), #73(market 패키지), #74(scheduler 패키지), #75(storage 패키지), `.forge/codebase/CONVENTIONS.md`

## 맥락 (Context)

`backend/services/`·루트의 거대 단일 파일(`market.py` 797줄, `scheduler.py` 597줄, `storage.py` 424줄 등)을 seam별 패키지로 쪼개는 순차 리팩토링을 진행 중이다. 이 파일들은 수십 개의 외부 소비처(라우터·서비스)와 테스트가 `from services import market; market.X`(모듈 속성) 또는 `from services.market import _norm_sector`(직접 심볼, private 포함)로 의존하고, 테스트는 내부 함수를 `monkeypatch`/`patch`한다.

순수 코드 이동 리팩토링이라 **동작은 byte-identical**이어야 하는데, 단순히 파일을 쪼개면 두 가지가 깨진다: ① 외부 호출부의 import 경로, ② 테스트의 patch 경로(파이썬은 함수가 정의된 모듈의 전역에서 이름을 조회하므로, 패키지 루트에 re-export된 이름을 patch해도 서브모듈 내부 호출에는 도달하지 못한다).

## 결정 (Decision)

거대 파일을 `X.py` → `X/` 패키지로 쪼갤 때 다음 규약을 따른다:

1. **`__init__.py` re-export로 공개 표면을 전부 보존** — 공개 심볼뿐 아니라 **외부가 직접 import하는 private**(`_norm_sector`·`_yf_sym` 등)까지 re-export한다. `from services import X; X.Y`(모듈 속성)와 `from services.X import Y`(직접 심볼) 둘 다 이전 전 심볼에 대해 해석되어야 한다.

2. **외부 호출부·심볼명은 건드리지 않는다** — 라우터·서비스의 import 문을 고치지 않고, private 헬퍼를 public으로 개명하지 않는다. 개명/이동은 외부 호출부를 건드려 scope를 확대하므로 분리 리팩토링의 범위 밖이다.

3. **부분초기화 순환 회피** — 서브모듈은 공유 헬퍼/상태를 **leaf 모듈에서** import한다(패키지 루트 경유 금지). 공유 가변 상태(예: yfinance 모듈, APScheduler 인스턴스)는 leaf(`format.py`·`_state.py`)나 `__init__`에 두고 서브모듈이 import한다.

4. **내부 호출+테스트 patch가 겹치는 심볼만 patch 경로를 이전** — 패키지 *내부에서* 다른 함수가 호출하면서 *동시에* 테스트가 patch하는 심볼은, re-export로 못 미치므로 patch 경로를 서브모듈로 옮긴다(`services.market._naver_get` → `services.market.kr._naver_get`, `services.storage.query` → `services.storage.portfolio.query`). 단언 자체는 불변. **외부 소비처를 제어하려는 patch**(`monkeypatch.setattr(storage, "get_batch_schedule", …)`)는 소비처가 모듈 속성으로 조회하므로 **이전 불필요**(패키지 모듈 객체에 속성이 꽂힌다). **객체 속성 변경 patch**(`setattr(scheduler._scheduler, "start", …)`)도 공유 객체라 이전 불필요.

5. **byte-identical** — 로직·캐시 정책·throttle·fetch 체인 불변. 순수 이동 + re-export. 구 단일 파일은 삭제한다.

## 고려한 대안 (Alternatives)

1. **개명 + 외부 호출부 전수 수정** — 깔끔한 공개 API를 얻지만 수십 개 호출부를 동시에 건드려 분리 1건의 scope가 폭발하고, "순수 이동" 검증(byte-identical)이 불가능해진다. 기각.
2. **re-export 없이 서브모듈 직접 import로 호출부 전환** — `from services.market import get_quote` → `from services.market.us import get_quote`처럼 모든 호출부를 새 경로로. 호출부 N곳 수정 + private 직접 import는 캡슐화 약화. 기각.
3. **공유 상태를 `__init__`에만 두고 서브모듈이 루트에서 import** — 부분초기화 순환(`__init__` 실행 중 서브모듈이 `from services.X import _state` 시도). leaf 모듈 패턴으로 회피. 기각.

## 결과 (Consequences)

- `__init__.py`가 private까지 re-export하는 모습은 맥락 없이는 의외다 — 이 ADR이 "외부 호출부·테스트 patch 경로를 안 건드리려는 의도"임을 기록한다.
- re-export 표면이 load-bearing이 된다: 이후 코드가 `services.X.Y` 해석에 의존하므로, 서브모듈을 다시 재배치할 때 re-export 목록을 함께 유지해야 한다.
- **re-export는 `import *`가 아니라 명시 named import로 한다** — `from .sub import *`는 `__all__` 미정의 시 underscore private(`_norm_sector`·`_JOB_FUNCS`·`_now_kst` 등)을 건너뛰어 보존 표면에 구멍이 난다. 서브모듈마다 `__all__`을 다는 것보다 `__init__`에서 명시 named import로 private까지 re-export하는 게 견고하다. (task#73·74·75 분리에서 세 작업 모두 독립적으로 이 선택에 도달.)
- patch 경로 이전은 **내부 호출+patch 겹침** 케이스에 한정된다. 분리 전에 테스트 patch 사이트를 grep해 ① 외부 소비처 제어(이전 불필요) ② 객체 속성 변경(이전 불필요) ③ 내부 호출 심볼 patch(이전 필요)로 분류하는 것이 DoD의 일부다.
- 검증 게이트는 항상 **전체 pytest green + 이전 전 공개·내부참조 심볼 전부 해석**이다(import 회귀 0).
