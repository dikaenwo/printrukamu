const express = require('express')
const cors = require('cors')
const multer = require('multer')
const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
require('dotenv').config()

// ─── MIDTRANS (dinonaktifkan sementara) ───────────────────────────────────────
// const midtransClient = require('midtrans-client')
// const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true'
// const serverKey = process.env.MIDTRANS_SERVER_KEY
// const clientKey = process.env.MIDTRANS_CLIENT_KEY
// const qrisAcquirer = process.env.MIDTRANS_QRIS_ACQUIRER || 'gopay'
// const midtransFinishPath = process.env.MIDTRANS_FINISH_PATH || '/'
// const snap = new midtransClient.Snap({ isProduction, serverKey, clientKey })
// ──────────────────────────────────────────────────────────────────────────────

const app = express()
const api = express.Router()

app.use(cors())
app.use(express.json())

const PORT = process.env.PORT || 5001
const PRINTER_NAME = process.env.PRINTER_NAME || 'Brother_T720DW'

// Multer: simpan file sementara di folder temp OS
const upload = multer({ dest: os.tmpdir() })

// ─── HEALTH CHECK ─────────────────────────────────────────────────────────────
api.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'rukkamu-print-api',
    printer: PRINTER_NAME,
  })
})

// ─── PRINT ENDPOINT ───────────────────────────────────────────────────────────
api.post('/print', upload.single('file'), (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'Tidak ada file yang dikirim.' })
  }

  const { copies = '1', duplex = 'true', paperSize = 'A4' } = req.body || {}

  // Rename temp file agar punya ekstensi yang benar (penting untuk lp)
  const originalName = req.file.originalname || 'document.pdf'
  const ext = path.extname(originalName).toLowerCase() || '.pdf'
  const renamedPath = `${req.file.path}${ext}`

  try {
    fs.renameSync(req.file.path, renamedPath)
  } catch (renameErr) {
    return res.status(500).json({ error: `Gagal rename file sementara: ${renameErr.message}` })
  }

  // Terjemahkan config ke opsi lp
  const numCopies = Math.max(1, parseInt(copies, 10) || 1)
  const isDuplex = duplex === 'true'
  const mediaMap = { A4: 'A4', Letter: 'Letter', Legal: 'Legal' }
  const media = mediaMap[paperSize] || 'A4'

  const lpOptions = [
    `-d "${PRINTER_NAME}"`,
    `-n ${numCopies}`,
    `-o media=${media}`,
    isDuplex ? '-o sides=two-sided-long-edge' : '-o sides=one-sided',
  ].join(' ')

  const command = `lp ${lpOptions} "${renamedPath}"`
  console.log('[PRINT] Menjalankan:', command)

  exec(command, (error, stdout, stderr) => {
    // Hapus file sementara setelah print job dikirim
    try { fs.unlinkSync(renamedPath) } catch {}

    if (error) {
      console.error('[PRINT] Error:', stderr || error.message)
      return res.status(500).json({
        error: `Gagal mengirim ke printer: ${stderr?.trim() || error.message}`,
      })
    }

    // lp stdout contoh: "request id is Brother_T720DW-9 (1 file(s))"
    const jobMatch = stdout.match(/request id is (\S+)/)
    const jobId = jobMatch ? jobMatch[1] : 'unknown'

    console.log('[PRINT] Job diterima:', stdout.trim())
    return res.json({
      ok: true,
      jobId,
      message: stdout.trim() || 'Print job dikirim ke printer.',
    })
  })
})

// ─── MIDTRANS ENDPOINTS (dinonaktifkan sementara) ─────────────────────────────
/*
api.post('/create-checkout-transaction', async (req, res) => {
  const { amount, order_id, items, customer_details } = req.body || {}
  const grossAmount = Number(amount) || 0

  if (!grossAmount || !order_id) {
    return res.status(400).json({ error: 'amount dan order_id wajib diisi.' })
  }

  const parameter = {
    transaction_details: { order_id, gross_amount: grossAmount },
    item_details: items || [],
    customer_details: customer_details || undefined,
    credit_card: { secure: true },
  }

  try {
    const transaction = await snap.createTransaction(parameter)
    return res.json({ token: transaction.token, redirect_url: transaction.redirect_url })
  } catch (error) {
    console.error('Midtrans checkout error:', error?.ApiResponse || error)
    return res.status(500).json({
      error: error?.ApiResponse?.status_message || error.message || 'Gagal membuat checkout Midtrans.',
    })
  }
})

api.get('/transaction-status/:orderId', async (req, res) => {
  try {
    const status = await snap.transaction.status(req.params.orderId)
    return res.json(status)
  } catch (error) {
    console.error('Midtrans status error:', error?.ApiResponse || error)
    return res.status(500).json({
      error: error?.ApiResponse?.status_message || error.message || 'Gagal memeriksa status pembayaran.',
    })
  }
})
*/
// ──────────────────────────────────────────────────────────────────────────────

app.use('/api', api)

app.use((req, res) => {
  res.status(404).json({
    error: `Route tidak ditemukan: ${req.method} ${req.originalUrl}`,
  })
})

app.listen(PORT, () => {
  console.log('========================================')
  console.log(' Rukkamu Print Server Running          ')
  console.log(` Port    : ${PORT}                     `)
  console.log(` Printer : ${PRINTER_NAME}             `)
  console.log('========================================')
})
