"""메뉴 권한 키 집합의 4소스 드리프트 감시 (B74).

같은 집합이 네 곳에 따로 적혀 있다:
  ① backend/routers/auth.py  ALL_MENUS       — admin이면 /me가 전체를 반환
  ② backend/routers/admin.py ALL_MENUS       — 권한 쓰기 화이트리스트 + 응답 base dict
  ③ frontend/src/components/PermissionPanel.jsx ALL_MENUS — 관리 화면 렌더 키 목록
  ④ backend/app_schema.sql   default_menu_permissions 시드 — DB 기본 권한 행

넷 다 *키 집합*이다(표시 라벨은 JSX의 별도 MENU_LABELS가 갖는다) — task#251의
"필드를 합칠 때 역할 수를 세라"에 따라 소비처를 확인했고 역할 겸직은 없다.

정본은 5키(portfolio·research·market·guru·settings)이며 ADR-0025가
"ALL_MENUS 5키 불변"을 경계로 못박고 있다. ①만 6번째 키 'analysis'로 드리프트해
있었고 그 키는 프론트에서 메뉴 권한으로 소비되지 않는다
(navSections.js의 perm 값에 없다 — 'analysis'는 Portfolio/ReportDetailTabs 내부 탭 이름).

파싱 실패 시 조용히 통과하지 않도록 각 소스가 비어 있으면 실패시킨다
(빈 집합끼리 == 로 통과하는 것이 이 클래스의 전형적 무이빨 축이다).
"""
import io
import re
from pathlib import Path

import pytest

from routers.admin import ALL_MENUS as ADMIN_ALL_MENUS
from routers.auth import ALL_MENUS as AUTH_ALL_MENUS

_BACKEND = Path(__file__).resolve().parents[1]
_REPO = _BACKEND.parent
_PANEL = _REPO / "frontend" / "src" / "components" / "PermissionPanel.jsx"
_SCHEMA = _BACKEND / "app_schema.sql"
_NAV = _REPO / "frontend" / "src" / "navSections.js"


def _read(path: Path) -> str:
    if not path.exists():
        pytest.fail(f"소스 파일이 사라졌다: {path} — 이 테스트의 감시 대상을 옮겼다면 경로를 갱신할 것")
    return io.open(path, encoding="utf-8").read()


def _nonempty(name: str, keys: set) -> set:
    assert keys, f"{name} 파싱 결과가 비었다 — 파싱이 깨졌거나 소스가 사라졌다(빈 집합으로 통과시키지 않는다)"
    return keys


def _panel_menus() -> set:
    m = re.search(r"export const ALL_MENUS\s*=\s*\[([^\]]*)\]", _read(_PANEL))
    if not m:
        pytest.fail(f"{_PANEL.name}에서 `export const ALL_MENUS = [...]`를 찾지 못했다")
    return _nonempty("PermissionPanel.jsx", set(re.findall(r"'([a-z_]+)'", m.group(1))))


def _schema_menus() -> set:
    m = re.search(
        r"INSERT INTO default_menu_permissions\s*\([^)]*\)\s*VALUES(.*?);",
        _read(_SCHEMA),
        re.S,
    )
    if not m:
        pytest.fail("app_schema.sql에서 default_menu_permissions 시드 INSERT를 찾지 못했다")
    return _nonempty("app_schema.sql", set(re.findall(r"\('([a-z_]+)'", m.group(1))))


def _nav_perms() -> set:
    return _nonempty("navSections.js", set(re.findall(r"perm:\s*'([a-z_]+)'", _read(_NAV))))


def _literal_gated_perms() -> set:
    """`menuPermissions.includes('<key>')` 리터럴로 게이트되는 키 — nav 섹션 밖의 5번째 소스.

    ⚠️ 위 4소스만 대조하면 `settings`에 **원리적으로 블라인드**하다: 그 키는
    `navSections.js`의 `perm:` 값이 아니라 `Masthead.jsx`·`MobileTopActions.jsx`의
    하드코딩 리터럴로 소비된다. 실측(적대 검토) — 4소스에서 `'settings'`를 동시에
    제거하면 이 파일과 형제 인증 테스트가 **전부 초록인 채** 관리자 포함 전 사용자에게서
    설정 진입점이 사라졌다. 그래서 nav의 `perm:`과 이 리터럴 소비처를 *합집합*으로 본다.
    """
    keys = set()
    for path in sorted((_REPO / "frontend" / "src").rglob("*.jsx")):
        if "/test/" in str(path):
            continue  # 테스트의 mock 리터럴은 소비처가 아니다
        keys |= set(re.findall(r"menuPermissions\.includes\(\s*'([a-z_]+)'\s*\)", _read(path)))
    return _nonempty("menuPermissions.includes('<key>') 리터럴 소비처", keys)


def test_all_four_sources_agree():
    """4소스가 같은 키 집합을 낸다 — 어느 한 곳이 드리프트하면 여기서 깨진다."""
    auth = _nonempty("routers/auth.py", set(AUTH_ALL_MENUS))
    admin = _nonempty("routers/admin.py", set(ADMIN_ALL_MENUS))
    panel = _panel_menus()
    schema = _schema_menus()

    assert auth == admin, f"auth.py ↔ admin.py 드리프트: {auth ^ admin}"
    assert auth == panel, f"auth.py ↔ PermissionPanel.jsx 드리프트: {auth ^ panel}"
    assert auth == schema, f"auth.py ↔ app_schema.sql 드리프트: {auth ^ schema}"


def test_no_duplicate_keys_in_backend_lists():
    """리스트 형태라 중복이 들어갈 수 있다 — 중복은 /me 응답과 base dict를 조용히 왜곡한다."""
    assert len(AUTH_ALL_MENUS) == len(set(AUTH_ALL_MENUS))
    assert len(ADMIN_ALL_MENUS) == len(set(ADMIN_ALL_MENUS))


def test_nav_perm_keys_are_covered():
    """가드(구동력 없음 — 6키에서도 통과한다): nav가 요구하는 perm 키가 전부 집합에 있다.

    키를 *빼는* 방향의 회귀를 막는다 — navSections.js의 perm 값이 집합에서 빠지면
    admin에게도 그 탭이 사라진다.
    """
    missing = _nav_perms() - set(AUTH_ALL_MENUS)
    assert not missing, f"nav가 요구하는 perm 키가 ALL_MENUS에 없다: {missing}"


def test_literal_gated_perm_keys_are_covered():
    """가드: nav 섹션이 아닌 리터럴 게이트(`settings` 등)의 키도 집합에 있어야 한다.

    4소스 일괄 제거는 서로 여전히 같으므로 `test_all_four_sources_agree`가 통과하고,
    `test_nav_perm_keys_are_covered`는 nav의 `perm:`만 보므로 `settings`를 못 본다 —
    이 축이 그 사각을 덮는다(제거 방향의 회귀 = 진입점 소멸).
    """
    missing = _literal_gated_perms() - set(AUTH_ALL_MENUS)
    assert not missing, (
        f"프론트가 리터럴로 게이트하는 perm 키가 ALL_MENUS에 없다: {missing} — "
        "그 키는 /me 응답에 안 실려 해당 진입점이 전 사용자에게서 사라진다"
    )
