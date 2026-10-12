import { useRef, useState } from 'react'
import {
  clearRoomPhoto,
  deleteEventBand,
  deleteHourRate,
  deleteOvernightTier,
  deleteRental,
  saveEventBand,
  saveHourRate,
  saveOvernightTier,
  saveRate,
  saveRental,
  updateEventBand,
  updateHourRate,
  updateOvernightTier,
  updateUnitRate,
  uploadRoomPhoto,
} from '../lib/api'
import { useConfirm } from '../shared/ConfirmDialog'
import RoomPhoto from '../shared/RoomPhoto'
import { rpcError } from '../lib/format'

// Rate keys that belong to a specific package. Anything not listed lands in
// "Other rates" so a newly added rate never disappears from the page.
const DAY_KEYS = ['day_20']
const NIGHT_KEYS = ['night_20']
const OVERNIGHT_KEYS = ['extra_pax_overnight']
const ROOM_KEYS = ['room_pkg_1', 'room_pkg_2']
const SURCHARGE_KEYS = ['weekend', 'extra_hour', 'extra_pax_tour', 'pet', 'corkage']
// Replaced by the percentage rebooking fee; kept in the database, not shown.
const HIDDEN_KEYS = ['rebook_fee']
const GROUPED = new Set([
  ...DAY_KEYS,
  ...NIGHT_KEYS,
  ...OVERNIGHT_KEYS,
  ...ROOM_KEYS,
  ...SURCHARGE_KEYS,
  ...HIDDEN_KEYS,
])

function RateInput({ label, hint, value, onSave, onRemove }) {
  // Last value the server accepted, so blurring an untouched field does not re-save.
  const saved = useRef(Number(value) || 0)
  return (
    <div className="rate-row">
      <label className="rate-field">
        <span>
          {label}
          {hint ? <small>{hint}</small> : null}
        </span>
        <input
          type="number"
          min="0"
          defaultValue={value}
          onBlur={async (event) => {
            const next = Number(event.target.value) || 0
            if (next === saved.current) return
            if (await onSave(next)) saved.current = next
          }}
        />
      </label>
      {onRemove ? (
        <button type="button" className="rate-remove" onClick={onRemove} aria-label={`Remove ${label}`}>
          Remove
        </button>
      ) : null}
    </div>
  )
}

/** Inline "add a price" row: a few small inputs and one button. */
function AddPrice({ fields, cta, onAdd }) {
  const blank = Object.fromEntries(fields.map((field) => [field.name, '']))
  const [values, setValues] = useState(blank)
  const [busy, setBusy] = useState(false)
  const ready = fields.every((field) => String(values[field.name]).trim() !== '')

  return (
    <form
      className="rate-add"
      onSubmit={async (event) => {
        event.preventDefault()
        setBusy(true)
        const added = await onAdd(values)
        setBusy(false)
        if (added) setValues(blank)
      }}
    >
      {fields.map((field) => (
        <label key={field.name}>
          {field.label}
          <input
            type={field.type || 'number'}
            min={field.type === 'text' ? undefined : field.min ?? 0}
            value={values[field.name]}
            placeholder={field.placeholder}
            onChange={(event) => setValues({ ...values, [field.name]: event.target.value })}
          />
        </label>
      ))}
      <button type="submit" className="admin-save" disabled={!ready || busy}>
        {busy ? 'Adding…' : cta}
      </button>
    </form>
  )
}

function RateGroup({ title, tag, children, footer }) {
  return (
    <section className="admin-card rate-group">
      <header>
        <h3>{title}</h3>
        {tag ? <span className="pill">{tag}</span> : null}
      </header>
      <div className="rate-grid">{children}</div>
      {footer}
    </section>
  )
}

