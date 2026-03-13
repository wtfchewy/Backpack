import { useRef, useEffect, useState, useMemo, useCallback } from 'react'

export default function ComponentPreview({ html, background, capturedWidth, minHeight = 120 }) {
  const iframeRef = useRef(null)
  const containerRef = useRef(null)
  const [height, setHeight] = useState(minHeight)
  const [containerWidth, setContainerWidth] = useState(0)
  const [iframeScrollHeight, setIframeScrollHeight] = useState(0)

  // Parse background — may be a JSON string (from Firestore serialization), object, or plain string
  const parsedBackground = useMemo(() => {
    if (!background || typeof background !== 'string') return background
    try { return JSON.parse(background) } catch { return background }
  }, [background])

  // Build background CSS from string or structured object
  const bgStyles = useMemo(() => {
    if (!parsedBackground || parsedBackground === 'transparent') return 'background-color: transparent;'
    // Structured background object (new format)
    if (typeof parsedBackground === 'object') {
      const parts = []
      if (parsedBackground.backgroundColor) parts.push(`background-color: ${parsedBackground.backgroundColor}`)
      if (parsedBackground.backgroundImage) parts.push(`background-image: ${parsedBackground.backgroundImage}`)
      if (parsedBackground.backgroundSize) parts.push(`background-size: ${parsedBackground.backgroundSize}`)
      if (parsedBackground.backgroundPosition) parts.push(`background-position: ${parsedBackground.backgroundPosition}`)
      if (parsedBackground.backgroundRepeat) parts.push(`background-repeat: ${parsedBackground.backgroundRepeat}`)
      if (parsedBackground.backdropFilter) {
        parts.push(`backdrop-filter: ${parsedBackground.backdropFilter}`)
        parts.push(`-webkit-backdrop-filter: ${parsedBackground.backdropFilter}`)
      }
      return parts.join(';\n      ') + ';'
    }
    // Legacy string format
    const bgProp = parsedBackground.includes('gradient') || parsedBackground.includes('url(') ? 'background' : 'background-color'
    return `${bgProp}: ${parsedBackground};`
  }, [parsedBackground])

  // Build the full srcdoc HTML
  const srcdoc = useMemo(() => {
    const content = html || ''
    const linkTags = []
    const bodyContent = content.replace(/<link\s+[^>]*>/gi, (match) => {
      linkTags.push(match)
      return ''
    })

    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${linkTags.join('\n  ')}
  <style>
    html {
      scrollbar-width: none;
    }
    html::-webkit-scrollbar {
      display: none;
    }
    body {
      margin: 0;
      overflow: auto;
      scrollbar-width: none;
      ${bgStyles}
    }
    body::-webkit-scrollbar {
      display: none;
    }
  </style>
</head>
<body><div style="padding: 24px">${bodyContent}</div>
<script>
  // Strip all navigation: links, buttons with formaction, form submits
  document.addEventListener('click', function(e) {
    var el = e.target.closest('a[href], button[formaction], [onclick]');
    if (el) { e.preventDefault(); e.stopPropagation(); }
  }, true);
  document.addEventListener('submit', function(e) {
    e.preventDefault();
  }, true);
  // Remove href attributes so middle-click / right-click-open also can't navigate
  document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('a[href]').forEach(function(a) {
      a.removeAttribute('href');
      a.style.cursor = 'default';
    });
  });
</script>
</body>
</html>`
  }, [html, bgStyles])

  // Observe container width for scaling
  useEffect(() => {
    if (!capturedWidth || !containerRef.current) return
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width)
      }
    })
    ro.observe(containerRef.current)
    return () => ro.disconnect()
  }, [capturedWidth])

  // Resize iframe height
  const measureIframe = useCallback(() => {
    const iframe = iframeRef.current
    if (!iframe) return
    try {
      const doc = iframe.contentDocument
      if (!doc || !doc.body) return
      const wrapper = doc.body.firstElementChild
      const h = wrapper ? Math.ceil(wrapper.getBoundingClientRect().height) : doc.body.scrollHeight
      setIframeScrollHeight(h)
      if (!capturedWidth) {
        setHeight(Math.max(h, minHeight))
      }
    } catch { /* cross-origin */ }
  }, [capturedWidth, minHeight])

  useEffect(() => {
    if (!capturedWidth) return
    const iframe = iframeRef.current
    if (!iframe) return

    iframe.addEventListener('load', measureIframe)
    const t1 = setTimeout(measureIframe, 300)
    const t2 = setTimeout(measureIframe, 1000)
    const t3 = setTimeout(measureIframe, 2000)

    return () => {
      iframe.removeEventListener('load', measureIframe)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [srcdoc, capturedWidth, measureIframe])

  // Fixed-width scaling: render iframe at captured width + padding, scale to fit container
  // The iframe body has 24px padding on all sides, so the iframe must be 48px wider
  // than capturedWidth so the content area inside the padding matches the original width.
  if (capturedWidth && containerWidth > 0) {
    const iframePad = 48 // 24px padding × 2 sides
    const iframeWidth = capturedWidth + iframePad
    const scale = Math.min(containerWidth / iframeWidth, 1)
    const scaledHeight = iframeScrollHeight * scale

    return (
      <div
        ref={containerRef}
        style={{
          width: '100%',
          height: `${Math.max(scaledHeight, minHeight)}px`,
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <iframe
          ref={iframeRef}
          srcDoc={srcdoc}
          sandbox="allow-same-origin allow-scripts"
          title="Component preview"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: `${iframeWidth}px`,
            height: iframeScrollHeight ? `${iframeScrollHeight}px` : '100000px',
            border: 'none',
            background: 'transparent',
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            display: 'block',
          }}
        />
      </div>
    )
  }

  // Fallback: no capturedWidth (legacy components) or container not measured yet
  return (
    <div ref={containerRef} style={{ width: '100%' }}>
      <iframe
        ref={iframeRef}
        srcDoc={srcdoc}
        sandbox="allow-same-origin allow-scripts"
        title="Component preview"
        className="w-full border-none bg-transparent"
        style={{ height: `${height}px`, minHeight: `${minHeight}px` }}
      />
    </div>
  )
}
