import { Button, Card, CardHeader, Badge, MarketBadge, ChangeBadge, Stat } from '../components/ui'

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
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>카드 본문 내용</p>
        </Card>
        <Card elevated>
          <CardHeader title="Elevated" />
          <p style={{ margin: 0, color: 'var(--text-muted)' }}>그림자 있는 카드</p>
        </Card>
      </div>

      <h2>Stat</h2>
      <div style={{ display: 'flex', gap: 24 }}>
        <Stat label="총 평가금액" value="$124,500" change={2.3} />
        <Stat label="일간 손익" value="+$1,240" valueColor="success" />
        <Stat label="보유 종목" value="12" size="sm" />
      </div>
    </div>
  )
}
