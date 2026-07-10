<!-- forge-slug: recommendation-3of4-watchlist-rerank -->
# 2026-06-18 — 추천 관심 재정렬 섹션: watchlist additive + RecCard 공유 (task#66, part 3/4)

## Plan vs actual
- What went as planned: 2 슬라이스 전부 충족. Dynamic Workflow(3 에이전트, ~179k 토큰, ~4.3분) — Implement 병렬 2(S1 백엔드 TDD ‖ S2 프론트) + 적대적 리뷰(high) 1. S1: `GET /api/recommendations`에 `watchlist` 섹션 **additive** 추가(호출자 관심종목을 저장 점수로 score DESC, 점수 결측은 score=null 말미 append, discovery 키·shape·정렬·as_of·exclude_tickers·limit 불변, 요청경로 외부호출 0). TDD red→green(신규 4건 `KeyError: 'watchlist'` 먼저 실패 확인). pytest 전체 785 passed·엔드포인트 11 passed(메인 세션 독립 재실행 확인). S2: 발굴 카드+`FLAG_STYLE`·`fmtScore`를 공유 `RecCard`(props item+선택 footer)로 추출, 추천 탭 2섹션 렌더(발굴=딥다이브 footer 주입, 관심=footer 없음), npm build 통과. 리뷰 critical/major 0. 커밋 7cdfbc9d push→배포→라이브 UAT PASS.
- 라이브 UAT(배포된 localhost:80, test 계정 API): 응답 키 `[as_of,discovery,watchlist]`·discovery 50·watchlist 19(기존 보유)·as_of 2026-06-17. 왕복: discovery 최상위 CFRHF(92.6) 관심추가→watchlist 섹션에 92.6 포함·점수 내림차순(92.6→53.4, 19건)·discovery 50 유지 & 추가종목 discovery 제외(additive+추적제외)→DELETE 복원(200). verified: yes.
- Divergences:
  - **storage 단일조회 전환** — 관심종목을 가르려면 `get_full_portfolio`가 필요(그 항목 dict엔 `type` 키가 없어 `get_all_stocks` 필터 불가). discovery용 `tracked`도 `stocks+watchlist` 합집합으로 같은 portfolio에서 도출(단일조회 DRY). 기존 엔드포인트 테스트 7건 patch 타깃 `get_all_stocks`→`get_full_portfolio` retarget(의미 보존).
  - **call_args 회귀 함정 가드** — watchlist용 두 번째 `read_recommendations(only_tickers=...)` 호출이 기존 테스트의 `mock_read.call_args`(마지막 호출) 단언을 오염시킬 수 있어, **watchlist 비면 두 번째 호출 생략**(`if wl_tickers:`). 기존 테스트는 tracked를 `stocks`에 두고 watchlist는 빈 배열로 유지해 단일 read 보장, 신규 `..._empty_watchlist_no_second_read`가 `call_count==1`로 못박음.
  - **API_SPEC을 part3에 포함** — 계획 슬라이스엔 없고 part4 S3가 "API_SPEC 3섹션 최종형"을 소유하지만, watchlist 추가가 실제 API 변경이라 PR간 stale 방지 위해 doc-sync DoD대로 현재형(2섹션)으로 갱신. grep 결과 CLAUDE_COWORK_API.md·README엔 이 엔드포인트 참조 없음→무변경.
  - '발굴' h3 헤더 추가(기존 그리드엔 섹션 헤더 없었으나 2섹션 구분 위해). 프론트 단위 하니스 부재→S2는 build+라이브 UAT(part2와 동일).

## Learnings
- Do differently next time:
  - **엔드포인트에 read 호출을 additive로 '추가'하면 `mock.call_args`(마지막 호출) 단언 테스트가 조용히 오염된다** — additive는 응답 *shape*만이 아니라 *호출 시퀀스*도 늘린다. 기존 테스트가 단일 read를 전제로 마지막 호출 인자(exclude_tickers/limit)를 단언하면, 두 번째 read가 끼는 순간 거짓통과/오류가 난다. 이번엔 "그 호출이 안 일어나는 입력(빈 watchlist)"으로 기존 테스트를 보존하고, 신규 테스트가 `call_count`/호출별 kwargs로 시퀀스를 명시 단언했다. **part 4/4(holdings)는 *세 번째* read를 같은 엔드포인트·같은 테스트에 추가하므로 이 함정이 그대로 재현된다** — fg-run이 이 회고를 읽고 워크플로우 프롬프트에 "기존 call_args 단언 보존 + 신규 호출은 call_args_list/응답 data로 단언"을 박을 것. (CLAUDE.md "비-additive reshape시 소비처 전수 grep" 가토의 테스트판 사촌 — 응답이 아니라 모킹된 호출 시퀀스가 깨진다.)
  - **part 분할 작업의 doc는 part마다 증분 갱신** — 최종형(3섹션) 슬라이스가 뒤 part에 있어도, 각 part가 실제 API를 바꾸면 그 part에서 명세를 현재형으로 갱신해야 PR간 stale을 막는다("최종 part에 몰아서"는 중간 PR 동안 명세가 틀림). part4는 holdings로 확장만.
  - **공유 컴포넌트 추출은 후속 part가 추천했을 때 그 part 시작에 한다** — part2 회고가 "RecCard로 추출하면 관심·보유 재사용 쉽다"를 남겼고, part3에서 추출하니 관심 섹션은 footer만 빼고 그대로 재사용됐다. part4 보유 액션도 RecCard 재사용(footer에 액션 배지) + FLAG_STYLE 템플릿을 액션색에 확장 가능. 회고→다음 part 설계로 연결되는 흐름이 작동.
- 관찰(후속 후보, 차단 아님):
  - part1/2 미해결 관찰 여전: watchlist/discovery 최상위에 저유동성 OTC(CFRHF 92.6, 라이브 UAT에서도 1위) — 유동성/주거래소 필터 후속 튜닝.
  - unscored append 경로 name은 `get_full_portfolio`가 `name or ticker`로 폴백해 null 불가(scored 경로는 LEFT JOIN name null 가능). 두 경로 폴백 정책 미세차, spec 무관·무해.
- 검증 게이트: 45→ 신규 4 TDD 테스트(엔드포인트 11 passed) + 적대적 리뷰 0(critical/major) + 메인 세션 독립 pytest 785 passed + 빌드 통과 + 라이브 UAT(watchlist 19건 점수순·additive·왕복복원)로 verified: yes. 커밋 7cdfbc9d.

## Doc updates
- CONTEXT.md promotion: none (세 섹션=per-user partition은 ADR-0015 §6에서 이미 정의, watchlist 섹션은 그 결정의 구현이라 새 용어 없음).
- ADR added: none (storage 단일조회·call_args 가드·API_SPEC 타이밍 모두 가역적 구현/프로세스 — ADR 3조건 미충족, 설계 경계는 ADR-0015가 커버).
- CLAUDE.md: none (call_args 함정은 part4 직전에 fg-run이 이 회고를 읽어 흡수하는 게 더 타깃됨 — 범용 pytest 지식이라 프로젝트 가토로 일반화하진 않음).
- 후속 후보: ① part 4/4 보유 액션 섹션(#67, 백로그 — call_args 세 번째 read 함정 주의) ② 발굴 유동성/주거래소 필터(part1부터 누적 관찰).
