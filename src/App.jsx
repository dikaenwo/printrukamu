import { useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Clock3,
  Copy,
  FileText,
  Image as ImageIcon,
  Loader2,
  Palette,
  Printer,
  QrCode,
  Sparkles,
  Upload,
  X,
} from 'lucide-react'
import { PDFDocument } from 'pdf-lib'
import JSZip from 'jszip'
import './App.css'

const MotionSection = motion.section
const MotionDiv = motion.div
const API_BASE_URL = ''

const STEPS = [
  { label: 'Upload', hint: 'Pilih file' },
  { label: 'Atur Print', hint: 'Konfigurasi' },
  { label: 'Pembayaran', hint: 'QR / Snap' },
  { label: 'Cetak', hint: 'Kirim ke printer' },
]

const PRICE = { bw: 500, color: 2000, service: 1000, priority: 2500 }

const defaultConfig = { copies: 1, color: false, duplex: true, priority: false, paperSize: 'A4' }

function formatCurrency(value) {
  return new Intl.NumberFormat('id-ID', { style: 'currency', currency: 'IDR', maximumFractionDigits: 0 }).format(value)
}

function getFileKind(fileName = '') {
  return /\.(png|jpg|jpeg|webp)$/i.test(fileName.toLowerCase()) ? 'image' : 'document'
}

function createOrderId() {
  return `RKM-${Date.now()}`
}

// Load Midtrans Snap.js secara dinamis di browser
function loadSnapScript(key, isProd) {
  return new Promise((resolve, reject) => {
    if (window.snap) return resolve()
    if (document.getElementById('midtrans-snap')) {
      document.getElementById('midtrans-snap').addEventListener('load', resolve)
      return
    }
    const script = document.createElement('script')
    script.id = 'midtrans-snap'
    script.src = isProd
      ? 'https://app.midtrans.com/snap/snap.js'
      : 'https://app.sandbox.midtrans.com/snap/snap.js'
    script.setAttribute('data-client-key', key)
    script.onload = resolve
    script.onerror = () => reject(new Error('Gagal memuat Midtrans Snap.js'))
    document.head.appendChild(script)
  })
}

