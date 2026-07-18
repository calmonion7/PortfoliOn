# 2026-07-18 — 주식 용어집 코어 + 리포트 상세 적용 (task#198)

## Plan vs actual

- What went as planned: S1~S5 전부 계획 구조대로 — 용어집 정적 모듈(계획 ~50 → 65개)·매칭 순수함수(vitest 12)·앵커 팝오버(body 포털·z:1100·opacity 전용·body 락 없음)·리포트 AI 텍스트 전 섹션 자동 매칭·리포트 상세 차트 범례/라벨 배선. 그릴링 때 못박은 회고 규칙(transform 금지·useBodyScrollLock 미사용·스크롤 불변 프로브)이 그대로 적용돼 함정 재발 0.
- Divergences (유의미 1건): **"스크롤 시 닫힘" 명세가 브라우저 포커스 스크롤 엣지를 못 봤다.** 화면 밖(부분 가시) 단어를 탭하면 버튼 focus의 브라우저 자동 scroll-into-view가 팝오버 열림 0.6ms 뒤에 발생 → scroll 닫힘 리스너가 즉시 닫아 "탭해도 안 뜨는" 실버그. 라이브 프로브(EXIT=2)가 포착, MutationObserver+scroll 캡처 로그로 시퀀스(popover-add→scroll→popover-remove) 확정 후 in-run 수정(열림 400ms 내 스크롤은 닫는 대신 위치 재계산 추적, 315926f).

## Learnings

- Do differently next time:
  - **"스크롤 시 닫힘" 앵커 팝오버/툴팁은 열림 직후 유예가 필수 규칙.** 클릭이 유발하는 브라우저 포커스 스크롤(부분 가시 요소의 scroll-into-view)이 열림 직후 scroll 이벤트를 쏘므로, naive close-on-scroll은 뷰포트 경계 요소에서 100% 자기파괴한다. 패턴: 열림 ~400ms 내 scroll → 위치 재계산(추적), 이후 scroll → 닫힘. (Glossary.jsx GlossaryPopover가 참조 구현.)
  - **인터랙션 타이밍 버그 진단은 MutationObserver(childList) + capture-phase 이벤트 로그 주입이 빠르다** — DOM 부착/제거와 이벤트 발생을 ms 단위 타임라인으로 찍으면 "누가 먼저였나"가 즉시 갈린다(task#196 회고의 attributeOldValue 기법과 한 가족, 이번엔 childList판).
  - UAT 프로브가 제품의 시간 유예(grace)를 검증할 땐 **유예 창 밖에서 단언**해야 한다(400ms 추적 유예를 200ms 대기로 검사해 거짓 실패 — 600ms 대기로 정정).
  - 자동 매칭 규칙(라틴 키 영숫자 경계·한글 substring·longest-match·용어별 첫 등장)은 순수 함수로 분리해 vitest로 못박은 것이 배선 폭(6개 섹션+α)을 안전하게 만들었다 — 그대로 좋았음.

## Doc updates

- CONTEXT.md promotion: none (주식 용어집 용어는 그릴링 때 이미 등재 — 이번 학습은 전부 플랫폼/프로세스).
- ADR added: none (정적 모듈 선택은 가역적 — DB 이관 쉬움).
