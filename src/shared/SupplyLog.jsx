import { useEffect, useState } from 'react'
import { FolderList, groupByMonth } from './FolderList'
import { useConfirm } from './ConfirmDialog'
import { logSupplyMove, supplyOverview, supplyPrices } from '../lib/api'
import { peso, prettyDateTime, rpcError } from '../lib/format'
import '../front-desk-cashier/front-desk.css'
import './ops.css'

/**
 * Consumables in/out report: gas (LPG, butane), billiards (cue, powder) and
 * bonfire kits (marshmallow, sticks, firewood, coconut shell). Shared by the
 * front desk, operations staff and the manager.
 */
export default function SupplyLog({ guests = [], onError, onSaved }) {
  const confirm = useConfirm()
  const [data, setData] = useState(null)
  const [itemId, setItemId] = useState('')
  const [direction, setDirection] = useState('out')
  const [qty, setQty] = useState(1)
  // null = not chosen yet, so it follows whoever is on property; '' = resort use.
  const [guestPick, setGuestPick] = useState(null)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [links, setLinks] = useState([])

  async function reload() {
    const next = await supplyOverview()
    setData(next)
    return next
  }

  useEffect(() => {
    reload().then((next) => {
      if (next.items[0]) setItemId((current) => current || next.items[0].id)
    })
    supplyPrices().then(setLinks)
  }, [])

  if (!data) {
    return (
      <div className="desk-grid">
        <div className="skeleton skeleton-card" style={{ minHeight: 320 }} />
        <div className="skeleton skeleton-card" style={{ minHeight: 320 }} />
      </div>
    )
  }

  if (!data.items.length) {
    return (
      <section className="desk-card">
        <h3>Supplies in &amp; out</h3>
        <p className="desk-note">
          The supply list is not set up yet. Apply supabase/resort_ops.sql in the Supabase SQL Editor, then reload this
          page.
        </p>
      </section>
    )
  }

  const item = data.items.find((row) => row.id === itemId) || data.items[0]
  const categories = [...new Set(data.items.map((row) => row.category))]
  const short = direction === 'out' && qty > Number(item.stock)

  // What the guest pays for this item: its own price when the add-on is just
  // this item (LP Gas), or the add-on it is part of (Bonfire).
  function priceLine(row) {
    const link = links.find((entry) => entry.supply_item_id === row.id && entry.rentals?.is_active !== false)
    if (!link?.rentals) return ''
    const parts = links.filter((entry) => entry.rental_id === link.rental_id).length
    return parts === 1 ? `${peso(link.rentals.price)} each` : `In ${link.rentals.name} · ${peso(link.rentals.price)}`
  }
  // Stock going out defaults to the guest currently renting the place.
  const guestId = guestPick !== null && (guestPick === '' || guests.some((row) => row.id === guestPick))
    ? guestPick
    : guests[0]?.id || ''

  async function submit() {
    const guest = guests.find((row) => row.id === guestId)
    const ok = await confirm({
      title: direction === 'in' ? 'Stock in' : 'Stock out',
      message:
        direction === 'in'
          ? `Add ${qty} ${item.unit} of ${item.name} to stock?`
          : `Release ${qty} ${item.unit} of ${item.name}${guest ? ` to ${guest.guest_name}` : ''}?`,
      confirmLabel: direction === 'in' ? 'Log stock in' : 'Log stock out',
    })
    if (!ok) return
    setBusy(true)
    onError?.('')
    try {
      await logSupplyMove({
        itemId: item.id,
        direction,
        qty,
        bookingId: direction === 'out' ? guestId || null : null,
        note,
      })
      setQty(1)
      setNote('')
      await reload()
      onSaved?.(`${item.name} · ${qty} ${item.unit} logged ${direction}.`)
    } catch (err) {
      onError?.(rpcError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="desk-grid">
      <section className="desk-card">
        <h3>Supplies in &amp; out</h3>
        {categories.map((category) => (
          <div key={category} className="supply-group">
            <p className="desk-label">{category}</p>
            <div className="supply-stock">
              {data.items
                .filter((row) => row.category === category)
                .map((row) => (
                  <button
                    key={row.id}
                    type="button"
                    className={`supply-tile ${row.id === item.id ? 'on' : ''} ${Number(row.stock) === 0 ? 'out' : ''}`}
                    aria-pressed={row.id === item.id}
                    onClick={() => setItemId(row.id)}
                  >
                    <span>{row.name}</span>
                    <b>{row.stock}</b>
                    <small>{Number(row.stock) === 0 ? 'Out of stock' : row.unit}</small>
                    {priceLine(row) ? <em className="supply-price">{priceLine(row)}</em> : null}
                  </button>
                ))}
            </div>
          </div>
        ))}

        <div className="ops-form">
          <div className="chip-row tight" role="group" aria-label="Direction">
            <button type="button" className={direction === 'out' ? 'mini on' : 'mini'} onClick={() => setDirection('out')}>
              Out · released
            </button>
            <button type="button" className={direction === 'in' ? 'mini on' : 'mini'} onClick={() => setDirection('in')}>
              In · restocked
            </button>
          </div>
          <label className="desk-counter">
            <span>
              {item.name} · {item.unit}
            </span>
            <div>
              <button type="button" onClick={() => setQty(Math.max(1, qty - 1))}>
                −
              </button>
              <strong>{qty}</strong>
              <button type="button" onClick={() => setQty(qty + 1)}>
                +
              </button>
            </div>
          </label>
          {direction === 'out' ? (
            <label className="select-block">
              Released to
              <select value={guestId} onChange={(event) => setGuestPick(event.target.value)}>
                {guests.map((guest) => (
                  <option key={guest.id} value={guest.id}>
                    {guest.guest_name} · {guest.reference} · on property
                  </option>
                ))}
                <option value="">Resort use / no guest</option>
              </select>
            </label>
          ) : null}
          <label className="select-block">
            Note (optional)
            <input
              className="ops-input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              placeholder={direction === 'in' ? 'Supplier or delivery' : 'Bonfire set, refill, replacement'}
            />
          </label>
          {short ? (
            <p className="desk-err">
              Only {item.stock} {item.unit} left. Log a stock-in first.
            </p>
          ) : null}
          <button type="button" className="desk-btn" disabled={busy || short} onClick={submit}>
            {busy ? 'Saving…' : direction === 'in' ? `Log ${qty} in` : `Log ${qty} out`}
          </button>
        </div>
      </section>

      <section className="desk-card">
        <h3>Movement report</h3>
        <FolderList
          empty="No supply movement logged yet. Start with a stock-in for each item."
          listClassName="desk-log"
          groups={groupByMonth(data.moves, (row) => row.created_at)}
          renderItem={(row) => (
            <li key={row.id}>
              <div>
                <b>
                  {row.qty} {row.unit} · {row.item}
                </b>
                <small>
                  {prettyDateTime(row.created_at)} · {row.by}
                  {row.guest_name ? ` · for ${row.guest_name} (${row.reference})` : ''}
                  {row.note ? ` · ${row.note}` : ''}
                </small>
              </div>
              <span className={`pill move-${row.direction}`}>{row.direction === 'in' ? 'In' : 'Out'}</span>
            </li>
          )}
        />
      </section>
    </div>
  )
}
