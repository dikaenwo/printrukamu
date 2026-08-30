import { useEffect, useRef, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

// Use CDN worker to avoid bundler issues
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjsLib.version}/pdf.worker.min.mjs`

function PageThumb({ pdfDoc, pageNum, isSelected, isInRange, onClick }) {
  const canvasRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    async function render() {
      const page = await pdfDoc.getPage(pageNum)
      if (cancelled || !canvasRef.current) return
      const viewport = page.getViewport({ scale: 0.4 })
      const canvas = canvasRef.current
      canvas.width = viewport.width
      canvas.height = viewport.height
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise
    }
    render()
    return () => { cancelled = true }
  }, [pdfDoc, pageNum])

  return (
    <div
      onClick={() => onClick(pageNum)}
      style={{
        cursor: 'pointer',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '4px',
        padding: '6px',
        borderRadius: '8px',
        border: `2px solid ${isSelected ? 'var(--accent, #e07a5f)' : isInRange ? 'rgba(224,122,95,0.4)' : 'transparent'}`,
        background: isInRange ? 'rgba(224,122,95,0.08)' : 'transparent',
        transition: 'all 0.15s ease',
      }}
    >
      <canvas
        ref={canvasRef}
        style={{
          borderRadius: '4px',
          boxShadow: '0 1px 4px rgba(0,0,0,0.15)',
          maxWidth: '100%',
        }}
      />
      <span style={{ fontSize: '0.7rem', opacity: 0.6 }}>{pageNum}</span>
    </div>
  )
}

export default function PdfPreview({ rawFile, pageFrom, pageTo, pageRangeEnabled, onPageClick }) {
  const [pdfDoc, setPdfDoc] = useState(null)
  const [numPages, setNumPages] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!rawFile) return
    let cancelled = false
    setLoading(true)
    setPdfDoc(null)

    async function load() {
      const buffer = await rawFile.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
      if (cancelled) return
      setPdfDoc(pdf)
      setNumPages(pdf.numPages)
      setLoading(false)
    }
    load().catch(() => setLoading(false))
    return () => { cancelled = true }
  }, [rawFile])

  if (loading) return (
    <div style={{ textAlign: 'center', padding: '20px', opacity: 0.5, fontSize: '0.85rem' }}>
      Memuat preview...
    </div>
  )

  if (!pdfDoc) return null

  return (
    <div style={{
      maxHeight: '320px',
      overflowY: 'auto',
      padding: '8px',
      borderRadius: '10px',
      border: '1px solid var(--border, rgba(0,0,0,0.1))',
      background: 'var(--surface, #fafafa)',
    }}>
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(90px, 1fr))',
        gap: '8px',
      }}>
        {Array.from({ length: numPages }, (_, i) => i + 1).map(n => (
          <PageThumb
            key={n}
            pdfDoc={pdfDoc}
            pageNum={n}
            isSelected={pageRangeEnabled && (n === pageFrom || n === pageTo)}
            isInRange={pageRangeEnabled && n >= pageFrom && n <= pageTo}
            onClick={onPageClick}
          />
        ))}
      </div>
    </div>
  )
}
