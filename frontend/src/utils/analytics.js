export function trackEvent(eventName, properties = {}) {
  fetch('/api/events', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ event_name: eventName, properties }),
  }).catch(() => {})
}
