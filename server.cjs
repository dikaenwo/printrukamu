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

const PORT = process.env.PORT || 5050
const isProduction = process.env.MIDTRANS_IS_PRODUCTION === 'true'
const serverKey = process.env.MIDTRANS_SERVER_KEY
const clientKey = process.env.MIDTRANS_CLIENT_KEY
const qrisAcquirer = process.env.MIDTRANS_QRIS_ACQUIRER || 'gopay'
const midtransFinishPath = process.env.MIDTRANS_FINISH_PATH || '/'
const PRINTER_NAME = process.env.PRINTER_NAME || 'Brother_T720DW'

const snap = new midtransClient.Snap({ isProduction, serverKey, clientKey })

// ─── Transaction Store (JSON file) ───────────────────────────────────────────
const TX_FILE = path.join(__dirname, 'transactions.json')

function loadTransactions() {
  try {
    if (!fs.existsSync(TX_FILE)) { fs.writeFileSync(TX_FILE, '[]', 'utf8') }
    const raw = fs.readFileSync(TX_FILE, 'utf8')
    return JSON.parse(raw || '[]')
  } catch {
    return []
  }
}

function saveTransaction(tx) {
  const all = loadTransactions()
  // Avoid duplicates by order_id
  if (all.some((t) => t.order_id === tx.order_id)) {
    console.log(`[TX] Duplicate skipped: ${tx.order_id}`)
    return
  }
  all.push({
    order_id: tx.order_id,
    amount: Number(tx.amount) || 0,
    payment_type: tx.payment_type || 'unknown',
    status: tx.status || 'settlement',
    items: tx.items || [],
    created_at: tx.created_at || new Date().toISOString(),
  })
  fs.writeFileSync(TX_FILE, JSON.stringify(all, null, 2), 'utf8')
  console.log(`[TX] Recorded: ${tx.order_id} — Rp ${tx.amount}`)
}

// ─── Paper Store (JSON file) ──────────────────────────────────────────────────
const PAPER_FILE = path.join(__dirname, 'paper.json')

function loadPaperCount() {
  try {
    if (!fs.existsSync(PAPER_FILE)) { fs.writeFileSync(PAPER_FILE, '{"count": 65}', 'utf8') }
    const raw = fs.readFileSync(PAPER_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed.count === 'number' ? parsed.count : 65
  } catch {
    return 65
  }
}

function savePaperCount(count) {
  const safeCount = Math.max(0, count)
  fs.writeFileSync(PAPER_FILE, JSON.stringify({ count: safeCount }), 'utf8')
  return safeCount
}

// ─── WhatsApp Notification (kertas habis) ─────────────────────────────────────
const WA_NOTIFY_URL = process.env.WA_NOTIFY_URL || ''       // URL endpoint WA bot di VPS kamu
const WA_NOTIFY_PHONE = process.env.WA_NOTIFY_PHONE || ''   // Nomor tujuan notif (format: 6281343524552)
const WA_NOTIFY_THRESHOLD = parseInt(process.env.WA_NOTIFY_THRESHOLD || '10', 10)  // Kirim notif kalau sisa ≤ ini
let lastNotifTime = 0  // Cooldown agar tidak spam
const NOTIF_COOLDOWN = 5 * 60 * 1000  // 5 menit

async function sendPaperAlert(currentCount) {
  if (!WA_NOTIFY_URL || !WA_NOTIFY_PHONE) {
    console.log('[WA-NOTIF] Skipped — WA_NOTIFY_URL atau WA_NOTIFY_PHONE belum diset di .env')
    return
  }
  if (currentCount > WA_NOTIFY_THRESHOLD) return
  if (Date.now() - lastNotifTime < NOTIF_COOLDOWN) {
    console.log('[WA-NOTIF] Skipped — cooldown aktif (5 menit)')
    return
  }

  const message = currentCount <= 0
    ? `🚨 *KERTAS HABIS!*\n\nKertas di printer Rukkamu sudah habis (0 lembar). Segera isi ulang tray printer.\n\n_Pesan otomatis dari Rukkamu Print System_`
    : `⚠️ *Kertas Hampir Habis*\n\nSisa kertas di printer Rukkamu tinggal *${currentCount} lembar*. Mohon segera isi ulang tray printer.\n\n_Pesan otomatis dari Rukkamu Print System_`

  try {
    const response = await fetch(WA_NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phone: WA_NOTIFY_PHONE,
        message: message,
        // Field umum untuk berbagai WA bot API:
        number: WA_NOTIFY_PHONE,
        text: message,
        to: WA_NOTIFY_PHONE,
        body: message,
      }),
    })
    lastNotifTime = Date.now()
    console.log(`[WA-NOTIF] ✅ Notifikasi terkirim ke ${WA_NOTIFY_PHONE} (sisa: ${currentCount} lembar) — status: ${response.status}`)
  } catch (err) {
    console.error(`[WA-NOTIF] ❌ Gagal kirim notifikasi:`, err.message)
  }
}

// ─── Payout Store (JSON file) ─────────────────────────────────────────────────
const PAYOUTS_FILE = path.join(__dirname, 'payouts.json')

