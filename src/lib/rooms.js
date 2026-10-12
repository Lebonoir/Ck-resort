export function unitLabel(unit, rooms = []) {
  const room = rooms.find((item) => item.id === unit.room_id)
  return `${room?.name || 'Room'} · ${unit.name}`
}

export function setCapacity(units) {
  return units.reduce((sum, unit) => sum + Number(unit.capacity || 0), 0)
}

function slugOf(unit, rooms) {
  return rooms.find((item) => item.id === unit.room_id)?.slug || ''
}

/**
 * Every room set that sleeps `pax` (any package), mirroring assert_room_fit()
 * in SQL: enough beds for everyone, and no room that could be dropped.
 * Sorted so the first one is the recommendation: fewest rooms, then the
 * tightest fit, so a small group is not handed the largest room.
 */
export function suggestRoomSets(units = [], rooms = [], pax = 1, limit = Infinity) {
  const pool = units.filter((unit) => Number(unit.capacity) > 0)
  const found = []

  function consider(set, total) {
    // Minimal: removing any single room must leave someone without a bed.
    if (set.some((unit) => total - Number(unit.capacity) >= pax)) return
    const slugs = set.map((unit) => slugOf(unit, rooms))
    if (slugs.includes('sunrise') && !slugs.includes('gazebo')) return
    found.push({
      key: set
        .map((unit) => unit.id)
        .sort()
        .join('|'),
      units: [...set],
      capacity: total,
      spare: total - pax,
      buildings: new Set(set.map((unit) => unit.room_id)).size,
    })
  }

  // Walk every combination, but stop growing a set once it already sleeps the
  // group: anything added after that would be a spare room.
  function grow(from, set, total) {
    if (total >= pax) {
      consider(set, total)
      return
    }
    for (let index = from; index < pool.length; index += 1) {
      set.push(pool[index])
      grow(index + 1, set, total + Number(pool[index].capacity))
      set.pop()
    }
  }
  grow(0, [], 0)

  // Units of the same size in the same building are interchangeable (Tent 1
  // vs Tent 2), so only the first of each shape is offered.
  const shapes = new Set()
  return found
    .sort(
      (left, right) =>
        left.units.length - right.units.length || left.spare - right.spare || left.buildings - right.buildings,
    )
    .filter((set) => {
      const shape = set.units
        .map((unit) => `${unit.room_id}:${unit.capacity}`)
        .sort()
        .join('|')
      if (shapes.has(shape)) return false
      shapes.add(shape)
      return true
    })
    .slice(0, limit)
}

// A day or night tour covers this many people whatever size was booked.
export const TOUR_INCLUDED_PAX = 30

/**
 * How many people the booked package covers before the excess-pax fee starts,
 * mirroring included_pax() in SQL: 30 on a day or night tour, and the tier or
 * band that was booked on an overnight stay or event.
 */
export function includedPax(booking, catalog) {
  const pax = Number(booking?.pax) || 0
  const smallestFit = (sizes) => {
    const fits = sizes.map(Number).filter((size) => size >= pax)
    return fits.length ? Math.min(...fits) : pax
  }
  if (booking?.tour_type === 'overnight') return smallestFit((catalog?.overnight || []).map((tier) => tier.pax_cap))
  if (booking?.tour_type === 'event') return smallestFit((catalog?.events || []).map((band) => band.max_pax))
  return Math.max(pax, TOUR_INCLUDED_PAX)
}

/**
 * Smallest group a package can be booked for: a day or night tour is sold as a
 * 30-pax package, and an overnight stay starts at its smallest tier.
 */
export function minPax(tourType, catalog, rules) {
  if (tourType === 'day' || tourType === 'night') return Number(rules?.tour_included_pax) || TOUR_INCLUDED_PAX
  if (tourType === 'overnight') {
    const tiers = (catalog?.overnight || []).map((tier) => Number(tier.pax_cap)).filter((size) => size > 0)
    return tiers.length ? Math.min(...tiers) : 10
  }
  return 1
}
