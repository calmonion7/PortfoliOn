export function trackEvent(eventName, properties = {}) {
  const token = localStorage.getItem('access_token')
  if (!token) return
  fetch('/api/events', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ event_name: eventName, properties }),
  }).catch(() => {})
}
