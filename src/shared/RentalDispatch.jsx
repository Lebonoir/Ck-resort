import { useEffect, useState } from 'react'
import '../front-desk-cashier/front-desk.css'
import { FolderList, groupByMonth } from './FolderList'

function Counter({ label, value, onChange, min = 0 }) {
  return (
    <label className="desk-counter">
      <span>{label}</span>
      <div>
        <button type="button" onClick={() => onChange(Math.max(min, value - 1))}>
          −
        </button>
        <strong>{value}</strong>
        <button type="button" onClick={() => onChange(value + 1)}>
          +
        </button>
      </div>
    </label>
  )
}

export default function RentalDispatch({ guests, rentals = [], logs, onDispatch, onReturn, onDeleteReturned }) {
  const items = rentals
  const [guestId, setGuestId] = useState(guests[0]?.id || '')
  const [itemId, setItemId] = useState(items[0]?.id || '')
  const [qty, setQty] = useState(1)
  const out = logs.filter((item) => item.status === 'out')
  const back = logs.filter((item) => item.status === 'returned')

  useEffect(() => {
    if (!guestId && guests[0]) setGuestId(guests[0].id)
  }, [guestId, guests])

  useEffect(() => {
    if (!itemId && items[0]) setItemId(items[0].id)
  }, [itemId, items])

  return (
    <div className="desk-grid">
      <section className="desk-card">
        <h3>Dispatch add-on</h3>
        <label className="select-block">
          Guest on property
          <select value={guestId} onChange={(event) => setGuestId(event.target.value)}>
            <option value="">Select guest</option>
            {guests.map((guest) => (
              <option key={guest.id} value={guest.id}>
                {guest.guest_name || guest.name} · {guest.reference || guest.id}
              </option>
            ))}
          </select>
        </label>
        <div className="chip-row tight">
          {items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={itemId === item.id ? 'mini on' : 'mini'}
              onClick={() => setItemId(item.id)}
            >
              {item.name}
            </button>
          ))}
        </div>
        <Counter label="Quantity" value={qty} min={1} onChange={setQty} />
        <button
          type="button"
          className="desk-btn"
          disabled={!guestId || !items.length}
          onClick={async () => {
            await onDispatch({ guestId, itemId, qty })
            setQty(1)
          }}
        >
          Log as out
        </button>
        {!guests.length ? (
          <p className="desk-note">No guests on property yet. Check a guest in first.</p>
        ) : null}
      </section>

      <section className="desk-card">
        <h3>Return tracker</h3>
        <p className="desk-label">Still out</p>
        <ul className="desk-log">
          {out.length === 0 ? <li className="empty">Nothing out on the floor.</li> : null}
          {out.map((item) => (
            <li key={item.id}>
              <div>
                <b>
                  {item.qty}× {item.rentals?.name || item.itemName}
                </b>
                <small>
                  {item.bookings?.guest_name || item.guestName} · out {item.dispatched_at || item.time}
                </small>
              </div>
              <button type="button" className="desk-ghost" onClick={() => onReturn(item.id)}>
                Mark returned
              </button>
            </li>
          ))}
        </ul>
        <p className="desk-label">Returned</p>
        <FolderList
          empty="No returns logged yet."
          listClassName="desk-log"
          groups={groupByMonth(back, (item) => item.returned_at || item.returnedAt || item.dispatched_at)}
          renderItem={(item) => (
            <li key={item.id}>
              <div>
                <b>
                  {item.qty}× {item.rentals?.name || item.itemName}
                </b>
                <small>
                  {item.bookings?.guest_name || item.guestName} · back {item.returned_at || item.returnedAt}
                </small>
              </div>
              {onDeleteReturned ? (
                <button
                  type="button"
                  className="text-link danger"
                  onClick={() => {
                    if (window.confirm('Remove this returned rental log?')) onDeleteReturned(item.id)
                  }}
                >
                  Delete
                </button>
              ) : (
                <span className="pill">In</span>
              )}
            </li>
          )}
        />
      </section>
    </div>
  )
}
