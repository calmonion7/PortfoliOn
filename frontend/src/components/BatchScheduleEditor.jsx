import { useState } from 'react'
import api from '../api'

const DAYS = [
  { key: 'mon', label: '월' }, { key: 'tue', label: '화' },
  { key: 'wed', label: '수' }, { key: 'thu', label: '목' },
  { key: 'fri', label: '금' }, { key: 'sat', label: '토' },
  { key: 'sun', label: '일' },
]
const TYPES = [
  { key: 'daily', label: '매일' },
  { key: 'weekly', label: '매주' },
  { key: 'monthly', label: '매월' },
  { key: 'interval', label: '인터벌' },
]

const numInputStyle = {
  background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
  color: 'var(--text)', fontSize: 14, fontFamily: 'inherit',
  borderRadius: 8, padding: '4px 10px', width: 70,
}

function withDefaults(type, prev) {
  // 패턴 전환 시 누락 필드를 합리적 기본값으로 채운다(검증 통과용).
  const base = { ...prev, type }
  if (type === 'daily' || type === 'weekly' || type === 'monthly') {
    if (!base.time) base.time = '08:00'
  }
  if (type === 'weekly' && (!Array.isArray(base.days) || base.days.length === 0)) {
    base.days = ['mon']
  }
  if (type === 'monthly' && !base.day_of_month) base.day_of_month = 1
  if (type === 'interval') {
    if (base.every_minutes == null) base.every_minutes = 10
    if (base.start_hour == null) base.start_hour = 9
    if (base.end_hour == null) base.end_hour = 15
  }
  return base
}

export default function BatchScheduleEditor({ jobId, schedule, timezone, onSaved }) {
  const [spec, setSpec] = useState(schedule || { enabled: false, type: 'daily', time: '08:00' })
  const [saved, setSaved] = useState(false)
  const [saveErr, setSaveErr] = useState('')

  const set = (patch) => setSpec(s => ({ ...s, ...patch }))

  const toggleDay = (day) => {
    setSpec(s => {
      const days = s.days || []
      return { ...s, days: days.includes(day) ? days.filter(d => d !== day) : [...days, day] }
    })
  }

  const handleSave = async () => {
    setSaveErr('')
    // 클라이언트측 가드 (서버도 검증함)
    if (spec.type === 'weekly' && (!spec.days || spec.days.length === 0)) {
      setSaveErr('요일을 하나 이상 선택하세요.')
      return
    }
    if (spec.type === 'interval') {
      if ((spec.every_minutes ?? 0) < 5) { setSaveErr('주기는 5분 이상이어야 합니다.'); return }
      if (spec.start_hour > spec.end_hour) { setSaveErr('시작 시각이 종료 시각보다 클 수 없습니다.'); return }
    }
    try {
      await api.put(`/api/batches/${jobId}/schedule`, spec)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
      onSaved?.(spec)
    } catch (err) {
      setSaveErr(err?.response?.data?.detail || '저장에 실패했습니다.')
    }
  }

  const dim = { opacity: spec.enabled ? 1 : 0.4 }

  return (
    <div style={{ maxWidth: 480 }}>
      <div className="list-card" style={{ margin: 0 }}>
        <div className="s-row">
          <div className="title">자동 실행</div>
          <button
            className={`m-switch ${spec.enabled ? 'on' : ''}`}
            onClick={() => set({ enabled: !spec.enabled })}
          />
        </div>

        <div className="s-row" style={dim}>
          <div className="title">패턴</div>
          <select
            value={spec.type}
            onChange={e => setSpec(s => withDefaults(e.target.value, s))}
            disabled={!spec.enabled}
            style={{
              background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
              color: 'var(--text)', fontSize: 14, fontFamily: 'inherit',
              borderRadius: 8, padding: '4px 10px', cursor: spec.enabled ? 'pointer' : 'default',
            }}>
            {TYPES.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </div>

        {spec.type === 'weekly' && (
          <div style={{ padding: '14px 16px', borderTop: '1px solid var(--border)', ...dim }}>
            <div style={{ fontSize: 11, color: 'var(--text-3)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 500, marginBottom: 10 }}>요일</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {DAYS.map(({ key, label }) => (
                <button key={key} type="button"
                  onClick={() => spec.enabled && toggleDay(key)}
                  style={{
                    flex: 1, height: 36, borderRadius: '50%', border: 'none',
                    background: (spec.days || []).includes(key) ? 'var(--text)' : 'var(--accent-soft)',
                    color: (spec.days || []).includes(key) ? 'var(--bg)' : 'var(--text-3)',
                    fontSize: 13, fontWeight: 500, cursor: spec.enabled ? 'pointer' : 'default',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}

        {spec.type === 'monthly' && (
          <div className="s-row" style={dim}>
            <div className="title">실행 일자</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <input type="number" min={1} max={31} value={spec.day_of_month ?? 1}
                onChange={e => set({ day_of_month: Number(e.target.value) })}
                disabled={!spec.enabled} style={numInputStyle} />
              <span style={{ fontSize: 13, color: 'var(--text-3)' }}>일</span>
            </div>
          </div>
        )}

        {(spec.type === 'daily' || spec.type === 'weekly' || spec.type === 'monthly') && (
          <div className="s-row" style={dim}>
            <div className="title">실행 시간</div>
            <input type="time" value={spec.time || '08:00'}
              onChange={e => set({ time: e.target.value })}
              disabled={!spec.enabled}
              style={{
                background: 'var(--bg-elev-2)', border: '1px solid var(--border)',
                color: 'var(--text)', fontSize: 14, fontFamily: 'inherit',
                borderRadius: 8, padding: '4px 10px', cursor: spec.enabled ? 'pointer' : 'default',
              }} />
          </div>
        )}

        {spec.type === 'interval' && (
          <>
            <div className="s-row" style={dim}>
              <div className="title">주기 (분)</div>
              <input type="number" min={5} value={spec.every_minutes ?? 10}
                onChange={e => set({ every_minutes: Number(e.target.value) })}
                disabled={!spec.enabled} style={numInputStyle} />
            </div>
            <div className="s-row" style={dim}>
              <div className="title">시작 시각</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" min={0} max={23} value={spec.start_hour ?? 9}
                  onChange={e => set({ start_hour: Number(e.target.value) })}
                  disabled={!spec.enabled} style={numInputStyle} />
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>시</span>
              </div>
            </div>
            <div className="s-row" style={dim}>
              <div className="title">종료 시각</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <input type="number" min={0} max={23} value={spec.end_hour ?? 15}
                  onChange={e => set({ end_hour: Number(e.target.value) })}
                  disabled={!spec.enabled} style={numInputStyle} />
                <span style={{ fontSize: 13, color: 'var(--text-3)' }}>시</span>
              </div>
            </div>
          </>
        )}

        {timezone && (
          <div className="s-row">
            <div className="title">타임존</div>
            <span style={{ fontSize: 13, color: 'var(--text-3)' }}>{timezone}</span>
          </div>
        )}

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)' }}>
          <button className="btn btn-primary" onClick={handleSave} style={{ width: '100%', justifyContent: 'center' }}>
            {saved ? '저장됨 ✓' : '저장'}
          </button>
          {saveErr && <p style={{ color: 'var(--down)', fontSize: 13, marginTop: 6 }}>{saveErr}</p>}
        </div>
      </div>
    </div>
  )
}
