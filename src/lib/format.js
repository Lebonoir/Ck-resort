export function peso(amount) {
  return `₱${Number(amount || 0).toLocaleString('en-PH', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })}`
}

export function prettyDate(value) {
  if (!value) return '—'
  return new Date(`${value}T00:00:00`).toLocaleDateString('en-PH', {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}

export function prettyDateTime(value) {
  if (!value) return '—'
  return new Date(value).toLocaleString('en-PH', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

export const ROLE_LABELS = {
  guest: 'Customer / Guest',
  front_desk: 'Front Desk / Cashier',
  'front-desk': 'Front Desk / Cashier',
  staff: 'Resort Operations / Staff',
  admin: 'Admin / Resort Manager',
}

export const ROLE_SHORT = {
  guest: 'Guest',
  front_desk: 'Front Desk',
  'front-desk': 'Front Desk',
  staff: 'Operations',
  admin: 'Manager',
}

export function screenRole(role) {
  if (role === 'front_desk') return 'front-desk'
  return role
}

export const STATUS_LABELS = {
  pending_approval: 'Pending approval',
  rejected: 'Rejected',
  awaiting_downpayment: 'Pay 50% downpayment',
  confirmed: 'Confirmed',
  checked_in: 'Checked in',
  checked_out: 'Checked out',
  completed: 'Completed',
  cancelled: 'Cancelled',
  expired: 'Expired',
  no_show: 'No-show',
}

export function statusTone(status) {
  if (['confirmed', 'checked_in', 'completed'].includes(status)) return 'ok'
  if (['rejected', 'expired', 'no_show', 'cancelled'].includes(status)) return 'no'
  return 'warn'
}

export function verifiedPaid(booking) {
  const rows = booking?.payments || []
  if (rows.length) {
    return rows.filter((row) => row.status === 'paid').reduce((sum, row) => sum + Number(row.amount || 0), 0)
  }
  if (booking?.paid_total != null && booking.paid_total !== '') {
    return Number(booking.paid_total)
  }
  return Number(booking?.paid_amount || 0)
}

export const GUEST_ACTIVE_STATUSES = [
  'pending_approval',
  'awaiting_downpayment',
  'confirmed',
  'checked_in',
  'checked_out',
]

export function stayWindowLabel(booking) {
  if (!booking) return '—'
  if (booking.tour_type === 'overnight') return booking.overnight_shift || 'Overnight · 22 hours'
  if (booking.tour_type === 'night' || (booking.tour_type === 'event' && booking.event_when === 'night')) {
    return '5:00 PM – 12:00 AM'
  }
  if (booking.tour_type === 'event') return '8:00 AM – 4:00 PM'
  return '8:00 AM – 4:00 PM'
}

export function paymentStatusLabel(booking) {
  const paid = verifiedPaid(booking)
  const total = Number(booking?.override_amount ?? booking?.total_amount)
  if (booking?.status === 'pending_approval') return 'Downpayment not requested yet'
  if (booking?.status === 'awaiting_downpayment') return `50% downpayment due · ${peso(booking.downpayment_amount)}`
  if (paid <= 0) return 'No verified payment yet'
  if (paid + 0.009 >= total) return `Paid in full · ${peso(paid)}`
  return `Paid ${peso(paid)} of ${peso(total)}`
}

export function rpcError(error) {
  return error?.message?.replace(/^.*ERROR:\s*/i, '') || 'Something went wrong. Please try again.'
}
