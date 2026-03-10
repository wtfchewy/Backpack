import { createContext, useContext, useCallback, useRef } from 'react'

const ThemeContext = createContext(null)

export function useTheme() {
  return useContext(ThemeContext)
}

// Parse any CSS color to {r,g,b} or null
function parseColor(str) {
  if (!str || str === 'transparent' || str === 'none') return null
  if (str.includes('gradient') || str.includes('url(')) return null

  const rgbMatch = str.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (rgbMatch) return { r: +rgbMatch[1], g: +rgbMatch[2], b: +rgbMatch[3] }

  const hexMatch = str.match(/^#([0-9a-f]{3,8})$/i)
  if (hexMatch) {
    let hex = hexMatch[1]
    if (hex.length === 3) hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
    if (hex.length >= 6) {
      return {
        r: parseInt(hex.slice(0, 2), 16),
        g: parseInt(hex.slice(2, 4), 16),
        b: parseInt(hex.slice(4, 6), 16),
      }
    }
  }
  return null
}

function toHex(c) {
  const h = (n) => n.toString(16).padStart(2, '0')
  return `#${h(c.r)}${h(c.g)}${h(c.b)}`
}

function luminance({ r, g, b }) {
  const [rs, gs, bs] = [r, g, b].map((c) => {
    c = c / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

function shift({ r, g, b }, amount) {
  const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)))
  return { r: clamp(r + amount), g: clamp(g + amount), b: clamp(b + amount) }
}

// Derive a full set of CSS variable overrides from a background color
function deriveTheme(bgColor) {
  const light = luminance(bgColor) > 0.4
  const bg = toHex(bgColor)
  const fg = toHex(shift(bgColor, light ? -10 : 10))
  const border = toHex(shift(bgColor, light ? -30 : 30))
  const copy = light ? '#111111' : '#fbfbfb'
  const copyLight = light ? '#444444' : '#d0d0d0'
  const copyLighter = light ? '#777777' : '#999999'

  return {
    '--color-background': bg,
    '--color-foreground': fg,
    '--color-border': border,
    '--color-copy': copy,
    '--color-copy-light': copyLight,
    '--color-copy-lighter': copyLighter,
  }
}

// Find dominant background from a list of components
export function getDominantBackground(components) {
  const counts = {}
  for (const comp of components) {
    const bg = comp.background?.trim()
    if (!bg) continue
    const parsed = parseColor(bg)
    if (!parsed) continue
    const key = toHex(parsed)
    counts[key] = (counts[key] || 0) + 1
  }

  let best = null, bestCount = 0
  for (const [hex, count] of Object.entries(counts)) {
    if (count > bestCount) {
      best = hex
      bestCount = count
    }
  }
  if (!best) return null
  return parseColor(best)
}

const THEME_VARS = [
  '--color-background',
  '--color-foreground',
  '--color-border',
  '--color-copy',
  '--color-copy-light',
  '--color-copy-lighter',
]

export function ThemeProvider({ children }) {
  const activeRef = useRef(false)

  const applyTheme = useCallback((components) => {
    const dominant = getDominantBackground(components)
    if (!dominant) {
      clearTheme()
      return
    }
    const vars = deriveTheme(dominant)
    const root = document.documentElement
    for (const [key, value] of Object.entries(vars)) {
      root.style.setProperty(key, value)
    }
    activeRef.current = true
  }, [])

  const clearTheme = useCallback(() => {
    if (!activeRef.current) return
    const root = document.documentElement
    for (const key of THEME_VARS) {
      root.style.removeProperty(key)
    }
    activeRef.current = false
  }, [])

  return (
    <ThemeContext.Provider value={{ applyTheme, clearTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}
