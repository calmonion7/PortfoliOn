# 2026-07-06 — 포트폴리오 베타 (베타가중 노출) (task#150)

워크플로우 4-phase(백엔드 S1 → 적대적 검토 → 수정(생략) → 프론트·통합 S2) + 메인 세션 후처리(검토 minor 2건 수정). eco: sonnet 캡+ECO. 배포·라이브 UAT(부분) 통과(verified: yes).

## Plan vs actual
- What went as planned:
  - S1 beta 백필(dividends 패턴 미러: `stock_beta` 테이블 app_schema+_migrate 쌍, US=info.beta+beta3Year, KR=calc_beta vs ^KS11 재사용·^KS11 1회·tz-strip, batch_registry+scheduler+`POST /api/stocks/beta/refresh`(admin), 배치 count 테스트 4파일 갱신). S2 `compute_exposure` beta_map→portfolio_beta(Σw×β/Σw 재정규화)+커버리지, 노출 탭 베타 카드(전용색). pytest 1149·npm build green·적대 검토 critical/major 0.
  - **그릴링서 라이브 프로브 선행이 방식을 바로잡음**: "스냅샷 저장 beta 읽기"만으론 테스트계정 커버리지 0%(스냅샷이 beta 추가 이전)임을 프로브로 확인 → 백필 방식 채택. read-stored였으면 빈 기능이 됐을 것(fg-ask probe-first 규율이 실효).
- Divergences:
  1. `scheduler/__init__.py` 추가 수정(계획 밖·필수): 명시 재export 패키지라 `_fetch_betas` 재export 필요.
  2. 배치 count 테스트 grep 확대: 계획 제시 패턴이 `test_scheduler_seed.py` 2곳을 못 잡아 검색 확대(27→28). CLAUDE.md 가토("한 파일 여러 곳·전수 grep")가 그대로 재현.
  3. **적대적 검토 minor 3건 → 메인이 2건 사후 수정**(워크플로우 fix phase는 critical/major만): #1 beta=0.0 falsy→beta3Year 치환(correctness, wrong<missing) 명시 None 체크+회귀테스트, #2 fetch_kr_beta daily_df tz-strip 누락(키움 폴백 시 silent None) 가드. #3 KR source="kiwoom" 하드코딩(info-only) 보류.
  4. eco: 엔드포인트 beta_map 인라인 db_query(sector_map 패턴 미러, 별도 헬퍼 없음).

## Learnings
- Do differently next time:
  - **적대적 검토의 "minor" 등급을 신뢰해 흘려보내지 말 것 — 커밋 전 메인이 triage.** 워크플로우 auto-fix가 critical/major만 고치므로, minor로 분류된 실제 correctness 버그(이번 beta=0.0 wrong<missing)가 그냥 남는다. compute/파생계산 워크플로우는 특히 minor findings를 메인 세션이 직접 검토해 진짜 버그를 골라 고칠 것(리밸런싱 회고의 "compute 조용한 엣지"와 같은 가족 — 이번엔 검토가 잡았고 메인이 마무리).
  - **admin-게이트 배치 기능은 자율 UAT에 한계** — 백필이 admin write(테스트계정 403)라 "채워진 값 렌더"를 자율 확인 못 함. compute=유닛테스트, plumbing/graceful/auth=라이브로 커버하고, 실값 확인은 사용자(admin) 백필 트리거로 위임(reference-prod-writes-need-user와 동일 계열). 계획 DoD에 이 UAT 경로를 미리 명시하면 좋음.
- 후속(코드):
  - **`report_generator.generate_report` KR beta(145-170)에 같은 daily_df tz-strip 갭**(이번 재사용 원본) — 키움→yfinance 폴백 시 tz-aware daily_df가 ^KS11과 concat TypeError→조용히 None(graceful이나 커버리지 손실). beta.py엔 가드 넣었으나 원본 미수정 → **fg-quick 감**(통일).
  - (task#149서 넘어온) CLAUDE.md doc-sync gotcha에 "Cowork 무관 엔드포인트는 API_SPEC만" 단서 추가 — 여전히 fg-quick 감(이번에도 같은 판단 적용).

## Doc updates
- CONTEXT.md promotion: none — 포트폴리오 베타는 fg-ask 그릴링 때 「노출·집중도」에 반영. 새 용어·의미 변화 없음.
- ADR added: none — beta 백필은 dividends 패턴 미러(가역적), 저장 테이블·주기·임계 모두 되돌리기 쉬움.
- 후속: report_generator KR beta tz-strip 통일(fg-quick) · CLAUDE.md doc-sync 단서(fg-quick) · (사용자) admin `POST /api/stocks/beta/refresh` 백필로 실값 렌더 확인.
