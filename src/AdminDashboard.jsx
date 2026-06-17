import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  CircleDollarSign,
  Clock,
  CreditCard,
  FileText,
  Layers,
  Loader2,
  Lock,
  LogOut,
  Package,
  Printer,
  RefreshCw,
  Settings,
  TrendingUp,
  User,
  Wallet,
} from 'lucide-react'
import './AdminDashboard.css'

const API_BASE_URL = ''
const REFRESH_INTERVAL = 30000 // 30 detik

const ADMIN_USER = 'rukkamu'
const ADMIN_PASS = 'hidupjokowi'
const SESSION_KEY = 'rk_admin_session'

function formatCurrency(value) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value)
}

function formatDate(dateStr) {
  const d = new Date(dateStr)
  return d.toLocaleDateString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function formatMonthLabel(monthKey) {
  const [year, month] = monthKey.split('-')
  const d = new Date(parseInt(year), parseInt(month) - 1)
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' })
}

// ── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)

  const handleSubmit = (e) => {
    e.preventDefault()
    setLoading(true)
    setError('')
    setTimeout(() => {
      if (username === ADMIN_USER && password === ADMIN_PASS) {
        sessionStorage.setItem(SESSION_KEY, '1')
        onLogin()
      } else {
        setError('Username atau password salah.')
      }
      setLoading(false)
    }, 700)
  }

  return (
    <div className="admin-shell login-shell">
      <div className="admin-ambient-left" aria-hidden="true" />
      <div className="admin-ambient-right" aria-hidden="true" />

      <div className="login-center">
        <div className="login-card">
          <div className="login-brand">
            <div className="admin-brand-badge-lg">R</div>
            <div>
              <p className="login-overline">Rukkamu Self Printing</p>
              <h1 className="login-title">Admin Panel</h1>
            </div>
          </div>

          <p className="login-subtitle">
            Masuk untuk mengelola dashboard, transaksi, dan stok kertas printer.
          </p>

          <form onSubmit={handleSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="admin-username">
                <User size={14} /> Username
              </label>
              <input
                id="admin-username"
                type="text"
                autoComplete="username"
                placeholder="Masukkan username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
              />
            </div>

            <div className="login-field">
              <label htmlFor="admin-password">
                <Lock size={14} /> Password
              </label>
              <div className="login-pass-row">
                <input
                  id="admin-password"
                  type={showPass ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="Masukkan password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <button
                  type="button"
                  className="show-pass-btn"
                  onClick={() => setShowPass((v) => !v)}
                  tabIndex={-1}
                  aria-label="Toggle tampilkan password"
                >
                  {showPass ? '🙈' : '👁'}
                </button>
              </div>
            </div>

            {error && (
              <div className="login-error" role="alert">
                ⚠️ {error}
              </div>
            )}

            <button type="submit" className="login-submit-btn" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 size={16} className="spin-icon-admin" /> Memverifikasi...
                </>
              ) : (
                <>
                  <Lock size={16} /> Masuk ke Dashboard
                </>
              )}
            </button>
          </form>

          <p className="login-footer">
            Akses terbatas untuk admin Rukkamu
          </p>
        </div>
      </div>
    </div>
  )
}

