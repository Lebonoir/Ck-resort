import { supabase } from './supabase'
import { rpcError } from './format'

function throwIf(error) {
  if (error) throw new Error(rpcError(error))
}

export async function rpc(name, args = {}) {
  const { data, error } = await supabase.rpc(name, args)
  throwIf(error)
  return data
}

export async function getProfile() {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return null
  const { data, error } = await supabase.from('profiles').select('*').eq('id', user.id).maybeSingle()
  throwIf(error)
  return data
}

export async function updateProfile(patch) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const { error } = await supabase.from('profiles').update(patch).eq('id', user.id)
  throwIf(error)
}

export async function getCatalog() {
  const [rooms, units, rentals, caterers, rates, overnight, events, hours] = await Promise.all([
    supabase.from('rooms').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('room_units').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('rentals').select('*').eq('is_active', true).order('sort_order'),
    supabase.from('caterers').select('*').eq('is_active', true).order('name'),
    supabase.from('rate_settings').select('*').order('label'),
    supabase.from('overnight_tiers').select('*').order('pax_cap'),
    supabase.from('event_bands').select('*').order('max_pax'),
    supabase.from('tour_hour_rates').select('*').order('hours'),
  ])
  ;[rooms, units, rentals, caterers, rates, overnight, events, hours].forEach((result) => throwIf(result.error))
  return {
    rooms: rooms.data,
    units: units.data,
    rentals: rentals.data,
    caterers: caterers.data,
    rates: rates.data,
    overnight: overnight.data,
    events: events.data,
    hours: hours.data,
  }
}

export async function getOccupiedDates(from, to) {
  return rpc('occupied_dates', { p_from: from, p_to: to })
}

export async function quoteBooking(payload) {
  return rpc('quote_booking', { payload })
}

export async function submitBooking(payload) {
  return rpc('submit_booking', { payload })
}

export async function getActiveBooking() {
  try {
    return await rpc('guest_active_booking')
  } catch {
    try {
      const {
        data: { user },
      } = await supabase.auth.getUser()
      if (!user) return null
      return await rpc('guest_active_booking', { p_guest: user.id })
    } catch {
      return null
    }
  }
}

export async function createWalkIn(payload) {
  return rpc('create_walk_in', { payload })
}

export async function listBookings() {
  try {
    await supabase.rpc('advance_booking_lifecycle')
  } catch {
    // Lifecycle SQL may not be applied yet.
  }
  const { data, error } = await supabase
    .from('bookings')
    .select('*, booking_rooms(*), booking_rentals(*), booking_charges(*), payments(*)')
    .order('created_at', { ascending: false })
  throwIf(error)
  return data
}

export async function getBooking(id) {
  const { data, error } = await supabase
    .from('bookings')
    .select('*, booking_rooms(*), booking_rentals(*), booking_charges(*), payments(*)')
    .eq('id', id)
    .single()
  throwIf(error)
  return data
}

export async function approveBooking(id, override = null) {
  return rpc('approve_booking', { p_id: id, p_override: override })
}

export async function rejectBooking(id, reason) {
  return rpc('reject_booking', { p_id: id, p_reason: reason })
}

export async function cancelBooking(id) {
  return rpc('cancel_booking', { p_id: id })
}

export async function amountDue(id) {
  return rpc('booking_amount_due', { p_id: id })
}

export async function addCharge(bookingId, description, amount) {
  return rpc('add_booking_charge', {
    p_booking: bookingId,
    p_description: description,
    p_amount: amount,
  })
}

export async function checkInBooking(id, { actualPax, extraHours, cash, ewallet }) {
  return rpc('check_in_booking', {
    p_id: id,
    p_actual_pax: actualPax,
    p_extra_hours: extraHours,
    p_cash: cash,
    p_ewallet: ewallet,
  })
}

export async function checkOutBooking(id, { cash, ewallet }) {
  return rpc('check_out_booking', {
    p_id: id,
    p_cash: cash,
    p_ewallet: ewallet,
  })
}

export async function adminLifecycleSettings() {
  return rpc('admin_lifecycle_settings')
}

export async function saveLifecycleSettings({ downpaymentHours, graceMinutes, policy }) {
  return rpc('admin_save_lifecycle_settings', {
    p_downpayment_hours: downpaymentHours,
    p_grace_minutes: graceMinutes,
    p_policy: policy,
  })
}

export async function listRoomUnits() {
  const { data, error } = await supabase
    .from('room_units')
    .select('*, rooms(name, slug)')
    .order('sort_order')
  throwIf(error)
  return data
}

export async function setRoomStatus(unitId, status) {
  return rpc('set_room_status', { p_unit: unitId, p_status: status })
}

export async function listDispatches() {
  const { data, error } = await supabase
    .from('rental_dispatches')
    .select('*, rentals(name), bookings(reference, guest_name, status)')
    .order('dispatched_at', { ascending: false })
  throwIf(error)
  return data
}

export async function dispatchRental(bookingId, rentalId, qty) {
  return rpc('dispatch_rental', { p_booking: bookingId, p_rental: rentalId, p_qty: qty })
}

export async function returnRental(id) {
  return rpc('return_rental', { p_id: id })
}

export async function listNotifications() {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200)
  throwIf(error)
  return data
}

