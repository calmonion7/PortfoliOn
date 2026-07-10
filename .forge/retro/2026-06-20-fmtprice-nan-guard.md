<!-- forge-slug: fmtprice-nan-guard -->
# 2026-06-20 — fmtPrice 폴백 한국어화 + 비유한(NaN/Inf) 가드 (task#86)

## Plan vs actual
- What went as planned: 단일 슬라이스 그대로. `frontend/src/utils.js` 진입 가드를 `if (val == null) return 'N/A'` → `if (val == null || !Number.isFinite(Number(val))) return '—'`로 교체(시장 ₩/$ 분기 불변). 직접 편집(소규모라 워크플로우 미사용). node 실측 9케이스(null/undefined/NaN/'abc'/Infinity→'—', 1234.5→₩1,235·0→₩0·'123'→$123.00) + `npm run build` ✓ + 호출처 10곳 grep 무회귀. UAT: yes.
- Divergences: 없음(계획=실제). retro-hint: optional대로 사소.

## Learnings
- Do differently next time: 프론트 숫자 포매터는 `val == null` 가드만으론 부족 — `Number(val)`이 NaN/Inf가 되는 입력(외부 시세 NaN, 비숫자 문자열)에선 `₩NaN`/`$NaN`이 그대로 노출된다. 소스에서 `!Number.isFinite(Number(val))`로 막을 것. 무데이터 폴백 문자열은 앱 관례 `'—'`(48회)로 통일(영문 'N/A'는 outlier였음). 일부 호출처는 이미 `== null ? '—' : fmt(...)`로 선가드 중이라, 함수 자체 가드로 선가드 누락처(DashboardCard target_mean, Ranking price)까지 수렴.

## Doc updates
- CONTEXT.md promotion: none (새 용어 없음)
- ADR added: none (되돌리기 쉬운 표시 폴리시 — 3조건 미충족)
- CLAUDE.md: none — 사소·1회. CONCERNS #2(백엔드 NaN→JSON 500)는 별개 관심사라 무관.
