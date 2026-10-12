// Receipt content and its PDF. The PDF is written by hand (a single text page
// in Courier) so the app needs no PDF library: Courier is monospaced, which
// makes right-aligned amounts simple and suits a till receipt.

export const PAYMENT_TITLES = {
  downpayment: 'Downpayment',
  balance: 'Balance',
  full: 'Full payment',
  onsite: 'Add-on',
}

const METHOD_LABELS = { paymongo: 'PayMongo', cash: 'Cash', ewallet: 'E-wallet', bank: 'Bank transfer' }

// What a payment settled. New payments carry receipt_lines; older ones (and
// the online downpayment) fall back to a single descriptive line.
export function receiptLines(booking, payment) {
  if (Array.isArray(payment?.receipt_lines) && payment.receipt_lines.length) return payment.receipt_lines
  if (payment?.type === 'downpayment') {
    return [{ label: `50% downpayment · ${booking.package_label}`, amount: payment.amount }]
  }
  return [{ label: `${PAYMENT_TITLES[payment?.type] || 'Payment'} · ${booking.package_label}`, amount: payment?.amount || 0 }]
}

function money(amount) {
  return Number(amount || 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Everything a receipt shows, shared by the on-screen paper and the PDF. */
export function receiptModel(booking, payment, tender = null) {
  const when = payment?.paid_at ? new Date(payment.paid_at) : new Date()
  const number = payment?.receipt_no || ''
  return {
    title: payment?.type === 'onsite' ? 'Add-on receipt' : 'Official receipt',
    number: number || 'Not numbered',
    date: when.toLocaleString('en-PH', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    }),
    reference: booking.reference,
    guest: booking.guest_name,
    packageLabel: booking.package_label,
    stay: new Date(`${booking.stay_date}T00:00:00`).toLocaleDateString('en-PH', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }),
    lines: receiptLines(booking, payment).map((line) => ({ label: String(line.label), amount: money(line.amount) })),
    total: money(payment?.amount),
    method: METHOD_LABELS[payment?.method] || payment?.method || 'Cash',
    tender: tender
      ? { cash: money(tender.cash), ewallet: money(tender.ewallet), change: money(tender.change) }
      : null,
    fileName: `${booking.reference}-${number || 'receipt'}.pdf`.replace(/[^\w.-]+/g, '-'),
  }
}

// ---- PDF ----

const PAGE_WIDTH = 226.77 // 80 mm till roll, in points
const MARGIN = 14
const FONT_SIZE = 9
const CHAR_WIDTH = FONT_SIZE * 0.6 // every Courier glyph is 600/1000 em wide
const LINE_HEIGHT = 12.5
const COLUMNS = Math.floor((PAGE_WIDTH - MARGIN * 2) / CHAR_WIDTH)

// Characters outside Latin-1 that the standard PDF encoding still has.
const WIN_ANSI = { '–': 0x96, '—': 0x97, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '…': 0x85 }

function pdfHex(text) {
  let hex = ''
  for (const char of text) {
    const code = char.codePointAt(0)
    const byte = code < 256 ? code : WIN_ANSI[char] ?? 0x3f
    hex += byte.toString(16).padStart(2, '0')
  }
  return `<${hex}>`
}

function wrap(text, width) {
  const rows = []
  let row = ''
  for (const word of String(text).split(/\s+/).filter(Boolean)) {
    if (!row) row = word
    else if (`${row} ${word}`.length <= width) row += ` ${word}`
    else {
      rows.push(row)
      row = word
    }
    while (row.length > width) {
      rows.push(row.slice(0, width))
      row = row.slice(width)
    }
  }
  if (row) rows.push(row)
  return rows.length ? rows : ['']
}

/** Builds the receipt as a one-page PDF and returns it as a Blob. */
export function receiptPdf(model) {
  const rows = []
  const text = (value, { bold = false, align = 'left' } = {}) => {
    for (const line of wrap(value, COLUMNS)) rows.push({ line, bold, align })
  }
  const pair = (label, value, bold = false) => {
    const labelWidth = COLUMNS - value.length - 2
    wrap(label, Math.max(labelWidth, 8)).forEach((line, index) => {
      rows.push({ line, bold, align: 'left', right: index === 0 ? value : '' })
    })
  }
  const rule = () => rows.push({ line: '-'.repeat(COLUMNS), bold: false, align: 'left' })
  const gap = () => rows.push({ line: '', bold: false, align: 'left' })

  text('CK RESORT & EVENTS PLACE', { bold: true, align: 'center' })
  text('St. Duyong, San Simon, Pampanga', { align: 'center' })
  rule()
  text(model.title, { bold: true })
  text(`No. ${model.number}`)
  text(model.date)
  rule()
  text(model.reference, { bold: true })
  text(model.guest)
  text(model.packageLabel)
  text(`Stay: ${model.stay}`)
  rule()
  model.lines.forEach((line) => pair(line.label, line.amount))
  rule()
  pair('COLLECTED', `PHP ${model.total}`, true)
  gap()
  text(`Paid by ${model.method}`)
  if (model.tender) {
    pair('Cash', model.tender.cash)
    pair('E-wallet', model.tender.ewallet)
    pair('Change', model.tender.change)
  }
  rule()
  text('Thank you for staying with us.', { align: 'center' })

  const height = MARGIN * 2 + rows.length * LINE_HEIGHT
  const ops = ['BT']
  rows.forEach((row, index) => {
    const y = height - MARGIN - FONT_SIZE - index * LINE_HEIGHT
    const font = row.bold ? 'F2' : 'F1'
    if (row.line) {
      const x = row.align === 'center' ? MARGIN + ((COLUMNS - row.line.length) * CHAR_WIDTH) / 2 : MARGIN
      ops.push(`/${font} ${FONT_SIZE} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm ${pdfHex(row.line)} Tj`)
    }
    if (row.right) {
      const x = MARGIN + (COLUMNS - row.right.length) * CHAR_WIDTH
      ops.push(`/${font} ${FONT_SIZE} Tf 1 0 0 1 ${x.toFixed(2)} ${y.toFixed(2)} Tm ${pdfHex(row.right)} Tj`)
    }
  })
  ops.push('ET')
  const stream = ops.join('\n')

  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${height.toFixed(2)}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> >>`,
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>',
  ]

  // Everything written is ASCII, so string length is the byte offset.
  let pdf = '%PDF-1.4\n'
  const offsets = objects.map((body, index) => {
    const offset = pdf.length
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`
    return offset
  })
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets.map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return new Blob([pdf], { type: 'application/pdf' })
}

export function downloadReceipt(model) {
  const url = URL.createObjectURL(receiptPdf(model))
  const link = document.createElement('a')
  link.href = url
  link.download = model.fileName
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 4000)
}
