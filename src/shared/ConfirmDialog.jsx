import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'

const ConfirmContext = createContext(null)

function ConfirmDialog({ title, message, confirmLabel, cancelLabel, danger, onConfirm, onCancel }) {
  const dialogRef = useRef(null)

  useEffect(() => {
    function onKey(event) {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialogRef.current?.querySelector('[data-confirm-ok]')?.focus()
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = previous
    }
  }, [onCancel])

  return (
    <div
      className="confirm-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel()
      }}
    >
      <div className="confirm-modal" ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="confirm-title">
        <h3 id="confirm-title">{title}</h3>
        <p>{message}</p>
        <div className="action-row">
          <button type="button" data-confirm-ok className={danger ? 'confirm-danger' : 'book-btn'} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" className="desk-ghost" onClick={onCancel}>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  )
}

export function ConfirmProvider({ children }) {
  const [opts, setOpts] = useState(null)
  const resolver = useRef(null)

  const confirm = useCallback((options = {}) => {
    return new Promise((resolve) => {
      resolver.current = resolve
      setOpts({
        title: 'Please confirm',
        message: 'Continue with this action?',
        confirmLabel: 'Confirm',
        cancelLabel: 'Go back',
        danger: false,
        ...options,
      })
    })
  }, [])

  function finish(value) {
    resolver.current?.(value)
    resolver.current = null
    setOpts(null)
  }

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {opts ? (
        <ConfirmDialog
          title={opts.title}
          message={opts.message}
          confirmLabel={opts.confirmLabel}
          cancelLabel={opts.cancelLabel}
          danger={opts.danger}
          onConfirm={() => finish(true)}
          onCancel={() => finish(false)}
        />
      ) : null}
    </ConfirmContext.Provider>
  )
}

export function useConfirm() {
  const confirm = useContext(ConfirmContext)
  return (
    confirm ||
    (async (options = {}) => window.confirm(options.message || 'Continue?'))
  )
}
