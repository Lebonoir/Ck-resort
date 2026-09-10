import { useState } from 'react'
import { submitReview } from '../lib/api'
import { prettyDate, rpcError } from '../lib/format'

const CATEGORIES = [
  { key: 'overall', label: 'Overall experience' },
  { key: 'cleanliness', label: 'Cleanliness' },
  { key: 'amenities', label: 'Pool & amenities' },
  { key: 'staff', label: 'Staff & service' },
  { key: 'value_rating', label: 'Value for money' },
]

const EMPTY = { overall: 0, cleanliness: 0, amenities: 0, staff: 0, value_rating: 0, comment: '' }

function Stars({ value, onChange, label }) {
  const [hover, setHover] = useState(0)
  const shown = hover || value
  return (
    <div className="rate-row">
      <span className="rate-label">{label}</span>
      <div className="rate-stars" role="radiogroup" aria-label={label}>
        {[1, 2, 3, 4, 5].map((score) => (
          <button
            key={score}
            type="button"
            role="radio"
            aria-checked={value === score}
            aria-label={`${score} of 5`}
            className={score <= shown ? 'on' : ''}
            onMouseEnter={() => setHover(score)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onChange(score)}
          >
            ★
          </button>
        ))}
        <small>{value ? `${value}/5` : 'Not rated'}</small>
      </div>
    </div>
  )
}

export default function RatingsPanel({ stays, onDone, onError, onSaved }) {
  const [openId, setOpenId] = useState(stays[0]?.id || '')
  const [draft, setDraft] = useState(EMPTY)
  const [busy, setBusy] = useState(false)

  const complete = CATEGORIES.every((item) => draft[item.key] > 0)

  async function send(event) {
    event.preventDefault()
    if (!complete) return
    setBusy(true)
    onError('')
    try {
      await submitReview({ booking_id: openId, ...draft })
      setDraft(EMPTY)
      onSaved('Thank you! Your rating has been recorded.')
      await onDone()
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setBusy(false)
    }
  }

  if (!stays.length) {
    return (
      <section className="stay-card">
        <p className="stay-kicker">CK Resort · Ratings</p>
        <h2>Nothing to rate yet</h2>
        <p className="hint">
          Once a stay is completed it appears here so you can rate it. Your feedback goes straight to the resort
          manager.
        </p>
      </section>
    )
  }

  const stay = stays.find((item) => item.id === openId) || stays[0]

  return (
    <section className="stay-card rate-card">
      <p className="stay-kicker">CK Resort · Rate your stay</p>
      <h2>How was it?</h2>

      {stays.length > 1 ? (
        <label className="rate-pick">
          Stay to rate
          <select
            value={openId}
            onChange={(event) => {
              setOpenId(event.target.value)
              setDraft(EMPTY)
            }}
          >
            {stays.map((item) => (
              <option key={item.id} value={item.id}>
                {item.reference} · {item.package_label}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <p className="hint">
        {stay.reference} · {stay.package_label} · {prettyDate(stay.stay_date)}
      </p>

      <form onSubmit={send} className="rate-form">
        {CATEGORIES.map((item) => (
          <Stars
            key={item.key}
            label={item.label}
            value={draft[item.key]}
            onChange={(score) => setDraft({ ...draft, [item.key]: score })}
          />
        ))}
        <label className="rate-comment">
          Anything you want the resort to know?
          <textarea
            rows={4}
            value={draft.comment}
            maxLength={500}
            placeholder="Optional — what went well, what could be better…"
            onChange={(event) => setDraft({ ...draft, comment: event.target.value })}
          />
        </label>
        <button type="submit" className="book-btn" disabled={!complete || busy}>
          {busy ? 'Sending…' : complete ? 'Submit rating' : 'Rate every category to submit'}
        </button>
      </form>
    </section>
  )
}
