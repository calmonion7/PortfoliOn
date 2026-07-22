# 2026-07-17 — 랭킹 모달 이중스크롤 제거 + 배경 스크롤 락 (task#196)

## Plan vs actual

- What went as planned: S1(contentMaxHeight prop 통째 제거)·S2(useBodyScrollLock 훅 4곳 배선 + overscroll-behavior)·S3(빌드·push·라이브 프로브) 전부 계획 구조대로. vitest 79 green, 커밋 39b1e22.
- Divergences (유의미 1건): **Ranking엔 body 스크롤 락이 이미 있었다**(`Ranking.jsx:153-160` 인라인 effect). 계획의 "배경 번짐 = body 락 부재(전 모달 공통)" 진단이 Ranking에 한해 오진 — 새 훅과 이중 잠금돼 "모달 닫힘 후 배경 스크롤 영구 잠김" 버그를 라이브 프로브가 포착. 기존 effect 제거로 일원화(647a754), 재프로브 통과.

## Learnings

- Do differently next time:
  - **"부재(不在) 판정" grep은 `| head`로 자르지 말 것.** 그릴링 때 기존 락 탐색 grep을 `| head`로 잘라 `Ranking.jsx:157` 히트가 출력에서 누락 → "락 없음"으로 오진하고 훅을 중복 도입했다. 존재 확인 grep은 히트 수를 줄여도 되지만, **부재를 결론내는 grep은 전체 출력(최소 히트 카운트)을 봐야** 한다. 특히 "전 X에 공통으로 Y가 없다" 류 일반화 진단은 X별 개별 확인.
  - **전역 싱글턴 상태(body style 등)를 만지는 effect는 앱에 한 곳(공용 훅)만.** prev-캡처+복원 락 두 개가 겹치면 나중 등록 effect가 prev='hidden'을 캡처해 마지막 cleanup이 hidden을 "복원" → 영구 고착. 같은 관심사를 새로 구현하기 전에 기존 구현부터 찾아 일원화(위 grep 규칙과 한 쌍).
  - **"복원 안 됨" 류 전역 상태 버그 진단 순서(재사용 가능)**: ① MutationObserver `attributeOldValue`로 쓰기 시퀀스 확정(hidden→''→hidden = 제3 writer 존재 증명) → ② 프로드 번들은 스택 불가하므로 로컬 vite dev 재현 — 백엔드 포트가 안 열려 있으면 Playwright `page.route('**/api/**')`로 프로드 API에 릴레이(vite.config 무수정) → ③ 의심 코드에 console.trace 심어 "내 코드는 결백" 확정 → ④ writer 패턴 전수 grep(`body.style`).
- 그대로 좋았던 것: task#195 retro의 "스크롤 전후 불변 프로브" 표준을 UAT에 채택한 덕에 정적 캡처로는 못 잡는 닫힘-후-고착 버그를 배포 직후 포착했다(회귀 재발 방지 규칙이 실제로 작동한 사례).

## Doc updates

- CONTEXT.md promotion: none (도메인 용어 아님).
- ADR added: none (비가역 결정 아님 — 버그픽 + 프로세스 규칙).
