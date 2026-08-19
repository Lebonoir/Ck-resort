import { useEffect, useState } from 'react'
import { verifyDownpayment } from '../lib/api'
import { rpcError } from '../lib/format'

export default function PaymentReturn({ bookingId, cancelled, onDone }) {
  const [message, setMessage] = useState(cancelled ? 'Payment was cancelled.' : 'Confirming your PayMongo payment…')
  const [error, setError] = useState('')

  useEffect(() => {
    if (cancelled || !bookingId) return undefined
    let alive = true
    verifyDownpayment(bookingId)
      .then((result) => {
        if (!alive) return
        setMessage(result.paid ? 'Downpayment received. Your stay is confirmed.' : 'PayMongo has not marked this as paid yet. Open My reservations and tap “I already paid”.')
      })
      .catch((err) => {
        if (!alive) return
        setError(rpcError(err))
      })
    return () => {
      alive = false
    }
  }, [bookingId, cancelled])

  const paid = /confirmed|received/i.test(message)
  const pill = cancelled ? 'Cancelled' : error ? 'Needs attention' : paid ? 'Confirmed' : 'Confirming'
  const pillClass = cancelled || error ? 'no' : paid ? 'ok' : 'warn'

  return (
    <div className="status-shell">
      <div className="status-card">
        <p className="status-kicker">CK Resort · PayMongo</p>
        <div className="check-burst">{error || cancelled ? '!' : '✓'}</div>
        <h2 className="status-title">
          Pay<em>ment</em>
        </h2>
        <span className={`status-pill ${pillClass}`}>{pill}</span>
        <p>{error || message}</p>
        <button type="button" className="submit" onClick={onDone}>
          Back to workspace
        </button>
      </div>
    </div>
  )
}
