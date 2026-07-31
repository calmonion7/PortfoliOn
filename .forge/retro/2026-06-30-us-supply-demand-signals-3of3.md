# 2026-06-30 — US 수급 보강 3/3 (구루 드릴다운) (task#124, 일괄 승급 회고)

시리즈(#114 1of3·2of3·3of3) 완결. `fg-next all` 자동 스킵 봉인의 지연 승급. 원료: `done/2026-06-30-us-supply-demand-signals-3of3/run.md`.

## 계획 ↔ 실제

- **계획대로**: `GuruHoldersSection.jsx` 신설 — 기존 `GET /api/guru/managers`를 직접 fetch(신규 훅·엔드포인트 0)해 **종목→보유구루 클라이언트 역인덱스**를 만들고 리포트 상세 기술·수급 US 분기에 배선. 백엔드 파일 0 변경(git으로 확정). Dynamic Workflow 2 phase(Implement → Review), eco/sonnet.
- **Divergences**:
  1. **D1 (데이터 한계, 의도적)**: 구루 데이터는 `managers[].top10[]`만 노출하므로 해당 종목을 *top10 밖*으로 보유한 구루는 표시되지 않는다. 컴포넌트 주석에 의도를 명시했다(top10 밖 비중은 미미). 풀 holdings가 열리면 후속 가능.
  2. **D2 (low, 미수정·graceful)**: `h.ticker.toUpperCase()`가 ticker null이면 TypeError지만 outer `.catch()`가 잡아 silent null 렌더(크래시 아님)이고, 스크레이퍼가 ticker truthy일 때만 append하며 기존 `GuruManagers.jsx`도 동일 패턴이다. surgical·스타일 일관성을 위해 미수정(고치려면 GuruManagers까지 손대야 함).
  3. **가토가 즉시 렌즈로 작동한 사례**: Review가 *바로 전에 추가된* yfinance 퍼센트-분수 가토를 렌즈로 적용해 `weight_pct`를 검사했고, 스크레이프 HTML의 plain %(7.43 = 7.43%)지 yfinance식 0~1 분수가 아님을 확인했다(`toFixed(2)%` 정상). **새로 쓴 가토가 다음 작업에서 오탐 방지로 회수된 관측**이다.

## 배운 것

- **다음엔 다르게**:
  1. **데이터 소스의 커버리지 한계는 코드 주석에 남길 것.** "top10만 보인다"는 화면에서 구별 불가한 결측이므로, 다음 사람이 버그로 오인하지 않게 의도임을 코드에 박아야 한다(wrong<missing의 표시판).
  2. **기존 패턴과 동일한 저위험 결함은 그 자리에서 고치지 말고 기록할 것** — 한 곳만 고치면 형제와 어긋나 오히려 혼란이 된다(여기선 `GuruManagers.jsx`와 같은 패턴).
  3. **새 가토는 다음 리뷰의 렌즈 목록에 넣을 것.** 이번엔 그렇게 해서 스케일 오탐을 미리 걸렀다.
- **미검증 잔여**: 런타임 UI는 구루 보유분이 있는 US 종목 상세에서 확인(구루 데이터는 이미 적재, 프론트는 빌드 즉시 라이브).

## Doc updates

- CONTEXT.md promotion: none · ADR added: none
- CLAUDE.md 승급: none (D1·D2는 이 표면 국소 · "가토가 렌즈로 작동"은 관측이지 규칙이 아님)
