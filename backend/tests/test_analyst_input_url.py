"""원자료 원문 링크 `url` (task#409) — 스키마(https만)·발행 때 서버가 열어 확인(확실히 없을 때만 버림).

네트워크는 `services.link_check.requests.get`·`socket.getaddrinfo`를 mock한다(실서버 응답은 dev 실측이 맡는다).
"""
import socket
from unittest.mock import MagicMock, patch

import pytest
import requests
from pydantic import ValidationError

from routers.analyst_reports import RawInput
from services import link_check
from tests.test_analyst_report_lenses import _publish, _raw, crcl_body

PUBLIC = [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443))]


def _resp(status):
    r = MagicMock()
    r.status_code = status
    return r


def _check(url="https://example.com/a", status=200, addr=PUBLIC, get_exc=None, gai_exc=None):
    get = MagicMock(side_effect=get_exc) if get_exc else MagicMock(return_value=_resp(status))
    gai = MagicMock(side_effect=gai_exc) if gai_exc else MagicMock(return_value=addr)
    with patch.object(link_check.requests, "get", get), patch.object(link_check.socket, "getaddrinfo", gai):
        reason = link_check.check_url(url)
    return reason, get


# ── ⓐ 스키마 ────────────────────────────────────────────────────────────

def _ri(**kw):
    return RawInput(value=1, unit="USD M", source="disclosure", ref="10-Q", **kw)


def test_schema_url_optional_and_https_ok():
    assert _ri().url is None
    assert _ri(url="https://www.sec.gov/Archives/x.htm").url == "https://www.sec.gov/Archives/x.htm"


@pytest.mark.parametrize("bad", ["http://example.com/a", "javascript:alert(1)", "ftp://example.com/a",
                                 "https://" + "a" * 493])
def test_schema_rejects_non_https_or_too_long(bad):
    assert len(bad) > 8
    with pytest.raises(ValidationError):
        _ri(url=bad)


def test_schema_accepts_500_chars_boundary():
    assert _ri(url="https://" + "a" * 492).url


# ── ⓑ 확인 함수 ─────────────────────────────────────────────────────────

@pytest.mark.parametrize("status,reason", [(404, "not_found"), (410, "not_found")])
def test_check_drops_when_surely_gone(status, reason):
    assert _check(status=status)[0] == reason


@pytest.mark.parametrize("status", [200, 301, 302, 403, 429, 500, 503])
def test_check_keeps_when_exists_or_unsure(status):
    assert _check(status=status)[0] is None


def test_check_keeps_on_timeout():
    assert _check(get_exc=requests.Timeout())[0] is None


def test_check_drops_dns_failure():
    reason, get = _check(gai_exc=socket.gaierror())
    assert reason == "dns" and get.call_count == 0


def test_check_drops_connection_refused():
    assert _check(get_exc=requests.ConnectionError("refused"))[0] == "refused"


@pytest.mark.parametrize("ip", ["10.0.0.5", "127.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "192.168.1.1"])
def test_check_drops_private_ip_without_request(ip):
    fam = socket.AF_INET6 if ":" in ip else socket.AF_INET
    reason, get = _check(addr=[(fam, socket.SOCK_STREAM, 6, "", (ip, 443))])
    assert reason == "private" and get.call_count == 0


def test_check_drops_if_any_resolved_ip_is_private():
    addr = PUBLIC + [(socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.1.1.1", 443))]
    assert _check(addr=addr)[0] == "private"


def test_check_never_follows_redirects_and_does_not_read_body():
    _, get = _check()
    kw = get.call_args.kwargs
    assert kw["allow_redirects"] is False and kw["stream"] is True and kw["timeout"] == 5
    assert "PortfoliOn link-check" in kw["headers"]["User-Agent"]


# ── ⓒ 발행 ──────────────────────────────────────────────────────────────

LIVE, DEAD = "https://example.com/live", "https://example.com/dead"


def _fake_check(url):
    return "not_found" if url == DEAD else None


def test_publish_without_urls_has_empty_dropped_and_no_calls():
    with patch.object(link_check, "check_url") as chk:
        resp, _ = _publish(crcl_body())
    assert resp.status_code == 201, resp.text
    assert resp.json()["dropped_urls"] == [] and chk.call_count == 0


def test_publish_drops_dead_url_keeps_live_and_checks_each_url_once():
    body = crcl_body()
    body["lenses"][2]["inputs"]["contribution_prev"]["url"] = LIVE
    body["lenses"][2]["inputs"]["contribution_curr"]["url"] = LIVE   # 같은 URL — 한 번만 확인
    body["lenses"][2]["inputs"]["fixed_cost_prev"]["url"] = DEAD
    with patch.object(link_check, "check_url", side_effect=_fake_check) as chk:
        resp, save = _publish(body)
    assert resp.status_code == 201, resp.text
    assert resp.json()["dropped_urls"] == [{"lens": 3, "key": "fixed_cost_prev", "url": DEAD, "reason": "not_found"}]
    assert chk.call_count == 2
    ins = next(l for l in save.call_args.kwargs["lens_report"]["lenses"] if l["id"] == 3)["inputs"]
    assert ins["contribution_prev"]["url"] == LIVE and ins["contribution_curr"]["url"] == LIVE
    assert ins["fixed_cost_prev"]["url"] is None
    assert chk.call_args_list  # 호출 인자는 URL 하나뿐


def test_publish_rejects_http_url_with_reason():
    from tests._reject import assert_rejected
    body = crcl_body()
    body["lenses"][2]["inputs"]["contribution_prev"]["url"] = "http://example.com/x"
    assert_rejected(_publish(body)[0], loc=("body", "lenses", 2, "inputs", "contribution_prev", "url"),
                    type="string_pattern_mismatch")