// ── Paper Manager ─────────────────────────────────────────────────────────────
function PaperManager({ paperCount, onUpdate }) {
  const [editValue, setEditValue] = useState(String(paperCount))
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setEditValue(String(paperCount))
  }, [paperCount])

  const handleSave = async () => {
    const val = parseInt(editValue, 10)
    if (isNaN(val) || val < 0) return
    setSaving(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/paper`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ count: val }),
      })
      if (res.ok) {
        onUpdate(val)
        setSaved(true)
        setTimeout(() => setSaved(false), 2000)
      }
    } catch {
      // fallback: update local only
      onUpdate(val)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  const pct = Math.min(100, Math.round((paperCount / 65) * 100))
  const barColor =
    paperCount <= 10
      ? 'var(--admin-red)'
      : paperCount <= 25
      ? 'var(--admin-accent)'
      : 'var(--admin-green)'

  return (
    <div className="paper-manager-card admin-animate-in">
      <p className="admin-section-tag">
        <Layers size={14} /> Manajemen Kertas Tray
      </p>
      <h3>Stok Kertas</h3>

      <div className="paper-count-display">
        <div className="paper-count-num" style={{ color: barColor }}>
          {paperCount}
        </div>
        <span className="paper-count-label">lembar tersisa</span>
      </div>

      <div className="paper-bar-track">
        <div
          className="paper-bar-fill"
          style={{ width: `${pct}%`, background: barColor }}
        />
      </div>
      <p className="paper-bar-hint">
        {pct}% kapasitas tray (maks 65 lembar)
      </p>

      {paperCount <= 10 && (
        <div className="paper-alert" role="alert">
          ⚠️ <strong>Kertas hampir habis!</strong> Sisa {paperCount} lembar — segera isi ulang tray.
        </div>
      )}

      <div className="paper-set-row">
        <label htmlFor="paper-input">Set jumlah kertas saat ini:</label>
        <div className="paper-input-group">
          <input
            id="paper-input"
            type="number"
            min="0"
            max="9999"
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="paper-input"
          />
          <button
            type="button"
            className="admin-btn admin-btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? (
              <Loader2 size={14} className="spin-icon-admin" />
            ) : saved ? (
              '✓ Tersimpan'
            ) : (
              <>
                <Settings size={14} /> Simpan
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Main Dashboard ────────────────────────────────────────────────────────────
function Dashboard({ onLogout }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)
  const [paperCount, setPaperCount] = useState(() => {
    const stored = localStorage.getItem('rk_paper_count')
    return stored !== null ? parseInt(stored, 10) : 500
  })

  const fetchAnalytics = useCallback(async (showLoading = false) => {
    if (showLoading) setLoading(true)
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/analytics`)
      if (!res.ok) throw new Error('Gagal mengambil data analytics')
      const json = await res.json()
      setData(json)
      setError(null)
      setLastRefresh(new Date())
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const handleTogglePayout = async (month, currentStatus) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/admin/payouts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month, isPaid: !currentStatus }),
      })
      if (res.ok) fetchAnalytics()
    } catch (err) {
      console.error('Failed to toggle payout', err)
    }
  }

  // Sync paper count from server on mount
  useEffect(() => {
    const fetchPaper = async () => {
      try {
        const res = await fetch(`${API_BASE_URL}/api/admin/paper`)
        if (res.ok) {
          const j = await res.json()
          if (typeof j.count === 'number') {
            setPaperCount(j.count)
            localStorage.setItem('rk_paper_count', String(j.count))
          }
        }
      } catch {
        // use local storage value
      }
    }
    fetchPaper()
  }, [])

  useEffect(() => {
    fetchAnalytics(true)
    const interval = setInterval(() => fetchAnalytics(false), REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchAnalytics])

  const handlePaperUpdate = (val) => {
    setPaperCount(val)
    localStorage.setItem('rk_paper_count', String(val))
  }

  const goToKiosk = () => {
    window.location.hash = ''
  }

  const maxMonthRevenue = data?.monthlyBreakdown?.length
    ? Math.max(...data.monthlyBreakdown.map((m) => m.revenue))
    : 1

  return (
    <div className="admin-shell">
      <div className="admin-ambient-left" aria-hidden="true" />
      <div className="admin-ambient-right" aria-hidden="true" />

      <div className="admin-container">
        {/* ── Header ──────────────────────────────────────── */}
        <header className="admin-header">
          <div className="admin-brand">
            <div className="admin-brand-badge">R</div>
            <div className="admin-brand-text">
              <span>Admin Panel</span>
              <h1>Analytics Dashboard</h1>
            </div>
          </div>
          <div className="admin-header-actions">
            <div className="admin-live-badge">
              <span className="admin-live-dot" />
              Live
            </div>
            <button type="button" className="admin-btn" onClick={() => fetchAnalytics(false)}>
              <RefreshCw size={15} />
              Refresh
            </button>
            <button type="button" className="admin-btn" onClick={goToKiosk}>
              <ArrowLeft size={15} />
              Kiosk
            </button>
            <button type="button" className="admin-btn admin-btn-logout" onClick={onLogout}>
              <LogOut size={15} />
              Keluar
            </button>
          </div>
        </header>

        {/* Auto-refresh bar */}
        <div className="admin-refresh-bar" key={lastRefresh?.getTime()}>
          <div className="admin-refresh-fill" />
        </div>

        {/* ── Loading ──────────────────────────────────────── */}
        {loading && (
          <div className="admin-loading">
            <div className="admin-loading-spinner" />
            <p>Memuat data analytics...</p>
          </div>
        )}

        {/* ── Error ───────────────────────────────────────── */}
        {error && !loading && (
          <div className="admin-loading">
            <p style={{ color: 'var(--admin-red)' }}>⚠️ {error}</p>
            <button type="button" className="admin-btn admin-btn-primary" onClick={() => fetchAnalytics(true)}>
              Coba Lagi
            </button>
          </div>
        )}

        {/* ── Data ────────────────────────────────────────── */}
        {data && !loading && (
          <>
            {/* Revenue Cards */}
            <div className="admin-cards-grid">
              <div className="admin-metric-card admin-animate-in">
                <div className="admin-metric-icon">
                  <CircleDollarSign size={20} />
                </div>
                <span className="admin-metric-label">Pendapatan Hari Ini</span>
                <strong className="admin-metric-value">{formatCurrency(data.today.revenue)}</strong>
                <span className="admin-metric-sub">{data.today.orders} transaksi</span>
              </div>

              <div className="admin-metric-card admin-animate-in">
                <div className="admin-metric-icon">
                  <TrendingUp size={20} />
                </div>
                <span className="admin-metric-label">Pendapatan Minggu Ini</span>
                <strong className="admin-metric-value">{formatCurrency(data.thisWeek.revenue)}</strong>
                <span className="admin-metric-sub">{data.thisWeek.orders} transaksi</span>
              </div>

              <div className="admin-metric-card admin-animate-in">
                <div className="admin-metric-icon">
                  <Calendar size={20} />
                </div>
                <span className="admin-metric-label">Pendapatan Bulan Ini</span>
                <strong className="admin-metric-value">{formatCurrency(data.thisMonth.revenue)}</strong>
                <span className="admin-metric-sub">{data.thisMonth.orders} transaksi</span>
              </div>

              <div className="admin-metric-card admin-animate-in">
                <div className="admin-metric-icon">
                  <Package size={20} />
                </div>
                <span className="admin-metric-label">Total Semua Waktu</span>
                <strong className="admin-metric-value">{formatCurrency(data.totalAllTime.revenue)}</strong>
                <span className="admin-metric-sub">{data.totalAllTime.orders} transaksi</span>
              </div>
            </div>

            {/* Paper Manager + Revenue Split */}
            <div className="admin-split-grid admin-split-grid-3">
              {/* Paper Manager */}
              <PaperManager paperCount={paperCount} onUpdate={handlePaperUpdate} />

              {/* Revenue Split */}
              <div className="admin-split-card admin-animate-in">
                <p className="admin-section-tag">
                  <Wallet size={14} />
                  Pembagian Revenue Bulan Ini
                </p>
                <h3>Revenue Sharing</h3>

                <div className="admin-split-bar-container">
                  <div className="admin-split-bar">
                    <div
                      className="admin-split-bar-intechrest"
                      style={{ width: data.thisMonth.revenue > 0 ? '20%' : '0%' }}
                    />
                    <div
                      className="admin-split-bar-rukkamu"
                      style={{ width: data.thisMonth.revenue > 0 ? '80%' : '0%' }}
                    />
                  </div>
                  <div className="admin-split-legend">
                    <div className="admin-split-legend-item">
                      <span className="admin-legend-dot intechrest" />
                      <span>Intechrest (20%)</span>
                    </div>
                    <div className="admin-split-legend-item">
                      <span className="admin-legend-dot rukkamu" />
                      <span>Rukkamu (80%)</span>
                    </div>
                  </div>
                </div>

                <div className="admin-split-amounts">
                  <div className="admin-split-amount intechrest">
                    <span>Bagian Intechrest (20%)</span>
                    <strong>{formatCurrency(data.intechrestShare)}</strong>
                  </div>
                  <div className="admin-split-amount rukkamu">
                    <span>Bagian Rukkamu (80%)</span>
                    <strong>{formatCurrency(data.rukkmuShare)}</strong>
                  </div>
                </div>
              </div>

              {/* Monthly Breakdown */}
              <div className="admin-split-card admin-animate-in">
                <p className="admin-section-tag">
                  <BarChart3 size={14} />
                  Breakdown Per Bulan
                </p>
                <h3>Riwayat Tagihan Intechrest (20%)</h3>

                {data.monthlyBreakdown.length === 0 ? (
                  <div className="admin-empty" style={{ padding: '20px' }}>Belum ada data bulanan.</div>
                ) : (
                  <div style={{ marginTop: '14px' }}>
                    {data.monthlyBreakdown.map((m) => (
                      <div key={m.month} className="admin-monthly-item">
                        <span className="admin-month-label">{formatMonthLabel(m.month)}</span>
                        <div className="admin-month-bar">
                          <div
                            className="admin-month-bar-fill"
                            style={{ width: `${(m.revenue / maxMonthRevenue) * 100}%` }}
                          />
                        </div>
                        <span className="admin-month-intechrest">Tagihan: {formatCurrency(m.intechrest)}</span>
                        <div className="admin-payout-action">
                          <button
                            className={`admin-payout-badge ${m.isPaid ? 'paid' : 'unpaid'}`}
                            onClick={() => handleTogglePayout(m.month, m.isPaid)}
                          >
                            {m.isPaid ? '✓ Lunas' : 'Belum Lunas'}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Recent Transactions */}
            <div className="admin-table-card admin-animate-in">
              <p className="admin-section-tag">
                <Clock size={14} />
                Transaksi Terakhir
              </p>
              <h3>Riwayat Transaksi</h3>

              {data.recentTransactions.length === 0 ? (
                <div className="admin-empty">
                  <div className="admin-empty-icon">
                    <CreditCard size={28} />
                  </div>
                  <h4>Belum ada transaksi</h4>
                  <p>Transaksi akan muncul di sini setelah ada pembayaran yang berhasil.</p>
                </div>
              ) : (
                <div className="admin-table-wrapper">
                  <table className="admin-table">
                    <thead>
                      <tr>
                        <th>Order ID</th>
                        <th>Tanggal</th>
                        <th>Jumlah</th>
                        <th>Metode</th>
                        <th>Status</th>
                        <th>Intechrest (20%)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.recentTransactions.map((tx) => (
                        <tr key={tx.order_id}>
                          <td className="admin-tx-id">{tx.order_id}</td>
                          <td className="admin-tx-date">{formatDate(tx.created_at)}</td>
                          <td className="admin-tx-amount">{formatCurrency(tx.amount)}</td>
                          <td>{tx.payment_type || '-'}</td>
                          <td>
                            <span className={`admin-tx-status ${tx.status}`}>
                              {tx.status}
                            </span>
                          </td>
                          <td style={{ color: 'var(--admin-blue)', fontWeight: 600 }}>
                            {formatCurrency(Math.round(tx.amount * 0.2))}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Footer note */}
            <div style={{ textAlign: 'center', color: 'var(--admin-text-muted)', fontSize: '0.82rem', padding: '16px 0' }}>
              <p>
                Data di-refresh otomatis setiap 30 detik • Terakhir diperbarui:{' '}
                {lastRefresh ? lastRefresh.toLocaleTimeString('id-ID') : '-'}
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ── Root ─────────────────────────────────────────────────────────────────────
function AdminDashboard() {
  const [loggedIn, setLoggedIn] = useState(() => sessionStorage.getItem(SESSION_KEY) === '1')

  const handleLogout = () => {
    sessionStorage.removeItem(SESSION_KEY)
    setLoggedIn(false)
  }

  if (!loggedIn) {
    return <LoginScreen onLogin={() => setLoggedIn(true)} />
  }

  return <Dashboard onLogout={handleLogout} />
}

export default AdminDashboard
