import { useState } from 'react'

// Round the top of the scale up to a tidy number so gridlines read cleanly.
function niceMax(value) {
  if (!(value > 0)) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  const step = [1, 2, 2.5, 5, 10].find((size) => size * power >= value) * power
  return step
}

function DataTable({ caption, head, rows }) {
  return (
    <table className="chart-table">
      <caption>{caption}</caption>
      <thead>
        <tr>
          {head.map((cell) => (
            <th key={cell} scope="col">
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row[0]}>
            {row.map((cell, index) => (
              <td key={index}>{cell}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Column chart for comparing a handful of categories. One series, one hue:
 * the bars carry magnitude, the labels carry identity. Hover or focus a bar
 * for its exact value; a screen-reader table sits behind it.
 */
export function ColumnChart({ title, rows, format = (value) => String(value), empty = 'Nothing in this range.' }) {
  if (!rows.length) return <p className="admin-note">{empty}</p>
  const top = niceMax(Math.max(...rows.map((row) => Number(row.value) || 0)))
  const labelAll = rows.length <= 8

  return (
    <figure className="chart">
      <div className="chart-plot">
        <div className="chart-grid" aria-hidden="true">
          {[1, 0.5, 0].map((share) => (
            <span key={share} style={{ bottom: `${share * 100}%` }}>
              <i>{format(top * share)}</i>
            </span>
          ))}
        </div>
        <div className="chart-cols" aria-hidden="true">
          {rows.map((row, index) => {
            const value = Number(row.value) || 0
            return (
              <div key={row.label} className="chart-col" tabIndex={0}>
                <div className="chart-bar-wrap">
                  <span
                    className="chart-bar"
                    style={{ height: `${Math.max((value / top) * 100, value > 0 ? 1.5 : 0)}%`, animationDelay: `${index * 50}ms` }}
                  >
                    {labelAll ? <b>{format(value)}</b> : null}
                  </span>
                </div>
                <span className="chart-tip">
                  <b>{row.label}</b>
                  {format(value)}
                  {row.note ? <small>{row.note}</small> : null}
                </span>
              </div>
            )
          })}
        </div>
      </div>
      <div className="chart-x" aria-hidden="true">
        {rows.map((row) => (
          <span key={row.label} title={row.label}>
            {row.label}
          </span>
        ))}
      </div>
      <DataTable caption={title} head={['Item', 'Value']} rows={rows.map((row) => [row.label, format(Number(row.value) || 0)])} />
    </figure>
  )
}

/**
 * Trend over time: a 2px line over a soft area. Moving across the plot snaps a
 * crosshair to the nearest day and shows that day's figures.
 */
export function TrendChart({ title, rows, format = (value) => String(value), note = () => '', empty = 'Nothing in this range.' }) {
  const [active, setActive] = useState(null)
  if (!rows.length) return <p className="admin-note">{empty}</p>
  if (rows.length === 1) {
    return <ColumnChart title={title} rows={rows.map((row) => ({ label: row.label, value: row.value, note: note(row) }))} format={format} />
  }

  const top = niceMax(Math.max(...rows.map((row) => Number(row.value) || 0)))
  const x = (index) => (index / (rows.length - 1)) * 100
  const y = (value) => 100 - ((Number(value) || 0) / top) * 100
  const line = rows.map((row, index) => `${index ? 'L' : 'M'}${x(index).toFixed(2)} ${y(row.value).toFixed(2)}`).join(' ')
  const area = `${line} L100 100 L0 100 Z`
  const current = active === null ? null : rows[active]

  function track(event) {
    const box = event.currentTarget.getBoundingClientRect()
    const share = Math.min(Math.max((event.clientX - box.left) / box.width, 0), 1)
    setActive(Math.round(share * (rows.length - 1)))
  }

  return (
    <figure className="chart">
      <div className="chart-plot trend" onMouseMove={track} onMouseLeave={() => setActive(null)}>
        <div className="chart-grid" aria-hidden="true">
          {[1, 0.5, 0].map((share) => (
            <span key={share} style={{ bottom: `${share * 100}%` }}>
              <i>{format(top * share)}</i>
            </span>
          ))}
        </div>
        <svg className="chart-trend" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
          <path className="chart-area" d={area} />
          <path className="chart-line" d={line} vectorEffect="non-scaling-stroke" />
        </svg>
        {current ? (
          <>
            <span className="chart-cross" style={{ left: `${x(active)}%` }} aria-hidden="true" />
            <span className="chart-dot" style={{ left: `${x(active)}%`, top: `${y(current.value)}%` }} aria-hidden="true" />
            <span className={`chart-tip shown ${x(active) > 60 ? 'left' : ''}`} style={{ left: `${x(active)}%` }}>
              <b>{current.label}</b>
              {format(Number(current.value) || 0)}
              {note(current) ? <small>{note(current)}</small> : null}
            </span>
          </>
        ) : null}
      </div>
      <div className="chart-x ends" aria-hidden="true">
        <span>{rows[0].label}</span>
        {rows.length > 2 ? <span>{rows[Math.floor((rows.length - 1) / 2)].label}</span> : null}
        <span>{rows[rows.length - 1].label}</span>
      </div>
      <DataTable
        caption={title}
        head={['Date', 'Value', 'Detail']}
        rows={rows.map((row) => [row.label, format(Number(row.value) || 0), note(row)])}
      />
    </figure>
  )
}
