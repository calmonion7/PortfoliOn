// task#274 — 배치 실행 상태 아이콘이 partial·skipped를 구별해 렌더한다.
//
// 옛 배선은 success/failed만 알고 나머지를 전부 회색 빈 동그라미로 떨어뜨려, 미종료(running)와
// 종료했지만 부분/생략인 경우가 화면에서 **구별 불가**였다(job_runs가 상태를 갖게 되면서 생긴 갭).
// 불변식: 채워진 ● = 종료 상태 · 빈 ○ = 미종료/미지.
import { render } from '@testing-library/react'
import { describe, it, expect } from 'vitest'

import { StatusIcon } from '../pages/Settings'

function iconOf(status) {
  const { container } = render(<StatusIcon status={status} />)
  const el = container.querySelector('span')
  return { glyph: el.textContent, color: el.style.color, title: el.getAttribute('title') }
}

describe('StatusIcon', () => {
  it('종료 상태 4종이 서로 다른 글리프·색 조합을 갖는다', () => {
    const seen = ['success', 'failed', 'partial', 'skipped'].map(iconOf)
    const keys = seen.map((s) => `${s.glyph}|${s.color}`)
    expect(new Set(keys).size).toBe(4)          // 어느 둘도 같아 보이지 않는다
    expect(seen.every((s) => s.glyph === '●')).toBe(true)   // 종료 = 채움
  })

  it('partial·skipped가 미종료(running)와도 구별된다', () => {
    const running = iconOf('running')
    expect(running.glyph).toBe('○')             // 미종료 = 빈 동그라미
    for (const s of ['partial', 'skipped']) {
      expect(iconOf(s).glyph).not.toBe(running.glyph)
    }
  })

  it('partial은 경고색(--warn)이고 가격 토큰을 쓰지 않는다', () => {
    // KR 색 관례 — 의미 상태는 --warn/--color-success/--color-error, 가격 방향은 --up/--down.
    expect(iconOf('partial').color).toContain('--warn')
    for (const s of ['success', 'failed', 'partial', 'skipped']) {
      expect(iconOf(s).color).not.toMatch(/--up|--down/)
    }
  })

  it('색 단독 구별을 4상태로 늘렸으므로 전부 title을 단다', () => {
    for (const s of ['success', 'failed', 'partial', 'skipped', 'running']) {
      expect(iconOf(s).title).toBeTruthy()
    }
  })
})
