import { useRef, useEffect, useState, useMemo } from 'react'

export default function ComponentPreview({ html, background, minHeight = 120, fill = false }) {
  const iframeRef = useRef(null)
  const [height, setHeight] = useState(minHeight)

  // Build the full srcdoc HTML
  const srcdoc = useMemo(() => {
    const bg = background || 'transparent'
    const bgProp = bg.includes('gradient') || bg.includes('url(') ? 'background' : 'background-color'

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
      padding: 24px;
      ${bgProp}: ${bg};
      overflow: auto;
      scrollbar-width: none;
      min-height: 100%;
    }
    body::-webkit-scrollbar {
      display: none;
    }
    body > *:not(style):not(link) {
      max-width: 100%;
    }
  </style>
</head>
<body>${bodyContent}</body>
</html>`
  }, [html, background])

  useEffect(() => {
    if (fill) return
    const iframe = iframeRef.current
    if (!iframe) return

    function resize() {
      try {
        const doc = iframe.contentDocument
        if (!doc || !doc.body) return
        const h = Math.max(doc.body.scrollHeight, minHeight)
        setHeight(h)
      } catch { /* cross-origin */ }
    }

    iframe.addEventListener('load', resize)
    const t1 = setTimeout(resize, 300)
    const t2 = setTimeout(resize, 1000)
    const t3 = setTimeout(resize, 2000)

    return () => {
      iframe.removeEventListener('load', resize)
      clearTimeout(t1)
      clearTimeout(t2)
      clearTimeout(t3)
    }
  }, [srcdoc, minHeight, fill])

  return (
    <iframe
      ref={iframeRef}
      srcDoc={srcdoc}
      title="Component preview"
      className="w-full border-none bg-transparent"
      style={fill
        ? { width: '100%', height: '100%', display: 'block' }
        : { height: `${height}px`, minHeight: `${minHeight}px` }
      }
    />
  )
}
