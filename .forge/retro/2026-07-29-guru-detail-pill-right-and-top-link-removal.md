<!-- forge-slug: guru-detail-pill-right-and-top-link-removal -->
# 2026-07-29 — 구루 상세 목록복귀 pill 우하단 이동 + 상단 이동 링크 3곳 삭제 (task#238)

일괄 승급으로 사후 작성(2026-07-29, `fg-next all` 드라이브가 자동 skip한 분).
커밋 `35b456c` · 직접 실행 · 프론트-only · vitest **183 passed** · 라이브 UAT 4조합 ALL PASS

## Plan vs actual

3슬라이스 전부 계획대로, 비목표도 전부 준수. pill 3곳 전부 `to="/guru"`·`☰ 목록`으로 통일하고 고아 `.list-pill--left` 제거.

### Divergences

- **D1 (의도적)** 워크플로우 대신 직접 실행(3회 연속 동일 판단).
- **D2 ⚠️ 프로브의 판정 *범위*가 넓어 거짓 FAIL 4건.** 첫 실행이 4조합 전부 `상단 /guru 링크 2개 잔존`으로 FAIL. 원인은 구현이 아니라 프로브가 `document.querySelectorAll('a[href="/guru"]')`로 **문서 전체**를 센 것 — PC 마스트헤드 카테고리 칩과 모바일 탭바가 같은 href를 쓴다(둘 다 DOM엔 양 뷰포트 모두 존재, CSS가 한쪽을 숨긴다). 완화 전에 **부모 체인을 덤프해 정체를 실측**한 뒤 판정 범위를 `main.page-wrap` 본문으로 좁히고 내비 수는 참고값으로 분리. **task#228 D3의 사촌** — 그때는 기준 *상자*를 추정해서, 이번은 판정 *범위*를 안 좁혀서.
- **D3 ⚠️ 스샷 육안 판독이 거짓 경보를 냈고 실측이 기각했다 (D2의 거울상).** PC 스샷에서 pill이 `☆ 추가` 버튼을 덮은 것으로 **보여** 클릭 차단 회귀로 의심했으나, 3단계 실측으로 기각: ① 좌/우 배치가 각각 무엇을 덮는지 대조 ② `/reports`의 `.fab`은 `covered: []`라 "우하단 플로팅이 버튼을 덮는 건 앱의 기존 성질"이 아님을 확인 ③ **`elementFromPoint`로 결정** — `centerBlocked: false`, 버튼 표면 5×3=15개 샘플점 전부 버튼 자신이 최상위. bbox가 1~2px만 스치고 `border-radius: 999px`라 사각 bbox 모서리는 투명. **육안 인상만으로 되돌렸다면 정상 구현을 훼손했을 것이다.**
- **D4 (관찰·미수정)** 모바일에서 pill이 도넛 조각 라벨 1개를 덮는 건 **좌·우 대칭**이라 우측 이동이 만든 신규 리스크가 아니라 `.list-pill` 레이어의 기존 성질.
- **D6 (인프라 churn, 자기해소)** 커밋 직후 `git log -1`이 이전 커밋을 찍어 폴러가 커밋을 날린 것으로 **오판**. reflog 확인 결과 `commit → reset → reset`이 연달아 찍혀 있었고 최종 `HEAD == origin/main == 35b456c`로 **손실 0** — 2분 폴러의 reset 두 번 사이에 `git log`가 실행된 타이밍 아티팩트. CLAUDE.md의 폴러 경고가 강해 과대해석했다.

## Learnings

- **Do differently next time**:
  - ⭐ **프로브의 판정 *범위*를 명시적으로 좁힐 것**(D2). 셀렉터를 문서 전체에 걸면 전역 내비·공용 레이아웃이 섞여 **정상 구현이 FAIL**한다. 그리고 FAIL이 나면 완화하기 전에 **정체를 실측**(부모 체인 덤프)해 구현 결함인지 프로브 결함인지 확정할 것.
  - ⭐ **육안 확인은 거짓 *경보*도 낸다 — 되돌리기 전에 실측으로 기각하라**(D3). 회고 #235가 "프로브 PASS 후 육안 확인"을 넣게 했다면, 이번은 그 역방향이다. 겹침이 실제 클릭 차단인지는 bbox가 아니라 **`elementFromPoint`**로 결정할 것(둥근 모서리·투명 영역·`pointerEvents:none` 때문에 bbox 교차 ≠ 차단). 판정 전에 **"이게 앱의 기존 성질인가"를 형제 표면으로 대조**하면 신규 회귀와 기존 성질이 갈린다.
  - ⭐ **폴러 churn은 `git log -1`로 판정하지 말 것**(D6). 2분 폴의 reset 두 번 사이에 걸리면 이전 커밋이 찍힌다 — push는 이미 살아있고 다음 폴이 복구한다. 판정은 **`git rev-parse HEAD` vs `origin/main` + `gh run list`**로. CLAUDE.md의 폴러 경고가 강해 정황을 커밋 소실로 과대해석하기 쉽다.
- **후속 후보(미해결)**: 없음(D4는 기존 성질로 판정 종결).

## Doc updates

- CONTEXT.md promotion: 없음. ADR added: 없음.
- **프로젝트 `CLAUDE.md` Gotchas 승급(사용자 승인, 일괄 승급 2026-07-29)**: ① 프로브 판정 범위 좁히기 + FAIL 시 정체 실측 ② 육안 거짓경보는 `elementFromPoint`로 기각 ③ 폴러 churn 판정법(`rev-parse` + `gh run list`).