function loadPayouts() {
  try {
    if (!fs.existsSync(PAYOUTS_FILE)) { fs.writeFileSync(PAYOUTS_FILE, '{}', 'utf8') }
    const raw = fs.readFileSync(PAYOUTS_FILE, 'utf8')
    return JSON.parse(raw || '{}')
  } catch {
    return {}
  }
}

function savePayout(month, isPaid) {
  const payouts = loadPayouts()
  payouts[month] = Boolean(isPaid)
  fs.writeFileSync(PAYOUTS_FILE, JSON.stringify(payouts, null, 2), 'utf8')
  return payouts
}

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
  const { amount, order_id, items, customer_details, totalSheets } = req.body || {}
  const grossAmount = Number(amount) || 0
  if (!grossAmount || !order_id) return res.status(400).json({ error: 'amount dan order_id wajib diisi.' })

  // Pengecekan sisa kertas
  if (totalSheets) {
    const currentPaper = loadPaperCount()
    if (currentPaper < totalSheets) {
      return res.status(400).json({ error: `Kertas di printer tidak cukup. Sisa: ${currentPaper} lembar, Butuh: ${totalSheets} lembar. Silakan hubungi admin.` })
    }
  }

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
  const { filename, data, copies = 1, duplex = false, paperSize = 'A4', color = false, totalSheets = 1 } = req.body || {}

  if (!data) return res.status(400).json({ error: 'Tidak ada data file yang dikirim.' })

  const currentPaper = loadPaperCount()
  if (currentPaper < totalSheets) {
    return res.status(400).json({ error: `Kertas tidak cukup. Sisa kertas: ${currentPaper} lembar. Dibutuhkan: ${totalSheets} lembar.` })
  }

  const ext = path.extname(filename || 'document.pdf').toLowerCase() || '.pdf'
  const tempPath = path.join(os.tmpdir(), `print-${Date.now()}${ext}`)

  try {
    fs.writeFileSync(tempPath, Buffer.from(data, 'base64'))
  } catch (e) {
    return res.status(500).json({ error: `Gagal menyimpan file: ${e.message}` })
  }

  const numCopies = Math.max(1, parseInt(copies, 10) || 1)
  const media     = { A4: 'A4', Letter: 'Letter', Legal: 'Legal' }[paperSize] || 'A4'
  const sides     = duplex === true || duplex === 'true' ? 'two-sided-long-edge' : 'one-sided'
  const isColor   = color === true || color === 'true'
  const colorOpts = isColor ? '' : '-o ColorModel=Gray -o print-color-mode=monochrome'

  // Ekstensi yang tidak didukung CUPS secara langsung — perlu konversi ke PDF dulu
  const needsConvert = ['.docx', '.doc', '.odt', '.jpg', '.jpeg', '.png', '.webp'].includes(ext)

  const doPrint = (fileToPrint, cleanup = []) => {
    const command = `lp -d "${PRINTER_NAME}" -n ${numCopies} -o media=${media} -o sides=${sides} ${colorOpts} "${fileToPrint}"`
    console.log('[PRINT]', command)
    exec(command, (error, stdout, stderr) => {
      // Bersihkan semua file temp
      ;[tempPath, ...cleanup].forEach((f) => { try { fs.unlinkSync(f) } catch {} })
      if (error) {
        console.error('[PRINT] Error:', stderr || error.message)
        return res.status(500).json({ error: `Gagal mencetak: ${stderr?.trim() || error.message}` })
      }

      // Kurangi jumlah kertas
      const newPaperCount = savePaperCount(currentPaper - totalSheets)

      // Kirim notif WA kalau kertas hampir habis / habis
      sendPaperAlert(newPaperCount)

      const jobId = (stdout.match(/request id is (\S+)/) || [])[1] || 'unknown'
      console.log('[PRINT] Job:', stdout.trim())
      return res.json({ ok: true, jobId, message: stdout.trim() })
    })
  }

  if (needsConvert) {
    // Konversi ke PDF via LibreOffice headless
    // Install di Raspberry Pi: sudo apt install libreoffice
    const convertCmd = `libreoffice --headless --convert-to pdf --outdir "${os.tmpdir()}" "${tempPath}"`
    console.log('[CONVERT]', convertCmd)
    exec(convertCmd, { timeout: 30000 }, (convErr, convOut, convStderr) => {
      if (convErr) {
        try { fs.unlinkSync(tempPath) } catch {}
        console.error('[CONVERT] Error:', convStderr || convErr.message)
        return res.status(500).json({ error: `Gagal konversi file ke PDF: ${convStderr?.trim() || convErr.message}. Pastikan LibreOffice terinstall: sudo apt install libreoffice` })
      }
      // LibreOffice output: file.docx → file.pdf di folder yang sama
      const pdfPath = path.join(os.tmpdir(), path.basename(tempPath, ext) + '.pdf')
      console.log('[CONVERT] OK →', pdfPath)
      doPrint(pdfPath, [pdfPath])
    })
  } else {
    doPrint(tempPath)
  }
})

