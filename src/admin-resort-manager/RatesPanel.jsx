import { useRef } from 'react'
import { saveRate, updateEventBand, updateHourRate, updateOvernightTier, updateUnitRate } from '../lib/api'
import { rpcError } from '../lib/format'

// Rate keys that belong to a specific package. Anything not listed lands in
// "Other rates" so a newly added rate never disappears from the page.
const DAY_KEYS = ['day_20']
const NIGHT_KEYS = ['night_20']
const OVERNIGHT_KEYS = ['extra_pax_overnight']
const ROOM_KEYS = ['room_pkg_1', 'room_pkg_2']
const SURCHARGE_KEYS = ['weekend', 'extra_hour', 'extra_pax_tour', 'pet', 'corkage']
const GROUPED = new Set([...DAY_KEYS, ...NIGHT_KEYS, ...OVERNIGHT_KEYS, ...ROOM_KEYS, ...SURCHARGE_KEYS])

function RateInput({ label, hint, value, onSave }) {
  // Last value the server accepted, so blurring an untouched field does not re-save.
  const saved = useRef(Number(value) || 0)
  return (
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
  )
}

function RateGroup({ title, tag, children }) {
  return (
    <section className="admin-card rate-group">
      <header>
        <h3>{title}</h3>
        {tag ? <span className="pill">{tag}</span> : null}
      </header>
      <div className="rate-grid">{children}</div>
    </section>
  )
}

export default function RatesPanel({ catalog, onError, onSaved }) {
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
    return catalog.hours
      .filter((row) => row.tour_type === tourType)
      .map((row) => (
        <RateInput
          key={`${row.tour_type}-${row.hours}`}
          label={`30 pax · ${row.hours} hours`}
          value={row.amount}
          onSave={(amount) =>
            save(() => updateHourRate(row.tour_type, row.hours, amount), `${row.hours}-hour ${tourType} rate saved.`)
          }
        />
      ))
  }

  const roomName = (unit) => catalog.rooms?.find((room) => room.id === unit.room_id)?.name || 'Room'

  return (
    <div className="rates-page">
      <p className="admin-note">
        Rates save when you leave a field. Existing bookings keep their quoted package total; excess pax and extra hour
        fees use the current rates when the guest checks in.
      </p>

      <div className="analytics-masonry">
        <RateGroup title="Day Tour" tag="8:00 AM – 4:00 PM">
          {DAY_KEYS.map((key) => settingField(key, 'Up to 20 pax'))}
          {hourFields('day')}
        </RateGroup>

        <RateGroup title="Night Tour" tag="5:00 PM – 12:00 AM">
          {NIGHT_KEYS.map((key) => settingField(key, 'Up to 20 pax'))}
          {hourFields('night')}
        </RateGroup>

        <RateGroup title="Overnight Stay" tag="22 hours">
          {catalog.overnight.map((tier) => (
            <RateInput
              key={tier.pax_cap}
              label={`Up to ${tier.pax_cap} pax`}
              value={tier.amount}
              onSave={(amount) =>
                save(() => updateOvernightTier(tier.pax_cap, amount), `Overnight ${tier.pax_cap}-pax rate saved.`)
              }
            />
          ))}
          {OVERNIGHT_KEYS.map((key) => settingField(key, 'Per head above 70 pax'))}
        </RateGroup>

        <RateGroup title="Event Package" tag="With sound system">
          {catalog.events.flatMap((band) => [
            <RateInput
              key={`day-${band.max_pax}`}
              label={`Up to ${band.max_pax} pax · Day`}
              value={band.day_amount}
              onSave={(amount) =>
                save(() => updateEventBand(band.max_pax, { day_amount: amount }), `Day event (${band.max_pax} pax) saved.`)
              }
            />,
            <RateInput
              key={`night-${band.max_pax}`}
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

        <RateGroup title="Room add-ons" tag="Day · Night · Event">
          {ROOM_KEYS.map((key) => settingField(key, 'Flat rate on day, night and event bookings'))}
          {catalog.units.map((unit) => (
            <RateInput
              key={unit.id}
              label={`${roomName(unit)} · ${unit.name}`}
              hint={unit.capacity ? `${unit.capacity} pax · used for overnight and 3+ rooms` : 'Per tent'}
              value={unit.rate}
              onSave={(amount) =>
                save(() => updateUnitRate(unit.id, amount), `${roomName(unit)} ${unit.name} rate saved.`)
              }
            />
          ))}
        </RateGroup>

        <RateGroup title="Surcharges & add-ons" tag="All packages">
          {SURCHARGE_KEYS.map((key) => settingField(key))}
        </RateGroup>

        {others.length ? (
          <RateGroup title="Other rates">{others.map((row) => settingField(row.key))}</RateGroup>
        ) : null}
      </div>
    </div>
  )
}
