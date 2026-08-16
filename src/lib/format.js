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
  completed: 'Completed',
  cancelled: 'Cancelled',
}

export function rpcError(error) {
  return error?.message?.replace(/^.*ERROR:\s*/i, '') || 'Something went wrong. Please try again.'
}
