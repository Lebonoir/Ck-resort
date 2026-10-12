import { useState } from 'react'
import { peso } from '../lib/format'

const MAX_RENTAL_QTY = 9

function Stepper({ value, min = 0, max, onChange, label }) {
  return (
    <span className="stepper" role="group" aria-label={label}>
      <button type="button" aria-label={`Fewer ${label}`} disabled={value <= min} onClick={() => onChange(value - 1)}>
        −
      </button>
      <strong aria-live="polite">{value}</strong>
      <button type="button" aria-label={`More ${label}`} disabled={value >= max} onClick={() => onChange(value + 1)}>
        +
      </button>
    </span>
  )
}

/**
 * Step 3 of the booking wizard: rentals, pets and catering. Every choice is
 * optional, so each section reads as "nothing added" until the guest opts in.
 */
export default function AddOnsStep({ catalog, booking, patch, maxPets, petsPerRoom }) {
  const partners = catalog.caterers.filter((item) => item.is_partner)
  const outside = catalog.caterers.find((item) => !item.is_partner) || null
  const picked = catalog.caterers.find((item) => item.id === booking.caterer_id) || null
  const rate = (key, fallback) => Number(catalog.rates.find((row) => row.key === key)?.amount ?? fallback)
  const petFee = rate('pet', 200)
  const corkage = rate('corkage', 1500)

  // "Tie-up" can be chosen before a caterer is picked, so the mode is tracked
  // separately from caterer_id (which stays empty until a name is selected).
  const [mode, setMode] = useState(picked ? (picked.is_partner ? 'partner' : 'outside') : 'none')
  const [query, setQuery] = useState('')

  function setQty(item, qty) {
    const rest = booking.rentals.filter((row) => row.id !== item.id)
    patch({ rentals: qty > 0 ? [...rest, { id: item.id, qty }] : rest })
  }

  function chooseMode(next) {
    setMode(next)
    setQuery('')
    if (next === 'none') patch({ caterer_id: '' })
    else if (next === 'outside') patch({ caterer_id: outside?.id || '' })
    else patch({ caterer_id: picked?.is_partner ? picked.id : '' })
  }

  const needle = query.trim().toLowerCase()
  const shown = needle ? partners.filter((item) => item.name.toLowerCase().includes(needle)) : partners
  const rentalCount = booking.rentals.reduce((sum, row) => sum + row.qty, 0)

  const modes = [
    { id: 'none', title: 'No catering', note: 'Bring your own food or decide later' },
    { id: 'partner', title: 'Tie-up caterer', note: 'Resort partners · no corkage' },
  ]
  if (outside) modes.push({ id: 'outside', title: 'Outside caterer', note: `${peso(corkage)} minimum corkage` })

  return (
    <div className="addons">
      <section className="addon-section">
        <header>
          <h4>Rentals</h4>
          <span>{rentalCount ? `${rentalCount} added` : 'Optional'}</span>
        </header>
        {catalog.rentals.length === 0 ? (
          <p className="hint">No rentals are offered online right now. Ask the front desk on arrival.</p>
        ) : (
          <div className="rental-grid">
            {catalog.rentals.map((item) => {
              const qty = booking.rentals.find((row) => row.id === item.id)?.qty || 0
              return (
                <div key={item.id} className={`rental-tile ${qty ? 'on' : ''}`}>
                  <div>
                    <b>{item.name}</b>
                    <span>{peso(item.price)} each</span>
                  </div>
                  {qty ? (
                    <Stepper value={qty} max={MAX_RENTAL_QTY} label={item.name} onChange={(next) => setQty(item, next)} />
                  ) : (
                    <button type="button" className="rental-add" onClick={() => setQty(item, 1)}>
                      Add
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="addon-section">
        <header>
          <h4>Pets</h4>
          <span>{booking.pets ? peso(booking.pets * petFee) : 'Optional'}</span>
        </header>
        <div className={`rental-tile wide ${booking.pets ? 'on' : ''}`}>
          <div>
            <b>Bringing pets?</b>
            <span>
              {peso(petFee)} per pet
              {petsPerRoom > 0
                ? ` · up to ${petsPerRoom} per room, ${maxPets} for this booking`
                : ''}
            </span>
          </div>
          <Stepper value={booking.pets} max={maxPets} label="pets" onChange={(pets) => patch({ pets })} />
        </div>
      </section>

      <section className="addon-section">
        <header>
          <h4>Catering</h4>
          <span>{picked ? picked.name : mode === 'partner' ? 'Pick a caterer' : 'Optional'}</span>
        </header>
        <div className="cater-modes" role="radiogroup" aria-label="Catering">
          {modes.map((item) => (
            <button
              key={item.id}
              type="button"
              role="radio"
              aria-checked={mode === item.id}
              className={mode === item.id ? 'on' : ''}
              onClick={() => chooseMode(item.id)}
            >
              <b>{item.title}</b>
              <span>{item.note}</span>
            </button>
          ))}
        </div>

        {mode === 'partner' ? (
          <div className="cater-pick">
            {partners.length > 6 ? (
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search tie-up caterers"
                aria-label="Search tie-up caterers"
              />
            ) : null}
            <ul role="radiogroup" aria-label="Tie-up caterers">
              {shown.length === 0 ? <li className="cater-empty">No caterer matches “{query.trim()}”.</li> : null}
              {shown.map((item) => {
                const on = booking.caterer_id === item.id
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={on}
                      className={on ? 'on' : ''}
                      onClick={() => patch({ caterer_id: item.id })}
                    >
                      <span className="cater-dot" aria-hidden="true" />
                      <span>{item.name}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
            {!picked ? <p className="hint">Pick the caterer you have arranged with. Nothing is charged for tie-up partners.</p> : null}
          </div>
        ) : null}

        {mode === 'outside' ? (
          <p className="hint">
            Tell us your caterer when you arrive. The {peso(corkage)} corkage is the minimum and is included in your total.
          </p>
        ) : null}
      </section>
    </div>
  )
}
