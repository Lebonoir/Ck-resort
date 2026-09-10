import { useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import { advanceLifecycle } from '../lib/api'

/**
 * Keeps a workspace current without the user pressing anything:
 *  - ticks the SQL lifecycle so time-based transitions actually fire, and
 *  - re-reads once whenever Postgres reports a change on a watched table.
 *
 * `reload` is held in a ref so callers can pass an inline function without
 * tearing down the realtime channel on every render.
 */
export function useLiveData(reload, { tables = ['bookings', 'room_units'], interval = 30000, channel = 'live' } = {}) {
  const reloadRef = useRef(reload)
  reloadRef.current = reload

  const tableKey = tables.join(',')

  useEffect(() => {
    let alive = true
    let pending = null

    // Collapse bursts of row events into a single refetch.
    function refresh() {
      if (!alive) return
      clearTimeout(pending)
      pending = setTimeout(() => {
        if (alive) Promise.resolve(reloadRef.current?.()).catch(() => {})
      }, 250)
    }

    async function tick() {
      if (!alive) return
      try {
        const result = await advanceLifecycle()
        // Only refetch when the lifecycle actually moved something.
        if (alive && result?.processed) refresh()
      } catch {
        // Lifecycle SQL may not be applied yet; realtime still keeps us fresh.
      }
    }

    tick()
    const timer = setInterval(tick, interval)

    const sub = supabase.channel(`${channel}-${tableKey}`)
    tableKey.split(',').forEach((table) => {
      sub.on('postgres_changes', { event: '*', schema: 'public', table }, refresh)
    })
    sub.subscribe()

    return () => {
      alive = false
      clearTimeout(pending)
      clearInterval(timer)
      supabase.removeChannel(sub)
    }
  }, [tableKey, interval, channel])
}
