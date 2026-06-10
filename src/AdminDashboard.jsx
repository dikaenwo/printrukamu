import { useState, useEffect, useCallback } from 'react'
import {
  ArrowLeft,
  BarChart3,
  Calendar,
  CircleDollarSign,
  Clock,
  CreditCard,
  FileText,
  Loader2,
  Package,
  RefreshCw,
  TrendingUp,
  Wallet,
} from 'lucide-react'
import './AdminDashboard.css'

const API_BASE_URL = ''
const REFRESH_INTERVAL = 30000 // 30 detik

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

function AdminDashboard() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [lastRefresh, setLastRefresh] = useState(null)

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

  useEffect(() => {
    fetchAnalytics(true)
    const interval = setInterval(() => fetchAnalytics(false), REFRESH_INTERVAL)
    return () => clearInterval(interval)
  }, [fetchAnalytics])

  const goToKiosk = () => {
    window.location.hash = ''
  }

  // Max revenue across months for bar scaling
  const maxMonthRevenue = data?.monthlyBreakdown?.length
    ? Math.max(...data.monthlyBreakdown.map((m) => m.revenue))
    : 1

  return (
    <div className="admin-shell">
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

            {/* Revenue Split Panel */}
            <div className="admin-split-grid">
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
                <h3>Riwayat Bulanan</h3>

                {data.monthlyBreakdown.length === 0 ? (
                  <div className="admin-empty">
                    <div className="admin-empty-icon">
                      <FileText size={28} />
                    </div>
                    <h4>Belum ada data</h4>
                    <p>Data bulanan akan muncul setelah ada transaksi.</p>
                  </div>
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
                        <span className="admin-month-revenue">{formatCurrency(m.revenue)}</span>
                        <span className="admin-month-intechrest">IT: {formatCurrency(m.intechrest)}</span>
                        <span className="admin-month-orders">{m.orders} order</span>
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

export default AdminDashboard
