import { useState, useEffect, useRef, useCallback } from 'react'
import { Copy, Check, Code, Trash2, ExternalLink, GripVertical, Download, MousePointerClick, PackagePlus, Chrome } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext'
import { getAllComponents, getPacks, deleteComponent } from '../store'
import ComponentPreview from '../components/ComponentPreview'

const GAP = 32
const FALLBACK_W = 360
const FALLBACK_H = 240
const PREVIEW_PAD = 48 // matches 24px padding top+bottom in iframe body
const MIN_ZOOM = 0.1
const MAX_ZOOM = 3

// Row-packing layout for variable-sized cards
function layoutCards(components, maxRowWidth) {
  const positions = []
  let x = GAP
  let y = GAP
  let rowHeight = 0

  for (const comp of components) {
    const w = comp.capturedWidth || FALLBACK_W
    const h = (comp.capturedHeight || FALLBACK_H) + PREVIEW_PAD

    if (x + w > maxRowWidth && x > GAP) {
      x = GAP
      y += rowHeight + GAP
      rowHeight = 0
    }

    positions.push({ id: comp.id, x, y, w, h })
    rowHeight = Math.max(rowHeight, h)
    x += w + GAP
  }

  return positions
}

export default function Canvas({ filterPack, filterSite }) {
  const { user } = useAuth()
  const [components, setComponents] = useState([])
  const [packs, setPacks] = useState([])
  const [loading, setLoading] = useState(true)

  // Per-component position overrides from dragging
  const [cardPositions, setCardPositions] = useState({})

  // Canvas pan + zoom state
  const canvasRef = useRef(null)
  const [offset, setOffset] = useState({ x: 0, y: 0 })
  const [zoom, setZoom] = useState(1)
  const offsetRef = useRef(offset)
  const zoomRef = useRef(zoom)
  offsetRef.current = offset
  zoomRef.current = zoom
  const [panning, setPanning] = useState(false)
  const panStart = useRef({ x: 0, y: 0, ox: 0, oy: 0 })

  // Card drag state
  const [dragId, setDragId] = useState(null)
  const cardDragStart = useRef({ x: 0, y: 0, cx: 0, cy: 0 })

  async function load() {
    const [c, p] = await Promise.all([
      getAllComponents(user.uid),
      getPacks(user.uid),
    ])
    setComponents(c)
    setPacks(p)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [user])

  // Filter
  const filtered = components.filter((comp) => {
    if (filterPack && comp.packId !== filterPack) return false
    if (filterSite) {
      try {
        const host = new URL(comp.sourceUrl || '').hostname
        if (host !== filterSite) return false
      } catch {
        return false
      }
    }
    return true
  })

  // Base layout
  const basePositions = layoutCards(filtered, Math.max(window.innerWidth * 3, 4000))

  // Merge base with overrides
  const resolvedPositions = basePositions.map((pos) => {
    const override = cardPositions[pos.id]
    if (override) return { ...pos, x: override.x, y: override.y }
    return pos
  })

  // Canvas pan handlers
  const onPointerDown = useCallback((e) => {
    if (e.target !== canvasRef.current && !e.target.classList.contains('canvas-bg')) return
    setPanning(true)
    panStart.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
    canvasRef.current.setPointerCapture(e.pointerId)
  }, [offset])

  const onPointerMove = useCallback((e) => {
    if (panning) {
      const dx = e.clientX - panStart.current.x
      const dy = e.clientY - panStart.current.y
      setOffset({ x: panStart.current.ox + dx, y: panStart.current.oy + dy })
    } else if (dragId) {
      const dx = (e.clientX - cardDragStart.current.x) / zoom
      const dy = (e.clientY - cardDragStart.current.y) / zoom
      setCardPositions((prev) => ({
        ...prev,
        [dragId]: {
          x: cardDragStart.current.cx + dx,
          y: cardDragStart.current.cy + dy,
        },
      }))
    }
  }, [panning, dragId, zoom])

  const onPointerUp = useCallback(() => {
    setPanning(false)
    setDragId(null)
  }, [])

  // Card drag start
  const onCardDragStart = useCallback((e, compId, currentX, currentY) => {
    e.stopPropagation()
    setDragId(compId)
    cardDragStart.current = { x: e.clientX, y: e.clientY, cx: currentX, cy: currentY }
    canvasRef.current.setPointerCapture(e.pointerId)
  }, [])

  // Zoom towards cursor — works with trackpad pinch and scroll wheel
  useEffect(() => {
    function handleWheel(e) {
      // Only zoom when canvas is mounted
      if (!canvasRef.current) return
      e.preventDefault()

      const cx = e.clientX
      const cy = e.clientY

      // ctrlKey is set by trackpad pinch gestures
      const factor = e.ctrlKey ? 0.01 : 0.002
      const scale = Math.pow(2, -e.deltaY * factor)

      const prev = zoomRef.current
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, prev * scale))
      const ratio = next / prev

      const o = offsetRef.current
      setOffset({
        x: cx - ratio * (cx - o.x),
        y: cy - ratio * (cy - o.y),
      })
      setZoom(next)
    }

    window.addEventListener('wheel', handleWheel, { passive: false })
    return () => window.removeEventListener('wheel', handleWheel)
  }, [])

  async function handleDelete(compId) {
    await deleteComponent(user.uid, compId)
    setCardPositions((prev) => {
      const next = { ...prev }
      delete next[compId]
      return next
    })
    load()
  }

  // Pack lookup
  const packMap = {}
  packs.forEach((p) => { packMap[p.id] = p })

  if (loading) {
    return (
      <div className="fixed inset-0 flex items-center justify-center bg-background">
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const isDraggingCard = dragId !== null

  return (
    <div
      ref={canvasRef}
      className="canvas-bg fixed inset-0 overflow-hidden"
      style={{ cursor: panning || isDraggingCard ? 'grabbing' : 'default' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      {/* Dot grid background */}
      <div
        className="canvas-bg absolute inset-0 pointer-events-none"
        style={{
          backgroundImage: 'radial-gradient(circle, var(--color-border) 1px, transparent 1px)',
          backgroundSize: `${32 * zoom}px ${32 * zoom}px`,
          backgroundPosition: `${offset.x % (32 * zoom)}px ${offset.y % (32 * zoom)}px`,
          opacity: 0.5,
        }}
      />

      {/* Transformed canvas content */}
      <div
        className="canvas-bg absolute"
        style={{
          transform: `translate(${offset.x}px, ${offset.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          willChange: 'transform',
        }}
      >
        {filtered.length === 0 ? (
          <div
            className="absolute flex flex-col items-center text-center"
            style={{ left: 'calc(50vw - 180px)', top: 'calc(50vh - 180px)', width: 360 }}
          >
            <div className="flex items-center gap-2.5 mb-2">
              <img src="/logo.svg" alt="" className="w-10 h-10" />
              <span className="text-3xl font-bold tracking-tight font-display text-copy">Backpack</span>
            </div>
            <p className="text-copy-lighter text-[13px] mb-8">
              {filterPack || filterSite
                ? 'No components match this filter'
                : 'Get started in 3 easy steps'}
            </p>

            {!filterPack && !filterSite && (
              <div className="w-full flex flex-col gap-3 text-left">
                <a
                  href="https://chromewebstore.google.com/detail/backpack/epeogfhiemohndkcagldkgechfjfbfhj"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-4 p-4 rounded-xl bg-primary hover:bg-primary/80 transition-colors no-underline group"
                >
                  <div className="w-9 h-9 rounded-lg bg-primary-content/10 flex items-center justify-center shrink-0 mt-0.5">
                    <Chrome size={18} className="text-primary-content" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="text-[13px] font-semibold text-primary-content">Install the Chrome Extension</p>
                      <ExternalLink size={11} className="text-primary-content opacity-0 group-hover:opacity-100 transition-opacity" />
                    </div>
                    <p className="text-[11px] text-primary-content mt-0.5 leading-relaxed">
                      Add Backpack to Chrome from the Web Store
                    </p>
                  </div>
                </a>

                <div className="flex items-start gap-4 p-4 rounded-xl bg-foreground/80 border border-border">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <PackagePlus size={18} className="text-primary" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-copy">Create a Pack</p>
                    <p className="text-[11px] text-copy-lighter mt-0.5 leading-relaxed">
                      Open the extension and create a pack to organize your components
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-4 p-4 rounded-xl bg-foreground/80 border border-border">
                  <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                    <MousePointerClick size={18} className="text-primary" />
                  </div>
                  <div>
                    <p className="text-[13px] font-semibold text-copy">Pick Components</p>
                    <p className="text-[11px] text-copy-lighter mt-0.5 leading-relaxed">
                      Click "Pick Component" on any website and select elements to save
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : (
          resolvedPositions.map((pos, i) => {
            const comp = filtered[i]
            const cardW = comp.capturedWidth || FALLBACK_W
            const cardH = (comp.capturedHeight || FALLBACK_H) + PREVIEW_PAD

            return (
              <ComponentCard
                key={comp.id}
                component={comp}
                pack={packMap[comp.packId]}
                x={pos.x}
                y={pos.y}
                width={cardW}
                previewHeight={cardH}
                isDragging={dragId === comp.id}
                onDragStart={(e) => onCardDragStart(e, comp.id, pos.x, pos.y)}
                onDelete={() => handleDelete(comp.id)}
              />
            )
          })
        )}
      </div>

    </div>
  )
}

function ComponentCard({ component, pack, x, y, width, previewHeight, isDragging, onDragStart, onDelete }) {
  const [copied, setCopied] = useState(false)
  const [showCode, setShowCode] = useState(false)
  const [hovered, setHovered] = useState(false)

  function handleCopy(e) {
    e.stopPropagation()
    navigator.clipboard.writeText(component.html)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  let hostname = ''
  try {
    hostname = new URL(component.sourceUrl || '').hostname.replace('www.', '')
  } catch { /* */ }

  return (
    <div
      style={{
        position: 'absolute',
        left: x,
        top: y,
        width,
        zIndex: isDragging ? 100 : hovered ? 50 : 1,
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => { setHovered(false); setShowCode(false) }}
    >
      <div
        className={`relative rounded-2xl overflow-hidden border bg-foreground transition-all duration-200 ${isDragging
          ? 'border-primary/50 shadow-2xl shadow-primary/10 scale-[1.02]'
          : 'border-border shadow-lg shadow-black/20 hover:border-copy-lighter/30 hover:shadow-xl hover:shadow-black/30'
          }`}
      >
        {/* Drag handle — top-left corner, only visible on hover */}
        <div
          onPointerDown={onDragStart}
          className={`absolute top-2 left-2 z-20 p-1 rounded-lg bg-black/40 backdrop-blur-sm border border-white/10 transition-opacity duration-150 ${hovered && !isDragging ? 'opacity-100' : isDragging ? 'opacity-100' : 'opacity-0'
            }`}
          style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
        >
          <GripVertical size={14} className="text-white/80" />
        </div>

        {/* Preview at captured size — interactive */}
        <div className="relative overflow-hidden rounded-2xl" style={{ height: previewHeight }}>
          <ComponentPreview html={component.html} background={component.background} minHeight={0} fill />
        </div>
      </div>

      {/* Info bar — extends below the card on hover */}
      <div
        className="overflow-hidden transition-all duration-200 ease-out"
        style={{
          maxHeight: hovered ? 200 : 0,
          opacity: hovered ? 1 : 0,
        }}
      >
        <div className="mt-1 rounded-xl border border-border bg-foreground/95 backdrop-blur-md shadow-lg shadow-black/20 px-4 py-3">
          <div className="flex items-center justify-between">
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-copy truncate">
                {component.name || component.tagName}
              </p>
              <div className="flex items-center gap-2 mt-0.5">
                {pack && (
                  <span className="text-[11px] text-copy-lighter font-medium">{pack.name}</span>
                )}
                {pack && hostname && <span className="text-[11px] text-copy-lighter/50">·</span>}
                {hostname && (
                  <span className="text-[11px] text-copy-lighter">{hostname}</span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-0.5">
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setShowCode(!showCode)
                }}
                className={`p-1.5 rounded-lg cursor-pointer border-none transition-colors ${showCode ? 'bg-primary/10 text-primary' : 'bg-transparent text-copy-lighter hover:text-copy'
                  }`}
              >
                <Code size={14} />
              </button>
              <button
                onClick={handleCopy}
                className="p-1.5 rounded-lg text-copy-lighter hover:text-copy cursor-pointer bg-transparent border-none transition-colors"
              >
                {copied ? <Check size={14} className="text-primary" /> : <Copy size={14} />}
              </button>
              {component.sourceUrl && (
                <a
                  href={component.sourceUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1.5 rounded-lg text-copy-lighter hover:text-copy transition-colors"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink size={14} />
                </a>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete()
                }}
                className="p-1.5 rounded-lg text-copy-lighter hover:text-error cursor-pointer bg-transparent border-none transition-colors"
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>

          {/* Code panel */}
          {showCode && (
            <div className="mt-2 pt-2 border-t border-border max-h-48 overflow-auto">
              <pre className="text-[11px] text-copy-light font-mono m-0 whitespace-pre-wrap break-all">
                <code>{component.html}</code>
              </pre>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
