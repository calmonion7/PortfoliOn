import { useState } from 'react'
import { Button, Card, CardHeader, Badge, MarketBadge, ChangeBadge, Stat } from '../components/ui'
import {
  SketchEmpty, SketchError, SketchNotFound, SketchHero,
  IconResearch, IconPortfolio, IconMarket, IconCalendarIncome, IconGuru,
  SketchUnderline, SketchArrowUp, SketchCircleMark,
} from '../components/sketches'
import useReveal from '../hooks/useReveal'
import useCountUp from '../hooks/useCountUp'

function CountUpDemo() {
  const [value, setValue] = useState(1240)
  const display = useCountUp(value)
  return (
    <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
      <span style={{ fontSize: 24, fontVariantNumeric: 'tabular-nums' }}>{Math.round(display).toLocaleString()}</span>
      <Button variant="secondary" size="sm" onClick={() => setValue((v) => v + 500)}>+500</Button>
    </div>
  )
}

function RevealDemo() {
  const ref = useReveal()
  return (
    <div ref={ref} className="reveal">
      <Card>스크롤해 뷰포트에 들어오면 나타납니다</Card>
    </div>
  )
}

export default function Showcase() {
  return (
    <div style={{ padding: 32, display: 'flex', flexDirection: 'column', gap: 32, maxWidth: 800 }}>
      <h2>Button</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Danger</Button>
        <Button variant="primary" size="sm">Small</Button>
        <Button variant="primary" size="lg">Large</Button>
        <Button variant="primary" loading>Loading</Button>
        <Button variant="primary" disabled>Disabled</Button>
      </div>

      <h2>Badge</h2>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <Badge variant="neutral">Neutral</Badge>
        <Badge variant="success">Success</Badge>
        <Badge variant="danger">Danger</Badge>
        <Badge variant="warning">Warning</Badge>
        <Badge variant="info">Info</Badge>
        <MarketBadge market="KR" />
        <MarketBadge market="US" />
        <ChangeBadge value={3.2} />
        <ChangeBadge value={-1.5} />
        <ChangeBadge value={null} />
      </div>

      <h2>Card</h2>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Card>
          <CardHeader title="기본 카드" subtitle="padding md" />
          <p style={{ margin: 0, color: 'var(--text-3)' }}>카드 본문 내용</p>
        </Card>
        <Card elevated>
          <CardHeader title="Elevated" />
          <p style={{ margin: 0, color: 'var(--text-3)' }}>그림자 있는 카드</p>
        </Card>
      </div>

      <h2>Stat</h2>
      <div style={{ display: 'flex', gap: 24 }}>
        <Stat label="총 평가금액" value="$124,500" change={2.3} />
        <Stat label="일간 손익" value="+$1,240" valueColor="success" />
        <Stat label="보유 종목" value="12" size="sm" />
      </div>

      <h2>Sketches</h2>
      <h3 style={{ margin: 0 }}>상태 3종 (드로잉 애니메이션)</h3>
      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', color: 'var(--text-3)' }}>
        <div className="sketch-draw"><SketchEmpty /></div>
        <div className="sketch-draw"><SketchError /></div>
        <div className="sketch-draw"><SketchNotFound /></div>
      </div>

      <h3 style={{ margin: 0 }}>카테고리 아이콘 5종</h3>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', color: 'var(--text)' }}>
        <IconResearch size={20} />
        <IconPortfolio size={20} />
        <IconMarket size={20} />
        <IconCalendarIncome size={20} />
        <IconGuru size={20} />
      </div>

      <h3 style={{ margin: 0 }}>히어로</h3>
      <div style={{ maxWidth: 480, color: 'var(--text-2)' }}>
        <SketchHero />
      </div>

      <h3 style={{ margin: 0 }}>차트 장식 모티프 3종</h3>
      <div style={{ display: 'flex', gap: 24, alignItems: 'center', color: 'var(--accent)' }}>
        <SketchUnderline />
        <SketchArrowUp />
        <SketchCircleMark />
      </div>

      <h2>Motion</h2>
      <h3 style={{ margin: 0 }}>fade-up</h3>
      <div className="anim-fade-up">
        <Card>anim-fade-up 클래스가 적용된 카드</Card>
      </div>

      <h3 style={{ margin: 0 }}>reveal (scroll)</h3>
      <RevealDemo />

      <h3 style={{ margin: 0 }}>useCountUp</h3>
      <CountUpDemo />
    </div>
  )
}
