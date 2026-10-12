import { useEffect, useMemo, useRef, useState } from 'react'
import { prefersReducedMotion } from '../shared/motion'
import { downloadReceipt, receiptModel } from './receipt'

// Matches the rcptFeed animation length in front-desk.css.
const FEED_MS = 2200

/**
 * "Print receipt": the receipt feeds out of a printer, then is saved as a PDF.
 * The paper on screen and the PDF are built from the same receipt model.
 */
export default function ReceiptPrinter({ booking, payment, tender, onClose }) {
  const model = useMemo(() => receiptModel(booking, payment, tender), [booking, payment, tender])
  const still = useMemo(() => prefersReducedMotion(), [])
  const [done, setDone] = useState(false)
  const saved = useRef(false)
  const closeButton = useRef(null)

  function finish() {
    if (saved.current) return
    saved.current = true
    downloadReceipt(model)
    setDone(true)
  }

  // Reduced motion skips the feed, so the PDF is handed over straight away.
  // Otherwise the feed's animationend hands it over; the timer is the backstop
  // for a browser that pauses animations (a hidden tab) and never fires it.
  useEffect(() => {
    if (still) {
      finish()
      return undefined
    }
    const timer = setTimeout(finish, FEED_MS + 300)
    return () => clearTimeout(timer)
  }, [])

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => {
    if (done) closeButton.current?.focus()
  }, [done])

  return (
    <div
      className="rcpt-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={`Receipt ${model.number}`}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className={`rcpt-stage ${done ? 'done' : 'printing'}`}>
        <div className="rcpt-printer">
          <span className="rcpt-light" aria-hidden="true" />
          <p role="status">{done ? `Saved as ${model.fileName}` : 'Printing receipt…'}</p>
          <span className="rcpt-slot" aria-hidden="true" />
        </div>

        <div className="rcpt-feed">
          <div className={`rcpt-paper ${still ? 'still' : ''}`} onAnimationEnd={finish}>
            <header>
              <b>CK Resort &amp; Events Place</b>
              <span>St. Duyong, San Simon, Pampanga</span>
            </header>
            <dl className="rcpt-meta">
              <div>
                <dt>{model.title}</dt>
                <dd>{model.number}</dd>
              </div>
              <div>
                <dt>Date</dt>
                <dd>{model.date}</dd>
              </div>
              <div>
                <dt>{model.reference}</dt>
                <dd>{model.guest}</dd>
              </div>
              <div>
                <dt>Stay</dt>
                <dd>{model.stay}</dd>
              </div>
            </dl>
            <ul className="rcpt-lines">
              {model.lines.map((line, index) => (
                <li key={index}>
                  <span>{line.label}</span>
                  <b>{line.amount}</b>
                </li>
              ))}
            </ul>
            <p className="rcpt-total">
              <span>Collected</span>
              <b>₱{model.total}</b>
            </p>
            <ul className="rcpt-lines rcpt-tender">
              <li>
                <span>Paid by</span>
                <b>{model.method}</b>
              </li>
              {model.tender ? (
                <>
                  <li>
                    <span>Cash</span>
                    <b>{model.tender.cash}</b>
                  </li>
                  <li>
                    <span>E-wallet</span>
                    <b>{model.tender.ewallet}</b>
                  </li>
                  <li>
                    <span>Change</span>
                    <b>{model.tender.change}</b>
                  </li>
                </>
              ) : null}
            </ul>
            <footer>Thank you for staying with us.</footer>
          </div>
        </div>

        <div className="rcpt-actions">
          {done ? (
            <button type="button" className="rcpt-again" onClick={() => downloadReceipt(model)}>
              Download PDF again
            </button>
          ) : null}
          <button type="button" className="rcpt-close" ref={closeButton} onClick={onClose}>
            {done ? 'Done' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  )
}
