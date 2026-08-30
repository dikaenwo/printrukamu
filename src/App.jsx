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
import PdfPreview from './PdfPreview'
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

const PRICE = { bw: 300, color: 500 }

const defaultConfig = { copies: 1, color: false, duplex: false, paperSize: 'A4', pageRangeEnabled: false, pageFrom: 1, pageTo: 1 }

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
  const [files, setFiles] = useState([])          // array of { name, size, pages, kind }
  const [rawFiles, setRawFiles] = useState([])    // array of raw File objects
  const [error, setError] = useState(null)
  const [paperError, setPaperError] = useState(false)
  const [printJobId, setPrintJobId] = useState(null)
  const [currentOrderId, setCurrentOrderId] = useState(null)
  const [config, setConfig] = useState(defaultConfig)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [printSessions, setPrintSessions] = useState([]) // [{sesi:1|2, pages:'1-3', status:'done'|'pending', sessionId}]
  const fileInputRef = useRef(null)
  const sessionPollRef = useRef(null)

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

  const ACCEPTED_EXTS = /\.(pdf|doc|docx|png|jpg|jpeg|webp)$/i

  const processFileList = async (fileList) => {
    const accepted = Array.from(fileList).filter((f) => ACCEPTED_EXTS.test(f.name))
    if (!accepted.length) {
      setError('Format file tidak didukung. Gunakan PDF, DOC, DOCX, JPG, PNG, atau WEBP.')
      return
    }
    setError(null)
    setIsAnalyzing(true)
    try {
      const analyzed = await Promise.all(
        accepted.map(async (f) => ({
          raw: f,
          meta: {
            name: f.name,
            size: (f.size / 1024 / 1024).toFixed(2),
            pages: (await analyzeFile(f)) || 1,
            kind: getFileKind(f.name),
          },
        }))
      )

      const totalPages = analyzed.reduce((s, a) => s + a.meta.pages, 0)

      // Cek stok kertas — hanya block kalau kertas = 0 (multi-sesi handled di server)
      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/paper`)
        if (res.ok) {
          const data = await res.json()
          if (data.count <= 0) {
            setPaperError(true)
            setIsAnalyzing(false)
            return
          }
        }
      } catch (err) {
        console.warn('Gagal cek kertas', err)
      }

      setRawFiles((prev) => [...prev, ...analyzed.map((a) => a.raw)])
      setFiles((prev) => [...prev, ...analyzed.map((a) => a.meta)])
      if (step === 0) setStep(1)
    } catch {
      setError('Gagal membaca satu atau lebih dokumen. Coba file lain atau unggah ulang.')
    } finally {
      setIsAnalyzing(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handleFileUpload = (event) => {
    if (event.target.files?.length) processFileList(event.target.files)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer.files?.length) processFileList(e.dataTransfer.files)
  }

  const handleDragOver = (e) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = () => setIsDragging(false)

  const removeFile = (index) => {
    setFiles((prev) => prev.filter((_, i) => i !== index))
    setRawFiles((prev) => prev.filter((_, i) => i !== index))
  }

  const resetAll = () => {
    setStep(0); setFiles([]); setRawFiles([]); setPrintJobId(null); setCurrentOrderId(null); setPaperError(false)
    setConfig(defaultConfig); setIsAnalyzing(false); setIsProcessing(false); setError(null)
    setPrintSessions([])
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const updateConfig = (key, value) => setConfig((c) => ({ ...c, [key]: value }))

  // ─── Kalkulasi harga ────────────────────────────────────────────────────────
  const totalPages = files.reduce((s, f) => s + f.pages, 0)
  const totalSizeMB = files.reduce((s, f) => s + parseFloat(f.size), 0).toFixed(2)
  // Halaman efektif: kalau page range aktif, pakai range; kalau tidak, semua halaman
  const effectivePages = config.pageRangeEnabled
    ? Math.max(0, config.pageTo - config.pageFrom + 1)
    : totalPages
  const sheetCount = files.length ? Math.ceil(effectivePages / (config.duplex ? 2 : 1)) * config.copies : 0
  const pageRate = config.color ? PRICE.color : PRICE.bw
  const printCost = files.length ? effectivePages * config.copies * pageRate : 0
  const totalPrice = files.length ? printCost : 0
  const currentStepTitle =
    step === 0 ? 'Upload Dokumen' : step === 1 ? 'Konfigurasi Cetak' : step === 2 ? 'Pembayaran' : 'Proses Print'

  const proceedToPayment = async () => {
    if (!files.length) return
    setIsProcessing(true)
    // Cek stok kertas — hanya block kalau kertas = 0 (multi-sesi handled di server)
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/paper`)
      if (res.ok) {
        const data = await res.json()
        if (data.count <= 0) {
          setPaperError(true)
          setIsProcessing(false)
          return
        }
      }
    } catch (err) {
      console.warn('Gagal cek kertas', err)
    }
    setIsProcessing(false)
    setStep(2)
  }

  // ─── Record transaction ke backend ──────────────────────────────────────────
  const recordTransaction = async (orderId, amount, items) => {
    try {
      await fetch(`${API_BASE_URL}/api/record-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          order_id: orderId,
          amount,
          items: items || [],
          payment_type: 'snap',
        }),
      })
    } catch (err) {
      console.warn('Gagal mencatat transaksi:', err)
    }
  }

  // ─── Upload file & cetak (dipanggil setelah bayar) ──────────────────────────
  const encodeBase64 = async (rawFile) => {
    const arrayBuffer = await rawFile.arrayBuffer()
    const uint8 = new Uint8Array(arrayBuffer)
    let binary = ''
    const CHUNK = 8192
    for (let i = 0; i < uint8.length; i += CHUNK) {
      binary += String.fromCharCode(...uint8.subarray(i, i + CHUNK))
    }
    return btoa(binary)
  }

  const sendPrintJob = async () => {
    if (!rawFiles.length || !files.length) return

    const sessions = []
    let lastJobId = 'unknown'

    for (let i = 0; i < rawFiles.length; i++) {
      const rawFile = rawFiles[i]
      const fileMeta = files[i]
      const base64 = await encodeBase64(rawFile)
      // Kalau page range aktif, hitung berdasarkan range; kalau tidak, semua halaman
      const printFrom = config.pageRangeEnabled ? config.pageFrom : 1
      const printTo   = config.pageRangeEnabled ? config.pageTo   : fileMeta.pages
      const selectedPages = printTo - printFrom + 1
      const totalSheets = Math.ceil(selectedPages / (config.duplex ? 2 : 1)) * config.copies

      const response = await fetch(`${API_BASE_URL}/api/print`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          filename: fileMeta.name,
          data: base64,
          copies: config.copies,
          duplex: config.duplex,
          paperSize: config.paperSize,
          color: config.color,
          totalSheets,
          printFrom,
          printTo,
        }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || `Gagal mengirim file ke-${i + 1} ke printer.`)

      lastJobId = data.jobId || data.sessionId || 'unknown'

      if (data.multiSession && data.sessionId) {
        const sesi1To = data.sesi1Pages
        const totalPgs = data.totalPages
        sessions.push({ sesi: 1, pages: `1–${sesi1To}`, status: 'done', filename: fileMeta.name })
        if (sesi1To < totalPgs) {
          sessions.push({ sesi: 2, pages: `${sesi1To + 1}–${totalPgs}`, status: 'pending', sessionId: data.sessionId, filename: fileMeta.name })
          // Poll status sesi 2
          if (sessionPollRef.current) clearInterval(sessionPollRef.current)
          sessionPollRef.current = setInterval(async () => {
            try {
              const sr = await fetch(`${API_BASE_URL}/api/session/${data.sessionId}`)
              const sj = await sr.json()
              if (sj.status === 'done') {
                clearInterval(sessionPollRef.current)
                setPrintSessions(prev => prev.map(s =>
                  s.sessionId === data.sessionId ? { ...s, status: 'done' } : s
                ))
              }
            } catch {}
          }, 10000)
        }
      } else {
        sessions.push({ sesi: 1, pages: `1–${totalSheets}`, status: 'done', filename: fileMeta.name })
      }
    }

    setPrintSessions(sessions)
    setPrintJobId(lastJobId)
    setStep(3)
  }

  // Cek status transaksi ke Midtrans — jika sudah lunas, langsung print
  const checkAndPrint = async (orderId) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/transaction-status/${orderId}`)
      const data = await res.json()
      if (['settlement', 'capture'].includes(data.transaction_status)) {
        const fileNames = files.map((f) => f.name).join(', ')
        await recordTransaction(orderId, totalPrice, [{ id: 'PRINT-JOB', price: totalPrice, quantity: 1, name: `Print: ${fileNames || 'document'}` }])
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
    if (!files.length) return
    setIsProcessing(true)
    setError(null)

    try {
      // 1. Ambil clientKey dari backend
      const configRes = await fetch(`${API_BASE_URL}/api/config`)
      const { clientKey, isProduction } = await configRes.json()

      // 2. Buat transaksi → dapat snap token
      const orderId = createOrderId()
      setCurrentOrderId(orderId)
      const fileNames = files.map((f) => f.name).join(', ')

      const txRes = await fetch(`${API_BASE_URL}/api/create-checkout-transaction`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount: totalPrice,
          order_id: orderId,
          items: [{ id: 'PRINT-JOB', price: totalPrice, quantity: 1, name: `Print: ${fileNames}` }],
          totalSheets: sheetCount,
        }),
      })
      const txData = await txRes.json()
      if (!txRes.ok) throw new Error(txData.error || 'Gagal membuat transaksi.')

      // 3. Muat Snap.js lalu buka popup
      await loadSnapScript(clientKey, isProduction)

      // 4. Auto-polling: cek status pembayaran setiap 3 detik
      //    Begitu lunas → langsung print tanpa user klik "Check status"
      let alreadyHandled = false
      const pollInterval = setInterval(async () => {
        if (alreadyHandled) return
        try {
          const res = await fetch(`${API_BASE_URL}/api/transaction-status/${orderId}`)
          const data = await res.json()
          if (['settlement', 'capture'].includes(data.transaction_status)) {
            alreadyHandled = true
            clearInterval(pollInterval)
            // Tutup popup Midtrans jika masih terbuka
            try { window.snap.hide() } catch {}
            const names = files.map((f) => f.name).join(', ')
            await recordTransaction(orderId, totalPrice, [{ id: 'PRINT-JOB', price: totalPrice, quantity: 1, name: `Print: ${names}` }])
            try {
              await sendPrintJob()
            } catch (e) {
              setError(`Pembayaran berhasil tapi print gagal: ${e.message}`)
            }
          }
        } catch {
          // Gagal polling — abaikan, coba lagi di interval berikutnya
        }
      }, 3000)

      window.snap.pay(txData.token, {
        onSuccess: async () => {
          if (alreadyHandled) return
          alreadyHandled = true
          clearInterval(pollInterval)
          const names = files.map((f) => f.name).join(', ')
          await recordTransaction(orderId, totalPrice, [{ id: 'PRINT-JOB', price: totalPrice, quantity: 1, name: `Print: ${names}` }])
          try { await sendPrintJob() } catch (e) {
            setError(`Pembayaran berhasil tapi print gagal: ${e.message}`)
          }
        },
        onPending: async () => {
          // Polling tetap jalan di background — tidak perlu manual check
          // Tapi fallback: cek sekali lagi
          if (alreadyHandled) return
          const paid = await checkAndPrint(orderId)
          if (paid) {
            alreadyHandled = true
            clearInterval(pollInterval)
          }
          // Polling tetap aktif kalau belum lunas
        },
        onError: () => {
          clearInterval(pollInterval)
          if (alreadyHandled) return
          setError('Pembayaran gagal. Silakan coba lagi.')
          setIsProcessing(false)
        },
        onClose: async () => {
          // User tutup popup — polling tetap jalan 30 detik lagi untuk jaga-jaga
          if (alreadyHandled) return
          const paid = await checkAndPrint(orderId)
          if (paid) {
            alreadyHandled = true
            clearInterval(pollInterval)
          } else {
            // Beri waktu 30 detik lagi untuk polling, lalu stop
            setTimeout(() => {
              if (!alreadyHandled) {
                clearInterval(pollInterval)
                setIsProcessing(false)
              }
            }, 30000)
          }
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
                    <div
                      className={`drop-panel${isDragging ? ' drop-panel--dragging' : ''}`}
                      onClick={() => fileInputRef.current?.click()}
                      onDrop={handleDrop}
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      role="button"
                      tabIndex={0}
                      aria-label="Area drop file"
                      onKeyDown={(e) => e.key === 'Enter' && fileInputRef.current?.click()}
                    >
                      <div className="drop-icon"><Upload size={34} /></div>
                      <h4>Tarik file ke sini atau pilih dokumen</h4>
                      <p>Mendukung PDF, DOC, DOCX, JPG, PNG, dan WEBP — bisa pilih <strong>banyak file sekaligus</strong>.</p>
                      <span className="primary-button">Pilih File<ChevronRight size={18} /></span>
                    </div>
                    <input ref={fileInputRef} type="file" hidden accept=".pdf,.doc,.docx,image/*" multiple onChange={handleFileUpload} />
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
            {step === 1 && files.length > 0 && (
              <MotionSection
                key="config"
                initial={{ opacity: 0, x: 28 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -28 }}
                className="stage stage-config"
              >
                {/* Daftar file yang dipilih */}
                <div className="file-list">
                  <div className="file-list-header">
                    <span className="file-list-count">{files.length} file dipilih</span>
                    <button type="button" className="add-more-btn" onClick={() => fileInputRef.current?.click()}>
                      <Upload size={14} /> Tambah File
                    </button>
                    <input ref={fileInputRef} type="file" hidden accept=".pdf,.doc,.docx,image/*" multiple onChange={handleFileUpload} />
                  </div>
                  {files.map((f, i) => (
                    <div key={`${f.name}-${i}`} className="file-card">
                      <div className="file-icon">
                        {f.kind === 'image' ? <ImageIcon size={24} /> : <FileText size={24} />}
                      </div>
                      <div className="file-meta">
                        <strong>{f.name}</strong>
                        <span>{f.size} MB · {f.pages} halaman</span>
                      </div>
                      <button type="button" className="ghost-icon" onClick={() => removeFile(i)} aria-label={`Hapus ${f.name}`}>
                        <X size={18} />
                      </button>
                    </div>
                  ))}
                  <div className="file-list-summary">
                    <span>Total: <strong>{totalPages} halaman</strong> dari {files.length} file · {totalSizeMB} MB</span>
                  </div>
                </div>


                {error && (
                  <div className="alert-box" role="alert" style={{ margin: '16px 0' }}>
                    <AlertCircle size={18} /><span>{error}</span>
                  </div>
                )}

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
                        <strong>Hitam Putih</strong><span>Rp 300 / halaman</span>
                      </button>
                      <button type="button" className={`option-card ${config.color ? 'selected' : ''}`} onClick={() => updateConfig('color', true)}>
                        <strong>Full Color</strong><span>Rp 500 / halaman</span>
                      </button>
                    </div>
                  </section>


                  <section className="control-group">
                    <div className="toggle-stack">
                      <button type="button" className={`toggle-card ${config.duplex ? 'selected' : ''}`} onClick={() => updateConfig('duplex', !config.duplex)}>
                        <div><strong>Bolak-balik</strong><span>Hemat kertas untuk dokumen multi-halaman</span></div>
                        <span className="toggle-state">{config.duplex ? 'Aktif' : 'Nonaktif'}</span>
                      </button>
                    </div>
                  </section>

                  <section className="control-group">
                    <div className="toggle-stack">
                      <button type="button" className={`toggle-card ${config.pageRangeEnabled ? 'selected' : ''}`}
                        onClick={() => {
                          const next = !config.pageRangeEnabled
                          updateConfig('pageRangeEnabled', next)
                          if (next && totalPages > 0) {
                            updateConfig('pageFrom', 1)
                            updateConfig('pageTo', totalPages)
                          }
                        }}>
                        <div><strong>Pilih halaman tertentu</strong><span>Cetak hanya halaman yang dipilih</span></div>
                        <span className="toggle-state">{config.pageRangeEnabled ? 'Aktif' : 'Nonaktif'}</span>
                      </button>
                    </div>
                    {config.pageRangeEnabled && (
                      <div style={{ display: 'flex', gap: '12px', marginTop: '12px', alignItems: 'center' }}>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '0.78rem', opacity: 0.7, display: 'block', marginBottom: '4px' }}>Dari halaman</label>
                          <input
                            type="number" min={1} max={totalPages}
                            value={config.pageFrom}
                            onWheel={e => e.target.blur()}
                            onChange={e => { const v = Math.min(parseInt(e.target.value) || 1, totalPages); updateConfig('pageFrom', v) }}
                            onBlur={() => updateConfig('pageFrom', Math.min(Math.max(1, config.pageFrom), config.pageTo))}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'inherit', fontSize: '0.9rem' }}
                          />
                        </div>
                        <span style={{ marginTop: '18px', opacity: 0.5 }}>—</span>
                        <div style={{ flex: 1 }}>
                          <label style={{ fontSize: '0.78rem', opacity: 0.7, display: 'block', marginBottom: '4px' }}>Sampai halaman</label>
                          <input
                            type="number" min={config.pageFrom} max={totalPages}
                            value={config.pageTo}
                            onWheel={e => e.target.blur()}
                            onChange={e => { const v = Math.min(parseInt(e.target.value) || 1, totalPages); updateConfig('pageTo', v) }}
                            onBlur={() => updateConfig('pageTo', Math.min(Math.max(config.pageFrom, config.pageTo), totalPages))}
                            style={{ width: '100%', padding: '8px 10px', borderRadius: '8px', border: '1px solid var(--border)', background: 'var(--surface)', color: 'inherit', fontSize: '0.9rem' }}
                          />
                        </div>
                      </div>
                    )}
                    {config.pageRangeEnabled && (
                      <p style={{ fontSize: '0.78rem', opacity: 0.65, marginTop: '8px' }}>
                        📄 Mencetak {config.pageTo - config.pageFrom + 1} halaman dari total {totalPages} halaman dokumen
                      </p>
                    )}
                  </section>
                </div>

                {/* ── PDF Page Preview ── */}
                {rawFiles.length === 1 && rawFiles[0]?.name?.toLowerCase().endsWith('.pdf') && (
                  <div style={{ marginTop: '16px' }}>
                    <p style={{ fontSize: '0.8rem', opacity: 0.55, marginBottom: '6px' }}>👁️ Preview halaman</p>
                    <PdfPreview
                      rawFile={rawFiles[0]}
                      pageFrom={config.pageFrom}
                      pageTo={config.pageTo}
                      pageRangeEnabled={config.pageRangeEnabled}
                      onPageClick={() => {}}
                    />
                  </div>
                )}

                <div className="stage-actions">
                  <button type="button" className="secondary-button" onClick={resetAll}>Ganti Dokumen</button>
                  <button type="button" className="primary-button" onClick={proceedToPayment} disabled={isProcessing}>
                    {isProcessing ? <><Loader2 size={16} className="spin-icon" /> Memproses...</> : <>Lanjut ke Pembayaran<ChevronRight size={18} /></>}
                  </button>
                </div>
              </MotionSection>
            )}

            {/* ── Step 2: Pembayaran ── */}
            {step === 2 && files.length > 0 && (
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
                        <div><span>Dokumen</span><strong>{files.length} file ({totalPages} hal)</strong></div>
                        <div><span>Halaman</span><strong>{totalPages} hal × {config.copies} copy</strong></div>
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
            {step === 3 && files.length > 0 && (
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
            <h3>{files.length > 0 ? `${files.length} file siap` : 'Belum ada dokumen'}</h3>
          </div>
          <div className="summary-hero">
            <span>Total pembayaran</span>
            <strong>{formatCurrency(totalPrice)}</strong>
            <small>{files.length > 0 ? `${totalPages} halaman — ${config.copies} copy` : 'Upload dokumen untuk mulai'}</small>
          </div>
          <div className="summary-list">
            <div><span>Dokumen</span><strong>{files.length > 0 ? `${files.length} file` : '-'}</strong></div>
            <div><span>Ukuran</span><strong>{files.length > 0 ? `${totalSizeMB} MB` : '-'}</strong></div>
            <div><span>Spesifikasi</span><strong>{config.paperSize} — {config.color ? 'Warna' : 'B&W'}</strong></div>
            <div><span>Lembar output</span><strong>{sheetCount || 0} lembar</strong></div>
            <div><span>Bolak-balik</span><strong>{config.duplex ? 'Aktif' : 'Nonaktif'}</strong></div>
          </div>
          <div className="cost-panel">
            <div><span>Biaya cetak</span><strong>{formatCurrency(printCost)}</strong></div>
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
                {step === 1 && `${files.length} file siap, lanjut ke pembayaran.`}
                {step === 2 && 'Klik Bayar Sekarang untuk membuka QR.'}
                {step === 3 && `Job ${printJobId || ''} diterima printer.`}
              </span>
            </div>
          </div>

          {/* ── Sesi Print (multi-session) ── */}
          {step === 3 && printSessions.length > 0 && (
            <div style={{ marginTop: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {printSessions.map((s, i) => (
                <div key={i} style={{
                  padding: '10px 14px',
                  borderRadius: '10px',
                  background: s.status === 'done' ? 'rgba(34,197,94,0.1)' : 'rgba(251,146,60,0.1)',
                  border: `1px solid ${s.status === 'done' ? 'rgba(34,197,94,0.4)' : 'rgba(251,146,60,0.4)'}`,
                  fontSize: '0.82rem',
                }}>
                  <div style={{ fontWeight: 700, marginBottom: '2px' }}>
                    {s.status === 'done' ? '✅' : '⏳'} Sesi {s.sesi}
                  </div>
                  <div style={{ opacity: 0.8 }}>Halaman {s.pages}</div>
                  <div style={{ marginTop: '3px', fontWeight: 600, color: s.status === 'done' ? '#22c55e' : '#fb923c' }}>
                    {s.status === 'done' ? 'Sudah dicetak' : 'Menunggu kertas diisi admin...'}
                  </div>
                </div>
              ))}
            </div>
          )}
        </aside>
      </div>

      {/* ── Modal Kertas Habis ── */}
      <AnimatePresence>
        {paperError && (
          <motion.div
            className="modal-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div
              className="modal-content"
              initial={{ opacity: 0, y: 20, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 20, scale: 0.95 }}
            >
              <div className="modal-icon">
                <AlertCircle size={42} />
              </div>
              <h3>Pemberitahuan Kertas Tidak Cukup</h3>
              <p>Kontak Admin Wa Sekarang</p>
              <div className="modal-actions">
                <button type="button" className="secondary-button" onClick={() => setPaperError(false)}>
                  Tutup
                </button>
                <a
                  href="https://wa.me/6281343524552?text=Tray%20Kertas%20Habis%20Ibu%2C%20Mohon%20Diisi%20ulang"
                  target="_blank"
                  rel="noreferrer"
                  className="primary-button"
                  style={{ textDecoration: 'none' }}
                >
                  Hubungi Admin (WA)
                </a>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export default App
