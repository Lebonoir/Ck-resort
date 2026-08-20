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

export function TweenNumber({ value, format = String, duration = 480, className = '' }) {
  const [current, setCurrent] = useState(Number(value) || 0)
  const currentRef = useRef(current)

  useEffect(() => {
    currentRef.current = current
  }, [current])

  useEffect(() => {
    const to = Number(value) || 0
    if (prefersReducedMotion()) {
      setCurrent(to)
      return undefined
    }
    const from = currentRef.current
    if (from === to) return undefined
    const begin = performance.now()
    let frame = 0
    const ease = (t) => 1 - (1 - t) ** 3
    function tick(now) {
      const t = Math.min(1, (now - begin) / duration)
      setCurrent(from + (to - from) * ease(t))
      if (t < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [value, duration])

  const highlight = Number(value) !== current && Math.abs(Number(value) - current) > 0.5

  return <span className={`tween-num ${highlight ? 'flashing' : ''} ${className}`.trim()}>{format(current)}</span>
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
