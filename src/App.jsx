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
  { label: 'Cetak', hint: 'Kirim ke printer' },
]

const PRICE = {
  bw: 500,
  color: 2000,
  service: 1000,
  priority: 2500,
}

const defaultConfig = {
  copies: 1,
  color: false,
  duplex: true,
  priority: false,
  paperSize: 'A4',
}

function formatCurrency(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value)
}

function getFileKind(fileName = '') {
  const normalized = fileName.toLowerCase()

  if (/\.(png|jpg|jpeg|webp)$/i.test(normalized)) {
    return 'image'
  }

  return 'document'
}

function createOrderId() {
  return `RKM-${Date.now()}`
}

async function parseApiResponse(response) {
  const contentType = response.headers.get('content-type') || ''
  const rawBody = await response.text()

  if (!contentType.includes('application/json')) {
    const preview = rawBody.trim().slice(0, 120)
    throw new Error(
      `API pembayaran tidak mengembalikan JSON. Kemungkinan backend belum jalan atau route salah. Response awal: ${preview}`,
    )
  }

  try {
    return JSON.parse(rawBody)
  } catch {
    throw new Error('Response API pembayaran bukan JSON yang valid.')
  }
}

function App() {
  const [step, setStep] = useState(0)
  const [file, setFile] = useState(null)
  const [rawFile, setRawFile] = useState(null)   // File object asli untuk dikirim ke printer
  const [printJobId, setPrintJobId] = useState(null)
  const [config, setConfig] = useState(defaultConfig)
  const [isAnalyzing, setIsAnalyzing] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)
  const [error, setError] = useState(null)
  const fileInputRef = useRef(null)

  const analyzeFile = async (fileObject) => {
    const fileName = fileObject.name.toLowerCase()
    const extension = fileName.split('.').pop()
    const arrayBuffer = await fileObject.arrayBuffer()

    try {
      if (extension === 'pdf') {
        const pdfDoc = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })
        return pdfDoc.getPageCount()
      }

      if (extension === 'docx' || extension === 'doc') {
        const zip = await JSZip.loadAsync(arrayBuffer)
        const appXml = await zip.file('docProps/app.xml')?.async('text')

        if (appXml) {
          const match = appXml.match(/<Pages>(\d+)<\/Pages>/)

          if (match?.[1]) {
            return Number.parseInt(match[1], 10)
          }
        }

        return 1
      }

      if (['png', 'jpg', 'jpeg', 'webp'].includes(extension)) {
        return 1
      }

      return 1
    } catch (analysisError) {
      console.error('File analysis error:', analysisError)
      return 1
    }
  }

  const handleFileUpload = async (event) => {
    const uploadedFile = event.target.files?.[0]

    if (!uploadedFile) {
      return
    }

    setError(null)
    setIsAnalyzing(true)

    try {
      const pages = await analyzeFile(uploadedFile)

      setRawFile(uploadedFile)   // simpan File object asli
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
    setStep(0)
    setFile(null)
    setRawFile(null)
    setPrintJobId(null)
    setConfig(defaultConfig)
    setIsAnalyzing(false)
    setIsProcessing(false)
    setError(null)

    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  // Kirim file ke backend → lp command di Raspberry Pi
  const sendPrintJob = async () => {
    if (!rawFile || !file) return

    setIsProcessing(true)
    setError(null)

    try {
      const formData = new FormData()
      formData.append('file', rawFile, file.name)
      formData.append('copies', String(config.copies))
      formData.append('duplex', String(config.duplex))
      formData.append('paperSize', config.paperSize)

      const response = await fetch(`${API_BASE_URL}/api/print`, {
        method: 'POST',
        body: formData,
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Gagal mengirim ke printer.')
      }

      setPrintJobId(data.jobId || 'unknown')
      setStep(2)   // step 2 = Cetak (sebelumnya step 3)
    } catch (printError) {
      console.error('Print error:', printError)
      setError(printError.message || 'Gagal mengirim ke printer.')
    } finally {
      setIsProcessing(false)
    }
  }

  const updateConfig = (key, value) => {
    setConfig((current) => ({
      ...current,
      [key]: value,
    }))
  }

  const sheetCount = file
    ? Math.ceil(file.pages / (config.duplex ? 2 : 1)) * config.copies
    : 0
  const currentStepTitle =
    step === 0 ? 'Upload Dokumen' : step === 1 ? 'Konfigurasi Cetak' : 'Proses Print'

  // createCheckoutAndRedirect → dinonaktifkan sementara (Midtrans dicomment)
  // const createCheckoutAndRedirect = async () => { ... }

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
          <span className="live-pill">
            <span className="live-dot" />
            Online
          </span>
          <div className="queue-chip">
            <Clock3 size={16} />
            Estimasi antrean 2 menit
          </div>
        </div>
      </header>

      <section className="hero-panel">
        <div className="hero-copy">
          <p className="section-tag">Kiosk Cetak Mandiri</p>
          <h2>Upload dokumen, atur konfigurasi, lalu printer langsung jalan.</h2>
          <p>
            Sistem terhubung langsung ke printer <strong>Brother T720DW</strong> melalui Raspberry Pi.
            Tidak perlu antri — dokumen dikirim otomatis setelah konfigurasi selesai.
          </p>
        </div>

        <div className="hero-metrics">
          <div className="metric-card">
            <span>Format</span>
            <strong>PDF, DOCX, Gambar</strong>
          </div>
          <div className="metric-card">
            <span>Printer</span>
            <strong>Brother T720DW</strong>
          </div>
          <div className="metric-card">
            <span>Mode</span>
            <strong>Print Langsung via lp</strong>
          </div>
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
                <div
                  key={item.label}
                  className={`step-pill ${index <= step ? 'is-active' : ''}`}
                >
                  <span>{index + 1}</span>
                  <div>
                    <strong>{item.label}</strong>
                    <small>{item.hint}</small>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <AnimatePresence mode="wait">
            {step === 0 && (
              <MotionSection
                key="upload"
                initial={{ opacity: 0, y: 24 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -24 }}
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
                    <button
                      type="button"
                      className="drop-panel"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <div className="drop-icon">
                        <Upload size={34} />
                      </div>
                      <h4>Tarik file ke sini atau pilih dokumen</h4>
                      <p>Mendukung PDF, DOC, DOCX, JPG, PNG, dan WEBP untuk kebutuhan cetak cepat.</p>
                      <span className="primary-button">
                        Pilih File
                        <ChevronRight size={18} />
                      </span>
                    </button>

                    <input
                      ref={fileInputRef}
                      type="file"
                      hidden
                      accept=".pdf,.doc,.docx,image/*"
                      onChange={handleFileUpload}
                    />

                    {error && (
                      <div className="alert-box" role="alert">
                        <AlertCircle size={18} />
                        <span>{error}</span>
                      </div>
                    )}

                    <div className="feature-grid">
                      <article className="feature-card">
                        <Sparkles size={18} />
                        <strong>Deteksi halaman</strong>
                        <p>PDF dan DOCX dihitung otomatis agar konfigurasi lebih akurat.</p>
                      </article>
                      <article className="feature-card">
                        <Printer size={18} />
                        <strong>Cetak langsung</strong>
                        <p>File dikirim ke printer Brother T720DW via Raspberry Pi tanpa antrian manual.</p>
                      </article>
                      <article className="feature-card">
                        <Copy size={18} />
                        <strong>Multi-copy & bolak-balik</strong>
                        <p>Atur jumlah salinan, mode warna, ukuran kertas, dan duplex dalam satu layar.</p>
                      </article>
                    </div>
                  </>
                )}
              </MotionSection>
            )}

            {step === 1 && file && (
              <MotionSection
                key="config"
                initial={{ opacity: 0, x: 28 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -28 }}
                className="stage stage-config"
              >
                <div className="file-card">
                  <div className="file-icon">
                    {file.kind === 'image' ? <ImageIcon size={24} /> : <FileText size={24} />}
                  </div>
                  <div className="file-meta">
                    <strong>{file.name}</strong>
                    <span>
                      {file.size} MB - {file.pages} halaman
                    </span>
                  </div>
                  <button type="button" className="ghost-icon" onClick={resetAll} aria-label="Reset dokumen">
                    <X size={18} />
                  </button>
                </div>

                <div className="config-grid">
                  <section className="control-group">
                    <div className="control-heading">
                      <Copy size={18} />
                      <div>
                        <strong>Jumlah copy</strong>
                        <span>Atur berapa salinan yang ingin dicetak</span>
                      </div>
                    </div>
                    <div className="counter-box">
                      <button
                        type="button"
                        onClick={() => updateConfig('copies', Math.max(1, config.copies - 1))}
                      >
                        -
                      </button>
                      <strong>{config.copies}</strong>
                      <button type="button" onClick={() => updateConfig('copies', config.copies + 1)}>
                        +
                      </button>
                    </div>
                  </section>

                  <section className="control-group">
                    <div className="control-heading">
                      <Palette size={18} />
                      <div>
                        <strong>Mode cetak</strong>
                        <span>Pilih hitam putih atau warna penuh</span>
                      </div>
                    </div>
                    <div className="option-grid">
                      <button
                        type="button"
                        className={`option-card ${!config.color ? 'selected' : ''}`}
                        onClick={() => updateConfig('color', false)}
                      >
                        <strong>Hitam Putih</strong>
                        <span>Rp 500 / halaman</span>
                      </button>
                      <button
                        type="button"
                        className={`option-card ${config.color ? 'selected' : ''}`}
                        onClick={() => updateConfig('color', true)}
                      >
                        <strong>Full Color</strong>
                        <span>Rp 2.000 / halaman</span>
                      </button>
                    </div>
                  </section>

                  <section className="control-group">
                    <div className="control-heading">
                      <FileText size={18} />
                      <div>
                        <strong>Ukuran kertas</strong>
                        <span>Sesuaikan dengan dokumen yang dicetak</span>
                      </div>
                    </div>
                    <div className="select-row">
                      {['A4', 'Letter', 'Legal'].map((size) => (
                        <button
                          key={size}
                          type="button"
                          className={`chip-button ${config.paperSize === size ? 'selected' : ''}`}
                          onClick={() => updateConfig('paperSize', size)}
                        >
                          {size}
                        </button>
                      ))}
                    </div>
                  </section>

                  <section className="control-group">
                    <div className="toggle-stack">
                      <button
                        type="button"
                        className={`toggle-card ${config.duplex ? 'selected' : ''}`}
                        onClick={() => updateConfig('duplex', !config.duplex)}
                      >
                        <div>
                          <strong>Bolak-balik</strong>
                          <span>Hemat kertas untuk dokumen multi-halaman</span>
                        </div>
                        <span className="toggle-state">{config.duplex ? 'Aktif' : 'Nonaktif'}</span>
                      </button>
                      <button
                        type="button"
                        className={`toggle-card ${config.priority ? 'selected priority' : ''}`}
                        onClick={() => updateConfig('priority', !config.priority)}
                      >
                        <div>
                          <strong>Prioritas cepat</strong>
                          <span>Tambah biaya layanan untuk antrean yang lebih singkat</span>
                        </div>
                        <span className="toggle-state">{config.priority ? '+ Express' : 'Standar'}</span>
                      </button>
                    </div>
                  </section>
                </div>

                {error && (
                  <div className="alert-box" role="alert" style={{ marginBottom: '0.5rem' }}>
                    <AlertCircle size={18} />
                    <span>{error}</span>
                  </div>
                )}

                <div className="stage-actions">
                  <button type="button" className="secondary-button" onClick={resetAll}>
                    Ganti Dokumen
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    onClick={sendPrintJob}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <><Loader2 size={16} className="spin-icon" /> Mengirim ke Printer...</>
                    ) : (
                      <><Printer size={16} /> Cetak Sekarang<ChevronRight size={18} /></>
                    )}
                  </button>
                </div>
              </MotionSection>
            )}

            {/* step 2 = Cetak (Midtrans payment step dinonaktifkan) */}
            {step === 2 && file && (
              <MotionSection
                key="print"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="stage stage-finish"
              >
                <div className="printing-orb">
                  <Printer size={48} />
                </div>

                <div className="finish-copy">
                  <p className="section-tag">Print Server — Raspberry Pi</p>
                  <h4>Dokumen berhasil dikirim ke printer!</h4>
                  <p>
                    Job <strong>{printJobId}</strong> telah diterima oleh printer{' '}
                    <strong>Brother T720DW</strong>. Silakan tunggu di dekat printer sampai dokumen selesai keluar.
                  </p>
                </div>

                <div className="progress-rail">
                  <MotionDiv
                    className="progress-fill"
                    initial={{ width: '0%' }}
                    animate={{ width: '100%' }}
                    transition={{ duration: 6 }}
                  />
                </div>

                <div className="stage-actions centered">
                  <button type="button" className="primary-button" onClick={resetAll}>
                    Mulai Job Baru
                  </button>
                </div>
              </MotionSection>
            )}
          </AnimatePresence>
        </main>

        <aside className="summary-card">
          <div className="summary-head">
            <p className="section-tag">Ringkasan Job</p>
            <h3>{file ? 'Siap dicetak' : 'Belum ada dokumen'}</h3>
          </div>

          <div className="summary-hero">
            <span>Printer target</span>
            <strong>Brother T720DW</strong>
            <small>{file ? `${file.pages} halaman — ${config.copies} copy` : 'Upload dokumen untuk mulai'}</small>
          </div>

          <div className="summary-list">
            <div>
              <span>Dokumen</span>
              <strong>{file ? file.name : '-'}</strong>
            </div>
            <div>
              <span>Ukuran</span>
              <strong>{file ? `${file.size} MB` : '-'}</strong>
            </div>
            <div>
              <span>Spesifikasi</span>
              <strong>{config.paperSize} — {config.color ? 'Warna' : 'B&W'}</strong>
            </div>
            <div>
              <span>Lembar output</span>
              <strong>{sheetCount || 0} lembar</strong>
            </div>
            <div>
              <span>Bolak-balik</span>
              <strong>{config.duplex ? 'Aktif' : 'Nonaktif'}</strong>
            </div>
          </div>

          <div className="cost-panel">
            <div>
              <span>Copy</span>
              <strong>{config.copies}x</strong>
            </div>
            <div>
              <span>Mode cetak</span>
              <strong>{config.color ? 'Full Color' : 'Hitam Putih'}</strong>
            </div>
            <div>
              <span>Printer</span>
              <strong>via lp (CUPS)</strong>
            </div>
          </div>

          <div className={`status-panel status-${step}`}>
            <div className="status-icon">
              {step < 2 ? <CheckCircle2 size={18} /> : <Printer size={18} />}
            </div>
            <div>
              <strong>
                {step === 0 && 'Menunggu upload'}
                {step === 1 && 'Siap dikonfigurasi'}
                {step === 2 && 'Print job dikirim!'}
              </strong>
              <span>
                {step === 0 && 'Pilih file untuk mulai.'}
                {step === 1 && 'Atur konfigurasi lalu tekan Cetak Sekarang.'}
                {step === 2 && `Job ${printJobId || ''} diterima printer.`}
              </span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  )
}

export default App
