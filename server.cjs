const express = require('express')
const midtransClient = require('midtrans-client')
const cors = require('cors')
const { exec } = require('child_process')
const path = require('path')
const fs = require('fs')
const os = require('os')
require('dotenv').config()

const app = express()

app.use(cors({
  origin: [
    /localhost/,
    /print\.rukkamu\.local/,
    /rukkamu\.local/,
    /\.trycloudflare\.com$/,
    /\.rukkamu\.com$/,
    /rukamu\.store$/,
  ],
  credentials: true,
}))
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
    if (!fs.existsSync(PAPER_FILE)) { fs.writeFileSync(PAPER_FILE, '{"count": 130}', 'utf8') }
    const raw = fs.readFileSync(PAPER_FILE, 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed.count === 'number' ? parsed.count : 130
  } catch {
    return 130
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
let lastNotifTime = 0  // unused, kept for compatibility

async function sendPaperAlert(currentCount) {
  if (!WA_NOTIFY_URL || !WA_NOTIFY_PHONE) {
    console.log('[WA-NOTIF] Skipped — WA_NOTIFY_URL atau WA_NOTIFY_PHONE belum diset di .env')
    return
  }
  if (currentCount > WA_NOTIFY_THRESHOLD) return

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

// ─── Pending Session Store ───────────────────────────────────────────────────
const PENDING_SESSIONS_FILE = path.join(__dirname, 'pending-sessions.json')

function loadPendingSessions() {
  try {
    if (!fs.existsSync(PENDING_SESSIONS_FILE)) { fs.writeFileSync(PENDING_SESSIONS_FILE, '[]', 'utf8') }
    return JSON.parse(fs.readFileSync(PENDING_SESSIONS_FILE, 'utf8') || '[]')
  } catch { return [] }
}

function savePendingSessions(sessions) {
  fs.writeFileSync(PENDING_SESSIONS_FILE, JSON.stringify(sessions, null, 2), 'utf8')
}

function addPendingSession(session) {
  const sessions = loadPendingSessions()
  sessions.push({ ...session, created_at: new Date().toISOString() })
  savePendingSessions(sessions)
  console.log(`[SESSION] Pending session disimpan: ${session.filename} hal ${session.fromPage}–${session.toPage}`)
}

function removePendingSession(id) {
  const sessions = loadPendingSessions()
  savePendingSessions(sessions.filter(s => s.id !== id))
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

  // Hanya block kalau kertas = 0 (multi-sesi handled di /api/print)
  if (totalSheets) {
    const currentPaper = loadPaperCount()
    if (currentPaper <= 0) {
      return res.status(400).json({ error: `Kertas di printer habis (0 lembar). Silakan hubungi admin.` })
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

// ─── Core print function (support page range) ───────────────────────────────
function executePrint({ filename, data, copies, duplex, paperSize, color, fromPage, toPage, onSuccess, onError }) {
  const numCopies = Math.max(1, parseInt(copies, 10) || 1)
  const media     = { A4: 'A4', Letter: 'Letter', Legal: 'Legal' }[paperSize] || 'A4'
  const sides     = duplex === true || duplex === 'true' ? 'two-sided-long-edge' : 'one-sided'
  const isColor   = color === true || color === 'true'
  const colorOpts = isColor ? '' : '-o ColorModel=Gray -o print-color-mode=monochrome'
  const pageRange = (fromPage && toPage) ? `-o page-ranges=${fromPage}-${toPage}` : ''

  const ext = path.extname(filename || 'document.pdf').toLowerCase() || '.pdf'
  const tempPath = path.join(os.tmpdir(), `print-${Date.now()}${ext}`)

  try {
    fs.writeFileSync(tempPath, Buffer.from(data, 'base64'))
  } catch (e) {
    return onError(`Gagal menyimpan file: ${e.message}`)
  }

  const needsConvert = ['.docx', '.doc', '.odt', '.jpg', '.jpeg', '.png', '.webp'].includes(ext)

  const doPrint = (fileToPrint, cleanup = []) => {
    const command = `lp -d "${PRINTER_NAME}" -n ${numCopies} -o media=${media} -o sides=${sides} ${colorOpts} ${pageRange} "${fileToPrint}"`
    console.log('[PRINT]', command)
    exec(command, (error, stdout, stderr) => {
      ;[tempPath, ...cleanup].forEach((f) => { try { fs.unlinkSync(f) } catch {} })
      if (error) {
        console.error('[PRINT] Error:', stderr || error.message)
        return onError(`Gagal mencetak: ${stderr?.trim() || error.message}`)
      }
      const jobId = (stdout.match(/request id is (\S+)/) || [])[1] || 'unknown'
      console.log('[PRINT] Job:', stdout.trim())
      onSuccess(jobId)
    })
  }

  if (needsConvert) {
    const convertCmd = `libreoffice --headless --convert-to pdf --outdir "${os.tmpdir()}" "${tempPath}"`
    console.log('[CONVERT]', convertCmd)
    exec(convertCmd, { timeout: 30000 }, (convErr, _out, convStderr) => {
      if (convErr) {
        try { fs.unlinkSync(tempPath) } catch {}
        return onError(`Gagal konversi file ke PDF: ${convStderr?.trim() || convErr.message}`)
      }
      const pdfPath = path.join(os.tmpdir(), path.basename(tempPath, ext) + '.pdf')
      doPrint(pdfPath, [pdfPath])
    })
  } else {
    doPrint(tempPath)
  }
}

// ─── Auto-continue pending sessions ─────────────────────────────────────────
async function processPendingSessions() {
  const sessions = loadPendingSessions()
  if (sessions.length === 0) return

  const session = sessions[0] // Proses satu per satu (FIFO)
  const available = loadPaperCount()
  if (available <= 0) {
    console.log('[SESSION] Kertas masih 0, pending session belum bisa dilanjutkan')
    return
  }

  const sheetsNeeded = session.toPage - session.fromPage + 1
  const sheetsToPrint = Math.min(sheetsNeeded, available)
  const actualToPage = session.fromPage + sheetsToPrint - 1

  console.log(`[SESSION] Auto-continue: ${session.filename} hal ${session.fromPage}–${actualToPage} (${sheetsToPrint} lembar)`)

  executePrint({
    filename: session.filename,
    data: session.data,
    copies: session.copies,
    duplex: session.duplex,
    paperSize: session.paperSize,
    color: session.color,
    fromPage: session.fromPage,
    toPage: actualToPage,
    onSuccess: async (jobId) => {
      const newPaper = savePaperCount(available - sheetsToPrint)
      sendPaperAlert(newPaper)

      if (actualToPage < session.toPage) {
        // Masih ada sisa halaman → update pending session
        const sessions2 = loadPendingSessions()
        const idx = sessions2.findIndex(s => s.id === session.id)
        if (idx !== -1) {
          sessions2[idx].fromPage = actualToPage + 1
          savePendingSessions(sessions2)
        }
        const remaining = session.toPage - actualToPage
        console.log(`[SESSION] Sisa ${remaining} halaman masih pending`)
        // Kirim WA notif sesi sebagian
        if (WA_NOTIFY_URL && WA_NOTIFY_PHONE) {
          fetch(WA_NOTIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: WA_NOTIFY_PHONE, message: `⚠️ *Sesi Print Belum Selesai*\n\nDokumen: ${session.filename}\nSudah dicetak: hal 1–${actualToPage}\nSisa: ${remaining} halaman (sesi berikutnya)\n\nIsi kertas lagi lalu update stok di dashboard untuk lanjutkan otomatis.\n\n_Rukkamu Print System_` }),
          }).catch(() => {})
        }
      } else {
        // Semua halaman selesai
        removePendingSession(session.id)
        console.log(`[SESSION] ✅ Semua sesi selesai: ${session.filename}`)
        if (WA_NOTIFY_URL && WA_NOTIFY_PHONE) {
          fetch(WA_NOTIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ phone: WA_NOTIFY_PHONE, message: `✅ *Print Selesai*\n\nDokumen: ${session.filename}\nSemua ${session.toPage} halaman sudah tercetak.\n\n_Rukkamu Print System_` }),
          }).catch(() => {})
        }
      }
    },
    onError: (err) => {
      console.error('[SESSION] Error saat lanjut sesi:', err)
    },
  })
}

