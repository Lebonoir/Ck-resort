import { useEffect, useRef, useState } from 'react'

export function prefersReducedMotion() {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function Reveal({ as: Tag = 'div', variant = 'up', delay = 0, className = '', children, ...props }) {
  const ref = useRef(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const node = ref.current
    if (!node) return undefined
    if (prefersReducedMotion()) {
      setShown(true)
      return undefined
    }
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true)
          observer.disconnect()
        }
      },
      { threshold: 0.14, rootMargin: '0px 0px -6% 0px' },
    )
    observer.observe(node)
    return () => observer.disconnect()
  }, [])

  return (
    <Tag
      ref={ref}
      className={`reveal reveal-${variant} ${shown ? 'in' : ''} ${className}`.trim()}
      style={{ '--d': `${delay}ms` }}
      {...props}
    >
      {children}
    </Tag>
  )
}

export function CountUp({ value, duration = 1100, className = '' }) {
  const text = String(value ?? '')
  const match = text.match(/-?[\d,.]+/)
  const prefix = match ? text.slice(0, match.index) : ''
  const suffix = match ? text.slice(match.index + match[0].length) : ''
  const [shown, setShown] = useState(match ? `${prefix}0${suffix}` : text)
  const ref = useRef(null)

  useEffect(() => {
    const node = ref.current
    if (!node || !match) {
      setShown(text)
      return undefined
    }
    const raw = match[0]
    const target = Number(raw.replace(/,/g, ''))
    if (!Number.isFinite(target)) {
      setShown(text)
      return undefined
    }
    const decimals = raw.includes('.') ? raw.split('.')[1].length : 0

    function paint(amount) {
      const formatted = decimals
        ? amount.toFixed(decimals)
        : Math.round(amount).toLocaleString('en-PH')
      setShown(`${prefix}${formatted}${suffix}`)
    }

    if (prefersReducedMotion()) {
      paint(target)
      return undefined
    }

    let started = false
    let frame = 0
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started) return
        started = true
        observer.disconnect()
        const from = 0
        const begin = performance.now()
        const ease = (t) => 1 - (1 - t) ** 3
        function tick(now) {
          const t = Math.min(1, (now - begin) / duration)
          paint(from + (target - from) * ease(t))
          if (t < 1) frame = requestAnimationFrame(tick)
        }
        frame = requestAnimationFrame(tick)
      },
      { threshold: 0.4 },
    )
    observer.observe(node)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }, [text, duration])

  return (
    <span ref={ref} className={`count-up ${className}`.trim()}>
      {shown}
    </span>
  )
}

const DIGITS = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']

/**
 * Odometer-style amount: every digit sits on its own 0-9 strip and rolls to the
 * new value, the smallest unit first. A change also tints the number briefly
 * (up or down) and, with `showDelta`, floats the difference above it.
 * Only transform and opacity animate; reduced motion just swaps the digits.
 */
export function RollingNumber({ value, format = String, showDelta = false, className = '' }) {
  const amount = Number(value) || 0
  const previous = useRef(amount)
  const [change, setChange] = useState(null)

  useEffect(() => {
    const diff = amount - previous.current
    previous.current = amount
    if (!diff) return undefined
    setChange((current) => ({ id: (current?.id || 0) + 1, diff }))
    const timer = setTimeout(() => setChange(null), 1300)
    return () => clearTimeout(timer)
  }, [amount])

  const text = format(amount)
  const chars = [...text]
  let place = 0
  // Keyed from the right so the ones digit stays the ones digit as the amount grows.
  const cells = chars
    .map((char, index) => ({ char, fromEnd: chars.length - index }))
    .reverse()
    .map((cell) => (/\d/.test(cell.char) ? { ...cell, place: place++ } : cell))
    .reverse()
  const tone = change ? (change.diff > 0 ? 'up' : 'down') : ''

  return (
    <span className={`roll-num ${tone} ${className}`.trim()} aria-label={text} role="text">
      {showDelta && change ? (
        <span key={change.id} className={`roll-delta ${tone}`} aria-hidden="true">
          {change.diff > 0 ? '+' : '−'}
          {format(Math.abs(change.diff))}
        </span>
      ) : null}
      <span className="roll-row" aria-hidden="true">
        {cells.map((cell) =>
          cell.place === undefined ? (
            <span key={`s${cell.fromEnd}`} className="roll-sep">
              {cell.char}
            </span>
          ) : (
            <span key={`d${cell.fromEnd}`} className="roll-digit">
              <span
                className="roll-strip"
                style={{
                  transform: `translateY(-${Number(cell.char) * 10}%)`,
                  transitionDelay: `${Math.min(cell.place, 6) * 45}ms`,
                }}
              >
                {DIGITS.map((digit) => (
                  <span key={digit}>{digit}</span>
                ))}
              </span>
            </span>
          ),
        )}
      </span>
    </span>
  )
}

export function Lightbox({ src, alt, caption, onClose }) {
  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onClose])

  return (
    <div className="lightbox" onMouseDown={(event) => event.target === event.currentTarget && onClose()} role="dialog" aria-modal="true">
      <figure>
        <img src={src} alt={alt} />
        {caption ? <figcaption>{caption}</figcaption> : null}
      </figure>
      <button type="button" className="lightbox-close" onClick={onClose} aria-label="Close preview">
        ×
      </button>
    </div>
  )
}