function PhotoField({ unit, label, onError, onSaved }) {
  const [src, setSrc] = useState(unit.image_url || '')
  const [busy, setBusy] = useState(false)
  const input = useRef(null)

  async function run(task, message) {
    setBusy(true)
    onError('')
    try {
      setSrc((await task()) || '')
      onSaved(message)
    } catch (err) {
      onError(rpcError(err))
    } finally {
      setBusy(false)
      if (input.current) input.current.value = ''
    }
  }

  return (
    <div className="photo-field">
      <RoomPhoto key={src} src={src} label={label} />
      <div>
        <b>{label}</b>
        <small>{src ? 'Shown to guests in the booking flow' : 'No photo yet'}</small>
        <div className="action-row">
          <label className={`desk-ghost photo-pick ${busy ? 'is-busy' : ''}`}>
            {busy ? 'Saving…' : src ? 'Replace photo' : 'Upload photo'}
            <input
              ref={input}
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (file) run(() => uploadRoomPhoto(unit.id, file), `${label} photo saved.`)
              }}
            />
          </label>
          {src ? (
            <button
              type="button"
              className="text-link danger"
              disabled={busy}
              onClick={() => run(() => clearRoomPhoto(unit.id).then(() => ''), `${label} photo removed.`)}
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export default function RatesPanel({ catalog, onError, onSaved, onReload }) {
  const confirm = useConfirm()

  async function save(task, message) {
    onError('')
    try {
      await task()
      onSaved(message)
      return true
    } catch (err) {
      onError(rpcError(err))
      return false
    }
  }

  // Adding or removing a price changes the list itself, so the catalog is re-read.
  async function change(task, message) {
    const done = await save(task, message)
    if (done) await onReload?.()
    return done
  }

  async function remove(what, task) {
    const ok = await confirm({
      title: 'Remove price',
      message: `Remove ${what}? New bookings stop using it. Bookings already made keep the price they were quoted.`,
      confirmLabel: 'Remove',
      danger: true,
    })
    if (ok) await change(task, `${what} removed.`)
  }

  const rates = new Map(catalog.rates.map((row) => [row.key, row]))
  const others = catalog.rates.filter((row) => !GROUPED.has(row.key))

  function settingField(key, hint) {
    const row = rates.get(key)
    if (!row) return null
    return (
      <RateInput
        key={key}
        label={row.label}
        hint={hint}
        value={row.amount}
        onSave={(amount) => save(() => saveRate(key, amount), `${row.label} saved.`)}
      />
    )
  }

  function hourFields(tourType) {
    const name = tourType === 'day' ? 'day tour' : 'night tour'
    return catalog.hours
      .filter((row) => row.tour_type === tourType)
      .map((row) => (
        <RateInput
          key={`${row.tour_type}-${row.hours}-${row.amount}`}
          label={`30 pax · ${row.hours} hours`}
          hint={row.hours === 8 ? 'Standard rate for 21 to 30 pax' : undefined}
          value={row.amount}
          onSave={(amount) =>
            save(() => updateHourRate(row.tour_type, row.hours, amount), `${row.hours}-hour ${name} rate saved.`)
          }
          onRemove={
            row.hours === 8
              ? undefined
              : () => remove(`the ${row.hours}-hour ${name} rate`, () => deleteHourRate(row.tour_type, row.hours))
          }
        />
      ))
  }

  function hourAdd(tourType) {
    return (
      <AddPrice
        cta="Add hours"
        fields={[
          { name: 'hours', label: 'Hours', placeholder: '12', min: 1 },
          { name: 'amount', label: 'Price', placeholder: '10000' },
        ]}
        onAdd={(values) =>
          change(
            () => saveHourRate(tourType, Number(values.hours), Number(values.amount)),
            `${values.hours}-hour ${tourType} tour rate added.`,
          )
        }
      />
    )
  }

  const roomName = (unit) => catalog.rooms?.find((room) => room.id === unit.room_id)?.name || 'Room'

  return (
    <div className="rates-page">
      <p className="admin-note">
        A price saves when you leave its field. Use Remove or the Add row under a list to change which prices exist.
        Existing bookings keep their quoted package total; excess pax and extra hour fees use the current rates when the
        guest checks in.
      </p>

      <div className="analytics-masonry">
        <RateGroup title="Day Tour" tag="8:00 AM – 4:00 PM" footer={hourAdd('day')}>
          {DAY_KEYS.map((key) => settingField(key, 'Up to 20 pax'))}
          {hourFields('day')}
        </RateGroup>

        <RateGroup title="Night Tour" tag="5:00 PM – 12:00 AM" footer={hourAdd('night')}>
          {NIGHT_KEYS.map((key) => settingField(key, 'Up to 20 pax'))}
          {hourFields('night')}
        </RateGroup>

        <RateGroup
          title="Overnight Stay"
          tag="22 hours"
          footer={
            <AddPrice
              cta="Add tier"
              fields={[
                { name: 'pax', label: 'Up to pax', placeholder: '75', min: 1 },
                { name: 'amount', label: 'Price', placeholder: '53000' },
              ]}
              onAdd={(values) =>
                change(
                  () => saveOvernightTier(Number(values.pax), Number(values.amount)),
                  `Overnight ${values.pax}-pax price added.`,
                )
              }
            />
          }
        >
          {catalog.overnight.map((tier) => (
            <RateInput
              key={`${tier.pax_cap}-${tier.amount}`}
              label={`Up to ${tier.pax_cap} pax`}
              value={tier.amount}
              onSave={(amount) =>
                save(() => updateOvernightTier(tier.pax_cap, amount), `Overnight ${tier.pax_cap}-pax rate saved.`)
              }
              onRemove={
                catalog.overnight.length > 1
                  ? () => remove(`the overnight ${tier.pax_cap}-pax price`, () => deleteOvernightTier(tier.pax_cap))
                  : undefined
              }
            />
          ))}
          {OVERNIGHT_KEYS.map((key) => settingField(key, 'Per head beyond the booked tier'))}
        </RateGroup>

        <RateGroup
          title="Event Package"
          tag="With sound system"
          footer={
            <AddPrice
              cta="Add event size"
              fields={[
                { name: 'pax', label: 'Up to pax', placeholder: '250', min: 1 },
                { name: 'day', label: 'Day price', placeholder: '18000' },
                { name: 'night', label: 'Night price', placeholder: '20000' },
              ]}
              onAdd={(values) =>
                change(
                  () => saveEventBand(Number(values.pax), Number(values.day), Number(values.night)),
                  `Event prices for up to ${values.pax} pax added.`,
                )
              }
            />
          }
        >
          {catalog.events.flatMap((band) => [
            <RateInput
              key={`day-${band.max_pax}-${band.day_amount}`}
              label={`Up to ${band.max_pax} pax · Day`}
              value={band.day_amount}
              onSave={(amount) =>
                save(() => updateEventBand(band.max_pax, { day_amount: amount }), `Day event (${band.max_pax} pax) saved.`)
              }
              onRemove={
                catalog.events.length > 1
                  ? () => remove(`the event prices for up to ${band.max_pax} pax`, () => deleteEventBand(band.max_pax))
                  : undefined
              }
            />,
            <RateInput
              key={`night-${band.max_pax}-${band.night_amount}`}
              label={`Up to ${band.max_pax} pax · Night`}
              value={band.night_amount}
              onSave={(amount) =>
                save(
                  () => updateEventBand(band.max_pax, { night_amount: amount }),
                  `Night event (${band.max_pax} pax) saved.`,
                )
              }
            />,
          ])}
        </RateGroup>

        <RateGroup
          title="For rent"
          tag="Add-ons"
          footer={
            <AddPrice
              cta="Add item"
              fields={[
                { name: 'name', label: 'Item', placeholder: 'Videoke', type: 'text' },
                { name: 'price', label: 'Price', placeholder: '800' },
              ]}
              onAdd={(values) =>
                change(() => saveRental(null, values.name, Number(values.price)), `${values.name.trim()} added.`)
              }
            />
          }
        >
          {catalog.rentals.length === 0 ? <p className="admin-note">No items for rent yet. Add one below.</p> : null}
          {catalog.rentals.map((item) => (
            <RateInput
              key={`${item.id}-${item.price}`}
              label={item.name}
              hint="Charged per add-on at the front desk"
              value={item.price}
              onSave={(amount) => change(() => saveRental(item.id, item.name, amount), `${item.name} price saved.`)}
              onRemove={() => remove(item.name, () => deleteRental(item.id))}
            />
          ))}
        </RateGroup>

        <RateGroup title="Room add-ons" tag="Day · Night · Event">
          {ROOM_KEYS.map((key) => settingField(key, 'Flat rate on day, night and event bookings'))}
          {catalog.units.map((unit) => (
            <RateInput
              key={unit.id}
              label={`${roomName(unit)} · ${unit.name}`}
              hint={unit.capacity ? `${unit.capacity} pax · 3+ rooms, or a room added at check-in` : 'Per tent'}
              value={unit.rate}
              onSave={(amount) =>
                save(() => updateUnitRate(unit.id, amount), `${roomName(unit)} ${unit.name} rate saved.`)
              }
            />
          ))}
        </RateGroup>

        <RateGroup title="Surcharges" tag="All packages">
          {SURCHARGE_KEYS.map((key) =>
            settingField(key, key === 'extra_pax_tour' ? 'Per head from the 31st person' : undefined),
          )}
        </RateGroup>

        {others.length ? (
          <RateGroup title="Other rates">{others.map((row) => settingField(row.key))}</RateGroup>
        ) : null}
      </div>

      <section className="admin-card rate-group">
        <header>
          <h3>Room photos</h3>
          <span className="pill">Shown when booking</span>
        </header>
        <p className="admin-note">
          Guests see these when they choose a room. Landscape photos work best; a room without one shows a placeholder
          tile.
        </p>
        <div className="photo-grid">
          {catalog.units.map((unit) => (
            <PhotoField
              key={unit.id}
              unit={unit}
              label={`${roomName(unit)} · ${unit.name}`}
              onError={onError}
              onSaved={onSaved}
            />
          ))}
        </div>
      </section>
    </div>
  )
}
