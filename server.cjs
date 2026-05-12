const express = require('express')
const midtransClient = require('midtrans-client')
const cors = require('cors')
const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
require('dotenv').config()

const app = express()

app.use(cors())
app.use(express.json({ limit: '50mb' }))  // limit besar untuk file base64

const PORT = process.env.PORT || 5001
const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true'
const serverKey = process.env.MIDTRANS_SERVER_KEY
const clientKey = process.env.MIDTRANS_CLIENT_KEY
const qrisAcquirer = process.env.MIDTRANS_QRIS_ACQUIRER || 'gopay'
const midtransFinishPath = process.env.MIDTRANS_FINISH_PATH || '/'
const PRINTER_NAME = process.env.PRINTER_NAME || 'Brother_T720DW'

const snap = new midtransClient.Snap({ isProduction, serverKey, clientKey })

// ─── Helpers ──────────────────────────────────────────────────────────────────
function truncateItemName(name = '', maxLength = 50) {
  return name.length <= maxLength ? name : `${name.slice(0, maxLength - 3)}...`
}

function normalizeItemDetails(items = [], grossAmount = 0) {
  const normalized = items
    .map((item, i) => ({
      id: String(item?.id || `ITEM-${i + 1}`),
      price: Number(item?.price) || 0,
      quantity: Number(item?.quantity) || 1,
      name: truncateItemName(String(item?.name || `Item ${i + 1}`)),
    }))
    .filter((item) => item.price > 0 && item.quantity > 0)

  if (normalized.length === 0 || normalized.reduce((s, i) => s + i.price * i.quantity, 0) !== grossAmount) {
    return [{ id: 'PRINT-JOB', price: grossAmount, quantity: 1, name: 'Print Job' }]
  }
  return normalized
}

function getRequestBaseUrl(req) {
  if (req.headers.origin) return req.headers.origin
  const host = req.headers['x-forwarded-host'] || req.headers.host
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'http'
  return host ? `${proto}://${host}` : 'http://localhost:5173'
}

function getFinishUrl(req) {
  const base = process.env.MIDTRANS_FINISH_URL || getRequestBaseUrl(req)
  return new URL(midtransFinishPath, base).toString()
}

// ─── Debug: log semua request masuk ─────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`[REQ] ${req.method} ${req.url} | Content-Type: ${req.headers['content-type'] || '-'}`)
  next()
})

// Ping sederhana untuk test konektivitas
app.get('/ping', (_req, res) => res.json({ pong: true, time: new Date().toISOString() }))

// ─── Routes ───────────────────────────────────────────────────────────────────
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'rukkamu-print-api', mode: isProduction ? 'production' : 'sandbox', printer: PRINTER_NAME })
})

// Expose client key ke frontend untuk Snap.js
app.get('/api/config', (_req, res) => {
  res.json({ clientKey, isProduction, printer: PRINTER_NAME })
})

app.post('/api/create-checkout-transaction', async (req, res) => {
  const { amount, order_id, items, customer_details } = req.body || {}
  const grossAmount = Number(amount) || 0
  if (!grossAmount || !order_id) return res.status(400).json({ error: 'amount dan order_id wajib diisi.' })

  try {
    const transaction = await snap.createTransaction({
      transaction_details: { order_id, gross_amount: grossAmount },
      item_details: normalizeItemDetails(items, grossAmount),
      customer_details: customer_details || undefined,
      credit_card: { secure: true },
      callbacks: { finish: getFinishUrl(req) },
      custom_field1: qrisAcquirer,
    })
    return res.json({ token: transaction.token, redirect_url: transaction.redirect_url })
  } catch (error) {
    console.error('Midtrans error:', error?.ApiResponse || error)
    return res.status(500).json({ error: error?.ApiResponse?.status_message || error.message || 'Gagal membuat transaksi.' })
  }
})

app.get('/api/transaction-status/:orderId', async (req, res) => {
  try {
    const status = await snap.transaction.status(req.params.orderId)
    return res.json(status)
  } catch (error) {
    console.error('Status error:', error?.ApiResponse || error)
    return res.status(500).json({ error: error?.ApiResponse?.status_message || error.message })
  }
})

// Print endpoint — menerima file sebagai base64 JSON (lebih reliable dari multipart)
app.post('/api/print', (req, res) => {
  const { filename, data, copies = 1, duplex = true, paperSize = 'A4' } = req.body || {}

  if (!data) return res.status(400).json({ error: 'Tidak ada data file yang dikirim.' })

  const ext = path.extname(filename || 'document.pdf').toLowerCase() || '.pdf'
  const tempPath = path.join(os.tmpdir(), `print-${Date.now()}${ext}`)

  try {
    fs.writeFileSync(tempPath, Buffer.from(data, 'base64'))
  } catch (e) {
    return res.status(500).json({ error: `Gagal menyimpan file: ${e.message}` })
  }

  const numCopies = Math.max(1, parseInt(copies, 10) || 1)
  const media = { A4: 'A4', Letter: 'Letter', Legal: 'Legal' }[paperSize] || 'A4'
  const sides = duplex === true || duplex === 'true' ? 'two-sided-long-edge' : 'one-sided'
  const command = `lp -d "${PRINTER_NAME}" -n ${numCopies} -o media=${media} -o sides=${sides} "${tempPath}"`
  console.log('[PRINT]', command)

  exec(command, (error, stdout, stderr) => {
    try { fs.unlinkSync(tempPath) } catch {}
    if (error) {
      console.error('[PRINT] Error:', stderr || error.message)
      return res.status(500).json({ error: `Gagal mencetak: ${stderr?.trim() || error.message}` })
    }
    const jobId = (stdout.match(/request id is (\S+)/) || [])[1] || 'unknown'
    console.log('[PRINT] Job:', stdout.trim())
    return res.json({ ok: true, jobId, message: stdout.trim() })
  })
})

app.use((req, res) => {
  console.log(`[404] Route tidak ditemukan: ${req.method} ${req.originalUrl}`)
  res.status(404).json({ error: `Route tidak ditemukan: ${req.method} ${req.originalUrl}` })
})

app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================')
  console.log(` Rukkamu Print Server — Port ${PORT}   `)
  console.log(` Printer : ${PRINTER_NAME}             `)
  console.log(` Mode    : ${isProduction ? 'PRODUCTION' : 'SANDBOX'}`)
  console.log('========================================')
})
