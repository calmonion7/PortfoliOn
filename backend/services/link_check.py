"""원자료 원문 링크 확인 (task#409) — 발행 때 서버가 URL을 열어 **확실히 없는 주소만** 버린다.

- 버림: 404·410 / 도메인 조회 실패 / 연결 거부 / 사설·루프백·링크로컬·예약 IP(SSRF 방지).
- 유지: 403·429·5xx·타임아웃·3xx(리다이렉트는 따라가지 않는다 — 대상이 사내 주소일 위험을 없앤다).
- 발행 주체가 admin·API 키라 DNS 리바인딩 TOCTOU는 받아들인다. 공유 가변 상태 없음(publish는 sync def → 스레드풀).
"""
import ipaddress
import logging
import socket
from concurrent.futures import ThreadPoolExecutor
from typing import List, Optional
from urllib.parse import urlsplit

import requests

logger = logging.getLogger(__name__)

_TIMEOUT = 5
_MAX_WORKERS = 8
# SEC(sec.gov)는 연락처가 든 UA가 아니면 없는 경로에도 403을 줘서 링크를 못 거른다 — 연락처를 UA에 싣는다(task#409 후속)
_HEADERS = {"User-Agent": "PortfoliOn link-check (+https://portfolion.taebro.com) taebro80@gmail.com"}


def _is_private(ip: str) -> bool:
    addr = ipaddress.ip_address(ip.split("%")[0])
    if addr.version == 6 and addr.ipv4_mapped:
        addr = addr.ipv4_mapped
    return (addr.is_private or addr.is_loopback or addr.is_link_local or addr.is_reserved
            or addr.is_multicast or addr.is_unspecified)


def check_url(url: str) -> Optional[str]:
    """버려야 하면 사유(`private`·`dns`·`refused`·`not_found`), 유지면 None."""
    host = urlsplit(url).hostname
    if not host:
        return "dns"
    try:
        infos = socket.getaddrinfo(host, 443)
    except (socket.gaierror, UnicodeError):
        return "dns"
    if any(_is_private(i[4][0]) for i in infos):
        return "private"
    try:
        resp = requests.get(url, stream=True, timeout=_TIMEOUT, allow_redirects=False, headers=_HEADERS)
    except requests.ConnectionError:
        return "refused"
    except requests.RequestException:
        return None   # 타임아웃 등 — 확실히 없다고 말할 수 없다
    try:
        return "not_found" if resp.status_code in (404, 410) else None
    finally:
        resp.close()


def sanitize_input_urls(lenses: List[dict]) -> List[dict]:
    """렌즈들의 inputs에서 `url`을 확인해 확실히 없는 것은 None으로 비운다. 비운 건을 반환(`dropped_urls`)."""
    found = [(l["id"], k, r["url"]) for l in lenses for k, r in (l.get("inputs") or {}).items() if r.get("url")]
    if not found:
        return []
    urls = sorted({u for _, _, u in found})
    with ThreadPoolExecutor(max_workers=min(_MAX_WORKERS, len(urls))) as ex:
        verdict = dict(zip(urls, ex.map(check_url, urls)))
    dropped = []
    for lid, key, url in found:
        if verdict[url]:
            next(l for l in lenses if l["id"] == lid)["inputs"][key]["url"] = None
            dropped.append({"lens": lid, "key": key, "url": url, "reason": verdict[url]})
    if dropped:
        logger.warning(f"[LinkCheck] 원자료 URL {len(dropped)}건 버림: {[(d['lens'], d['key'], d['reason']) for d in dropped]}")
    return dropped
