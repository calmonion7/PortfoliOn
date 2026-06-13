import usePriceFlash from '../../hooks/usePriceFlash'
import './PriceFlash.css'

// 표시값(value)이 라이브 폴링 틱(tick)으로 바뀌면 방향색으로 잠깐 플래시하는 래퍼.
// as: 렌더 태그(기본 span — 테이블 셀이면 'td', 블록이면 'div'). className: 기존 클래스 유지.
// flash.id를 key로 줘 연속 변동 시 애니메이션이 매번 재발화된다.
export default function FlashValue({ value, tick, as: Tag = 'span', className = '', children, ...rest }) {
  const flash = usePriceFlash(value, tick)
  const cls = ['price-flash', flash ? `price-flash--${flash.dir}` : '', className].filter(Boolean).join(' ')
  return <Tag key={flash?.id ?? 'base'} className={cls} {...rest}>{children}</Tag>
}
