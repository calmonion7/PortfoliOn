# 2026-07-07 — 종목 비교 뷰 (task#153)

워크플로우 4-phase(백엔드 S1 → 적대적 검토 → 수정(생략) → 프론트 S2) + 라이브 UAT에서 500 발견·fix-forward. eco: sonnet 캡+ECO. 배포·재검증 통과(verified: yes).

## Plan vs actual
- What went as planned:
  - S1 `GET /api/stocks/compare`(최대4·auth) + `_compare_best`(순수, 낮을수록/높을수록·애매 제외) + `_compare_extract`. **스냅샷 필드 경로를 grep으로 실확정**(추정 금지 준수): 밸류=top-level, 재무=`financials_annual[]` 최신 non-consensus, 베타=`stock_beta` 배치, 목표가=`daily_consensus_mart` as-of(ADR-0008). 14지표. S2 `Compare.jsx` + Research '비교' 탭(모바일·데스크톱) + best 하이라이트 전용색(`--color-success`) + `events.tab_compare`.
  - 라이브 재검증: compare 200·best 방향 정확(per/pbr/roe/부채/fcf=000660·psr=COST·ev_ebitda/upside=NFLX)·애매지표 best=[]·비교탭 녹색 하이라이트(반전 없음)·시장별 포맷.
- Divergences:
  1. **라이브 500 → fix-forward (핵심)**: 배포 직후 compare가 모든 입력서 결정적 500 — `_compare_extract`의 `(target_mean - price)`에서 **Decimal-float TypeError**(target_mean=mart NUMERIC→Decimal, price=스냅샷 float). `_f` 헬퍼로 전 지표값 float 정규화(산술·`_compare_best` isinstance(int,float)·JSON 직렬화 3중 안전) + Decimal 회귀 테스트로 수정(fb56185), 재검증 200. pytest 1177.
  2. 목표가 소스 = `daily_consensus_mart` as-of(스냅샷 frozen 아님, ADR-0008) — 계획 "스냅샷 필드"보다 정확. >4→400·auth·베타 배치쿼리는 구현 재량.
  3. `events.py` VALID_EVENTS += `tab_compare`(프론트 슬라이스가 백엔드 1줄, 탭 이벤트 400 방지).

## Learnings
- Do differently next time:
  - **Decimal/float 가토는 systemic — 재발 3+회째. NUMERIC 읽는 *모든* 신규 compute는 float 정규화 + Decimal fixture 기본**: Decimal 소스가 계속 늘고 있다(avg_cost·quantity·dividends·stock_beta·**daily_consensus_mart**). CLAUDE.md 대시보드 가토가 "회귀는 Decimal로"라 했지만 *그 가토 안*에만 있어 신규 경로(compare)가 float fixture로 또 당함. **snapshot/mart/NUMERIC을 산술하는 compute 슬라이스는 fixture 기본을 Decimal로** 두고, 완료기준에 라이브 스모크를 명시할 것(이번엔 명시돼 있어 UAT가 잡음 — 안전망 유효).
  - **적대적 검토 렌즈에 "Decimal-*산술*"을 명시**: 이번 검토는 "NaN 직렬화 됐나"만 물어 Decimal `a-b` TypeError를 놓쳤다. NUMERIC 읽는 compute 검토 시 isinstance/직렬화뿐 아니라 **Decimal-float 산술**을 별도 렌즈로.
  - **grep 그라운딩은 잘 작동**: 스냅샷 필드 경로를 추정 않고 grep 확정 + mart as-of·stock_beta 정본 소스를 골라 "필드 all-None fixture-pass-live-fail"은 회피됨. 남은 구멍은 값의 *타입*(Decimal)이었지 *경로*가 아니었다.

## Doc updates
- CONTEXT.md promotion: none — 비교 뷰=기능, 신규 도메인 용어 없음(기존 밸류/재무/기술 필드 재사용).
- ADR added: none — `_f` float 정규화=방어 코드(가역), 소스 선택(mart as-of)은 ADR-0008 기존 정본 준수.
- 후속: **CLAUDE.md Decimal/float 가토 일반화** — daily_consensus_mart를 Decimal 소스 목록에 추가 + "NUMERIC 읽는 신규 compute는 float 정규화·Decimal fixture 기본" 일반 규칙으로 승격(fg-quick 후보). (사용자·admin) beta_fetch 백필로 비교 탭 베타 실값 채우기(task#150 이월).
