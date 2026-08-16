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

          send(res, 404, { error: 'Not found' })
        } catch (error) {
          send(res, 500, { error: error.message || 'Server error' })
        }
      })
    },
  }
}
