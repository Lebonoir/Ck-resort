import { useState } from 'react'

function monogram(label) {
  return String(label || 'Room')
    .split(/[\s·]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase()
}

/**
 * Room picture with a composed fallback: rooms without an uploaded photo (or
 * with a link that no longer loads) show a monogram tile instead of a broken
 * image. Photos are uploaded by the manager under Rates → Room photos.
 */
export default function RoomPhoto({ src, label, className = '' }) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) {
    return (
      <span className={`room-photo ${className}`}>
        <img src={src} alt={`${label} room`} loading="lazy" onError={() => setFailed(true)} />
      </span>
    )
  }
  return (
    <span className={`room-photo empty ${className}`} role="img" aria-label={`${label} · photo not uploaded yet`}>
      <b>{monogram(label)}</b>
      <small>Photo coming soon</small>
    </span>
  )
}
