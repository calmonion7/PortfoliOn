import { useEffect, useRef } from 'react'
import api from '../api'
import { useToast } from '../components/Toast'

/**
 * 온디맨드 갱신 (ADR 260916-132605 결정 2·3) — 리포트 상세를 열 때 그 종목의 사업분석 갱신을 루틴에 요청하고,
 * 요청이 실제로 나갔으면(`fired:true`) 완료를 **유계** 폴링해 알린다.
 *
 * 판정은 서버가 한다(7일 게이트·in-flight 가드) — 프론트는 상세 진입마다 1회 POST하고 응답의 `fired`만 본다.
 * `fired:false`(fresh·in_flight·unconfigured)와 POST 실패(옛 백엔드 404 등)는 **조용히** 끝낸다: 사용자에게
 * 「갱신 안 함」을 알릴 이유가 없고, 배포 창(새 프론트 ↔ 옛 백엔드)에서 콘솔 에러를 내지 않기 위해서다.
 *
 * 폴링 상한 셋(무한 경로 금지, task#343 재발 방지): MAX_TICKS · 연속 실패 MAX_FAIL_STREAK · 언마운트/종목 변경.
 * 완료 판정은 **첫 폴의 `enriched_at`을 baseline**으로 잡고 그 뒤 값이 바뀌었을 때다 — 부모의 `detail` 상태는
 * 이 이펙트와 비동기로 채워져 「미조회 null」과 「진짜 null」을 구별하지 못하므로 그것을 baseline으로 쓰지 않는다.
 * enrich 세션은 수 분 걸리므로 첫 폴(30초) 전에 끝나는 경우는 실질적으로 없다.
 */
export const POLL_INTERVAL_MS = 30_000
export const MAX_TICKS = 30            // 15분
export const MAX_FAIL_STREAK = 3

export default function useEnrichOnDemand({ ticker, date, enabled = true, onRefreshed }) {
  const { showToast } = useToast()
  const onRefreshedRef = useRef(onRefreshed)
  onRefreshedRef.current = onRefreshed

  useEffect(() => {
    if (!enabled || !ticker || !date) return undefined
    let cancelled = false
    let timer = null
    const stop = () => { if (timer) { clearInterval(timer); timer = null } }

    // Promise 체인 안에서 호출한다 — 동기 throw·비-promise 반환도 아래 `.catch`로 모아 상세 렌더를 깨뜨리지 않는다.
    Promise.resolve()
      .then(() => api.post(`/api/stocks/${ticker}/enrich/request`))
      .then((res) => {
        const data = res?.data
        if (cancelled || !data?.fired) return
        showToast('사업분석이 묵어 갱신을 요청했습니다. 완료되면 알려드립니다.', 'warning')
        let baseline
        let ticks = 0
        let fails = 0
        timer = setInterval(() => {
          ticks += 1
          if (ticks > MAX_TICKS) { stop(); return }
          api.get(`/api/report/${ticker}/${date}`)
            .then(({ data: d }) => {
              if (cancelled) return
              fails = 0
              const ea = d?.enriched_at ?? null
              if (baseline === undefined) { baseline = ea; return }
              if (ea !== null && ea !== baseline) {
                stop()
                showToast('사업분석이 갱신됐습니다.', 'success')
                onRefreshedRef.current?.()
              }
            })
            .catch(() => {
              if (cancelled) return
              fails += 1
              if (fails >= MAX_FAIL_STREAK) stop()
            })
        }, POLL_INTERVAL_MS)
      })
      .catch((e) => {
        // 404 = 옛 백엔드(엔드포인트 미배포) — 배포 창의 정상 상태라 경고도 내지 않는다.
        if (e?.response?.status !== 404) console.warn('[useEnrichOnDemand] 갱신 요청 실패:', e)
      })

    return () => { cancelled = true; stop() }
  }, [ticker, date, enabled, showToast])
}
