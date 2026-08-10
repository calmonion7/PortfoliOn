// task#290 S4 (B47) — 부팅 1회 api-cache 삭제. ADR-0036.
// caches 부재(jsdom 기본)·delete 성공·delete 거절 세 경로를 모두 던지지 않고 통과해야 한다
// (가토 ⑧ⓡ — `if (기능 있음)`은 부재 처리일 뿐 실패 처리가 아니다. 거절 경로가 실제 실패 모드).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { purgeApiCache } from '../apiCachePurge'

describe('purgeApiCache — 부팅 1회 api-cache 삭제 (ADR-0036)', () => {
  afterEach(() => {
    delete globalThis.caches
  })

  it('caches 부재(jsdom 기본) 시 던지지 않고 no-op한다', async () => {
    delete globalThis.caches
    await expect(purgeApiCache()).resolves.toBeUndefined()
  })

  it("caches.delete가 resolve되면 'api-cache'로 정확히 1회 호출된다", async () => {
    const del = vi.fn().mockResolvedValue(true)
    globalThis.caches = { delete: del }

    await purgeApiCache()

    expect(del).toHaveBeenCalledTimes(1)
    expect(del).toHaveBeenCalledWith('api-cache')
  })

  it('caches.delete가 거절되어도 던지지 않고 삼킨다 — 단 침묵하지는 않는다', async () => {
    const del = vi.fn().mockRejectedValue(new Error('boom'))
    globalThis.caches = { delete: del }
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(purgeApiCache()).resolves.toBeUndefined()

    // 이 삭제는 전환 창(옛 SW 생존)에서 B47의 유일한 방어선이라, 실패가 조용히 사라지면
    // 운영자가 방어선 부재를 알 방법이 없다(무음 실패 금지).
    expect(warn).toHaveBeenCalledTimes(1)
    expect(warn.mock.calls[0][0]).toContain('[apiCachePurge]')
    warn.mockRestore()
  })

  it('google-fonts·cdn-fonts·precache 키는 건드리지 않는다', async () => {
    const del = vi.fn().mockResolvedValue(true)
    globalThis.caches = { delete: del }

    await purgeApiCache()

    expect(del).not.toHaveBeenCalledWith('google-fonts')
    expect(del).not.toHaveBeenCalledWith('cdn-fonts')
    expect(del).not.toHaveBeenCalledWith(expect.stringContaining('precache'))
  })
})