export async function markNotificationRead(id) {
  const { error } = await supabase.from('notifications').update({ is_read: true }).eq('id', id)
  throwIf(error)
}

export async function markAllNotificationsRead() {
  try {
    return await rpc('mark_all_notifications_read')
  } catch {
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) throw new Error('Sign in required')
    const { error } = await supabase.from('notifications').update({ is_read: true }).eq('user_id', user.id).eq('is_read', false)
    throwIf(error)
  }
}

export async function deleteNotification(id) {
  try {
    return await rpc('delete_notification', { p_id: id })
  } catch (err) {
    const { error } = await supabase.from('notifications').delete().eq('id', id)
    throwIf(error)
  }
}

export async function deleteReturnedDispatch(id) {
  return rpc('delete_returned_dispatch', { p_id: id })
}

export async function listUsers() {
  const { data, error } = await supabase.from('profiles').select('*').order('created_at', { ascending: false })
  throwIf(error)
  return data
}

function isMissingRpc(error) {
  const message = `${error?.message || ''} ${error?.code || ''}`
  return /PGRST202|schema cache|could not find the function/i.test(message)
}

function accountRpcArgs(payload) {
  return {
    p_id: payload.id,
    p_first_name: payload.firstName,
    p_last_name: payload.lastName || '',
    p_email: payload.email,
    p_contact: payload.contact || '',
    p_role: payload.role,
    p_is_active: payload.isActive !== false,
  }
}

async function persistAccountRow(payload) {
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user?.id === payload.id && payload.isActive === false) {
    throw new Error('You cannot deactivate the account you are signed in with')
  }
  if (payload.role !== 'admin' || payload.isActive === false) {
    const { data: current, error: currentError } = await supabase
      .from('profiles')
      .select('role, is_active')
      .eq('id', payload.id)
      .single()
    throwIf(currentError)
    if (current?.role === 'admin' && current?.is_active) {
      const { data: others, error: adminError } = await supabase
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .eq('is_active', true)
        .neq('id', payload.id)
      throwIf(adminError)
      if (!others?.length) throw new Error('Keep at least one active admin account')
    }
  }
  const patch = {
    first_name: payload.firstName.trim(),
    last_name: (payload.lastName || '').trim(),
    email: payload.email.trim().toLowerCase(),
    contact: (payload.contact || '').trim(),
    role: payload.role,
    is_active: payload.isActive !== false,
  }
  const { data, error } = await supabase.from('profiles').update(patch).eq('id', payload.id).select().single()
  throwIf(error)
  const { error: inviteError } = await supabase.rpc('invite_staff', {
    p_email: patch.email,
    p_name: `${patch.first_name} ${patch.last_name}`.trim(),
    p_role: payload.role,
  })
  if (inviteError && !isMissingRpc(inviteError) && !/Guests sign up/i.test(inviteError.message || '')) {
    throw new Error(rpcError(inviteError))
  }
  return data
}

export async function inviteStaff(email, name, role) {
  return rpc('invite_staff', { p_email: email, p_name: name, p_role: role })
}

export async function adminUpdateAccount(payload) {
  const { data, error } = await supabase.rpc('admin_update_account', accountRpcArgs(payload))
  if (!error) return data
  if (!isMissingRpc(error)) throw new Error(rpcError(error))
  return persistAccountRow(payload)
}

export async function adminCreateAccount(payload) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const response = await fetch('/api/admin/create-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify(payload),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(json.error || 'Could not create account.')
  return json
}

export async function adminDeleteAccount(userId) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const response = await fetch('/api/admin/delete-user', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify({ userId }),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 404) {
      return rpc('admin_delete_account', { p_id: userId })
    }
    throw new Error(json.error || 'Could not delete account.')
  }
  return json
}

export async function saveRate(key, amount) {
  return rpc('save_rate', { p_key: key, p_amount: amount })
}

export async function updateOvernightTier(paxCap, amount) {
  const { error } = await supabase.from('overnight_tiers').update({ amount }).eq('pax_cap', paxCap)
  throwIf(error)
}

export async function updateEventBand(maxPax, patch) {
  const { error } = await supabase.from('event_bands').update(patch).eq('max_pax', maxPax)
  throwIf(error)
}

export async function updateHourRate(tourType, hours, amount) {
  const { error } = await supabase
    .from('tour_hour_rates')
    .update({ amount })
    .eq('tour_type', tourType)
    .eq('hours', hours)
  throwIf(error)
}

export async function updateUnitRate(id, rate) {
  const { error } = await supabase.from('room_units').update({ rate }).eq('id', id)
  throwIf(error)
}

export async function adminMetrics() {
  return rpc('admin_metrics')
}

export async function adminReports() {
  return rpc('admin_reports')
}

export async function startDownpayment(bookingId) {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  const response = await fetch('/api/paymongo/checkout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session?.access_token || ''}`,
    },
    body: JSON.stringify({ bookingId }),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'Could not start payment.')
  return json
}

export async function verifyDownpayment(bookingId) {
  const response = await fetch('/api/paymongo/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bookingId }),
  })
  const json = await response.json()
  if (!response.ok) throw new Error(json.error || 'Could not verify payment.')
  return json
}
