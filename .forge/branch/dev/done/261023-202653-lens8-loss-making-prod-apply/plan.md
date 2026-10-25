<!-- forge-slug: lens8-loss-making-prod-apply -->
<!-- task: 406 -->
<!-- tdd: off -->
# 적자 렌즈 8 소급 재계산을 prod에 적용하고 PLUG 화면을 육안 확인 (task#405 후속, 사람 단계)

## 목표 / 비목표
- 목표: task#405(서버 규칙 정정 + `scripts/recompute_lens8_loss.py`)가 main에 머지·배포된 뒤, prod에 이미 발행된 적자 렌즈 8 판을 소급 재계산하고 PLUG 심층 리포트에서 렌즈 8이 회색 「미산출」로 보이는지 확인한다.
- 계기: task#405의 S5를 fg-loop 범위 결정(2026-10-23)으로 분리했다. prod 쓰기는 에이전트가 막혀 있고 main 머지는 사람 몫이라, 루프 안에 두면 task#405를 봉인할 수 없다.
- 비목표: 서버 규칙·스크립트 수정(task#405 몫). 화면 코드 변경(육안에서 깨지면 그때 새 계획).

## 작업 슬라이스
- [ ] S1. **prod 적용**(의존: task#405가 main에 머지·배포됨, **사람 단계**) — 사람이 `! docker exec -i portfolion-backend-1 python - < scripts/recompute_lens8_loss.py`(dry-run)를 실행한다. 출력에 PLUG가 있는지 확인한 뒤 `--apply`로 다시 실행하고, 마지막으로 dry-run을 한 번 더 돌린다. — 완료기준: dry-run 목록에 PLUG 포함 → apply → 재 dry-run 0건.
- [ ] S2. **육안 확인** — PLUG 심층 리포트 렌즈 8을 모바일 폭에서 스크린샷 1장 찍는다(루트 CLAUDE.md ⓐ — 화면 코드는 무변경이지만 na 계산 렌즈에 계산값이 있는 조합은 처음 그려진다). — 완료기준: 렌즈 8이 회색 「미산출」이고, 「미산출 사유」가 보이고, 게이지·바뀜 조건이 없으며, 상세를 펼치면 이익수익률 -19.7%가 보인다.

## 완료 정의 (DoD)
1. prod dry-run에 PLUG 포함 → apply → 재 dry-run 0건.
2. PLUG 렌즈 8 스크린샷 1장에서 회색·미산출 사유·게이지 없음·이익수익률 -19.7% 확인.
- 영구 회귀 검사: 해당 없음 — 일회성 데이터 적용이다. 회귀 검사는 task#405 S1의 단위 테스트가 맡는다.
- 「이 단언이 통과하면서도 깨질 수 있는 방식」: 화면이 na 계산 렌즈의 `computed.values.multiple: null`을 「null」·「NaN」으로 그릴 수 있다. 그래서 상세를 펼친 상태로 스크린샷을 찍는다.
