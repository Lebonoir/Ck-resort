import { useEffect, useState } from 'react'

export function formatRemain(until, now = Date.now()) {
  if (!until) return '—'
  const ms = new Date(until).getTime() - now
  if (ms <= 0) return 'Due now'
  const total = Math.floor(ms / 1000)
  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  if (days > 0) return `${days}d ${hours}h`
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

/** One shared ticker so many countdowns do not each hold their own interval. */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

/**
 * Live countdown to `until`. Once it elapses the label flips to `doneLabel` —
 * the SQL lifecycle is what actually closes the record out, this only reports.
 */
export function CountdownPill({ until, label, doneLabel = 'Wrapping up…', tone = '' }) {
  const now = useNow()
  if (!until) return null
  const elapsed = new Date(until).getTime() - now <= 0
  return (
    <span className={`countdown ${elapsed ? 'elapsed' : tone}`}>
      <small>{elapsed ? '' : label}</small>
      <b>{elapsed ? doneLabel : formatRemain(until, now)}</b>
    </span>
  )
}
