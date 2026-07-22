# 2026-07-23 — 에디토리얼 리디자인 1/5: 토큰·타이포·스케치·모션 토대 (일괄 승급 사후 회고)

2026-07-17 실행·봉인(fg-next all auto-skip), run.md 기반 사후 회고. 5부작의 재료 파트 — ADR-0026(에디토리얼 매거진 아이덴티티)이 하드결정 정본.

## Plan vs actual
- What went as planned: 종이질감 라이트/야간 인쇄본 다크 토큰, KR 가격색 잉크톤(버밀리온 #b3372b/프러시안 #2b5c9e), AA 3중 검증(worst 4.83 + 배지 5.47 + 독립 감사 108조합 미달 0), Noto Serif KR, 스케치 SVG 12종(stroke·currentColor·pathLength 계약), motion.css+useReveal+useCountUp+reduced-motion. vitest 79 green, 적대 리뷰 6렌즈 결함 0.
- Divergences: 경미 3건 — 게이트 grep 권한 차단 → Read 대체, 감사 스크립트 /tmp 잔존(무해), Showcase 캡처 무인증 1회 헛발 → 토큰 주입 재캡처.

## Learnings
- Do differently next time: **무배포 검증 기법(로컬 vite preview + prod API 베이크) 재사용 가치 확인** — 대형 시각 변경을 라이브 오염 없이 검증. 스펙 문서를 정본으로 한 병렬 저작(같은 디렉터리·다른 파일)은 충돌 0.
- 색 접근성은 "설계 실측 + 소비처 배지 + 독립 전수 감사" 3중이 실효 — 단일 검증은 조합 누락.

## Doc updates
- CONTEXT.md promotion: none — 하드결정은 ADR-0026에 이미 정본화(그릴링 시점).
- ADR added: none 신규.
