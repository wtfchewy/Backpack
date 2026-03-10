if (!window.__backpackInjected) {
  window.__backpackInjected = true;

  let isPickerActive = false;
  let currentTarget = null;
  let overlay = null;
  let depthLocked = false;
  let hoverTarget = null;
  let packDropdown = null;
  let isShowingDropdown = false;

  // ─── URL Resolution ───────────────────────────────────────────────

  function resolveRelativeURLs(clone) {
    const base = window.location.origin;
    const resolveAttr = (el, attr) => {
      const val = el.getAttribute(attr);
      if (val && !val.startsWith('http') && !val.startsWith('data:') && !val.startsWith('blob:') && !val.startsWith('#') && !val.startsWith('mailto:') && !val.startsWith('tel:')) {
        try { el.setAttribute(attr, new URL(val, base).href); } catch {}
      }
    };

    // src, href, poster on root + descendants
    [clone, ...clone.querySelectorAll('*')].forEach((el) => {
      if (el.hasAttribute) {
        if (el.hasAttribute('src')) resolveAttr(el, 'src');
        if (el.hasAttribute('href')) resolveAttr(el, 'href');
        if (el.hasAttribute('poster')) resolveAttr(el, 'poster');
      }
    });

    // srcset
    clone.querySelectorAll('[srcset]').forEach((el) => {
      const srcset = el.getAttribute('srcset');
      if (srcset) {
        el.setAttribute('srcset', srcset.split(',').map((entry) => {
          const parts = entry.trim().split(/\s+/);
          if (parts[0] && !parts[0].startsWith('http') && !parts[0].startsWith('data:')) {
            try { parts[0] = new URL(parts[0], base).href; } catch {}
          }
          return parts.join(' ');
        }).join(', '));
      }
    });

    // inline style url()
    [clone, ...clone.querySelectorAll('[style]')].forEach((el) => {
      if (!el.hasAttribute || !el.hasAttribute('style')) return;
      const style = el.getAttribute('style');
      if (style && style.includes('url(')) {
        el.setAttribute('style', resolveURLsInCSS(style, base));
      }
    });
  }

  function resolveURLsInCSS(css, base) {
    if (!base) base = window.location.origin;
    return css.replace(/url\(\s*['"]?([^'")]+)['"]?\s*\)/g, (match, url) => {
      if (url && !url.startsWith('http') && !url.startsWith('data:') && !url.startsWith('blob:') && !url.startsWith('#')) {
        try { return `url("${new URL(url, base).href}")`; } catch {}
      }
      return match;
    });
  }

  // ─── Clean HTML ───────────────────────────────────────────────────

  function getCleanHTML(el) {
    const clone = el.cloneNode(true);
    clone.classList.remove('__backpack-highlight');
    clone.removeAttribute('data-backpack-tag');
    resolveRelativeURLs(clone);
    return clone.outerHTML;
  }

  // ─── Styles JSON (summary for metadata) ───────────────────────────

  function getComputedStylesJSON(el) {
    const computed = window.getComputedStyle(el);
    const styles = {};
    const keep = [
      'color', 'backgroundColor', 'fontSize', 'fontWeight', 'fontFamily',
      'padding', 'margin', 'borderRadius', 'border', 'display',
      'width', 'height', 'maxWidth', 'minHeight', 'textAlign',
      'lineHeight', 'letterSpacing', 'boxShadow', 'position'
    ];
    keep.forEach((prop) => {
      const val = computed.getPropertyValue(prop.replace(/([A-Z])/g, '-$1').toLowerCase());
      if (val && val !== 'none' && val !== 'normal' && val !== '0px' && val !== 'auto' && val !== 'static') {
        styles[prop] = val;
      }
    });
    return JSON.stringify(styles);
  }

  // ─── Smart Component Detection ────────────────────────────────────

  // Score an element on how likely it is to be a "component boundary"
  function componentScore(el) {
    if (!el || el === document.body || el === document.documentElement) return -1;

    let score = 0;
    const tag = el.tagName.toLowerCase();
    const computed = window.getComputedStyle(el);
    const display = computed.display;
    const childCount = el.children.length;
    const rect = el.getBoundingClientRect();

    // Semantic component containers
    if (['article', 'section', 'aside', 'nav', 'main', 'header', 'footer', 'figure'].includes(tag)) {
      score += 10;
    }

    // Interactive wrappers with content inside (cards)
    if ((tag === 'a' || tag === 'button') && childCount > 0) {
      score += 15;
    }

    // Has multiple children — likely a layout component, not a leaf
    if (childCount >= 2) score += 8;
    if (childCount >= 3) score += 4;

    // Flex/grid containers — layout components
    if (display === 'flex' || display === 'inline-flex') score += 6;
    if (display === 'grid' || display === 'inline-grid') score += 6;

    // Has visual boundaries — background, shadow, border, border-radius
    const bg = computed.backgroundColor;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') score += 5;
    if (computed.backgroundImage && computed.backgroundImage !== 'none') score += 5;
    if (computed.boxShadow && computed.boxShadow !== 'none') score += 6;
    const border = computed.borderWidth;
    if (border && border !== '0px') score += 4;
    const radius = computed.borderRadius;
    if (radius && radius !== '0px') score += 4;

    // Has meaningful content area (not tiny, not page-width)
    const viewW = window.innerWidth;
    if (rect.width > 100 && rect.width < viewW * 0.9) score += 5;
    if (rect.height > 60 && rect.height < window.innerHeight * 0.85) score += 5;

    // Is a direct child of a grid/flex parent — likely a card in a grid
    if (el.parentElement) {
      const parentDisplay = window.getComputedStyle(el.parentElement).display;
      if (parentDisplay === 'grid' || parentDisplay === 'inline-grid') score += 8;
      if (parentDisplay === 'flex' || parentDisplay === 'inline-flex') score += 4;
    }

    // Has overflow hidden — self-contained visual boundary
    if (computed.overflow === 'hidden' || computed.overflowX === 'hidden' || computed.overflowY === 'hidden') {
      score += 3;
    }

    // Penalty for being too large (page sections, full-width wrappers)
    if (rect.width >= viewW * 0.95) score -= 8;
    if (rect.height >= window.innerHeight * 0.9) score -= 10;

    // Penalty for leaf nodes with no children
    if (childCount === 0) score -= 10;

    // Penalty for generic wrapper divs with only one child and no visual styles
    if (tag === 'div' && childCount === 1 && bg === 'rgba(0, 0, 0, 0)' &&
        (!computed.boxShadow || computed.boxShadow === 'none') &&
        (!border || border === '0px')) {
      score -= 3;
    }

    return score;
  }

  // Walk from a leaf element up and find the best "component" ancestor
  function findComponent(leaf) {
    if (!leaf || leaf === document.body || leaf === document.documentElement) return leaf;

    let best = leaf;
    let bestScore = componentScore(leaf);
    let el = leaf.parentElement;
    let depth = 0;
    const maxDepth = 8; // don't walk too far up

    while (el && el !== document.body && el !== document.documentElement && depth < maxDepth) {
      const score = componentScore(el);
      if (score > bestScore) {
        best = el;
        bestScore = score;
      }
      // If we hit a very high-scoring element, stop — we found the component
      if (score >= 25) break;
      el = el.parentElement;
      depth++;
    }

    return best;
  }

  // ─── Background Detection ─────────────────────────────────────────

  // Check if a background value is "solid" — not transparent or fading to transparent
  function isSolidBackground(value) {
    if (!value) return false;
    // Skip gradients that contain transparent or rgba with 0 alpha
    if (value.includes('transparent')) return false;
    if (/rgba\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*,\s*0\s*\)/.test(value)) return false;
    // Skip gradients where one end fades to 0 opacity
    if (value.includes('gradient') && /,\s*(?:transparent|rgba\([^)]*,\s*0\s*\))/.test(value)) return false;
    return true;
  }

  function findBackground(el) {
    let walker = el;

    while (walker) {
      const computed = window.getComputedStyle(walker);

      // Check background-color first — most reliable
      const bgColor = computed.backgroundColor;
      if (bgColor && bgColor !== 'rgba(0, 0, 0, 0)' && bgColor !== 'transparent') {
        // Also check if there's a solid gradient on top
        const bgImage = computed.backgroundImage;
        if (bgImage && bgImage !== 'none' && isSolidBackground(bgImage)) {
          return resolveURLsInCSS(bgImage);
        }
        return bgColor;
      }

      // Check for solid background-image (actual images, not fade-to-transparent gradients)
      const bgImage = computed.backgroundImage;
      if (bgImage && bgImage !== 'none' && isSolidBackground(bgImage)) {
        return resolveURLsInCSS(bgImage);
      }

      walker = walker.parentElement;
    }

    // Fallback: page background
    const bodyBg = window.getComputedStyle(document.body).backgroundColor;
    if (bodyBg && bodyBg !== 'rgba(0, 0, 0, 0)' && bodyBg !== 'transparent') return bodyBg;
    return '#ffffff';
  }

  // ─── CSS Extraction ───────────────────────────────────────────────

  function collectElements(el) {
    return [el, ...el.querySelectorAll('*')];
  }

  function selectorMatchesAny(selector, elements) {
    try {
      for (const el of elements) {
        if (el.matches && el.matches(selector)) return true;
      }
    } catch {}
    return false;
  }

  function getBaseSelector(selector) {
    return selector
      .replace(/::[\w-]+(\([^)]*\))?/g, '')
      .replace(/:(?:hover|focus|active|focus-within|focus-visible|visited|checked|disabled|enabled|first-child|last-child|nth-child\([^)]*\)|nth-of-type\([^)]*\))(?![a-zA-Z-])/g, '')
      .trim();
  }

  // Inline computed styles onto a cloned element tree as a fallback
  // when CSS rule extraction fails to capture meaningful styles
  function inlineComputedStyles(clone, liveEl) {
    const PROPS = [
      'display', 'flex-direction', 'align-items', 'justify-content', 'gap',
      'flex', 'flex-grow', 'flex-shrink', 'flex-basis', 'flex-wrap',
      'grid-template-columns', 'grid-template-rows', 'grid-column', 'grid-row',
      'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
      'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
      'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
      'background', 'background-color', 'background-image',
      'color', 'font-family', 'font-size', 'font-weight', 'font-style',
      'text-align', 'text-decoration', 'text-transform', 'line-height', 'letter-spacing',
      'white-space', 'word-break', 'overflow', 'overflow-x', 'overflow-y',
      'border', 'border-radius', 'border-top', 'border-right', 'border-bottom', 'border-left',
      'box-shadow', 'opacity', 'z-index', 'position',
      'top', 'right', 'bottom', 'left',
      'transform', 'transition',
      'cursor', 'pointer-events', 'list-style', 'vertical-align',
      'object-fit', 'aspect-ratio', 'isolation',
    ];
    const DEFAULTS = {
      'display': 'block', 'flex-direction': 'row', 'align-items': 'normal',
      'justify-content': 'normal', 'gap': 'normal', 'flex': '0 1 auto',
      'flex-grow': '0', 'flex-shrink': '1', 'flex-basis': 'auto', 'flex-wrap': 'nowrap',
      'width': 'auto', 'height': 'auto', 'min-width': 'auto', 'min-height': 'auto',
      'max-width': 'none', 'max-height': 'none',
      'padding': '0px', 'margin': '0px',
      'background-color': 'rgba(0, 0, 0, 0)', 'background-image': 'none',
      'color': 'rgb(0, 0, 0)',
      'font-weight': '400', 'font-style': 'normal',
      'text-align': 'start', 'text-decoration': 'none solid rgb(0, 0, 0)',
      'text-transform': 'none', 'line-height': 'normal', 'letter-spacing': 'normal',
      'white-space': 'normal', 'word-break': 'normal',
      'overflow': 'visible', 'overflow-x': 'visible', 'overflow-y': 'visible',
      'border-radius': '0px', 'box-shadow': 'none', 'opacity': '1',
      'z-index': 'auto', 'position': 'static',
      'top': 'auto', 'right': 'auto', 'bottom': 'auto', 'left': 'auto',
      'transform': 'none', 'transition': 'all 0s ease 0s',
      'cursor': 'auto', 'pointer-events': 'auto', 'list-style': 'outside none disc',
      'vertical-align': 'baseline', 'object-fit': 'fill', 'isolation': 'auto',
    };

    const liveElements = [liveEl, ...liveEl.querySelectorAll('*')];
    const cloneElements = [clone, ...clone.querySelectorAll('*')];

    for (let i = 0; i < liveElements.length && i < cloneElements.length; i++) {
      const computed = window.getComputedStyle(liveElements[i]);
      const parts = [];
      for (const prop of PROPS) {
        const val = computed.getPropertyValue(prop);
        if (!val) continue;
        // Skip defaults to keep output compact
        const def = DEFAULTS[prop];
        if (def && val === def) continue;
        // Skip shorthand padding/margin if all sides are 0px
        if ((prop === 'padding' || prop === 'margin') && val === '0px') continue;
        // Skip border if none
        if (prop === 'border' && (val === '' || val.includes('none'))) continue;
        if (prop === 'background' && val.includes('rgba(0, 0, 0, 0)') && !val.includes('url') && !val.includes('gradient')) continue;
        parts.push(`${prop}: ${val}`);
      }
      if (parts.length > 0) {
        const existing = cloneElements[i].getAttribute('style') || '';
        cloneElements[i].setAttribute('style', parts.join('; ') + '; ' + existing);
      }
    }
  }

  function extractMatchingCSS(el) {
    const elements = collectElements(el);
    const matchedRules = [];
    const fontFaceRules = [];
    const keyframeRules = [];
    const cssVars = new Set();
    const usedFontFamilies = new Set();

    // Debug counters
    let _dbgStyleRules = 0;
    let _dbgTestedSelectors = 0;
    let _dbgMatchedSelectors = 0;
    let _dbgErrors = 0;
    let _dbgSheetErrors = 0;
    const _dbgRuleTypes = {};
    const _dbgSampleSelectors = [];

    for (const element of elements) {
      const ff = window.getComputedStyle(element).getPropertyValue('font-family');
      if (ff) ff.split(',').forEach(f => {
        const clean = f.trim().replace(/['"]/g, '').toLowerCase();
        usedFontFamilies.add(clean);
      });
    }

    function processRules(rules) {
      if (!rules) return;
      for (const rule of rules) {
        // Track rule types
        _dbgRuleTypes[rule.type] = (_dbgRuleTypes[rule.type] || 0) + 1;

        if (rule.type === CSSRule.STYLE_RULE) {
          _dbgStyleRules++;
          const selectors = rule.selectorText.split(',').map(s => s.trim());

          // Always include :root, html, body, * rules — they provide inherited styles & variables
          const inheritedSelectors = [':root', 'html', 'body', '*'];
          const isInherited = selectors.some(sel => {
            const base = getBaseSelector(sel).trim();
            return inheritedSelectors.includes(base);
          });

          const matching = isInherited ? selectors : selectors.filter(sel => {
            _dbgTestedSelectors++;
            const base = getBaseSelector(sel);
            if (!base) return false;
            try {
              const matched = selectorMatchesAny(base, elements);
              if (matched) _dbgMatchedSelectors++;
              if (_dbgSampleSelectors.length < 20 && _dbgStyleRules <= 30) {
                _dbgSampleSelectors.push({ sel, base, matched });
              }
              return matched;
            } catch (e) {
              _dbgErrors++;
              return false;
            }
          });
          if (matching.length > 0) {
            matchedRules.push(`${matching.join(', ')} { ${rule.style.cssText} }`);
            const text = rule.style.cssText;
            for (const m of text.matchAll(/var\((--[\w-]+)/g)) cssVars.add(m[1]);
          }
        } else if (rule.type === CSSRule.FONT_FACE_RULE) {
          const ff = rule.style.getPropertyValue('font-family').replace(/['"]/g, '').toLowerCase().trim();
          if (!ff) continue; // Skip malformed @font-face without font-family
          if (usedFontFamilies.has(ff)) fontFaceRules.push(rule.cssText);
        } else if (rule.type === CSSRule.KEYFRAMES_RULE) {
          keyframeRules.push(rule.cssText);
        } else if (rule.type === CSSRule.MEDIA_RULE) {
          const inner = [];
          const inheritedSelectors = [':root', 'html', 'body', '*'];
          try {
            for (const r of rule.cssRules) {
              if (r.type === CSSRule.STYLE_RULE) {
                const sels = r.selectorText.split(',').map(s => s.trim());
                const isInherited = sels.some(sel => {
                  const base = getBaseSelector(sel).trim();
                  return inheritedSelectors.includes(base);
                });
                const m = isInherited ? sels : sels.filter(sel => {
                  const base = getBaseSelector(sel);
                  return base && selectorMatchesAny(base, elements);
                });
                if (m.length > 0) inner.push(`${m.join(', ')} { ${r.style.cssText} }`);
              }
            }
          } catch {}
          if (inner.length > 0) matchedRules.push(`@media ${rule.conditionText} {\n${inner.join('\n')}\n}`);
        } else if (rule.cssRules) {
          try { processRules(rule.cssRules); } catch {}
        }
      }
    }

    for (const sheet of document.styleSheets) {
      try {
        const rules = sheet.cssRules || sheet.rules;
        processRules(rules);
      } catch (e) {
        _dbgSheetErrors++;
      }
    }

    console.log('%c[Backpack Extraction Debug]', 'color: #e17055; font-weight: bold', {
      totalStyleRules: _dbgStyleRules,
      testedSelectors: _dbgTestedSelectors,
      matchedSelectors: _dbgMatchedSelectors,
      errors: _dbgErrors,
      sheetErrors: _dbgSheetErrors,
      ruleTypes: _dbgRuleTypes,
      matchedRuleCount: matchedRules.length,
      sampleSelectors: _dbgSampleSelectors,
      elementClasses: elements.slice(0, 5).map(e => e.className?.toString?.() || ''),
    });

    // Resolve CSS variables
    const resolvedVars = [];
    if (cssVars.size > 0) {
      for (const element of elements) {
        const style = element.getAttribute('style') || '';
        for (const m of style.matchAll(/(--[\w-]+)\s*:/g)) cssVars.add(m[1]);
      }
      const rootC = window.getComputedStyle(document.documentElement);
      const bodyC = window.getComputedStyle(document.body);
      const entries = [];
      for (const v of cssVars) {
        let val = rootC.getPropertyValue(v).trim() || bodyC.getPropertyValue(v).trim();
        if (!val) {
          for (const el of elements) {
            val = window.getComputedStyle(el).getPropertyValue(v).trim();
            if (val) break;
          }
        }
        if (val) entries.push(`  ${v}: ${val};`);
      }
      if (entries.length > 0) resolvedVars.push(`:root {\n${entries.join('\n')}\n}`);
    }

    // Font imports — capture any stylesheet that likely provides fonts
    const imports = [];
    const seen = new Set();
    const fontHints = ['fonts.googleapis.com', 'fonts.gstatic.com', 'use.typekit.net', 'fonts.bunny.net', 'rsms.me/inter', 'cdn.jsdelivr.net/fontsource'];

    function isFontSheet(href) {
      if (!href) return false;
      const lower = href.toLowerCase();
      return fontHints.some(hint => lower.includes(hint));
    }

    // Check stylesheets loaded in the document
    for (const sheet of document.styleSheets) {
      try {
        if (sheet.href && isFontSheet(sheet.href) && !seen.has(sheet.href)) {
          seen.add(sheet.href);
          imports.push(`@import url("${sheet.href}");`);
        }
      } catch {}
    }

    // Check <link> tags (may not all appear as document.styleSheets)
    document.querySelectorAll('link[rel="stylesheet"], link[rel="preload"][as="style"]').forEach(link => {
      if (link.href && isFontSheet(link.href) && !seen.has(link.href)) {
        seen.add(link.href);
        imports.push(`@import url("${link.href}");`);
      }
    });

    // Resolve @font-face src url() values to absolute URLs
    for (let i = 0; i < fontFaceRules.length; i++) {
      fontFaceRules[i] = resolveURLsInCSS(fontFaceRules[i]);
    }

    // Find which font families are NOT yet covered by @font-face or imports
    const systemFonts = new Set([
      'serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui',
      'ui-serif', 'ui-sans-serif', 'ui-monospace', 'ui-rounded',
      '-apple-system', 'blinkmacsystemfont', 'segoe ui', 'helvetica',
      'arial', 'helvetica neue', 'times new roman', 'courier new',
      'times', 'courier', 'georgia', 'verdana', 'tahoma', 'trebuchet ms',
      'lucida console', 'lucida sans unicode', 'palatino linotype',
    ]);

    // Collect font families already covered by captured @font-face rules
    const coveredFonts = new Set();
    for (const rule of fontFaceRules) {
      const match = rule.match(/font-family:\s*['"]?([^;'"]+)/i);
      if (match) coveredFonts.add(match[1].trim().toLowerCase());
    }

    // Find uncovered custom fonts
    const uncoveredFonts = [...usedFontFamilies].filter(f =>
      !systemFonts.has(f) && !coveredFonts.has(f)
    );

    // Generate Google Fonts fallback for any uncovered custom fonts
    if (uncoveredFonts.length > 0) {
      const families = uncoveredFonts.map(f => {
        const name = f.split(' ').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join('+');
        return `family=${name}:wght@100;200;300;400;500;600;700;800;900`;
      }).join('&');
      imports.push(`@import url("https://fonts.googleapis.com/css2?${families}&display=swap");`);
    }

    // Capture inherited font-family — if the root element uses a custom font
    // but no matched rule sets font-family on it, inject a body rule so the
    // font applies in the isolated preview
    const rootFont = window.getComputedStyle(el).fontFamily;
    const hasFontRule = matchedRules.some(r => {
      if (!r.includes('font-family')) return false;
      // Check if this rule targets the root element (not just descendants)
      const selMatch = r.match(/^([^{]+)\{/);
      if (!selMatch) return false;
      return selMatch[1].split(',').some(s => {
        const base = getBaseSelector(s.trim());
        try { return base && el.matches && el.matches(base); } catch { return false; }
      });
    });
    const inheritedFontRule = (!hasFontRule && rootFont)
      ? `body { font-family: ${rootFont}; }`
      : '';

    const parts = [];
    if (imports.length) parts.push(imports.join('\n'));
    if (fontFaceRules.length) parts.push(fontFaceRules.join('\n'));
    if (inheritedFontRule) parts.push(inheritedFontRule);
    if (resolvedVars.length) parts.push(resolvedVars.join('\n'));
    if (keyframeRules.length) parts.push(keyframeRules.join('\n'));
    if (matchedRules.length) parts.push(matchedRules.join('\n'));
    return { css: parts.join('\n\n'), matchedRules };
  }

  // Clean up broken CSS declarations (empty values from browser serialization)
  function cleanCSS(css) {
    // Remove declarations with empty values like "transition-duration: ;"
    css = css.replace(/[\w-]+:\s*;/g, '');
    // Remove resulting double-semicolons and clean up whitespace
    css = css.replace(/;\s*;/g, ';');
    css = css.replace(/\{\s*;/g, '{');
    css = css.replace(/;\s*\}/g, ' }');
    return css;
  }

  // Patch broken transition/animation longhand in CSS by reading computed durations
  // from live elements. Uses the property list FROM THE CSS RULE (not computed style)
  // to preserve all properties the author intended, then pairs with computed duration.
  function patchTransitions(css, el) {
    const elements = collectElements(el);

    // Build a lookup: for each element (and its pseudo-elements), store computed transition info
    // keyed by a combo of element + pseudo
    function getComputedDuration(element, pseudo) {
      const c = window.getComputedStyle(element, pseudo || null);
      const dur = c.transitionDuration;
      const func = c.transitionTimingFunction;
      const delay = c.transitionDelay;
      // Return null if no real duration
      if (!dur || dur === '0s' || /^0s(,\s*0s)*$/.test(dur)) return null;
      return {
        durations: dur.split(',').map(s => s.trim()),
        timings: func ? func.split(',').map(s => s.trim()) : ['ease'],
        delays: delay ? delay.split(',').map(s => s.trim()) : ['0s'],
      };
    }

    // For each rule with broken transition-property, find a matching element and patch
    css = css.replace(/([^{}@][^{]*)\{([^}]*)\}/g, (match, rawSelector, body) => {
      // Skip if no broken transition
      if (!body.includes('transition-property')) return match;
      if (/transition\s*:/.test(body)) return match; // already has shorthand
      if (/transition-duration:\s*[^;\s]/.test(body)) return match; // has real duration

      // Extract the property list from the CSS rule text
      const propMatch = body.match(/transition-property:\s*([^;]+)/);
      if (!propMatch) return match;
      const cssProps = propMatch[1].trim().split(',').map(s => s.trim());

      const selector = rawSelector.trim();
      const hasPseudo = /::(?:before|after)/.test(selector);
      const pseudo = hasPseudo ? (selector.includes('::before') ? '::before' : '::after') : null;
      const base = getBaseSelector(selector);

      // Find a matching element to get computed duration
      let durInfo = null;
      for (const element of elements) {
        try {
          if (base && element.matches && element.matches(base)) {
            durInfo = getComputedDuration(element, pseudo);
            if (durInfo) break;
          }
        } catch {}
      }

      // If no computed duration found, use a sensible default (0.3s)
      if (!durInfo) {
        durInfo = { durations: ['0.3s'], timings: ['ease'], delays: ['0s'] };
      }

      // Build shorthand: pair each CSS property with cycled duration/timing/delay
      const shorthand = 'transition: ' + cssProps.map((p, i) => {
        const d = durInfo.durations[i % durInfo.durations.length] || '0s';
        const f = durInfo.timings[i % durInfo.timings.length] || 'ease';
        const dl = durInfo.delays[i % durInfo.delays.length] || '0s';
        return `${p} ${d} ${f} ${dl}`;
      }).join(', ') + ';';

      // Remove broken longhand, inject shorthand
      const cleaned = body
        .replace(/transition-property:\s*[^;]*;?/g, '')
        .replace(/transition-duration:\s*;?/g, '')
        .replace(/transition-timing-function:\s*[^;]*;?/g, '')
        .replace(/transition-delay:\s*[^;]*;?/g, '');
      return `${rawSelector}{${cleaned} ${shorthand} }`;
    });

    // Patch broken animation longhand similarly
    css = css.replace(/([^{}@][^{]*)\{([^}]*)\}/g, (match, rawSelector, body) => {
      if (!body.includes('animation-name')) return match;
      if (/animation\s*:/.test(body)) return match;
      if (/animation-duration:\s*[^;\s]/.test(body)) return match;

      const nameMatch = body.match(/animation-name:\s*([^;]+)/);
      if (!nameMatch) return match;

      const selector = rawSelector.trim();
      const base = getBaseSelector(selector);

      let computed = null;
      for (const element of elements) {
        try {
          if (base && element.matches && element.matches(base)) {
            const c = window.getComputedStyle(element);
            if (c.animationName && c.animationName !== 'none') {
              computed = c;
              break;
            }
          }
        } catch {}
      }

      if (!computed) return match;

      const shorthand = `animation: ${computed.animationName} ${computed.animationDuration} ${computed.animationTimingFunction} ${computed.animationDelay} ${computed.animationIterationCount} ${computed.animationDirection} ${computed.animationFillMode};`;
      const cleaned = body
        .replace(/animation-name:\s*[^;]*;?/g, '')
        .replace(/animation-duration:\s*[^;]*;?/g, '')
        .replace(/animation-timing-function:\s*[^;]*;?/g, '')
        .replace(/animation-delay:\s*[^;]*;?/g, '')
        .replace(/animation-iteration-count:\s*[^;]*;?/g, '')
        .replace(/animation-direction:\s*[^;]*;?/g, '')
        .replace(/animation-fill-mode:\s*[^;]*;?/g, '');
      return `${rawSelector}{${cleaned} ${shorthand} }`;
    });

    return css;
  }

  function buildCapturedHTML(el) {
    const debug = { stage: 'buildCapturedHTML' };
    const elements = collectElements(el);

    // ── Debug: element info ──
    debug.element = {
      tag: el.tagName.toLowerCase(),
      classes: el.className?.toString?.() || '',
      id: el.id || null,
      rect: (() => { const r = el.getBoundingClientRect(); return { w: Math.round(r.width), h: Math.round(r.height) }; })(),
      childCount: el.children.length,
      totalDescendants: elements.length - 1,
    };

    // ── Debug: computed styles on root element ──
    const cs = window.getComputedStyle(el);
    debug.computedRoot = {
      fontFamily: cs.fontFamily,
      fontSize: cs.fontSize,
      color: cs.color,
      backgroundColor: cs.backgroundColor,
      display: cs.display,
      position: cs.position,
      transition: cs.transition,
      transitionProperty: cs.transitionProperty,
      transitionDuration: cs.transitionDuration,
      animation: cs.animationName !== 'none' ? `${cs.animationName} ${cs.animationDuration}` : 'none',
      overflow: cs.overflow,
    };

    // ── Debug: all font families used across component ──
    const fontFamilies = new Set();
    for (const element of elements) {
      const ff = window.getComputedStyle(element).fontFamily;
      if (ff) ff.split(',').forEach(f => fontFamilies.add(f.trim().replace(/['"]/g, '')));
    }
    debug.fontFamilies = [...fontFamilies];

    // ── Debug: all transitions across component elements (including pseudo-elements) ──
    debug.transitions = [];
    for (const element of elements) {
      const ec = window.getComputedStyle(element);
      if (ec.transitionProperty && ec.transitionProperty !== 'all' && ec.transitionDuration && !/^0s(,\s*0s)*$/.test(ec.transitionDuration)) {
        debug.transitions.push({
          tag: element.tagName.toLowerCase(),
          class: element.className?.toString?.().split(' ')[0] || '',
          property: ec.transitionProperty,
          duration: ec.transitionDuration,
          timing: ec.transitionTimingFunction,
        });
      }
      // Check ::before and ::after
      for (const pseudo of ['::before', '::after']) {
        const pc = window.getComputedStyle(element, pseudo);
        if (pc.content && pc.content !== 'none' && pc.content !== 'normal' &&
            pc.transitionProperty && pc.transitionProperty !== 'all' &&
            pc.transitionDuration && !/^0s(,\s*0s)*$/.test(pc.transitionDuration)) {
          debug.transitions.push({
            tag: element.tagName.toLowerCase() + pseudo,
            class: element.className?.toString?.().split(' ')[0] || '',
            property: pc.transitionProperty,
            duration: pc.transitionDuration,
            timing: pc.transitionTimingFunction,
          });
        }
      }
    }

    // ── Debug: stylesheets on page ──
    debug.stylesheets = [];
    for (const sheet of document.styleSheets) {
      try {
        debug.stylesheets.push({
          href: sheet.href || '(inline)',
          rules: sheet.cssRules?.length || 0,
          disabled: sheet.disabled,
        });
      } catch (e) {
        debug.stylesheets.push({ href: sheet.href || '(inline)', error: 'CORS blocked' });
      }
    }

    // ── Debug: font-related link tags on page ──
    debug.fontLinks = [];
    document.querySelectorAll('link[rel="stylesheet"], link[rel="preload"][as="style"]').forEach(link => {
      if (link.href) debug.fontLinks.push(link.href);
    });

    // ── Run extraction ──
    const extracted = extractMatchingCSS(el);
    let css = extracted.css;
    const matchedRules = extracted.matchedRules;
    const cleanHTML = getCleanHTML(el);

    debug.rawCSS = {
      length: css?.length || 0,
      hasImports: css?.includes('@import') || false,
      hasFontFace: css?.includes('@font-face') || false,
      hasKeyframes: css?.includes('@keyframes') || false,
      hasTransitionProperty: css?.includes('transition-property') || false,
      hasTransitionShorthand: /transition\s*:/.test(css || ''),
      hasVars: css?.includes('var(--') || false,
      ruleCount: (css?.match(/\{/g) || []).length,
      preview: css?.substring(0, 500) || '(empty)',
    };

    // Count component-specific matched rules (exclude inherited :root/html/body/* rules)
    const inheritedPattern = /^(?:\*|:root|html|body)\s*\{/;
    const componentRuleCount = matchedRules.filter(r => !inheritedPattern.test(r.trim())).length;

    const needsFallback = componentRuleCount < 3;

    if (needsFallback) {
      debug.fallback = 'COMPUTED STYLE INLINING — CSS extraction found too few rules (' + componentRuleCount + ')';
      console.log('%c[Backpack]', 'color: #e17055; font-weight: bold',
        'CSS extraction insufficient (' + componentRuleCount + ' rules). Falling back to computed style inlining.');

      // Clone the element again and inline computed styles
      const styledClone = el.cloneNode(true);
      styledClone.classList.remove('__backpack-highlight');
      styledClone.removeAttribute('data-backpack-tag');
      resolveRelativeURLs(styledClone);
      inlineComputedStyles(styledClone, el);

      // Still extract @imports and font links from any CSS we did get
      const linkTags = [];
      if (css) {
        css.replace(/@import\s+url\(\s*["']?([^"')]+)["']?\s*\)\s*;?/g, (match, url) => {
          linkTags.push(`<link rel="stylesheet" href="${url}">`);
          return '';
        });
      }

      // Also include the page's same-origin stylesheets as <link> tags
      // so hover states, media queries, and animations still work
      const pageOrigin = window.location.origin;
      document.querySelectorAll('link[rel="stylesheet"]').forEach(link => {
        if (link.href && link.href.startsWith(pageOrigin) && !linkTags.some(t => t.includes(link.href))) {
          linkTags.push(`<link rel="stylesheet" href="${link.href}">`);
        }
      });

      // Extract font-related CSS (keyframes, font-face, body font, imports)
      let fontCSS = '';
      if (css) {
        const fontParts = [];
        // Keep body font rule
        const bodyMatch = css.match(/body\s*\{[^}]*font-family[^}]*\}/);
        if (bodyMatch) fontParts.push(bodyMatch[0]);
        // Keep keyframes
        css.replace(/@keyframes\s+[\w-]+\s*\{[^}]*(?:\{[^}]*\}[^}]*)*\}/g, m => { fontParts.push(m); return ''; });
        if (fontParts.length) fontCSS = fontParts.join('\n');
      }

      debug.finalOutput = {
        linkTags,
        method: 'computed-style-inlining',
        htmlLength: styledClone.outerHTML.length,
      };

      console.log('%c[Backpack Debug]', 'color: #6C5CE7; font-weight: bold', debug);

      const parts = [];
      if (linkTags.length) parts.push(linkTags.join('\n'));
      if (fontCSS.trim()) parts.push(`<style>\n${fontCSS.trim()}\n</style>`);
      parts.push(styledClone.outerHTML);
      return parts.join('\n');
    }

    css = resolveURLsInCSS(css);

    // ── Debug: transition patching ──
    const beforePatch = css;
    css = patchTransitions(css, el);
    const patchDiff = css !== beforePatch;
    debug.transitionPatch = {
      applied: patchDiff,
      addedChars: css.length - beforePatch.length,
    };

    css = cleanCSS(css);

    // Extract @import rules and convert to <link> tags for reliable loading
    const linkTags = [];
    css = css.replace(/@import\s+url\(\s*["']?([^"')]+)["']?\s*\)\s*;?/g, (match, url) => {
      linkTags.push(`<link rel="stylesheet" href="${url}">`);
      return ''; // Remove from CSS
    });

    debug.finalOutput = {
      linkTags: linkTags,
      method: 'css-extraction',
      cssLength: css.trim().length,
      htmlLength: cleanHTML.length,
      hasTransitionProperty: css.includes('transition-property'),
      hasTransitionShorthand: /transition\s*:/.test(css),
      cssPreview: css.trim().substring(0, 500),
    };

    console.log('%c[Backpack Debug]', 'color: #6C5CE7; font-weight: bold', debug);
    console.log('%c[Backpack CSS]', 'color: #00b894; font-weight: bold', css.trim());

    const parts = [];
    if (linkTags.length) parts.push(linkTags.join('\n'));
    css = css.trim();
    if (css) parts.push(`<style>\n${css}\n</style>`);
    parts.push(cleanHTML);
    return parts.join('\n');
  }

  // ─── Picker UI ────────────────────────────────────────────────────

  function getTagLabel(el) {
    const tag = el.tagName.toLowerCase();
    const cls = el.className && typeof el.className === 'string'
      ? '.' + el.className.trim().split(/\s+/)[0]
      : '';
    const rect = el.getBoundingClientRect();
    const w = Math.round(rect.width);
    const h = Math.round(rect.height);
    return `<${tag}${cls}> ${w}×${h}`;
  }

  function highlightElement(el) {
    if (currentTarget) {
      currentTarget.classList.remove('__backpack-highlight');
      currentTarget.removeAttribute('data-backpack-tag');
    }
    currentTarget = el;
    if (el) {
      el.classList.add('__backpack-highlight');
      el.setAttribute('data-backpack-tag', getTagLabel(el));
    }
  }

  function handleMouseOver(e) {
    if (!isPickerActive) return;
    e.stopPropagation();

    const target = e.target;
    if (
      target === overlay ||
      target.classList.contains('__backpack-overlay') ||
      target.classList.contains('__backpack-toast') ||
      target === document.body ||
      target === document.documentElement
    ) return;

    hoverTarget = target;
    if (depthLocked) return;

    // Auto-detect the best component from the hovered leaf
    const component = findComponent(target);
    highlightElement(component);
  }

  function handleMouseOut(e) {
    if (!isPickerActive) return;
    if (depthLocked && e.target === hoverTarget) {
      depthLocked = false;
    }
  }

  function handleScroll(e) {
    if (!isPickerActive || !currentTarget) return;
    e.preventDefault();
    e.stopPropagation();
    depthLocked = true;

    if (e.deltaY > 0) {
      // Scroll down = expand to parent
      const parent = currentTarget.parentElement;
      if (parent && parent !== document.body && parent !== document.documentElement) {
        highlightElement(parent);
      }
    } else {
      // Scroll up = narrow to child
      let child = null;
      if (hoverTarget && currentTarget.contains(hoverTarget) && hoverTarget !== currentTarget) {
        let walker = hoverTarget;
        while (walker.parentElement && walker.parentElement !== currentTarget) walker = walker.parentElement;
        if (walker.parentElement === currentTarget) child = walker;
      }
      if (!child && currentTarget.children.length > 0) child = currentTarget.children[0];
      if (child) highlightElement(child);
    }
  }

  function handleClick(e) {
    if (!isPickerActive || isShowingDropdown) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    if (!currentTarget) return;

    // Freeze the picker — keep highlight, stop hover updates
    isShowingDropdown = true;
    const selectedEl = currentTarget;

    // Remove hover/scroll listeners so the selection stays locked
    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('wheel', handleScroll, { capture: true });

    // Update overlay text
    if (overlay) {
      overlay.innerHTML = 'Select a pack for this component<span>Press ESC to cancel</span>';
    }

    // Fetch packs and show dropdown
    chrome.runtime.sendMessage({ type: 'GET_PACKS' }, (packs) => {
      if (chrome.runtime.lastError || !packs) packs = [];
      showPackDropdown(selectedEl, packs);
    });
  }

  function showPackDropdown(selectedEl, packs) {
    const rect = selectedEl.getBoundingClientRect();
    const dropdownWidth = 220;
    const viewW = window.innerWidth;

    // Decide left or right
    const spaceRight = viewW - rect.right;
    const spaceLeft = rect.left;
    let posLeft, posTop;

    if (spaceRight >= dropdownWidth + 16) {
      posLeft = rect.right + 12;
    } else if (spaceLeft >= dropdownWidth + 16) {
      posLeft = rect.left - dropdownWidth - 12;
    } else {
      // Center below
      posLeft = Math.max(8, rect.left + (rect.width - dropdownWidth) / 2);
    }
    posTop = Math.max(8, rect.top);

    // Clamp to viewport
    if (posTop + 300 > window.innerHeight) {
      posTop = Math.max(8, window.innerHeight - 320);
    }

    packDropdown = document.createElement('div');
    packDropdown.className = '__backpack-dropdown';
    packDropdown.style.left = posLeft + 'px';
    packDropdown.style.top = posTop + 'px';
    packDropdown.style.width = dropdownWidth + 'px';

    // "All" option (no pack)
    let html = `<div class="__backpack-dropdown-item" data-pack-id="">All</div>`;
    for (const pack of packs) {
      html += `<div class="__backpack-dropdown-item" data-pack-id="${pack.id}">${pack.name}</div>`;
    }
    packDropdown.innerHTML = html;
    document.body.appendChild(packDropdown);

    // Handle pack selection
    packDropdown.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      const item = e.target.closest('.__backpack-dropdown-item');
      if (!item) return;

      const selectedPackId = item.dataset.packId || null;
      saveAndAnimate(selectedEl, selectedPackId);
    }, true);

    // Handle clicking outside dropdown to cancel
    setTimeout(() => {
      document.addEventListener('click', handleDropdownOutsideClick, true);
    }, 50);
  }

  function handleDropdownOutsideClick(e) {
    if (packDropdown && packDropdown.contains(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    closeDropdown();
    // Re-enable picker
    isShowingDropdown = false;
    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('wheel', handleScroll, { capture: true, passive: false });
    if (overlay) {
      overlay.innerHTML = 'Backpack Picker Active — scroll to resize selection, click to save<span>Press ESC to cancel</span>';
    }
  }

  function closeDropdown() {
    document.removeEventListener('click', handleDropdownOutsideClick, true);
    if (packDropdown) {
      packDropdown.remove();
      packDropdown = null;
    }
  }

  function saveAndAnimate(selectedEl, selectedPackId) {
    closeDropdown();

    // Build component data before removing highlight
    const capturedHTML = buildCapturedHTML(selectedEl);
    const rawHTML = getCleanHTML(selectedEl);
    const background = findBackground(selectedEl.parentElement || selectedEl);
    const rect = selectedEl.getBoundingClientRect();

    const component = {
      id: crypto.randomUUID(),
      packId: selectedPackId,
      name: selectedEl.className
        ? selectedEl.className.toString().split(' ')[0].substring(0, 30)
        : selectedEl.tagName.toLowerCase(),
      tagName: `<${selectedEl.tagName.toLowerCase()}>`,
      html: capturedHTML,
      rawHtml: rawHTML,
      styles: getComputedStylesJSON(selectedEl),
      background: background,
      sourceUrl: window.location.href,
      capturedWidth: Math.round(rect.width),
      capturedHeight: Math.round(Math.max(rect.height, selectedEl.scrollHeight)),
      savedAt: Date.now(),
    };

    // Remove highlight before capturing screenshot
    selectedEl.classList.remove('__backpack-highlight');
    selectedEl.removeAttribute('data-backpack-tag');

    // Hide overlay so it doesn't appear in the screenshot
    if (overlay) overlay.style.display = 'none';

    // Deactivate picker (but keep logo until animation finishes)
    isPickerActive = false;
    isShowingDropdown = false;
    depthLocked = false;
    hoverTarget = null;
    currentTarget = null;

    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('wheel', handleScroll, { capture: true });
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('click', handleDropdownOutsideClick, true);

    // Small delay to let the DOM repaint without highlight/overlay
    requestAnimationFrame(() => {
      chrome.runtime.sendMessage({ type: 'CAPTURE_TAB' }, (response) => {
        // Remove overlay now that screenshot is taken
        if (overlay) {
          overlay.remove();
          overlay = null;
        }

        const dataUrl = response && response.dataUrl;

        // Save component
        chrome.runtime.sendMessage({ type: 'SAVE_COMPONENT', component }, () => {
          if (chrome.runtime.lastError) { /* ignore */ }
        });

        if (!dataUrl) {
          if (logoEl) {
            logoEl.classList.add('__backpack-logo-pulse');
            setTimeout(() => {
              if (logoEl) logoEl.classList.remove('__backpack-logo-pulse');
              hideLogo();
            }, 500);
          } else {
            hideLogo();
          }
          return;
        }

        // Crop the screenshot to the component bounds
        const dpr = window.devicePixelRatio || 1;
        const img = new Image();
        img.onload = () => {
          const canvas = document.createElement('canvas');
          const cropX = Math.round(rect.left * dpr);
          const cropY = Math.round(rect.top * dpr);
          const cropW = Math.round(rect.width * dpr);
          const cropH = Math.round(rect.height * dpr);
          canvas.width = cropW;
          canvas.height = cropH;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

          const croppedUrl = canvas.toDataURL('image/png');
          runArcAnimation(croppedUrl, rect);
        };
        img.src = dataUrl;
      });
    });
  }

  function runArcAnimation(imageUrl, rect) {
    const screenshot = document.createElement('div');
    screenshot.style.cssText = `
      position: fixed;
      left: ${rect.left}px;
      top: ${rect.top}px;
      width: ${rect.width}px;
      height: ${rect.height}px;
      z-index: 2147483647;
      pointer-events: none;
      overflow: hidden;
      border-radius: 12px;
      box-shadow: 0 8px 32px rgba(33, 215, 96, 0.3);
      border: 2px solid #21d760;
      background-image: url(${imageUrl});
      background-size: cover;
      background-position: center;
    `;
    document.body.appendChild(screenshot);

    const logoRect = logoEl ? logoEl.getBoundingClientRect() : { left: window.innerWidth - 56, top: window.innerHeight - 56, width: 52, height: 52 };
    const targetX = logoRect.left + logoRect.width / 2;
    const targetY = logoRect.top + logoRect.height / 2;
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;

    const duration = 700;
    const startTime = performance.now();

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function animateFrame(now) {
      const elapsed = now - startTime;
      const rawT = Math.min(elapsed / duration, 1);
      const t = easeInOutCubic(rawT);

      const x = startX + (targetX - startX) * t;
      const y = startY + (targetY - startY) * t;

      // Arc upward in the middle using sine curve
      const arcHeight = Math.min(300, Math.abs(targetY - startY) * 0.6 + 100);
      const arcOffset = -Math.sin(t * Math.PI) * arcHeight;

      // Scale down and fade
      const scale = 1 - t * 0.85;
      const w = rect.width * scale;
      const h = rect.height * scale;
      const opacity = 1 - t * 0.6;

      screenshot.style.left = (x - w / 2) + 'px';
      screenshot.style.top = (y + arcOffset - h / 2) + 'px';
      screenshot.style.width = w + 'px';
      screenshot.style.height = h + 'px';
      screenshot.style.opacity = opacity;
      screenshot.style.borderRadius = (12 + t * 40) + 'px';
      screenshot.style.transform = `rotate(${t * -8}deg)`;

      if (rawT < 1) {
        requestAnimationFrame(animateFrame);
      } else {
        screenshot.remove();
        if (logoEl) {
          logoEl.classList.add('__backpack-logo-pulse');
          setTimeout(() => {
            if (logoEl) logoEl.classList.remove('__backpack-logo-pulse');
            hideLogo();
          }, 500);
        } else {
          hideLogo();
        }
      }
    }

    requestAnimationFrame(animateFrame);
  }

  function handleKeyDown(e) {
    if (e.key === 'Escape') {
      if (isShowingDropdown) {
        // Close dropdown, return to picker
        closeDropdown();
        isShowingDropdown = false;
        document.addEventListener('mouseover', handleMouseOver, true);
        document.addEventListener('mouseout', handleMouseOut, true);
        document.addEventListener('wheel', handleScroll, { capture: true, passive: false });
        if (overlay) {
          overlay.innerHTML = 'Backpack Picker Active — scroll to resize selection, click to save<span>Press ESC to cancel</span>';
        }
      } else if (isPickerActive) {
        deactivatePicker();
      }
    }
  }

  let logoEl = null;

  const BACKPACK_LOGO_SVG = `<svg viewBox="0 0 190.73 190.72" xmlns="http://www.w3.org/2000/svg" width="32" height="32"><defs><style>.bp-1{fill-rule:evenodd;fill:#ffffff}.bp-2{fill:#ffffff}</style></defs><g><path class="bp-1" d="M161.88,162.13c-4.21,12.41-13.95,22.15-26.36,26.36-6.6,2.24-14.51,2.24-26.92,2.24h-26.48c-12.4,0-20.32,0-26.92-2.24-12.4-4.21-22.15-13.95-26.36-26.36-.78-2.31-1.29-4.77-1.62-7.53-.49-4.12-.74-6.18.3-8.45,1.04-2.27,2.93-3.54,6.71-6.09,17.59-11.83,36.24-20.3,61.13-20.3,21.7,0,46.56,8.64,62.73,20.85,2.81,2.12,4.21,3.18,5.14,5.31.93,2.13.75,3.93.39,7.53-.32,3.24-.86,6.07-1.75,8.69Z"/><path class="bp-1" d="M95.14,0h.45c3.94,0,7.23,0,9.94.18,2.81.19,5.47.61,8.05,1.67,5.98,2.48,10.73,7.22,13.2,13.2,1.07,2.58,1.48,5.23,1.67,8.05.18,2.7.18,5.99.18,9.94h0v2.14c21.16,11.72,35.48,34.28,35.48,60.18v25.63c0,3.07,0,4.6-.92,5.11-.92.5-2.25-.35-4.91-2.06-17.24-11.07-39.2-17.6-62.92-17.6s-45.67,6.52-62.92,17.6c-2.66,1.71-3.99,2.56-4.91,2.06-.92-.5-.92-2.04-.92-5.11h0v-25.63c0-25.9,14.32-48.46,35.48-60.18v-2.14c0-3.94,0-7.23.18-9.94.19-2.81.61-5.47,1.67-8.05,2.48-5.98,7.22-10.73,13.2-13.2,2.58-1.07,5.23-1.48,8.05-1.67C87.9,0,91.2,0,95.14,0h0ZM115.17,24.01c.1,1.48.14,3.25.15,5.54-6.32-1.91-13.01-2.94-19.95-2.94s-13.64,1.03-19.95,2.94c.01-2.29.05-4.06.15-5.54.15-2.14.41-3.18.69-3.86,1.13-2.72,3.28-4.88,6-6,.68-.28,1.72-.54,3.86-.69,2.2-.15,5.03-.15,9.26-.15s7.06,0,9.26.15c2.14.15,3.17.41,3.86.69,2.72,1.13,4.88,3.28,6,6,.28.68.55,1.72.69,3.86ZM86.49,70.97c-3.67,0-6.65,2.98-6.65,6.65s2.98,6.65,6.65,6.65h17.74c3.67,0,6.65-2.98,6.65-6.65s-2.98-6.65-6.65-6.65h-17.74Z"/><path class="bp-2" d="M15.52,136.66v-27.53c0-2.9,0-4.34-1.07-4.81-1.07-.46-2.05.46-4.01,2.31-6.43,6.07-10.45,14.67-10.45,24.2v11.41c0,8.65,5.02,16.12,12.3,19.67,2.09,1.02,3.13,1.52,4,.89s.65-1.99.23-4.69c-1.02-6.46-1.01-13.58-1.01-21.44Z"/><path class="bp-2" d="M175.2,136.66c0,7.86.01,14.98-1.01,21.44-.42,2.7-.64,4.05.23,4.69.86.64,1.91.13,4-.89,7.28-3.55,12.3-11.02,12.3-19.67v-11.41c0-9.54-4.01-18.14-10.44-24.2-1.96-1.85-2.94-2.77-4.01-2.31s-1.07,1.91-1.07,4.81v27.53Z"/></g></svg>`;

  function showLogo() {
    if (logoEl) return;
    logoEl = document.createElement('div');
    logoEl.className = '__backpack-logo';
    logoEl.innerHTML = BACKPACK_LOGO_SVG;
    document.body.appendChild(logoEl);
  }

  function hideLogo() {
    if (logoEl) {
      logoEl.remove();
      logoEl = null;
    }
  }

  function activatePicker() {
    isPickerActive = true;
    isShowingDropdown = false;
    depthLocked = false;
    hoverTarget = null;

    showLogo();

    overlay = document.createElement('div');
    overlay.className = '__backpack-overlay';
    overlay.innerHTML = 'Backpack Picker Active — scroll to resize selection, click to save<span>Press ESC to cancel</span>';
    document.body.appendChild(overlay);

    document.addEventListener('mouseover', handleMouseOver, true);
    document.addEventListener('mouseout', handleMouseOut, true);
    document.addEventListener('wheel', handleScroll, { capture: true, passive: false });
    document.addEventListener('click', handleClick, true);
    document.addEventListener('keydown', handleKeyDown, true);
  }

  function deactivatePicker() {
    isPickerActive = false;
    isShowingDropdown = false;
    depthLocked = false;
    hoverTarget = null;

    closeDropdown();
    hideLogo();

    if (currentTarget) {
      currentTarget.classList.remove('__backpack-highlight');
      currentTarget.removeAttribute('data-backpack-tag');
      currentTarget = null;
    }
    if (overlay) {
      overlay.remove();
      overlay = null;
    }

    document.removeEventListener('mouseover', handleMouseOver, true);
    document.removeEventListener('mouseout', handleMouseOut, true);
    document.removeEventListener('wheel', handleScroll, { capture: true });
    document.removeEventListener('click', handleClick, true);
    document.removeEventListener('keydown', handleKeyDown, true);
    document.removeEventListener('click', handleDropdownOutsideClick, true);
  }

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = '__backpack-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 2500);
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'ACTIVATE_PICKER') {
      if (isPickerActive) deactivatePicker();
      else activatePicker();
    }
  });
}
