import { useEffect } from 'react'
import BookingFlow from './BookingFlow'
import './booking.css'

const PLAN_STORAGE_KEY = 'ck_pending_plan'

// Read (and clear) the request a guest built here before they signed up, so
// the real BookingFlow can pick up right where they left off, once, after
// login, and send it automatically.
export function readPendingPlan() {
  try {
    const raw = sessionStorage.getItem(PLAN_STORAGE_KEY)
    if (!raw) return null
    sessionStorage.removeItem(PLAN_STORAGE_KEY)
    const plan = JSON.parse(raw)
    return plan && typeof plan === 'object' ? plan : null
  } catch {
    return null
  }
}

export default function GuestEstimator({ onClose, onRequireAuth }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  function handleRequireAuth(payload) {
    try {
      sessionStorage.setItem(PLAN_STORAGE_KEY, JSON.stringify(payload))
    } catch {
      // Private browsing / storage disabled — the guest just re-picks after signup.
    }
    onRequireAuth()
  }

  return (
    <div
      className="plan-overlay"
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      role="dialog"
      aria-modal="true"
      aria-label="Plan your visit"
    >
      <div className="plan-modal">
        <button type="button" className="plan-close" onClick={onClose} aria-label="Close">
          ×
        </button>
        <div className="plan-modal-head">
          <p className="plan-kicker">No account needed yet</p>
          <h3>Plan your visit</h3>
          <p>Pick a package, date, rooms, and rentals to see the full price. You only sign up when you're ready to send the request.</p>
        </div>
        <BookingFlow guestMode onRequireAuth={handleRequireAuth} onDone={() => {}} />
      </div>
    </div>
  )
}