// ─── Transaction Recording ───────────────────────────────────────────────────
// Called from frontend after successful payment
app.post('/api/record-transaction', (req, res) => {
  const { order_id, amount, items, payment_type } = req.body || {}
  if (!order_id || !amount) return res.status(400).json({ error: 'order_id dan amount wajib diisi.' })

  saveTransaction({
    order_id,
    amount,
    payment_type: payment_type || 'snap',
    status: 'settlement',
    items: items || [],
    created_at: new Date().toISOString(),
  })
  return res.json({ ok: true, message: 'Transaksi tercatat.' })
})

// ─── Midtrans Notification Webhook ──────────────────────────────────────────
// Midtrans akan POST ke URL ini saat status transaksi berubah
app.post('/api/midtrans-notification', async (req, res) => {
  try {
    const notification = req.body
    const orderId = notification.order_id
    const transactionStatus = notification.transaction_status
    const paymentType = notification.payment_type
    const grossAmount = Number(notification.gross_amount) || 0

    console.log(`[MIDTRANS-NOTIF] ${orderId} → ${transactionStatus} (${paymentType})`)

    if (['settlement', 'capture'].includes(transactionStatus)) {
      saveTransaction({
        order_id: orderId,
        amount: grossAmount,
        payment_type: paymentType,
        status: transactionStatus,
        items: [{ name: 'Print Job', price: grossAmount, quantity: 1 }],
        created_at: notification.transaction_time || new Date().toISOString(),
      })
    }

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('[MIDTRANS-NOTIF] Error:', error)
    return res.status(500).json({ error: error.message })
  }
})

// ─── Admin Analytics & Paper API ─────────────────────────────────────────────
app.get('/api/admin/paper', (_req, res) => {
  const currentCount = loadPaperCount()
  sendPaperAlert(currentCount) // Trigger notif kalau kertas rendah saat dicek
  res.json({ count: currentCount })
})

app.post('/api/admin/paper', (req, res) => {
  const { count } = req.body || {}
  if (typeof count === 'number') {
    const newCount = savePaperCount(count)
    sendPaperAlert(newCount) // Trigger notif saat di-set manual
    res.json({ count: newCount })
  } else {
    res.status(400).json({ error: 'count harus berupa angka' })
  }
})

app.post('/api/admin/payouts', (req, res) => {
  const { month, isPaid } = req.body || {}
  if (!month) return res.status(400).json({ error: 'Bulan (month) wajib diisi' })
  savePayout(month, isPaid)
  res.json({ ok: true, month, isPaid })
})

app.get('/api/admin/analytics', (_req, res) => {
  const transactions = loadTransactions()
  const now = new Date()

  // Helper: start of day, week, month
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dayOfWeek = now.getDay() === 0 ? 7 : now.getDay() // Monday=1
  const startOfWeek = new Date(startOfDay)
  startOfWeek.setDate(startOfDay.getDate() - (dayOfWeek - 1))
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)

  let todayRevenue = 0, todayOrders = 0
  let weekRevenue = 0, weekOrders = 0
  let monthRevenue = 0, monthOrders = 0

  // Monthly breakdown map: "2026-06" → { revenue, orders }
  const monthlyMap = {}

  for (const tx of transactions) {
    const txDate = new Date(tx.created_at)
    const amount = Number(tx.amount) || 0
    const monthKey = `${txDate.getFullYear()}-${String(txDate.getMonth() + 1).padStart(2, '0')}`

    // Monthly breakdown
    if (!monthlyMap[monthKey]) monthlyMap[monthKey] = { revenue: 0, orders: 0 }
    monthlyMap[monthKey].revenue += amount
    monthlyMap[monthKey].orders += 1

    // Today
    if (txDate >= startOfDay) {
      todayRevenue += amount
      todayOrders += 1
    }
    // This week
    if (txDate >= startOfWeek) {
      weekRevenue += amount
      weekOrders += 1
    }
    // This month
    if (txDate >= startOfMonth) {
      monthRevenue += amount
      monthOrders += 1
    }
  }

  const payouts = loadPayouts()

  // Build monthly breakdown array sorted desc
  const monthlyBreakdown = Object.entries(monthlyMap)
    .map(([month, data]) => ({
      month,
      revenue: data.revenue,
      orders: data.orders,
      intechrest: Math.round(data.revenue * 0.2),
      rukkamu: Math.round(data.revenue * 0.8),
      isPaid: Boolean(payouts[month]),
    }))
    .sort((a, b) => b.month.localeCompare(a.month))

  // Recent transactions (last 50, newest first)
  const recentTransactions = [...transactions]
    .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
    .slice(0, 50)

  return res.json({
    today: { revenue: todayRevenue, orders: todayOrders },
    thisWeek: { revenue: weekRevenue, orders: weekOrders },
    thisMonth: { revenue: monthRevenue, orders: monthOrders },
    intechrestShare: Math.round(monthRevenue * 0.2),
    rukkmuShare: Math.round(monthRevenue * 0.8),
    recentTransactions,
    monthlyBreakdown,
    totalAllTime: {
      revenue: transactions.reduce((s, t) => s + (Number(t.amount) || 0), 0),
      orders: transactions.length,
    },
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
