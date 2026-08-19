import { createClient } from '@supabase/supabase-js'

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function paymongoHeaders(secret) {
  return {
    Authorization: `Basic ${Buffer.from(`${secret}:`).toString('base64')}`,
    'Content-Type': 'application/json',
  }
}

function missingRpc(error) {
  return /PGRST202|schema cache|could not find the function/i.test(error?.message || '')
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function requireAdmin(supabaseUrl, supabaseKey, req) {
  const token = req.headers.authorization?.replace('Bearer ', '')
  if (!token) return { status: 401, error: 'Sign in required.' }
  const userClient = createClient(supabaseUrl, supabaseKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const {
    data: { user },
    error: userError,
  } = await userClient.auth.getUser()
  if (userError || !user) return { status: 401, error: 'Session expired. Please sign in again.' }
  const { data: adminFlag, error: adminError } = await userClient.rpc('is_admin')
  if (adminError || !adminFlag) return { status: 403, error: 'Admin only.' }
  return { userClient, user }
}

async function persistAccount(userClient, payload, actorId) {
  const args = {
    p_id: payload.id,
    p_first_name: payload.firstName,
    p_last_name: payload.lastName || '',
    p_email: payload.email,
    p_contact: payload.contact || '',
    p_role: payload.role,
    p_is_active: payload.isActive !== false,
  }
  const { data, error } = await userClient.rpc('admin_update_account', args)
  if (!error) return data
  if (!missingRpc(error)) throw new Error(error.message)
  if (actorId && payload.id === actorId && args.p_is_active === false) {
    throw new Error('You cannot deactivate the account you are signed in with')
  }
  if (args.p_role !== 'admin' || args.p_is_active === false) {
    const { data: current, error: currentError } = await userClient
      .from('profiles')
      .select('role, is_active')
      .eq('id', payload.id)
      .single()
    if (currentError) throw new Error(currentError.message)
    if (current?.role === 'admin' && current?.is_active) {
      const { data: others, error: adminError } = await userClient
        .from('profiles')
        .select('id')
        .eq('role', 'admin')
        .eq('is_active', true)
        .neq('id', payload.id)
      if (adminError) throw new Error(adminError.message)
      if (!others?.length) throw new Error('Keep at least one active admin account')
    }
  }
  const { data: row, error: updateError } = await userClient
    .from('profiles')
    .update({
      first_name: payload.firstName.trim(),
      last_name: (payload.lastName || '').trim(),
      email: payload.email.trim().toLowerCase(),
      contact: (payload.contact || '').trim(),
      role: payload.role,
      is_active: payload.isActive !== false,
    })
    .eq('id', payload.id)
    .select()
    .single()
  if (updateError) throw new Error(updateError.message)
  const { error: inviteError } = await userClient.rpc('invite_staff', {
    p_email: args.p_email,
    p_name: `${args.p_first_name} ${args.p_last_name}`.trim(),
    p_role: args.p_role,
  })
  if (inviteError && !missingRpc(inviteError) && !/Guests sign up/i.test(inviteError.message || '')) {
    throw new Error(inviteError.message)
  }
  return row
}

export function paymongoPlugin(env) {
  const supabaseUrl = env.VITE_SUPABASE_URL
  const supabaseKey = env.VITE_SUPABASE_PUBLISHABLE_KEY
  const paymongoSecret = env.PAYMONGO_SECRET_KEY
  const internalSecret = env.INTERNAL_API_SECRET
  const siteUrl = env.VITE_SITE_URL || 'http://localhost:5173'

  return {
    name: 'paymongo-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        const url = req.url?.split('?')[0] || ''
        if (!url.startsWith('/api/')) {
          next()
          return
        }

        try {
          if (!supabaseUrl || !supabaseKey) {
            send(res, 500, { error: 'Supabase is not configured on the server.' })
            return
          }
          if (url === '/api/health' && req.method === 'GET') {
            send(res, 200, { ok: true, paymongo: Boolean(paymongoSecret) })
            return
          }

          const supabase = createClient(supabaseUrl, supabaseKey)

          if (url === '/api/paymongo/checkout' && req.method === 'POST') {
            if (!paymongoSecret) {
              send(res, 500, { error: 'PayMongo secret is not configured.' })
              return
            }
            const token = req.headers.authorization?.replace('Bearer ', '')
            if (!token) {
              send(res, 401, { error: 'Sign in required.' })
              return
            }
            const userClient = createClient(supabaseUrl, supabaseKey, {
              global: { headers: { Authorization: `Bearer ${token}` } },
            })
            const {
              data: { user },
              error: userError,
            } = await userClient.auth.getUser()
            if (userError || !user) {
              send(res, 401, { error: 'Session expired. Please sign in again.' })
              return
            }

            const body = await readJson(req)
            const bookingId = body.bookingId
            const { data: booking, error: bookingError } = await userClient
              .from('bookings')
              .select('*')
              .eq('id', bookingId)
              .single()
            if (bookingError || !booking) {
              send(res, 404, { error: 'Booking not found.' })
              return
            }
            if (booking.status !== 'awaiting_downpayment') {
              send(res, 400, { error: 'This booking is not awaiting downpayment.' })
              return
            }

            const amount = Math.round(Number(booking.downpayment_amount) * 100)
            if (!amount) {
              send(res, 400, { error: 'Invalid downpayment amount.' })
              return
            }

            const checkoutRes = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
              method: 'POST',
              headers: paymongoHeaders(paymongoSecret),
              body: JSON.stringify({
                data: {
                  attributes: {
                    send_email_receipt: false,
                    show_description: true,
                    show_line_items: true,
                    description: `CK Resort ${booking.reference} 50% downpayment`,
                    line_items: [
                      {
                        currency: 'PHP',
                        amount,
                        name: `${booking.reference} · 50% downpayment`,
                        quantity: 1,
                        description: booking.package_label,
                      },
                    ],
                    payment_method_types: ['card', 'gcash', 'paymaya', 'grab_pay'],
                    success_url: `${siteUrl}/?payment=return&booking=${booking.id}`,
                    cancel_url: `${siteUrl}/?payment=cancel&booking=${booking.id}`,
                    metadata: {
                      booking_id: booking.id,
                      reference: booking.reference,
                    },
                  },
                },
              }),
            })
            const checkoutJson = await checkoutRes.json()
            if (!checkoutRes.ok) {
              const message = checkoutJson?.errors?.[0]?.detail || 'PayMongo checkout failed.'
              send(res, 400, { error: message })
              return
            }

            const checkoutId = checkoutJson.data.id
            const checkoutUrl = checkoutJson.data.attributes.checkout_url
            const { error: prepareError } = await supabase.rpc('server_prepare_downpayment', {
              p_secret: internalSecret,
              p_booking: booking.id,
              p_checkout_id: checkoutId,
              p_amount: booking.downpayment_amount,
            })
            if (prepareError) {
              send(res, 400, { error: prepareError.message })
              return
            }

            send(res, 200, { checkoutUrl, checkoutId })
            return
          }

          if (url === '/api/paymongo/verify' && req.method === 'POST') {
            if (!paymongoSecret) {
              send(res, 500, { error: 'PayMongo secret is not configured.' })
              return
            }
            const body = await readJson(req)
            const bookingId = body.bookingId
            if (!bookingId) {
              send(res, 400, { error: 'Missing booking.' })
              return
            }
            const { data: checkoutId, error: pendingError } = await supabase.rpc('server_pending_checkout', {
              p_secret: internalSecret,
              p_booking: bookingId,
            })
            if (pendingError) {
              send(res, 400, { error: pendingError.message })
              return
            }
            if (!checkoutId) {
              send(res, 400, { error: 'No PayMongo checkout was found for this booking.' })
              return
            }

            const sessionRes = await fetch(
              `https://api.paymongo.com/v1/checkout_sessions/${checkoutId}`,
              { headers: paymongoHeaders(paymongoSecret) },
            )
            const sessionJson = await sessionRes.json()
            if (!sessionRes.ok) {
              send(res, 400, { error: sessionJson?.errors?.[0]?.detail || 'Could not verify payment.' })
              return
            }

            const attrs = sessionJson.data.attributes
            const paid =
              attrs.status === 'paid' ||
              attrs.payment_status === 'paid' ||
              Boolean(attrs.paid_at) ||
              attrs.payments?.some((item) => item.attributes?.status === 'paid')
            if (!paid) {
              send(res, 200, { paid: false, status: attrs.status })
              return
            }

            const providerPaymentId =
              attrs.payments?.[0]?.id || attrs.payment_intent?.id || checkoutId
            const { data: booking, error: confirmError } = await supabase.rpc('server_confirm_downpayment', {
              p_secret: internalSecret,
              p_checkout_id: checkoutId,
              p_payment_id: providerPaymentId,
            })
            if (confirmError) {
              send(res, 400, { error: confirmError.message })
              return
            }
            send(res, 200, { paid: true, booking })
            return
          }

          if (url === '/api/paymongo/webhook' && req.method === 'POST') {
            const body = await readJson(req)
            const eventType = body?.data?.attributes?.type
            const session = body?.data?.attributes?.data
            const checkoutId = session?.id
            if (eventType === 'checkout_session.payment.paid' && checkoutId) {
              const providerPaymentId = session?.attributes?.payments?.[0]?.id || checkoutId
              await supabase.rpc('server_confirm_downpayment', {
                p_secret: internalSecret,
                p_checkout_id: checkoutId,
                p_payment_id: providerPaymentId,
              })
            }
            send(res, 200, { received: true })
            return
          }

          if (url === '/api/admin/create-user' && req.method === 'POST') {
            const authz = await requireAdmin(supabaseUrl, supabaseKey, req)
            if (authz.error) {
              send(res, authz.status, { error: authz.error })
              return
            }
            const body = await readJson(req)
            const firstName = String(body.firstName || '').trim()
            const lastName = String(body.lastName || '').trim()
            const email = String(body.email || '').trim().toLowerCase()
            const contact = String(body.contact || '').trim()
            const password = String(body.password || '')
            const role = body.role
            const roles = ['guest', 'front_desk', 'staff', 'admin']
            if (!firstName || !email || !roles.includes(role)) {
              send(res, 400, { error: 'First name, email, and a valid role are required.' })
              return
            }

            const { data: existing } = await authz.userClient
              .from('profiles')
              .select('*')
              .ilike('email', email)
              .maybeSingle()
            if (existing) {
              const updated = await persistAccount(
                authz.userClient,
                {
                  id: existing.id,
                  firstName,
                  lastName,
                  email,
                  contact,
                  role,
                  isActive: true,
                },
                authz.user.id,
              )
              send(res, 200, { profile: updated, existed: true })
              return
            }

            if (password.length < 8) {
              send(res, 400, { error: 'Password must be at least 8 characters for a new account.' })
              return
            }

            const { error: inviteError } = await authz.userClient.rpc('invite_staff', {
              p_email: email,
              p_name: `${firstName} ${lastName}`.trim(),
              p_role: role,
            })
            if (inviteError && role !== 'guest' && !/Guests sign up/i.test(inviteError.message || '')) {
              send(res, 400, { error: inviteError.message })
              return
            }

            const meta = { first_name: firstName, last_name: lastName, contact }
            let userId = null
            let created = false
            if (env.SUPABASE_SERVICE_ROLE_KEY) {
              const admin = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY, {
                auth: { persistSession: false, autoRefreshToken: false },
              })
              const { data, error } = await admin.auth.admin.createUser({
                email,
                password,
                email_confirm: true,
                user_metadata: meta,
              })
              if (error && !/already (been )?registered/i.test(error.message || '')) {
                send(res, 400, { error: error.message })
                return
              }
              userId = data?.user?.id || null
              created = Boolean(data?.user && !error)
            } else {
              const anon = createClient(supabaseUrl, supabaseKey, {
                auth: { persistSession: false, autoRefreshToken: false },
              })
              const { data, error } = await anon.auth.signUp({
                email,
                password,
                options: { data: meta, emailRedirectTo: siteUrl },
              })
              if (error && !/already (been )?registered/i.test(error.message || '')) {
                send(res, 400, { error: error.message })
                return
              }
              userId = data?.user?.id || null
              created = Boolean(data?.user && !error)
            }

            let profile = null
            for (let attempt = 0; attempt < 10; attempt += 1) {
              const query = userId
                ? authz.userClient.from('profiles').select('*').eq('id', userId)
                : authz.userClient.from('profiles').select('*').ilike('email', email)
              const { data } = await query.maybeSingle()
              if (data) {
                profile = data
                break
              }
              await sleep(250)
            }

            if (!profile) {
              send(res, 200, {
                created,
                pending: true,
                email,
                role,
                message: 'Invite saved. They can register with this email to receive the assigned role.',
              })
              return
            }

            const updated = await persistAccount(
              authz.userClient,
              {
                id: profile.id,
                firstName,
                lastName,
                email,
                contact,
                role,
                isActive: true,
              },
              authz.user.id,
            )
            send(res, 200, { profile: updated, created })
            return
          }

          if (url === '/api/admin/delete-user' && req.method === 'POST') {
            const authz = await requireAdmin(supabaseUrl, supabaseKey, req)
            if (authz.error) {
              send(res, authz.status, { error: authz.error })
              return
            }
            const userClient = authz.userClient
            const body = await readJson(req)
            const userId = body.userId
            if (!userId) {
              send(res, 400, { error: 'Missing user.' })
              return
            }
            const { data: deleted, error: deleteError } = await userClient.rpc('admin_delete_account', { p_id: userId })
            if (deleteError && missingRpc(deleteError)) {
              const { error: deactivateError } = await userClient
                .from('profiles')
                .update({ is_active: false })
                .eq('id', userId)
                .neq('id', authz.user.id)
              if (deactivateError) {
                send(res, 400, { error: deactivateError.message })
                return
              }
              send(res, 200, { id: userId, deleted: false, deactivated: true })
              return
            }
            if (deleteError) {
              send(res, 400, { error: deleteError.message })
              return
            }
            let authDeleted = false
            if (env.SUPABASE_SERVICE_ROLE_KEY) {
              const admin = createClient(supabaseUrl, env.SUPABASE_SERVICE_ROLE_KEY)
              const { error: authError } = await admin.auth.admin.deleteUser(userId)
              authDeleted = !authError
            }
            send(res, 200, { ...deleted, authDeleted })
            return
          }

          send(res, 404, { error: 'Not found' })
        } catch (error) {
          send(res, 500, { error: error.message || 'Server error' })
        }
      })
    },
  }
}