function App() {
  const [step, setStep] = useState(0)
  const [file, setFile] = useState(null)
  const [rawFile, setRawFile] = useState(null)
  const [printJobId, setPrintJobId] = useState(null)
  const [currentOrderId, setCurrentOrderId] = useState(null)
  const [config, setConfig] = useState(defaultConfig)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  // ─── File analysis ──────────────────────────────────────────────────────────
  const analyzeFile = async (fileObject) => {
    const ext = fileObject.name.toLowerCase().split('.').pop()
    const arrayBuffer = await fileObject.arrayBuffer()
    try {
      if (ext === 'pdf') {
        const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })
        return pdfDoc.getPageCount()
      }
      if (ext === 'docx' || ext === 'doc') {
        const zip = await JSZip.loadAsync(arrayBuffer)
        const appXml = await zip.file('docProps/app.xml')?.async('text')
        if (appXml) {
          const match = appXml.match(/<Pages>(\d+)<\/Pages>/)
          if (match?.[1]) return parseInt(match[1], 10)
        }
        return 1
      }
      return 1
    } catch {
      return 1
    }
  }

  const handleFileUpload = async (event) => {
    const uploadedFile = event.target.files?.[0]
    if (!uploadedFile) return
    setError(null)
    setIsAnalyzing(true)
    try {
      const pages = await analyzeFile(uploadedFile)
      setRawFile(uploadedFile)
      setFile({
        name: uploadedFile.name,
        size: (uploadedFile.size / 1024 / 1024).toFixed(2),
        pages: pages || 1,
        kind: getFileKind(uploadedFile.name),
      })
      setStep(1)
    } catch {
      setError('Gagal membaca dokumen. Coba file lain atau unggah ulang.')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const resetAll = () => {
    setStep(0); setFile(null); setRawFile(null); setPrintJobId(null); setCurrentOrderId(null)
    setConfig(defaultConfig); setIsAnalyzing(false); setIsProcessing(false); setError(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const updateConfig = (key, value) => setConfig((c) => ({ ...c, [key]: value }))

  // ─── Kalkulasi harga ────────────────────────────────────────────────────────
  const sheetCount = file ? Math.ceil(file.pages / (config.duplex ? 2 : 1)) * config.copies : 0
  const pageRate = config.color ? PRICE.color : PRICE.bw
  const printCost = file ? file.pages * config.copies * pageRate : 0
  const serviceCost = PRICE.service + (config.priority ? PRICE.priority : 0)
  const totalPrice = file ? printCost + serviceCost : 0
  const currentStepTitle =
    step === 0 ? 'Upload Dokumen' : step === 1 ? 'Konfigurasi Cetak' : step === 2 ? 'Pembayaran' : 'Proses Print'

  // ─── Upload file & cetak (dipanggil setelah bayar) ──────────────────────────
  const sendPrintJob = async () => {
    if (!rawFile || !file) return

    // Baca file sebagai base64 — lebih reliable dari FormData lewat proxy
    const arrayBuffer = await rawFile.arrayBuffer()
    // Gunakan chunk agar tidak overflow call stack untuk file besar (gambar, dll)
    const uint8 = new Uint8Array(arrayBuffer)
    let binary = ''
    const CHUNK = 8192
    for (let i = 0; i < uint8.length; i += CHUNK) {
      binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK))
    }
    const base64 = btoa(binary)

    const response = await fetch(`${API_BASE_URL}/api/print`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename: file.name,
        data: base64,
        copies: config.copies,
        duplex: config.duplex,
        paperSize: config.paperSize,
      }),
    })
    const data = await response.json()
    if (!response.ok) throw new Error(data.error || 'Gagal mengirim ke printer.')
    setPrintJobId(data.jobId || 'unknown')
    setStep(3)
  }

  // Cek status transaksi ke Midtrans — jika sudah lunas, langsung print
  const checkAndPrint = async (orderId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/transaction-status/${orderId}`)
      const data = await res.json()
      if (['settlement', 'capture'].includes(data.transaction_status)) {
        await sendPrintJob()
        return true
      }
      return false
    } catch {
      return false
    }
  }

  // Tombol manual "Saya Sudah Bayar" — polling status lalu print jika lunas
  const manualCheckAndPrint = async () => {
    if (!currentOrderId) return
    setIsProcessing(true)
    setError(null)
    const paid = await checkAndPrint(currentOrderId)
    if (!paid) {
      setError('Pembayaran belum terdeteksi. Pastikan simulasi berhasil (status PAID), lalu coba lagi.')
      setIsProcessing(false)
    }
  }

  // ─── Buka Snap popup → setelah bayar → cetak ────────────────────────────────
  const openSnapPayment = async () => {
    if (!file) return
    setIsProcessing(true)
    setError(null)

    try {
      // 1. Ambil clientKey dari backend
      const configRes = await fetch(`${API_BASE_URL}/api/config`)
      const { clientKey, isProduction } = await configRes.json()

      // 2. Buat transaksi → dapat snap token
      const orderId = createOrderId()
      setCurrentOrderId(orderId)

      const txRes = await fetch(`${API_BASE_URL}/api/create-checkout-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: totalPrice,
          order_id: orderId,
          items: [{ id: 'PRINT-JOB', price: totalPrice, quantity: 1, name: `Print: ${file.name}` }],
        }),
      })
      const txData = await txRes.json()
      if (!txRes.ok) throw new Error(txData.error || 'Gagal membuat transaksi.')

      // 3. Muat Snap.js lalu buka popup
      await loadSnapScript(clientKey, isProduction)

      window.snap.pay(txData.token, {
        onSuccess: async () => {
          // Pembayaran selesai di dalam popup
          try { await sendPrintJob() } catch (e) {
            setError(`Pembayaran berhasil tapi print gagal: ${e.message}`)
          }
        },
        onPending: async () => {
          // Mungkin sudah dibayar via simulator eksternal
          const paid = await checkAndPrint(orderId)
          if (!paid) {
            setError('Pembayaran pending. Klik "Saya Sudah Bayar" jika sudah menyelesaikan pembayaran.')
            setIsProcessing(false)
          }
        },
        onError: () => {
          setError('Pembayaran gagal. Silakan coba lagi.')
          setIsProcessing(false)
        },
        onClose: async () => {
          // User tutup popup — cek dulu ke Midtrans, mungkin sudah bayar via tab lain
          const paid = await checkAndPrint(orderId)
          if (!paid) setIsProcessing(false)
        },
      })
    } catch (err) {
      console.error('Snap error:', err)
      setError(err.message || 'Gagal membuka halaman pembayaran.')
      setIsProcessing(false)
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="app-shell">
      <div className="ambient ambient-left" aria-hidden="true" />
      <div className="ambient ambient-right" aria-hidden="true" />

      <header className="topbar">
        <button type="button" className="brand" onClick={resetAll}>
          <div className="brand-badge">R</div>
          <div>
            <p className="brand-overline">Rukkamu Self Printing</p>
            <h1>Printer Station</h1>
          </div>
        </button>
        <div className="topbar-status">
          <span className="live-pill"><span className="live-dot" />Online</span>
          <div className="queue-chip"><Clock3 size={16} />Estimasi antrean 2 menit</div>
        </div>
      </header>

      <section className="hero-panel">
        <div className="hero-copy">
          <p className="section-tag">Kiosk Cetak Mandiri</p>
          <h2>Upload, atur, bayar via QR, lalu printer langsung jalan.</h2>
          <p>
            Bayar dengan QRIS atau e-wallet via Midtrans Snap. Setelah pembayaran disetujui,
            dokumen langsung dikirim ke printer <strong>Brother T720DW</strong> di Raspberry Pi.
          </p>
        </div>
        <div className="hero-metrics">
          <div className="metric-card"><span>Format</span><strong>PDF, DOCX, Gambar</strong></div>
          <div className="metric-card"><span>Pembayaran</span><strong>QRIS, E-Wallet, Kartu</strong></div>
          <div className="metric-card"><span>Printer</span><strong>Brother T720DW</strong></div>
        </div>
      </section>

      <div className="flow-layout">
        <main className="workspace-card">
          <div className="section-head">
            <div>
              <p className="section-tag">Langkah Aktif</p>
              <h3>{currentStepTitle}</h3>
            </div>
            <div className="step-track" aria-label="Progress langkah">
              {STEPS.map((item, index) => (
                <div key={item.label} className={`step-pill ${index <= step ? 'is-active' : ''}`}>
                  <span>{index + 1}</span>
                  <div><strong>{item.label}</strong><small>{item.hint}</small></div>
                </div>
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {/* ── Step 0: Upload ── */}
            {step === 0 && (
              <MotionSection
                key="upload"
                initial={{ opacity: 0, y: 24 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -24 }}
                className="stage stage-upload"
              >
                {isAnalyzing ? (
                  <div className="analyzing-panel">
                    <Loader2 className="spin-icon" size={56} />
                    <h4>Menganalisis dokumen</h4>
                    <p>Sistem sedang membaca format file dan memperkirakan jumlah halaman.</p>
                  </div>
                ) : (
                  <>
                    <button type="button" className="drop-panel" onClick={() => fileInputRef.current?.click()}>
                      <div className="drop-icon"><Upload size={34} /></div>
                      <h4>Tarik file ke sini atau pilih dokumen</h4>
                      <p>Mendukung PDF, DOC, DOCX, JPG, PNG, dan WEBP untuk kebutuhan cetak cepat.</p>
                      <span className="primary-button">Pilih File<ChevronRight size={18} /></span>
                    </button>
                    <input ref={fileInputRef} type="file" hidden accept=".pdf,.doc,.docx,image/*" onChange={handleFileUpload} />
                    {error && (
                      <div className="alert-box" role="alert">
                        <AlertCircle size={18} /><span>{error}</span>
                      </div>
                    )}
                    <div className="feature-grid">
                      <article className="feature-card">
                        <Sparkles size={18} /><strong>Deteksi halaman</strong>
                        <p>PDF dan DOCX dihitung otomatis agar estimasi harga lebih akurat.</p>
                      </article>
                      <article className="feature-card">
                        <QrCode size={18} /><strong>Bayar via QR</strong>
                        <p>Scan QR Midtrans — QRIS, GoPay, OVO, dan metode lain tersedia.</p>
                      </article>
                      <article className="feature-card">
                        <Printer size={18} /><strong>Print otomatis</strong>
                        <p>Setelah bayar, dokumen langsung dicetak tanpa perlu konfirmasi manual.</p>
                      </article>
                    </div>
                  </>
                )}
              </MotionSection>
            )}

            {/* ── Step 1: Config ── */}
            {step === 1 && file && (
              <MotionSection
                key="config"
                initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -28 }}
                className="stage stage-config"
              >
                <div className="file-card">
                  <div className="file-icon">
                    {file.kind === 'image' ? <ImageIcon size={24} /> : <FileText size={24} />}
                  </div>
                  <div className="file-meta">
                    <strong>{file.name}</strong>
                    <span>{file.size} MB - {file.pages} halaman</span>
                  </div>
                  <button type="button" className="ghost-icon" onClick={resetAll} aria-label="Reset dokumen">
                    <X size={18} />
                  </button>
                </div>

                <div className="config-grid">
                  <section className="control-group">
                    <div className="control-heading">
                      <Copy size={18} />
                      <div><strong>Jumlah copy</strong><span>Atur berapa salinan yang ingin dicetak</span></div>
                    </div>
                    <div className="counter-box">
                      <button type="button" onClick={() => updateConfig('copies', Math.max(1, config.copies - 1))}>-</button>
                      <strong>{config.copies}</strong>
                      <button type="button" onClick={() => updateConfig('copies', config.copies + 1)}>+</button>
                    </div>
                  </section>

                  <section className="control-group">
                    <div className="control-heading">
                      <Palette size={18} />
                      <div><strong>Mode cetak</strong><span>Pilih hitam putih atau warna penuh</span></div>
                    </div>
                    <div className="option-grid">
                      <button type="button" className={`option-card ${!config.color ? 'selected' : ''}`} onClick={() => updateConfig('color', false)}>
                        <strong>Hitam Putih</strong><span>Rp 500 / halaman</span>
                      </button>
                      <button type="button" className={`option-card ${config.color ? 'selected' : ''}`} onClick={() => updateConfig('color', true)}>
                        <strong>Full Color</strong><span>Rp 2.000 / halaman</span>
                      </button>
                    </div>
                  </section>

                  <section className="control-group">
                    <div className="control-heading">
                      <FileText size={18} />
                      <div><strong>Ukuran kertas</strong><span>Sesuaikan dengan dokumen yang dicetak</span></div>
                    </div>
                    <div className="select-row">
                      {['A4', 'Letter', 'Legal'].map((size) => (
                        <button key={size} type="button" className={`chip-button ${config.paperSize === size ? 'selected' : ''}`} onClick={() => updateConfig('paperSize', size)}>
                          {size}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="control-group">
                    <div className="toggle-stack">
                      <button type="button" className={`toggle-card ${config.duplex ? 'selected' : ''}`} onClick={() => updateConfig('duplex', !config.duplex)}>
                        <div><strong>Bolak-balik</strong><span>Hemat kertas untuk dokumen multi-halaman</span></div>
                        <span className="toggle-state">{config.duplex ? 'Aktif' : 'Nonaktif'}</span>
                      </button>
                      <button type="button" className={`toggle-card ${config.priority ? 'selected priority' : ''}`} onClick={() => updateConfig('priority', !config.priority)}>
                        <div><strong>Prioritas cepat</strong><span>Tambah biaya layanan untuk antrean lebih singkat</span></div>
                        <span className="toggle-state">{config.priority ? '+ Express' : 'Standar'}</span>
                      </button>
                    </div>
                  </section>
                </div>

                <div className="stage-actions">
                  <button type="button" className="secondary-button" onClick={resetAll}>Ganti Dokumen</button>
                  <button type="button" className="primary-button" onClick={() => setStep(2)}>
                    Lanjut ke Pembayaran<ChevronRight size={18} />
                  </button>
                </div>
              </MotionSection>
            )}

            {/* ── Step 2: Pembayaran ── */}
            {step === 2 && file && (
              <MotionSection
                key="payment"
                initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.03 }}
                className="stage stage-payment"
              >
                <div className="payment-layout">
                  <div className="payment-left">
                    <div className="payment-heading">
                      <p className="section-tag">Pembayaran Digital</p>
                      <h4>Scan QR untuk bayar</h4>
                      <p>Klik <strong>Bayar Sekarang</strong> untuk membuka popup QR Midtrans. Setelah pembayaran disetujui, dokumen langsung dicetak secara otomatis.</p>
                    </div>
                    {error && (
                      <div className="alert-box payment-alert" role="alert">
                        <AlertCircle size={18} /><span>{error}</span>
                      </div>
                    )}
                    <div className="payment-options">
                      <article className="payment-card selected payment-card-static">
                        <QrCode size={20} />
                        <div>
                          <strong>Midtrans Snap</strong>
                          <span>QRIS, GoPay, OVO, ShopeePay, kartu kredit, dan lainnya.</span>
                        </div>
                      </article>
                    </div>
                  </div>

                  <div className="payment-right">
                    <div className="qr-panel">
                      <div className="qr-copy">
                        <strong>Total Pembayaran</strong>
                        <span>Setelah bayar, printer langsung jalan otomatis.</span>
                      </div>
                      <div className="qr-total">{formatCurrency(totalPrice)}</div>
                      <div className="payment-meta">
                        <div><span>Dokumen</span><strong>{file.name}</strong></div>
                        <div><span>Halaman</span><strong>{file.pages} hal × {config.copies} copy</strong></div>
                        <div><span>Printer</span><strong>Brother T720DW</strong></div>
                      </div>
                    </div>
                    <div className="stage-actions payment-actions">
                      <button type="button" className="secondary-button" onClick={() => setStep(1)} disabled={isProcessing}>
                        <ArrowLeft size={16} />Kembali
                      </button>
                      {currentOrderId && !isProcessing && (
                        <button type="button" className="secondary-button" onClick={manualCheckAndPrint}>
                          <CheckCircle2 size={16} /> Saya Sudah Bayar
                        </button>
                      )}
                      <button type="button" className="primary-button" onClick={openSnapPayment} disabled={isProcessing}>
                        {isProcessing
                          ? <><Loader2 size={16} className="spin-icon" /> Memproses...</>
                          : <><QrCode size={16} /> Bayar Sekarang</>}
                      </button>
                    </div>
                  </div>
                </div>
              </MotionSection>
            )}

            {/* ── Step 3: Cetak ── */}
            {step === 3 && file && (
              <MotionSection
                key="print"
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="stage stage-finish"
              >
                <div className="printing-orb"><Printer size={48} /></div>
                <div className="finish-copy">
                  <p className="section-tag">Print Server — Raspberry Pi</p>
                  <h4>Pembayaran berhasil! Dokumen sedang dicetak.</h4>
                  <p>
                    Job <strong>{printJobId}</strong> diterima oleh printer{' '}
                    <strong>Brother T720DW</strong>. Silakan tunggu di dekat printer sampai dokumen selesai keluar.
                  </p>
                </div>
                <div className="progress-rail">
                  <MotionDiv
                    className="progress-fill"
                    initial={{ width: '0%' }} animate={{ width: '100%' }} transition={{ duration: 6 }}
                  />
                </div>
                <div className="stage-actions centered">
                  <button type="button" className="primary-button" onClick={resetAll}>Mulai Job Baru</button>
                </div>
              </MotionSection>
            )}
          </AnimatePresence>
        </main>

        {/* ── Sidebar ── */}
        <aside className="summary-card">
          <div className="summary-head">
            <p className="section-tag">Ringkasan Job</p>
            <h3>{file ? 'Siap diproses' : 'Belum ada dokumen'}</h3>
          </div>
          <div className="summary-hero">
            <span>Total pembayaran</span>
            <strong>{formatCurrency(totalPrice)}</strong>
            <small>{file ? `${file.pages} halaman — ${config.copies} copy` : 'Upload dokumen untuk mulai'}</small>
          </div>
          <div className="summary-list">
            <div><span>Dokumen</span><strong>{file ? file.name : '-'}</strong></div>
            <div><span>Ukuran</span><strong>{file ? `${file.size} MB` : '-'}</strong></div>
            <div><span>Spesifikasi</span><strong>{config.paperSize} — {config.color ? 'Warna' : 'B&W'}</strong></div>
            <div><span>Lembar output</span><strong>{sheetCount || 0} lembar</strong></div>
            <div><span>Bolak-balik</span><strong>{config.duplex ? 'Aktif' : 'Nonaktif'}</strong></div>
          </div>
          <div className="cost-panel">
            <div><span>Biaya cetak</span><strong>{formatCurrency(printCost)}</strong></div>
            <div><span>Biaya layanan</span><strong>{formatCurrency(serviceCost)}</strong></div>
            <div><span>Metode bayar</span><strong>QRIS / Snap</strong></div>
          </div>
          <div className={`status-panel status-${step}`}>
            <div className="status-icon">
              {step < 3 ? <CheckCircle2 size={18} /> : <Printer size={18} />}
            </div>
            <div>
              <strong>
                {step === 0 && 'Menunggu upload'}
                {step === 1 && 'Siap dikonfigurasi'}
                {step === 2 && 'Menunggu pembayaran'}
                {step === 3 && 'Sedang mencetak'}
              </strong>
              <span>
                {step === 0 && 'Pilih file untuk mulai.'}
                {step === 1 && 'Konfigurasi selesai, lanjut ke pembayaran.'}
                {step === 2 && 'Klik Bayar Sekarang untuk membuka QR.'}
                {step === 3 && `Job ${printJobId || ''} diterima printer.`}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default App
