# RUN — 시장지표 반도체 카드 — 메모리 현물가를 분류 콤보로 압축 (task#404)

실행: fg-loop 무인 드라이브, 규모가 작아 워크플로 없이 메인 세션 직접 실행. 커밋 `63f7305`(기능) · `4afcc21`(프로브 측정 위치 보정), dev push 2회.

## 슬라이스 결과
- S1 `SemiconductorSection.jsx` 재구성(select·선택 분류 표 1개·표 바로 뒤 차트, 분류 전환 시 첫 품목, DEFAULT_ITEM 부재 대체) — ✅ 계획대로(상태는 `catKey`+`selected` 2개, 초기 분류·대체 품목은 렌더 시 파생)
- S2 프로브 분류별 순회 + `chart-follows-table`·`tap-chart-in-view` — ⚠ 축 3개 추가(`cat-switch-chart`, 1회성 `api-total-literal` 6분류·23품목, `tap-chart-in-view`에 select 가시성 hit-test), EXPECT_PER_VP 14→17
- S3 dev 배포 + 라이브 검증 + m360 육안 — ⚠ 첫 캡처에서 select가 sticky 헤더 밑에 가려 안 보임(측정 위치 결함) → 프로브 보정 후 재배포·재측정
- S4 README 1줄 — ✅ 계획대로

## DoD baseline → after
- SemiconductorSection vitest: 4 통과 → 7 통과(기존 4 회귀 가드 유지 + 신규 ①②④)
- 프론트 전체 vitest: (기준선 미측정) → 107 파일 · 1143 통과
- `uat403-semiconductor.mjs`(dev 8084): 새 프로브 vs 옛 배포 FAIL 30/55(`chart-follows-table` 968.5px, `tap-chart-in-view` 차트 top 1612 > vh 800 — red-first 이빨 확인) → ALL PASS 55/55(간격 8.0px, 차트 top 418 < 800)
- m360 육안: select 「DRAM 현물」 한 줄·갱신일·7행 표·차트가 한 화면 안
- README: `분류 콤보` 0 → 1, `6분류 표와 행 탭` 1 → 0

## 계획과 다른 점·현장 결정
- **육안 캡처가 프로브의 측정 위치 결함을 잡았다**: `scrollIntoView({block:'start'})`로 select를 맨 위에 붙이면 sticky 헤더 밑에 가려진다. 첫 판의 `tap-chart-in-view`는 그 상태에서도 PASS했다(차트 top만 봤기 때문). select 중심 hit-test가 자기 자신이 될 때까지 16px씩 되돌리고, `selVisible`을 축 조건에 넣었다 — 「통과하면서도 깨질 수 있는 방식」(select 가림)을 축으로 승격한 것이다.
- task#403 회고의 「API 유도 기대치는 API 결함에 블라인드」를 따라 소스 독립 리터럴 축(`api-total-literal` 6/23)을 프로브에 넣었다. 소스 품목 목록이 바뀌면 의도적으로 갱신해야 한다.
- 옛 코드에서 select가 없으면 `selectOption`이 기본 30초씩 기다려 red-first 실행이 길어졌다 → 5초 타임아웃.
- 안 다룬 경로: 네이티브 select의 iOS 피커 렌더(Chromium 블라인드 — appearance 미변경으로 위험 축소), 선택 기억(URL·localStorage, 비목표).
