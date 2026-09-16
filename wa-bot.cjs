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
let latestQr = null  // Simpan QR terbaru untuk endpoint /qr

client.on('qr', (qr) => {
  latestQr = qr
  console.log('[WA] QR baru diterima — buka browser: http://<IP-RASPI>:3001/qr')
  console.log('[WA] Atau jalankan: curl http://localhost:3001/qr > qr.html && open qr.html')
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

// ─── QR Code Viewer (buka di browser saat pertama kali) ──────────────────────
app.get('/qr', (_req, res) => {
  if (isReady) return res.send('<h2 style="font-family:sans-serif;color:green">✅ WhatsApp sudah terkoneksi!</h2>')
  if (!latestQr) return res.send('<h2 style="font-family:sans-serif">⏳ QR belum siap, tunggu ~15 detik lalu refresh...</h2><script>setTimeout(()=>location.reload(),5000)</script>')
  const encoded = encodeURIComponent(latestQr)
  res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Scan WA QR</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>body{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;margin:0;font-family:sans-serif;background:#f5f5f5}
h1{color:#25D366}p{color:#555}img{border:8px solid white;border-radius:12px;box-shadow:0 4px 20px rgba(0,0,0,.15)}</style>
<meta http-equiv="refresh" content="30"></head>
<body><h1>📱 Scan QR WhatsApp</h1>
<img src="https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encoded}" width="300" height="300" />
<p>Buka WhatsApp → <strong>Linked Devices</strong> → <strong>Link a Device</strong></p>
<p style="opacity:.5;font-size:.8rem">Halaman auto-refresh setiap 30 detik</p></body></html>`)
})

// Health check
app.get('/health', (_req, res) => {
  res.json({ ok: true, service: 'rukkamu-wa-bot', whatsapp: isReady ? 'connected' : 'disconnected' })
})

app.get('/health_check', (_req, res) => {
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