// Print endpoint — menerima file sebagai base64 JSON (lebih reliable dari multipart)
app.post('/api/print', (req, res) => {
  const { filename, data, copies = 1, duplex = false, paperSize = 'A4', color = false, totalSheets = 1, printFrom = null, printTo = null } = req.body || {}

  if (!data) return res.status(400).json({ error: 'Tidak ada data file yang dikirim.' })

  const currentPaper = loadPaperCount()

  // Kalau tidak ada kertas sama sekali, tolak
  if (currentPaper <= 0) {
    return res.status(400).json({ error: `Kertas habis. Sisa kertas: 0 lembar. Hubungi admin untuk mengisi ulang.` })
  }

  const sheetsToPrint = Math.min(totalSheets, currentPaper)
  const hasMore = totalSheets > currentPaper
  const sessionId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

  // ⚡ Kurangi kertas SEGERA (sebelum print selesai) untuk cegah race condition
  // Kalau print gagal, paper count dikembalikan di onError
  savePaperCount(currentPaper - sheetsToPrint)

  // Langsung respon ke client — print jalan di background
  res.json({
    ok: true,
    message: hasMore
      ? `Dokumen ${totalSheets} halaman akan dicetak dalam beberapa sesi. Sesi 1 (${sheetsToPrint} hal) dimulai. Sesi berikutnya otomatis saat kertas diisi.`
      : `Dokumen sedang dicetak (${sheetsToPrint} halaman).`,
    multiSession: hasMore,
    sessionId,
    sesi1Pages: sheetsToPrint,
    totalPages: totalSheets,
  })

  executePrint({
    filename, data, copies, duplex, paperSize, color,
    fromPage: printFrom || 1,
    toPage: printFrom ? (printFrom + sheetsToPrint - 1) : sheetsToPrint,
    onSuccess: (jobId) => {
      const newPaper = loadPaperCount()
      sendPaperAlert(newPaper)
      console.log(`[PRINT] ✅ Sesi 1 selesai (${sheetsToPrint} hal), jobId: ${jobId}`)

      if (hasMore) {
        addPendingSession({
          id: sessionId,
          filename, data, copies, duplex, paperSize, color,
          fromPage: sheetsToPrint + 1,
          toPage: totalSheets,
        })
        if (WA_NOTIFY_URL && WA_NOTIFY_PHONE) {
          fetch(WA_NOTIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              phone: WA_NOTIFY_PHONE,
              message: `⚠️ *Kertas Habis — Sesi Berikutnya Pending*\n\nDokumen: ${filename}\nSudah dicetak: hal 1–${sheetsToPrint}\nSisa: ${totalSheets - sheetsToPrint} halaman menunggu\n\nIsi kertas lalu update stok di dashboard admin — print akan lanjut otomatis.\n\n_Rukkamu Print System_`,
            }),
          }).catch(() => {})
        }
      }
    },
    onError: (err) => {
      // Kembalikan paper count kalau print gagal
      savePaperCount(currentPaper)
      console.error('[PRINT] Error:', err)
    },
  })
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
    sendPaperAlert(newCount)
    res.json({ count: newCount, pendingSessions: loadPendingSessions().length })
    // Auto-continue pending sessions kalau kertas > 0
    if (newCount > 0) {
      setTimeout(() => processPendingSessions(), 500)
    }
  } else {
    res.status(400).json({ error: 'count harus berupa angka' })
  }
})

app.get('/api/admin/pending-sessions', (_req, res) => {
  const sessions = loadPendingSessions()
  res.json(sessions.map(s => ({
    id: s.id,
    filename: s.filename,
    fromPage: s.fromPage,
    toPage: s.toPage,
    created_at: s.created_at,
    remaining: s.toPage - s.fromPage + 1,
  })))
})

// Public: cek status sesi print user (polling dari frontend)
app.get('/api/session/:sessionId', (req, res) => {
  const sessions = loadPendingSessions()
  const session = sessions.find(s => s.id === req.params.sessionId)
  if (session) {
    res.json({
      status: 'pending',
      fromPage: session.fromPage,
      toPage: session.toPage,
      remaining: session.toPage - session.fromPage + 1,
    })
  } else {
    res.json({ status: 'done' })
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

// ─── Serve Frontend Build (Production) ───────────────────────────────────────
const distPath = path.join(__dirname, 'dist')
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath))
  app.use((req, res, next) => {
    if (req.method !== 'GET' || req.path.startsWith('/api/')) return next()
    res.sendFile(path.join(distPath, 'index.html'))
  })
  console.log('[STATIC] Serving frontend from ./dist')
}

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
