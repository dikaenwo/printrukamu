/**
 * ─── Rukkamu WA Bot ─────────────────────────────────────────────────────────
 * Bot WhatsApp sederhana yang expose REST API untuk kirim pesan.
 * Digunakan oleh server.cjs untuk notif kertas habis.
 *
 * Cara pakai:
 *   1. npm install  (pastikan whatsapp-web.js & qrcode-terminal terinstall)
 *   2. node wa-bot.cjs
 *   3. Scan QR code yang muncul di terminal pakai WA kamu
 *   4. Setelah login, session tersimpan otomatis (tidak perlu scan ulang)
 *   5. Set di .env:  WA_NOTIFY_URL=http://localhost:3001/send-message
 *
 * Endpoint:
 *   POST /send-message
 *   Body: { "phone": "6281343524552", "message": "Teks pesan" }
 * ─────────────────────────────────────────────────────────────────────────────
 */

const { Client, LocalAuth } = require('whatsapp-web.js')
const qrcode = require('qrcode-terminal')
const express = require('express')
const cors = require('cors')

const app = express()
app.use(cors())
app.use(express.json())

const WA_BOT_PORT = process.env.WA_BOT_PORT || 3001

// ─── Auto-detect Chromium untuk Raspberry Pi (ARM) ────────────────────────────
const fs = require('fs')
const CHROMIUM_PATHS = [
  '/usr/bin/chromium-browser',    // Raspberry Pi OS
  '/usr/bin/chromium',            // Debian/Ubuntu ARM
  '/snap/bin/chromium',           // Snap
  '/usr/bin/google-chrome',       // x86 Linux
  '/usr/bin/google-chrome-stable',
]
const detectedChromium = CHROMIUM_PATHS.find((p) => { try { return fs.existsSync(p) } catch { return false } })

if (detectedChromium) {
  console.log(`[WA] Chromium ditemukan: ${detectedChromium}`)
} else {
  console.log('[WA] ⚠️ Chromium tidak ditemukan di system. Install dulu:')
  console.log('    sudo apt install chromium-browser')
  console.log('[WA] Akan coba pakai Puppeteer bundled Chrome (mungkin gagal di ARM)\n')
}

// ─── WhatsApp Client ──────────────────────────────────────────────────────────
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './wa-session' }),
  puppeteer: {
    headless: true,
    pipe: true,
    // Pakai Chromium system kalau ada (wajib untuk ARM/Raspberry Pi)
    ...(detectedChromium ? { executablePath: detectedChromium } : {}),
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--single-process',
      '--disable-extensions',
      '--no-first-run',
      '--no-zygote',
      '--disable-accelerated-2d-canvas',
      '--disable-web-security',
      '--ignore-certificate-errors',
    ],
  },
})

let isReady = false

client.on('qr', (qr) => {
  console.log('\n========================================')
  console.log(' 📱 Scan QR code ini dengan WhatsApp:')
  console.log('========================================\n')
  qrcode.generate(qr, { small: true })
  console.log('\nBuka WhatsApp → Linked Devices → Link a Device → Scan QR di atas\n')
})

client.on('ready', () => {
  isReady = true
  console.log('\n========================================')
  console.log(' ✅ WhatsApp Bot READY!')
  console.log(` 📡 API aktif di port ${WA_BOT_PORT}`)
  console.log(' 📩 POST /send-message untuk kirim pesan')
  console.log('========================================\n')
})

client.on('authenticated', () => {
  console.log('[WA] ✅ Authenticated — session tersimpan')
})

client.on('auth_failure', (msg) => {
  console.error('[WA] ❌ Auth gagal:', msg)
  console.log('[WA] Hapus folder wa-session/ lalu jalankan ulang untuk scan QR baru')
})

client.on('disconnected', (reason) => {
  isReady = false
  console.log('[WA] ⚠️ Disconnected:', reason)
  console.log('[WA] Mencoba reconnect...')
  client.initialize()
})

// ─── REST API ─────────────────────────────────────────────────────────────────

// Health check
app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'rukkamu-wa-bot',
    whatsapp: isReady ? 'connected' : 'disconnected',
  })
})

// Kirim pesan WA
app.post('/send-message', async (req, res) => {
  // Terima berbagai format field name
  const phone = req.body.phone || req.body.number || req.body.to || ''
  const message = req.body.message || req.body.text || req.body.body || ''

  if (!phone || !message) {
    return res.status(400).json({ error: 'phone dan message wajib diisi' })
  }

  if (!isReady) {
    return res.status(503).json({ error: 'WhatsApp belum terkoneksi. Scan QR dulu.' })
  }

  try {
    // Format nomor: pastikan pakai @c.us
    const chatId = phone.includes('@') ? phone : `${phone}@c.us`
    await client.sendMessage(chatId, message)
    console.log(`[WA] ✅ Pesan terkirim ke ${phone}`)
    return res.json({ ok: true, message: 'Pesan terkirim', to: phone })
  } catch (err) {
    console.error(`[WA] ❌ Gagal kirim ke ${phone}:`, err.message)
    return res.status(500).json({ error: `Gagal kirim pesan: ${err.message}` })
  }
})

// ─── Start ────────────────────────────────────────────────────────────────────
console.log('[WA] Menginisialisasi WhatsApp client...')
console.log('[WA] Tunggu QR code muncul untuk scan (pertama kali saja)\n')
client.initialize()

app.listen(WA_BOT_PORT, '0.0.0.0', () => {
  console.log(`[WA] REST API server berjalan di http://0.0.0.0:${WA_BOT_PORT}`)
})
