<!-- forge-slug: publish-ab-shadow-harness -->
<!-- task: 350 -->
<!-- tdd: on -->
# 발행 레인 A/B 섀도 하네스 — opus · muse-spark · 혼합(H1 초안→검수) 3팔 품질·비용 실측

## 목표 / 비목표
- 목표: 매일 도는 발행 레인(종목 리포트의 사업분석=enrich §1 · 심층=애널리스트 리포트 §2 · 주요기술 리포트 §3)의 품질·비용을 세 팔로 비교한다 — `opus`(현행 기준선) · `opencode/muse-spark-1.3-contributor-free`(무료) · **H1 혼합**(muse 초안 → opus 검수·수정). 표본 20건(종목 11 · 심층 6 · 기술 3)에 **자동 품질 축 + 실측 비용**을 한 표에 놓고, 사용자가 나란히 보기로 내용 품질을 판정한다.
  **설계 개정 2건(2026-09-15 사용자 지시, 실측 확인 완료):**
  ① **opus 팔은 신규 세션을 돌리지 않고 「이미 발행된 산출물」을 쓴다.** 현행 레인이 매일 만드는 것이 곧 기준선이므로 재실행보다 충실하고, opus 20세션이 통째로 빠진다. 실측 확인 — enrich 11표본의 opus 판은 `enrich_history` 라벨 **`nightly-0914`**(126행, 09-13 17:05~20:08 UTC)로 존재하며 muse 전환 커밋 `8a2ef6b`(09-15 03:51 UTC)보다 **앞선다**. 심층 6·기술 3은 발행 리포트가 전부 존재한다(발행 레인은 muse로 바꾼 적이 없다 — task#348은 **야간 enrich만** 전환했고, 09-15 20:42 런이 `claude -p --model opus`로 도는 것을 직접 관측). ⚠️ **현재 `tickers`의 enrich 판은 이미 muse다**(09-15 05:53~06:53 UTC 26청크 런) — 그것을 기준선으로 쓰면 비교 대상 자신을 기준선으로 삼게 되므로 반드시 `nightly-0914` 판을 쓴다.
  ② **프로드 무쓰기를 「프롬프트 지시 + 사후 카운트」가 아니라 「쓰기 차단 프록시」로 구조화한다.** 섀도 접두 절은 절차적 가드라 모델이 어기면 되돌릴 수 없고(기술 리포트는 slug당 upsert) 확인이 사후다. 대신 하네스가 `scripts/ab-proxy.py`(127.0.0.1)를 띄우고 **GET/HEAD만 prod로 통과시키고 그 외 모든 메서드는 prod로 보내지 않고 본문을 파일로 캡처한 뒤 그럴듯한 성공 응답을 돌려준다**. 방어는 서로 독립인 2겹: ⓐ 하네스가 프롬프트의 `BASE URL:` 줄을 프록시 주소로 치환(치환 1건 성립을 단언, 아니면 발사 중단) ⓑ 자식 세션 env의 `PORTFOLION_API_KEY`에 **더미 값**을 넣고 진짜 키는 프록시만 쥔다 → 세션이 프롬프트를 무시하고 prod를 직접 때려도 **401**. 부수 이득: 요청 본문이 **있는 그대로** 캡처되므로 모델에게 「out.json에 써 달라」고 부탁할 필요가 없다(task#349의 env 주입 구조 위에 그대로 얹힌다).

- 비목표:
  - 실제 레인 전환(어느 팔을 07:05/20:42에 쓸지) — 이 결과를 보고 **다음 태스크**에서. 이 태스크는 측정만.
  - sonnet 팔 — 사용자 결정으로 제외.
  - 블라인드 LLM 판정자 — 제외(사용자 판정이 정본, 옵션 B 미채택).
  - 라이브 발행·enrich 저장 — 전부 섀도. `enrich-ab.py`(저장형 A/B)는 건드리지 않음.
  - 무료 모델 웹검색 MCP(exa) 429 한도 해소 — 관측만(팔 비교의 조건 중 하나).

## 정본
- 글로서리: `.forge/CONTEXT.md`의 [[루틴]], [[섀도 모드]](이번 그릴링에서 추가), [[야간 전량 갱신]]
- 관련 ADR: `.forge/adr/0028-event-driven-routine-analysis-pipeline.md`(루틴=콘텐츠 생산자·백엔드 무LLM — 하네스도 백엔드 밖 스크립트), `.forge/adr/260913-013425-nightly-full-enrich-chunked-listener.md`(실행기 분기 — 하네스는 `_runner_argv` 재사용). 새 ADR 없음(측정 태스크; 레인 전환 결정 시 ADR).
- 사전 확정 사실(착수 시 재확인):
  - 발행 API에 dry-run 없음: `POST /api/analyst-reports/{ticker}` 즉시 201 저장, `POST /api/tech-reports/{slug}` slug당 1행 upsert → 섀도가 유일한 무쓰기 경로.
  - 요청 스키마 정본 = `backend/routers/analyst_reports.py::PublishBody`(rating Literal·points 2~3·PointMetric max 4) · `backend/routers/tech_reports.py::TechReportIn`(+`model_validator`들). 로컬 `.venv`(py3.9)에서 import 가능 — task#322가 같은 방식으로 발행 전 검증했다.
  - 실행기 argv 정본 = `scripts/cowork-fire-listener.py::_runner_argv(model)`(task#348). 프롬프트는 stdin, cwd는 세션별 디렉터리. **task#349(키 env 주입) 선행** — 하네스도 같은 방식으로 `PORTFOLION_API_KEY`를 env로 넘긴다.
  - 세션 비용은 `~/.claude/projects/<cwd 해시>/*.jsonl`의 `message.usage`로 실측 가능(task#348 회고에서 사용: 야간 opus 26세션 ≈ $290~307 상당/일, 배치 완료 세션 ≈ $17~19 — 그중 enrich $1.7~2.3, 발행 $15~17). OpenCode 세션은 이 트랜스크립트가 없다 → 무료 팔 비용은 0으로 두고 **소요 시간·웹조사 횟수**만 기록.
  - 표본(그릴링 확정, 2026-09-15 사용자 조정 「종목 리포트도 섹터별 1」): **종목 리포트(enrich §1) 11** = 섹터별 1(발행 표본과 겹치지 않게) — Technology `000660` SK하이닉스(KR) · Industrials `RKLB` · Financials `JPM` · Healthcare `NVO` · Energy `CCJ` · Consumer Cyclical `TSLA` · Communication `035420` NAVER(KR) · Consumer Defensive `COST` · Utilities `CEG` · Real Estate `EQIX` · Basic Materials `FCX`(섹터 표기는 소스별 동의어 병합: Healthcare/Health Care · Financial Services/Financials · Consumer Cyclical/Discretionary · Consumer Defensive/Staples; 섹터 없는 ETF 3종 제외). **심층(애널리스트 §2) 6** = `GOOGL`(Communication) · `005380` 현대차(Consumer Disc., KR) · `CRCL`(Financial) · `LLY`(Healthcare) · `SPCX`(Industrials, 상장 초기 희소 데이터) · `005930` 삼성전자(Technology, KR) — 전부 `analyst_target=true`. **기술(§3) 3** = `ai-datacenter-equipment` · `obesity-drugs` · `smr`. **총 20표본 × 3팔 = 60세션(opus 풀 20 + 검수 opus 20 + muse 40)**. opus 1회성 비용 ≈ $340 상당(풀 세션 ≈ $17 × 20 기준; enrich 단건은 더 싸다).
  - muse는 웹검색 MCP 429를 자주 맞고(27세션 중 11) 웹 조사 성공 0회 — 출처 조작 위험(AAOI 「C-LIGHT」). H1 검수의 존재 이유.
- 완료 정의(DoD) — baseline 2026-09-15(개정판):
  1. `cd backend && .venv/bin/python -m pytest -q` → failed 0 **그리고** passed ≥ 2337 (task#349 봉인 후 실측 = 2337)
  2. `ls scripts/ab-publish.py scripts/ab-proxy.py scripts/review-prompt.md` 존재 · `grep -c '_runner_argv' scripts/ab-publish.py` ≥ 1
  3. `ls backend/tests/test_ab_publish.py backend/tests/test_ab_proxy.py` 존재 · 테스트가 단언: ⓐ **프록시가 GET만 통과시키고 POST/PUT/DELETE를 캡처**(업스트림 미호출을 mock으로 못박음) ⓑ 프록시가 업스트림 GET에 **진짜 키**를 붙이고 자식에게는 **더미 키**만 준다 ⓒ BASE URL 치환이 **정확히 1건**이고 0건이면 발사를 중단한다 ⓓ 라우터 모델 로컬 검증(정상 통과·422 거부 쌍) ⓔ 트랜스크립트 usage 합산 ⓕ 출처 URL 판정(2xx/4xx mock) ⓖ 스냅샷 수치 매핑 + **커버리지 카운터**
  4. **프록시 이빨 검사(파일럿)**: 세션에 의도적으로 발행 POST를 시켜 ⓐ 캡처 파일이 생기고 ⓑ prod 3테이블 카운트가 **전혀 변하지 않으며** ⓒ 프록시 로그에 그 POST가 「차단됨」으로 남는다. 추가로 **더미 키 단독 검증** — prod URL에 더미 키로 직접 POST하면 **401**(2겹 방어가 각각 독립으로 작동함을 증명; 한 겹만 재면 나머지가 무력해도 초록이다)
  5. 본 실행: muse 20판 + h1 20판 = `find out -name '*.json'`에 팔별 파일 존재(실패는 `*.error.json`로 남기고 총계 포함). opus 팔은 **세션 0개** — 기존 산출물을 수확해 `opus.json`으로 정규화(enrich는 `enrich_history` `nightly-0914`, 심층·기술은 발행 리포트 API)
  6. 프로드 무쓰기 증명(주 안전장치가 아니라 **값싼 무회귀 단언**으로 강등): 실행 전후 `analyst_reports`·`tech_reports`·`enrich_history` 카운트 동일 + `tickers.enriched_at` 최댓값 불변(enrich 경로까지 덮는다 — 카운트만 보면 UPDATE를 놓친다) → `out/summary.md`에 전후값
  7. 비용 실측: `out/summary.md`에 팔별 합계(opus **검수 20세션**의 토큰·정가 환산, muse는 0·소요시간). opus 풀 20세션을 안 돌려 절감한 액수를 한 줄로 명시
  8. 사용자 나란히 보기: `out/<lane>/<sample>/compare.md`가 세 판을 필드별 3열로 배치(사용자 판정 칸 포함) — 육안 1건 확인
  9. **시점 교란 표기**: 각 표본의 opus 기준선 생성일과 muse 실행일의 **간격(일)**을 compare.md·summary.md에 싣고, 간격이 큰 표본은 「수치 일치율」 축을 **「대조 불가」**로 표기해 총계에서 제외한다(실측 간격 — enrich 11=1일 · GOOGL·CRCL·smr=0일 · 005380·005930=1일 · SPCX=11일 · LLY=10일 · obesity-drugs=25일 · **ai-datacenter-equipment=33일**). 제외 건수를 명시하지 않은 일치율은 공허하다

## 작업 슬라이스
- [ ] S0. baseline·전제 재측정 — DoD 1~3 현재값. `_runner_argv`·`PublishBody`·`TechReportIn` 로컬 import 가능(py3.9). 표본 20건 실재 재확인 + **opus 기준선 3종의 소재 확인**(`enrich_history` `nightly-0914` 126행 · 심층 6건 · 기술 3건) + 시점 간격 산출(DoD 9). — 완료기준: 전부 참, 간격표 산출.
- [ ] S1. **쓰기 차단 프록시(테스트 우선)** — `scripts/ab-proxy.py`: 127.0.0.1 임의 포트. GET/HEAD → 업스트림(`https://portfolion.taebro.com`)에 **진짜 키**를 붙여 전달하고 응답 그대로 반환. 그 외 모든 메서드 → **업스트림 미호출**, 본문을 `capture/<method>_<path-slug>_<n>.json`에 저장하고 그럴듯한 성공(201/202) 반환. 모든 요청을 `proxy.log`에 기록(통과/차단 표시). 응답에 `Content-Length` 명시(task#346 — 없으면 간헐 ConnectionReset이 나고 호출측 로그가 상태코드 대신 「연결 끊김」으로 남는다). — 완료기준: 테스트 ⓐⓑ red→green, DoD 2·3.
- [ ] S2. 하네스 코어(테스트 우선) — `scripts/ab-publish.py`: `run --lane analyst|tech|enrich --sample X --arms ...`. 프롬프트 = 루틴 프롬프트의 `BASE URL:` 줄을 프록시 주소로 치환(**치환 1건 단언, 아니면 중단**) + 트리거 문장(「§N만 수행, 대상 X」). 세션 스폰은 `_runner_argv(model)` 재사용 · env는 **더미** `PORTFOLION_API_KEY` · cwd `out/<lane>/<sample>/<arm>/`(트랜스크립트 해시 키). 타임아웃 40분. 캡처 파일 → `<arm>.json`. **리스너·루틴 프롬프트 파일은 무변경**(프로덕션 불간섭). — 완료기준: 테스트 ⓒ red→green, DoD 2.
- [ ] S3. opus 팔 수확기(세션 0개) — 기존 산출물을 `opus.json`으로 정규화: enrich는 `enrich_history`의 `nightly-0914` 행(`fields` jsonb), 심층·기술은 발행 API 응답. 각 판의 **생성일**을 함께 싣는다(DoD 9의 입력). — 완료기준: 20표본 전부 `opus.json` 생성, 생성일 기록.
- [ ] S4. H1 검수 팔 — `scripts/review-prompt.md`: 「초안 JSON + 스냅샷 GET 허용 + 출처 URL 실존 확인(출처당 1회) + 어느 필드든 수정·삭제(근거 없는 것은 지운다, wrong<missing) + **새 논지 금지, 단 핵심 주장에 출처가 없을 때만 웹검색 최대 2회** + 출력 = 최종 JSON과 `changes[]`(field·reason·severity)」. h1 팔 = **muse 팔이 이미 만든 초안을 재사용**(muse 재발사 없음) → opus 검수 세션 → `h1.json` + `h1.changes.json`. — 완료기준: 테스트(검수 프롬프트에 초안이 삽입되고 금지 문구 포함) red→green.
- [ ] S5. 자동 축(테스트 우선) — ① 라우터 모델 로컬 검증(lane별, 422 사유 기록) ② 출처 URL 실존율(HEAD/GET 2xx, 타임아웃 10초, 실패는 「미확인」) ③ 스냅샷 수치 매핑(매핑 가능한 것만, 나머지 「대조 불가」 + **커버리지 카운터 필수**) ④ 분량 ⑤ 웹조사 횟수(run.log의 websearch/webfetch/curl 외부 호출 카운트) ⑥ 실측 비용(cwd 해시 → 트랜스크립트 usage 합산 → 정가 환산; muse는 0·시간만) ⑦ H1 `changes[]` 건수·심각도 ⑧ 시점 간격(DoD 9). — 완료기준: 테스트 ⓓ~ⓖ red→green.
- [ ] S6. 파일럿 1표본 + **프록시 이빨 검사** — GOOGL × 3팔. 세션에 의도적 발행 POST를 시켜 캡처·prod 카운트 불변·프록시 로그 차단 기록을 확인하고, 더미 키로 prod 직접 POST가 401임을 따로 확인(2겹 독립 증명). `compare.md` 육안 확인. 문제면 S1~S5 보정 후 재실행. — 완료기준: DoD 4·6(파일럿 범위).
- [ ] S7. 본 실행 — 나머지 19표본(enrich 11 먼저, 심층·기술 뒤). 순차. 실패 세션은 `*.error.json`(원인·run.log 발췌) 남기고 계속. `summary.md` 생성. — 완료기준: DoD 5·6·7·9.
- [ ] S8. 문서 — `CONTEXT.md` [[섀도 모드]] 정의를 **쓰기 차단 프록시** 방식으로 갱신(옛 「프롬프트 지시」 서술이 남으면 거짓이 된다). run.md에 팔별 결과·비용 요약과 「레인 전환 후속 태스크 후보」 기록. `README.md`엔 넣지 않음(내부 측정 도구). — 완료기준: DoD 8 + run.md.

## 이 단언이 통과하면서도 깨질 수 있는 방식(계획 시점 메모 — 개정판)
- **2겹 방어를 한 겹만 재면 나머지가 무력해도 초록이다.** BASE URL 치환만 확인하면 더미 키가 실제로는 진짜 키여도 통과하고, 반대도 같다 → DoD 4가 둘을 **따로** 재는 이유(치환 1건 단언 + 더미 키로 prod 직접 POST가 401).
- **프록시가 「차단했다」를 로그로만 주장하면 공허하다** — 업스트림 미호출을 mock으로 못박아야 한다(로그 문자열은 구현이 거짓말할 수 있는 자리다).
- **DoD 6의 카운트는 enrich UPDATE를 못 본다** — enrich는 행을 늘리지 않고 `tickers` 컬럼을 덮으므로 카운트만 보면 오염이 안 보인다 → `tickers.enriched_at` 최댓값 불변을 쌍으로 둔 이유.
- **「수치 일치율」은 매핑 가능한 필드가 적으면 표본 0으로 공허 통과한다** → 커버리지 카운터(대조 시도 수/대조 가능 수)를 반드시 함께 출력.
- **시점 교란이 모델 차이로 오독된다** — opus 기준선은 최대 33일 전(ai-datacenter-equipment) 판이라 그 사이 주가·실적 변동이 「불일치」로 잡힌다. DoD 9의 간격 표기와 「대조 불가」 제외가 없으면 무료 모델이 실제보다 나빠 보인다.
- **`POST /api/report/generate`도 차단된다** — 세션의 「409 → generate → 재시도」 자가치유 경로가 섀도에서는 동작하지 않는다. 표본 20건은 전부 스냅샷이 있어 무해하지만, 그 경로를 탄 세션은 재시도 실패로 기록될 수 있다(오염이 아니라 측정 조건으로 기록할 것).
- **OpenCode 세션은 트랜스크립트가 없어 비용 0으로 기록되지만 「무료」는 한도(MCP 429) 때문이지 품질 때문이 아니다** — 웹조사 횟수 축이 그 차이를 드러낸다.
- **opus 검수 20세션은 여전히 Claude 주간 한도를 소모한다**(풀 세션보다는 훨씬 싸다) — 한도 마커 감지 시 중단하고 남은 표본을 기록해 사용자에게 보고.
