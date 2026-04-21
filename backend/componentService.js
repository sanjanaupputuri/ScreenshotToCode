import { enrichDetectedElements } from './database.js';

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CONTROL_LABEL_PATTERN = /(public|private|pin|watch|fork|star|main|code|add file|go to file|search|type|upload|download|edit|new|create|save|cancel|apply|close|open)/i;
const CHIP_BADGE_PATTERN = /^(public|private|draft|open|closed|beta|new)$/i;
const INPUT_LABEL_PATTERN = /(search|type|enter|email|name|password|phone|address|query|username)/i;

function px(value, fallback = 0) {
  const numeric = Number.isFinite(value) ? value : fallback;
  return `${Math.max(0, Math.round(numeric))}px`;
}

function styleString(declarations) {
  return Object.entries(declarations)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}:${value}`)
    .join(';');
}

function isTransparent(color) {
  return !color || color === 'transparent' || color === 'none';
}

function hexToRgb(color) {
  if (!color || color[0] !== '#' || (color.length !== 7 && color.length !== 4)) return null;
  const normalized = color.length === 4
    ? `#${color[1]}${color[1]}${color[2]}${color[2]}${color[3]}${color[3]}`
    : color;
  return {
    r: parseInt(normalized.slice(1, 3), 16),
    g: parseInt(normalized.slice(3, 5), 16),
    b: parseInt(normalized.slice(5, 7), 16),
  };
}

function relativeLuminance(color) {
  const rgb = hexToRgb(color);
  if (!rgb) return 1;
  const channels = [rgb.r, rgb.g, rgb.b].map((value) => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function contrastRatio(left, right) {
  const l1 = relativeLuminance(left);
  const l2 = relativeLuminance(right);
  const lighter = Math.max(l1, l2);
  const darker = Math.min(l1, l2);
  return (lighter + 0.05) / (darker + 0.05);
}

function colorDistance(left, right) {
  const leftRgb = hexToRgb(left);
  const rightRgb = hexToRgb(right);
  if (!leftRgb || !rightRgb) return Infinity;
  const dr = leftRgb.r - rightRgb.r;
  const dg = leftRgb.g - rightRgb.g;
  const db = leftRgb.b - rightRgb.b;
  return Math.sqrt((dr * dr) + (dg * dg) + (db * db));
}

function bestContrastText(background) {
  return contrastRatio(background, '#ffffff') >= contrastRatio(background, '#111827') ? '#ffffff' : '#111827';
}

function normalizeInlineText(value = '') {
  return String(value).replace(/\s+/g, ' ').trim();
}

function normalizeElement(raw, index) {
  const kind = raw.kind || 'shape';
  const semanticType = raw.semantic_type || raw.type || kind;
  const textRole = raw.text_role || (kind === 'text' ? 'body' : 'container');
  const background = isTransparent(raw.background_color) ? 'transparent' : raw.background_color;
  const border = Number(raw.border_width) > 0 && !isTransparent(raw.border_color)
    ? `${Math.round(raw.border_width)}px solid ${raw.border_color}`
    : 'none';
  const rawFontSize = Number(raw.font_size) || 14;
  const fontSize =
    textRole === 'title' ? Math.max(rawFontSize, 24) :
    textRole === 'heading' ? Math.max(rawFontSize, 18) :
    textRole === 'muted' ? Math.max(11, rawFontSize - 2) :
    rawFontSize > 20 ? rawFontSize : // Preserve large text
    rawFontSize;
  const fontWeight =
    textRole === 'title' ? Math.max(Number(raw.font_weight) || 600, 700) :
    textRole === 'heading' ? Math.max(Number(raw.font_weight) || 600, 600) :
    textRole === 'nav' ? Math.max(Number(raw.font_weight) || 500, 600) :
    Number(raw.font_weight) || 400;
  const textColor =
    textRole === 'muted' ? '#57606a' :
    (isTransparent(raw.text_color) ? '#24292f' : raw.text_color);
  const parentBackground = raw.parent_background_color || null;

  // Check contrast against parent bg OR the element's own background (for inline text)
  const contrastBg = parentBackground || (kind === 'text' ? null : background);
  const needsContrastCorrection =
    raw.kind === 'text' &&
    contrastBg &&
    !isTransparent(contrastBg) &&
    (
      isTransparent(raw.text_color) ||
      contrastRatio(textColor, contrastBg) < 1.5 ||
      colorDistance(textColor, contrastBg) < 30
    );
  const correctedTextColor =
    needsContrastCorrection
      ? bestContrastText(contrastBg)
      : textColor;

  const sourceId = Number.isFinite(raw.id) ? Number(raw.id) : index;

  // Use _direct_text if available (for buttons/chips with directly extracted text)
  const elementText = raw._direct_text || raw.text || '';

  return {
    id: `${kind}-${sourceId}`,
    sourceId,
    kind,
    type: raw.type || kind,
    semanticType,
    textRole,
    text: elementText,
    x: Number(raw.x) || 0,
    y: Number(raw.y) || 0,
    width: Number(raw.width) || 1,
    height: Number(raw.height) || 1,
    x_pct: Number(raw.x_pct) || 0,
    y_pct: Number(raw.y_pct) || 0,
    w_pct: Number(raw.w_pct) || 0.01,
    h_pct: Number(raw.h_pct) || 0.01,
    background,
    border,
    borderRadius: Number(raw.border_radius) || 0,
    textColor: correctedTextColor,
    fontSize,
    fontWeight,
    textAlign: raw.text_align || 'left',
    zIndex: kind === 'text' ? 100 : (Number(raw.z_index) || 1),
    confidence: Number(raw.confidence) || 0,
    quality: Number(raw.quality) || 0,
    profileName: raw.profile_name || null,
    profileScore: Number.isFinite(raw.profile_score) ? Number(raw.profile_score) : (raw.profile_score ?? null),
    templateHtml: raw.template_html || null,
    templateCss: raw.template_css || null,
    parentId: raw.parent_id ?? null,
    parentType: raw.parent_type ?? null,
    rowId: raw.row_id ?? null,
    layoutHint: raw.layout_hint || null,
    // T13: Spacing values from measurement
    spacingRight: Number(raw.spacing_right) || null,
    spacingBottom: Number(raw.spacing_bottom) || null,
    // T5: Repetition group
    repeatGroupId: raw.repeat_group_id ?? null,
    repeatIndex: raw.repeat_index ?? null,
    // T6: Gradient
    gradient: raw.gradient || null,
    // T7: Glassmorphism
    glassmorphism: raw.glassmorphism || false,
    // T16: Icon placeholder info
    iconSize: (kind === 'shape' && (raw.type === 'icon' || raw.type === 'image')) ? { w: Number(raw.width), h: Number(raw.height), color: raw.background_color } : null,
  };
}

function updateElementPercents(element, imageWidth, imageHeight) {
  element.x_pct = Number((element.x / imageWidth).toFixed(6));
  element.y_pct = Number((element.y / imageHeight).toFixed(6));
  element.w_pct = Number((element.width / imageWidth).toFixed(6));
  element.h_pct = Number((element.height / imageHeight).toFixed(6));
}

function applyParentAnchoring(elements, image) {
  const bySourceId = new Map(elements.map((element) => [element.sourceId, element]));
  const imageWidth = Number(image.width) || 1;
  const imageHeight = Number(image.height) || 1;

  for (const element of elements) {
    if (element.kind !== 'text' || element.parentId === null || element.parentId === undefined) continue;
    const parent = bySourceId.get(element.parentId);
    if (!parent || parent.kind !== 'shape') continue;

    const semantic = parent.semanticType || parent.type;
    const centerY = parent.y + (parent.height - element.height) / 2;
    const padX = Math.max(6, Math.round(parent.height * 0.25));

    if (semantic === 'button' || semantic === 'chip') {
      element.textAlign = 'center';
      element.layoutHint = 'fill-center';
      const targetY = Math.round(centerY);
      if (Math.abs(element.y - targetY) > Math.max(4, Math.round(parent.height * 0.22))) {
        element.y = targetY;
      }
      if (element.height > parent.height - 2) {
        element.height = Math.max(1, parent.height - 2);
      }
      if (element.x < parent.x - 6 || element.x + element.width > parent.x + parent.width + 6) {
        element.x = parent.x + 2;
        element.width = Math.max(8, parent.width - 4);
      }
      updateElementPercents(element, imageWidth, imageHeight);
      continue;
    }

    if (semantic === 'input') {
      element.textAlign = 'left';
      element.layoutHint = 'input-inline';
      const targetY = Math.round(centerY);
      if (Math.abs(element.y - targetY) > Math.max(4, Math.round(parent.height * 0.22))) {
        element.y = targetY;
      }

      const minX = parent.x + Math.max(3, Math.floor(padX / 2));
      const maxAllowedWidth = Math.max(20, parent.width - (padX * 2));
      if (
        element.x < parent.x + 1 ||
        element.x + element.width > parent.x + parent.width - 1 ||
        element.width > maxAllowedWidth * 1.2
      ) {
        element.x = parent.x + padX;
        element.width = Math.min(Math.max(20, element.width), maxAllowedWidth);
      } else {
        element.x = Math.max(minX, element.x);
        element.width = Math.max(8, Math.min(element.width, parent.x + parent.width - element.x - 2));
      }

      updateElementPercents(element, imageWidth, imageHeight);
      continue;
    }

    if (semantic === 'toolbar') {
      const targetY = Math.round(centerY);
      if (Math.abs(element.y - targetY) <= Math.max(10, Math.round(parent.height * 0.45))) {
        element.y = targetY;
      }
      element.layoutHint = 'center-y';
      updateElementPercents(element, imageWidth, imageHeight);
    }
  }
}

function getRelativeMetrics(element, frame) {
  if (!frame) {
    return {
      left: element.x,
      top: element.y,
      width: element.width,
      height: element.height,
    };
  }

  const left = Math.max(0, element.x - frame.x);
  const top = Math.max(0, element.y - frame.y);
  const maxWidth = Math.max(1, frame.width - left);
  const maxHeight = Math.max(1, frame.height - top);

  return {
    left,
    top,
    width: Math.max(1, Math.min(element.width, maxWidth)),
    height: Math.max(1, Math.min(element.height, maxHeight)),
  };
}

function renderBackground(element) {
  // T17: Gradient background support
  const bgStyle = element.gradient
    ? `linear-gradient(${element.gradient.direction}, ${element.gradient.stops.join(', ')})`
    : element.background;
  return `<div class="screen-bg" style="${styleString({
    position: 'absolute',
    inset: '0',
    background: bgStyle,
    'z-index': element.zIndex,
  })}" data-source-id="${element.sourceId}" data-kind="${element.kind}" data-semantic-type="${element.semanticType}"></div>`;
}

function textMetricsForEstimate(text, fontSize, fontWeight = 400, maxWidth = Infinity) {
  const normalized = String(text || '').replace(/\r/g, '');
  const lines = normalized.split('\n');
  const weightFactor = fontWeight >= 700 ? 0.58 : fontWeight >= 600 ? 0.56 : 0.52;
  const spaceWidth = fontSize * 0.28;

  let totalLines = 0;
  let widestLine = 0;

  for (const rawLine of lines) {
    const words = rawLine.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      totalLines += 1;
      continue;
    }

    let currentWidth = 0;
    for (const word of words) {
      const wordWidth = Math.max(fontSize * 0.4, word.length * fontSize * weightFactor);
      const nextWidth = currentWidth === 0 ? wordWidth : currentWidth + spaceWidth + wordWidth;
      if (nextWidth > maxWidth && currentWidth > 0 && Number.isFinite(maxWidth)) {
        widestLine = Math.max(widestLine, currentWidth);
        totalLines += 1;
        currentWidth = wordWidth;
      } else {
        currentWidth = nextWidth;
      }
    }

    widestLine = Math.max(widestLine, currentWidth);
    totalLines += 1;
  }

  return {
    lineCount: Math.max(1, totalLines),
    widestLine,
  };
}

function fitTextSize(text, preferredSize, maxWidth, maxHeight, fontWeight = 400, minSize = 8) {
  let size = Math.max(minSize, Math.round(preferredSize || 14));
  const targetWidth = Math.max(8, maxWidth || 8);
  const targetHeight = Math.max(size, maxHeight || size);

  while (size > minSize) {
    const metrics = textMetricsForEstimate(text, size, fontWeight, targetWidth);
    const lineHeight = size * 1.2;
    if (metrics.widestLine <= targetWidth + 4 && (metrics.lineCount * lineHeight) <= targetHeight + 4) {
      return size;
    }
    size -= 1;
  }

  return Math.max(minSize, size);
}

function textBoxForElement(element, metrics, frame = null) {
  const parentWidth = frame?.width || metrics.width;
  const parentHeight = frame?.height || metrics.height;

  if (element.layoutHint === 'fill-center') {
    return {
      width: Math.max(12, parentWidth * 0.82),
      height: Math.max(12, parentHeight * 0.72),
    };
  }

  if (element.layoutHint === 'input-inline') {
    return {
      width: Math.max(12, parentWidth - Math.max(12, parentHeight * 0.55)),
      height: Math.max(12, parentHeight * 0.7),
    };
  }

  return {
    width: Math.max(8, metrics.width),
    height: Math.max(8, Math.max(metrics.height, element.fontSize * 1.2)),
  };
}

function textChildScore(child) {
  const text = normalizeInlineText(child.text);
  if (!text) return -1;
  const alphaCount = (text.match(/[a-z]/ig) || []).length;
  const alphaRatio = alphaCount / Math.max(1, text.length);
  const weirdSymbolRatio = (text.match(/[^a-z0-9\s#:/._-]/ig) || []).length / Math.max(1, text.length);
  const quality = Number(child.quality) || 0;
  const confidence = (Number(child.confidence) || 0) / 100;
  return (
    quality * 1.8 +
    confidence * 1.1 +
    alphaRatio * 0.9 +
    Math.min(text.length, 30) * 0.02 -
    weirdSymbolRatio * 1.1
  );
}

function horizontalOverlapRatio(left, right) {
  const overlap = Math.max(0, Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x));
  const smaller = Math.max(1, Math.min(left.width, right.width));
  return overlap / smaller;
}

function mergeInlineSegments(rowItems = []) {
  const sorted = [...rowItems]
    .filter((item) => normalizeInlineText(item.text))
    .sort((a, b) => (a.x - b.x) || (a.y - b.y));

  const merged = [];
  for (const item of sorted) {
    if (!merged.length) {
      merged.push(item);
      continue;
    }

    const prev = merged[merged.length - 1];
    const overlap = horizontalOverlapRatio(prev, item);
    const xGap = item.x - (prev.x + prev.width);
    const sameSlot = overlap >= 0.55 || xGap < -4;

    if (sameSlot) {
      if (textChildScore(item) > textChildScore(prev)) {
        merged[merged.length - 1] = item;
      }
      continue;
    }

    if (xGap <= Math.max(28, Math.min(prev.height, item.height) * 2.5)) {
      merged.push(item);
      continue;
    }

    merged.push(item);
  }

  return merged;
}

function selectInlineText(children = [], semanticType = 'shape') {
  const textChildren = children
    .filter((child) => child.kind === 'text' && normalizeInlineText(child.text))
    .sort((a, b) => (a.y - b.y) || (a.x - b.x));

  if (!textChildren.length) {
    return { text: '', node: null };
  }

  const rows = [];
  for (const child of textChildren) {
    const centerY = child.y + (child.height / 2);
    let placed = false;
    for (const row of rows) {
      if (Math.abs(centerY - row.centerY) <= Math.max(4, Math.min(row.maxHeight, child.height) * 0.40)) {
        row.items.push(child);
        row.maxHeight = Math.max(row.maxHeight, child.height);
        row.centerY = row.items.reduce((acc, item) => acc + item.y + (item.height / 2), 0) / row.items.length;
        placed = true;
        break;
      }
    }
    if (!placed) {
      rows.push({ centerY, maxHeight: child.height, items: [child] });
    }
  }

  const candidates = rows.map((row) => {
    const segments = mergeInlineSegments(row.items);
    const text = normalizeInlineText(segments.map((item) => normalizeInlineText(item.text)).join(' '));
    const sourceNode = [...segments].sort((a, b) => textChildScore(b) - textChildScore(a))[0] || null;
    const words = text.split(/\s+/).filter(Boolean).length;
    let score = segments.reduce((sum, segment) => sum + textChildScore(segment), 0) + (words <= 4 ? 0.5 : 0);

    if (semanticType === 'input' && INPUT_LABEL_PATTERN.test(text)) score += 2.0;
    if ((semanticType === 'button' || semanticType === 'chip') && CONTROL_LABEL_PATTERN.test(text)) score += 1.6;
    if ((semanticType === 'button' || semanticType === 'chip') && words > 4) score -= 1.3;

    return { text, node: sourceNode, score };
  }).filter((candidate) => candidate.text);

  if (!candidates.length) {
    const fallbackNode = [...textChildren].sort((a, b) => textChildScore(b) - textChildScore(a))[0];
    return { text: normalizeInlineText(fallbackNode?.text || ''), node: fallbackNode || null };
  }

  const best = candidates.sort((a, b) => b.score - a.score)[0];
  return { text: best.text, node: best.node };
}

function renderDetachedChildren(children, childrenByParent, frame = null, pageBg = null, allElements = []) {
  return children.map((child) => {
    if (child.kind === 'text') {
      return renderText({
        ...child,
        layoutHint: null,
        textAlign: child.textAlign === 'center' ? 'left' : child.textAlign,
      }, frame, pageBg);
    }
    return renderNode(child, childrenByParent, frame, pageBg, allElements);
  }).join('');
}

function renderInputControl(element, textValue) {
  const padX = Math.max(10, Math.round(element.height * 0.25));
  const fontSize = fitTextSize(textValue, element.fontSize || 14, element.width - (padX * 2), element.height * 0.7, element.fontWeight || 400, 10);
  return `<input type="text" value="" placeholder="${escapeHtml(textValue)}" readonly style="${styleString({
    position: 'absolute',
    left: px(element.x),
    top: px(element.y),
    width: px(element.width),
    height: px(element.height),
    padding: `0 ${px(padX)}`,
    color: element.textColor,
    'font-size': px(fontSize),
    'font-weight': element.fontWeight,
    'line-height': '1.2',
    background: element.background,
    border: element.border,
    'border-radius': px(element.borderRadius),
    outline: 'none',
    'z-index': element.zIndex,
  })}" data-source-id="${element.sourceId}" data-kind="${element.kind}" data-semantic-type="${element.semanticType}" />`;
}

function renderSelectControl(element, textValue) {
  const fontSize = Math.max(11, Math.round(element.height * 0.38));
  return `<select style="${styleString({
    position: 'absolute',
    left: px(element.x),
    top: px(element.y),
    width: px(element.width),
    height: px(element.height),
    padding: `0 ${px(Math.max(6, Math.round(element.height * 0.2)))}`,
    color: element.textColor,
    'font-size': px(fontSize),
    'font-weight': element.fontWeight || 400,
    background: element.background,
    border: element.border !== 'none' ? element.border : '1px solid #d0d7de',
    'border-radius': px(element.borderRadius),
    outline: 'none',
    'z-index': element.zIndex,
    cursor: 'pointer',
    appearance: 'auto',
  })}" data-source-id="${element.sourceId}" data-kind="${element.kind}" data-semantic-type="${element.semanticType}"><option>${escapeHtml(textValue || '')}</option></select>`;
}

// T16: Icon → HTML comment with size/color + Lucide mapping suggestion
const LUCIDE_ICON_MAP = [
  [/search|find|query/i, 'Search'],
  [/menu|hamburger|nav/i, 'Menu'],
  [/close|dismiss|cancel/i, 'X'],
  [/settings|gear|config/i, 'Settings'],
  [/user|profile|account/i, 'User'],
  [/home|house/i, 'Home'],
  [/bell|notif/i, 'Bell'],
  [/star|fav/i, 'Star'],
  [/heart|like/i, 'Heart'],
  [/plus|add/i, 'Plus'],
  [/edit|pencil|pen/i, 'Pencil'],
  [/trash|delete|remove/i, 'Trash2'],
  [/arrow.*right|next/i, 'ArrowRight'],
  [/arrow.*left|back/i, 'ArrowLeft'],
  [/arrow.*down|expand/i, 'ChevronDown'],
  [/check|done|tick/i, 'Check'],
  [/info|about/i, 'Info'],
  [/warn|alert/i, 'AlertTriangle'],
  [/mail|email/i, 'Mail'],
  [/link|url/i, 'Link'],
  [/copy|clipboard/i, 'Copy'],
  [/share/i, 'Share2'],
  [/download/i, 'Download'],
  [/upload/i, 'Upload'],
  [/eye|view/i, 'Eye'],
  [/lock|secure/i, 'Lock'],
  [/code|dev/i, 'Code2'],
  [/git|branch/i, 'GitBranch'],
  [/image|photo|pic/i, 'Image'],
  [/file|doc/i, 'FileText'],
  [/folder|dir/i, 'Folder'],
  [/calendar|date/i, 'Calendar'],
  [/clock|time/i, 'Clock'],
  [/map|location|pin/i, 'MapPin'],
  [/phone|call/i, 'Phone'],
  [/chart|graph|stat/i, 'BarChart2'],
  [/filter/i, 'Filter'],
  [/sort/i, 'ArrowUpDown'],
  [/refresh|reload/i, 'RefreshCw'],
  [/external|open/i, 'ExternalLink'],
];

function suggestLucideIcon(text, color, w, h) {
  const t = (text || '').toLowerCase();
  for (const [re, name] of LUCIDE_ICON_MAP) {
    if (re.test(t)) return name;
  }
  // Size-based fallback
  if (w <= 16 && h <= 16) return 'Dot';
  return 'Square';
}

function renderIconPlaceholder(element) {
  const w = element.width, h = element.height;
  const color = element.background || '#9ca3af';
  const lucide = suggestLucideIcon(element.text, color, w, h);
  // T16: HTML comment with metadata + Lucide suggestion
  const comment = `<!-- ICON: ${w}x${h}px color=${color} lucide="${lucide}" text="${element.text||''}" -->`;
  return `${comment}<div style="${styleString({
    position: 'absolute',
    left: px(element.x),
    top: px(element.y),
    width: px(w),
    height: px(h),
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    'z-index': element.zIndex,
  })}" data-source-id="${element.sourceId}" data-kind="${element.kind}" data-semantic-type="${element.semanticType}"><svg width="${Math.min(w,24)}" height="${Math.min(h,24)}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="12" cy="12" r="3"/></svg></div>`;
}

function renderImagePlaceholder(element) {
  // T16: Small elements are icons, large are image placeholders
  const isIcon = element.width <= 32 && element.height <= 32;
  if (isIcon) return renderIconPlaceholder(element);

  // T17: Gradient background support
  const grad = element.gradient;
  let bgStyle;
  if (grad) {
    bgStyle = `linear-gradient(${grad.direction}, ${grad.stops.join(', ')})`;
  } else {
    bgStyle = element.background || '#e8eaed';
  }

  return `<div style="${styleString({
    position: 'absolute',
    left: px(element.x),
    top: px(element.y),
    width: px(element.width),
    height: px(element.height),
    background: bgStyle,
    border: '1px solid #d0d7de',
    'border-radius': px(element.borderRadius),
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    overflow: 'hidden',
    'z-index': element.zIndex,
  })}" data-source-id="${element.sourceId}" data-kind="${element.kind}" data-semantic-type="${element.semanticType}"><svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="1.5"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg></div>`;
}

function renderInlineControl(element, textValue, tagName = 'button') {
  const fontSize = fitTextSize(textValue, element.fontSize || 14, element.width * 0.88, element.height * 0.8, element.fontWeight || 600, 9);
  return `<${tagName} ${tagName === 'button' ? 'type="button"' : ''} style="${styleString({
    position: 'absolute',
    left: px(element.x),
    top: px(element.y),
    width: px(element.width),
    height: px(element.height),
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    padding: '0 6%',
    color: element.textColor,
    'font-size': px(fontSize),
    'font-weight': element.fontWeight,
    'line-height': '1',
    'text-align': 'center',
    'white-space': 'nowrap',
    background: element.background,
    border: element.border,
    'border-radius': px(element.borderRadius),
    'z-index': element.zIndex,
    overflow: 'visible',
  })}" data-source-id="${element.sourceId}" data-kind="${element.kind}" data-semantic-type="${element.semanticType}">${escapeHtml(textValue)}</${tagName}>`;
}

function renderShape(element, content, frame = null, tagName = 'div') {
  const metrics = getRelativeMetrics(element, frame);
  const radius = element.semanticType === 'toolbar'
    ? 0
    : element.semanticType === 'avatar'
      ? Math.max(element.width, element.height)
      : element.semanticType === 'icon'
        ? Math.max(element.borderRadius, 6)
        : element.borderRadius;
  const overflow = (element.semanticType === 'avatar' || element.semanticType === 'icon') ? 'hidden' : 'visible';
  const hasChildren = Boolean(content);
  const borderBottom = element.semanticType === 'toolbar' ? '1px solid #d0d7de' : undefined;

  // T17: Gradient background
  const bgStyle = element.gradient
    ? `linear-gradient(${element.gradient.direction}, ${element.gradient.stops.join(', ')})`
    : element.background;

  // T7: Glassmorphism flag
  const backdropFilter = element.glassmorphism ? 'blur(12px)' : undefined;
  const bgOpacity = element.glassmorphism ? (bgStyle + '99') : bgStyle;

  // T18: Per-component hover state flagging via data attribute
  const hoverFlag = (element.semanticType === 'button' || element.semanticType === 'chip' || element.semanticType === 'card')
    ? ` data-hover="true"` : '';

  return `<${tagName} class="screen-shape screen-${element.type}" ${tagName === 'button' ? 'type="button"' : ''}${hoverFlag} style="${styleString({
    position: 'absolute',
    left: px(metrics.left),
    top: px(metrics.top),
    width: px(metrics.width),
    height: px(metrics.height),
    background: bgOpacity,
    'backdrop-filter': backdropFilter,
    border: element.border,
    'border-bottom': borderBottom,
    'border-radius': px(radius),
    overflow,
    'z-index': element.zIndex,
    isolation: hasChildren ? 'isolate' : undefined,
  })}" data-source-id="${element.sourceId}" data-kind="${element.kind}" data-semantic-type="${element.semanticType}" data-parent-id="${element.parentId ?? ''}" data-row-id="${element.rowId ?? ''}">${content || ''}</${tagName}>`;
}

function renderText(element, frame = null, pageBg = null) {
  const metrics = getRelativeMetrics(element, frame);
  const box = textBoxForElement(element, metrics, frame);
  const fittedFontSize = fitTextSize(element.text, element.fontSize, box.width, box.height, element.fontWeight, 9);
  const localZIndex = frame ? Math.min(element.zIndex, 5) : element.zIndex;

  // For orphan texts (no parent frame), check contrast against page background
  let textColor = element.textColor;
  if (!frame && pageBg && !isTransparent(pageBg)) {
    if (contrastRatio(textColor, pageBg) < 1.5 || colorDistance(textColor, pageBg) < 30) {
      textColor = bestContrastText(pageBg);
    }
  }
  const baseStyle = {
    position: 'absolute',
    left: px(metrics.left),
    top: px(metrics.top),
    width: px(metrics.width),
    'min-height': px(metrics.height),
    color: textColor,
    'font-size': px(fittedFontSize),
    'font-weight': element.fontWeight,
    'line-height': '1.2',
    'text-align': element.textAlign,
    'white-space': 'normal',
    'word-wrap': 'normal',
    'overflow-wrap': 'normal',
    overflow: 'visible',
    background: 'transparent',
    border: 'none',
    'z-index': localZIndex,
  };

  if (element.layoutHint === 'fill-center') {
    delete baseStyle.left;
    delete baseStyle.top;
    delete baseStyle.width;
    delete baseStyle['min-height'];
    Object.assign(baseStyle, {
      inset: '0',
      display: 'flex',
      'align-items': 'center',
      'justify-content': 'center',
      padding: '0 8%',
      'text-align': 'center',
    });
  } else if (element.layoutHint === 'input-inline') {
    baseStyle.top = '50%';
    baseStyle.transform = 'translateY(-50%)';
    baseStyle['min-height'] = px(element.height);
  } else if (element.layoutHint === 'center-y') {
    baseStyle.top = '50%';
    baseStyle.transform = 'translateY(-50%)';
  }

  return `<div class="screen-text" style="${styleString(baseStyle)}" data-source-id="${element.sourceId}" data-kind="${element.kind}" data-semantic-type="${element.semanticType}" data-parent-id="${element.parentId ?? ''}" data-row-id="${element.rowId ?? ''}">${escapeHtml(element.text)}</div>`;
}

function buildHierarchy(elements) {
  const bySourceId = new Map(elements.map((element) => [element.sourceId, element]));
  const childrenByParent = new Map();
  const roots = [];

  for (const element of elements) {
    const parent = element.parentId !== null && element.parentId !== undefined
      ? bySourceId.get(element.parentId)
      : null;

    if (parent && parent.kind === 'shape') {
      const siblings = childrenByParent.get(parent.sourceId) || [];
      siblings.push(element);
      childrenByParent.set(parent.sourceId, siblings);
      continue;
    }

    roots.push(element);
  }

  const sortNodes = (items = []) => items.sort((left, right) => (
    (left.zIndex - right.zIndex) ||
    (left.y - right.y) ||
    (left.x - right.x)
  ));

  for (const [parentId, children] of childrenByParent.entries()) {
    childrenByParent.set(parentId, sortNodes(children));
  }

  return {
    roots: sortNodes(roots),
    childrenByParent,
  };
}

function findNearestText(element, allElements) {
  // Find orphan text elements that spatially overlap or are very close to this element
  const ex = element.x, ey = element.y, ew = element.width, eh = element.height;
  const candidates = allElements.filter((e) => {
    if (e.kind !== 'text' || !e.text || e.parentId !== null) return false;
    const tx = e.x, ty = e.y, tw = e.width, th = e.height;
    const overlapX = Math.max(0, Math.min(ex + ew, tx + tw) - Math.max(ex, tx));
    const overlapY = Math.max(0, Math.min(ey + eh, ty + th) - Math.max(ey, ty));
    const centerDist = Math.hypot((tx + tw/2) - (ex + ew/2), (ty + th/2) - (ey + eh/2));
    return (overlapX > 0 && overlapY > 0) || centerDist < Math.max(ew, eh) * 0.8;
  });
  if (!candidates.length) return null;
  return candidates.sort((a, b) => {
    const da = Math.hypot((a.x + a.width/2) - (ex + ew/2), (a.y + a.height/2) - (ey + eh/2));
    const db = Math.hypot((b.x + b.width/2) - (ex + ew/2), (b.y + b.height/2) - (ey + eh/2));
    return da - db;
  })[0];
}

function renderNode(element, childrenByParent, frame = null, pageBg = null, allElements = []) {
  if (element.kind === 'background') return renderBackground(element);
  
  if (element.kind === 'text' && element.layoutHint === 'fill-center') return '';
  if (element.kind === 'text' && element.layoutHint === 'input-inline') return '';
  if (element.kind === 'text') return renderText(element, frame, pageBg);

  // Image placeholder
  if (element.semanticType === 'image' || element.type === 'image') {
    return renderImagePlaceholder(element);
  }

  const children = childrenByParent.get(element.sourceId) || [];
  const inlineSelection = selectInlineText(children, element.semanticType);
  const inlineText = inlineSelection.text;
  const inlineTextNode = inlineSelection.node;

  // Toggle switch
  if (element.semanticType === 'toggle' || element.type === 'toggle') {
    const isOn = !isTransparent(element.background);
    return `<button type="button" aria-pressed="${isOn}" style="${styleString({
      position: 'absolute',
      left: px(element.x),
      top: px(element.y),
      width: px(element.width),
      height: px(element.height),
      background: element.background,
      border: element.border,
      'border-radius': px(element.borderRadius),
      'z-index': element.zIndex,
      cursor: 'pointer',
    })}" data-source-id="${element.sourceId}" data-kind="${element.kind}" data-semantic-type="toggle"></button>`;
  }

  // Select / dropdown
  if (element.semanticType === 'select' || element.type === 'select') {
    const label = inlineText || element.text || '';
    const textColor = inlineTextNode?.textColor || element.textColor || '#24292f';
    return renderSelectControl({ ...element, textColor }, label);
  }

  if (children.length === 0) {
    // Large panels/shapes with no children and no text are likely image regions
    const isLargeImageRegion = element.width > 100 && element.height > 80
      && (element.semanticType === 'panel' || element.type === 'panel')
      && !isTransparent(element.background);
    if (isLargeImageRegion) return renderImagePlaceholder(element);
    const isTransparentShape = (element.type === 'shape' || element.semanticType === 'shape')
      && isTransparent(element.background)
      && element.border === 'none';
    if (isTransparentShape && element.semanticType !== 'unknown') return '';
    if (element.semanticType === 'input' && element.width < 100) return '';
    if (element.semanticType === 'chip' && !element.text) return '';
  }

  if (
    element.semanticType === 'chip' &&
    inlineText &&
    (!CHIP_BADGE_PATTERN.test(inlineText.trim()) || inlineText.split(/\s+/).length > 2 || element.width > 120)
  ) {
    return renderDetachedChildren(children, childrenByParent, element, pageBg, allElements);
  }

  if (element.semanticType === 'input' && inlineText && !INPUT_LABEL_PATTERN.test(inlineText)) {
    return renderDetachedChildren(children, childrenByParent, element, pageBg, allElements);
  }

  if ((element.semanticType === 'button' || element.semanticType === 'chip') && inlineText) {
    const textColor = inlineTextNode?.textColor || element.textColor || '#111827';
    // Cap button font size more aggressively - use actual text node fontSize if available
    const fontSize = inlineTextNode?.fontSize || Math.min(14, Math.max(11, Math.round(element.height * 0.28)));
    const fontWeight = inlineTextNode?.fontWeight || 600;
    const bg = element.background;
    const finalTextColor = (!isTransparent(bg) && (contrastRatio(textColor, bg) < 1.5 || colorDistance(textColor, bg) < 30))
      ? bestContrastText(bg)
      : textColor;
    return renderInlineControl({ ...element, textColor: finalTextColor, fontSize, fontWeight }, inlineText, element.semanticType === 'button' ? 'button' : 'div');
  }

  if ((element.semanticType === 'button' || element.semanticType === 'chip') && !inlineText) {
    const bg = element.background;
    const labelColor = isTransparent(bg) ? '#24292f' : bestContrastText(bg);
    let label = element.text || '';
    if (!label) {
      const isGreenCodeBtn = bg === '#1f883d' || bg === '#2da44e' || bg === '#1a7f37';
      if (isGreenCodeBtn) {
        label = '⬇ Code';
      } else if (allElements.length) {
        const nearest = findNearestText(element, allElements);
        if (nearest) {
          const dist = Math.hypot((nearest.x + nearest.width/2) - (element.x + element.width/2), (nearest.y + nearest.height/2) - (element.y + element.height/2));
          if (dist < Math.max(element.width, element.height) * 0.6) label = nearest.text;
        }
      }
    }
    if (!label || label.trim().length === 0) return '';
    const fontSize = Math.min(14, Math.max(10, Math.round(element.height * 0.28)));
    const finalColor = (!isTransparent(bg) && label) ? (contrastRatio(labelColor, bg) >= 1.5 ? labelColor : bestContrastText(bg)) : labelColor;
    return renderInlineControl({ ...element, textColor: finalColor, fontSize, fontWeight: 600 }, label, element.semanticType === 'button' ? 'button' : 'div');
  }

  if (element.semanticType === 'input' && inlineText) {
    const textColor = inlineTextNode?.textColor || '#6b7280';
    const fontSize = inlineTextNode?.fontSize || Math.min(16, Math.max(11, Math.round(element.height * 0.28)));
    const fontWeight = inlineTextNode?.fontWeight || 400;
    return renderInputControl({ ...element, textColor, fontSize, fontWeight }, inlineText);
  }

  const content = children.map((child) => renderNode(child, childrenByParent, element, pageBg, allElements)).join('');
  return renderShape(element, content, frame);
}

export class ComponentService {
  static async processElements(
    elements = [],
    image = { width: 1440, height: 900, background_color: '#ffffff' },
    refinement = { page_kind: 'generic', hide_shape_ids: [], notes: [] },
    zones = null,
  ) {
    const enriched = await enrichDetectedElements(elements);
    const normalized = enriched
      .map((element, index) => normalizeElement(element, index))
      .sort((a, b) => (a.zIndex - b.zIndex) || (a.y - b.y) || (a.x - b.x));
    applyParentAnchoring(normalized, image);

    return {
      image: {
        width: Number(image.width) || 1440,
        height: Number(image.height) || 900,
        backgroundColor: image.background_color || '#ffffff',
      },
      refinement: {
        pageKind: refinement?.page_kind || 'generic',
        notes: Array.isArray(refinement?.notes) ? refinement.notes : [],
      },
      elements: normalized,
      zones: zones || null,
    };
  }

  static generateHTML(processed) {
    const image = processed.image;
    const elements = processed.elements || [];
    const bodyBg = image.backgroundColor || '#f6f8fa';
    const pageKind = processed.refinement?.pageKind || 'generic';

    // Use semantic HTML only for repository/dashboard pages
    const SEMANTIC_KINDS = ['repository', 'dashboard', 'docs'];
    if (SEMANTIC_KINDS.includes(pageKind)) {
      return ComponentService.generateSemanticHTML(processed);
    }

    const hierarchy = buildHierarchy(elements);
    const markup = hierarchy.roots
      .map((element) => renderNode(element, hierarchy.childrenByParent, null, bodyBg, elements))
      .join('\n    ');

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Screen Reconstruction</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: ${bodyBg};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      color: #24292f;
    }
    .viewport {
      min-height: 100vh;
      display: block;
      padding: 16px;
      overflow: auto;
      background: ${bodyBg};
    }
    .canvas {
      position: relative;
      width: ${image.width}px;
      height: ${image.height}px;
      min-width: ${image.width}px;
      min-height: ${image.height}px;
      margin: 0 auto;
      overflow: hidden;
      background: ${image.backgroundColor || '#ffffff'};
    }
    .screen-text {
      overflow: visible;
    }
    .screen-shape {
      overflow: hidden;
    }
    input::placeholder {
      color: inherit;
      opacity: 1;
    }
  </style>
</head>
<body>
  <main class="viewport">
    <section class="canvas" aria-label="Generated reconstruction">
    ${markup}
    </section>
  </main>
</body>
</html>
`;
  }

  static generateSnippets(processed) {
    const image = processed.image || { width: 1440, height: 900, backgroundColor: '#f6f8fa' };
    const elements = processed.elements || [];
    const bodyBg = image.backgroundColor || '#f6f8fa';

    const hierarchy = buildHierarchy(elements);

    const injectAttrs = (html, attrs) => {
      if (!html) return html;
      if (html.includes('{{attrs}}')) return html.replace('{{attrs}}', attrs);
      const idx = html.indexOf('>');
      if (idx === -1) return html;
      // If the tag is self-closing like <input ... />, attrs must appear before the closing.
      return html.slice(0, idx) + ` ${attrs}` + html.slice(idx);
    };

    const renderTemplateSnippet = (element) => {
      const template = element.templateHtml;
      if (!template) return null;

      const attrs = `data-source-id="${element.sourceId}" data-kind="${element.kind}" data-semantic-type="${element.semanticType}"`;

      const baseStyle = {
        position: 'absolute',
        left: px(element.x),
        top: px(element.y),
        width: px(element.width),
        height: px(element.height),
        'z-index': element.zIndex,
      };

      const isText = element.kind === 'text';
      const style = isText
        ? styleString({
          ...baseStyle,
          color: element.textColor,
          'font-size': px(element.fontSize),
          'font-weight': element.fontWeight,
          'line-height': '1.2',
          'text-align': element.textAlign || 'left',
          background: 'transparent',
          border: 'none',
          overflow: 'visible',
        })
        : styleString({
          ...baseStyle,
          background: element.background,
          border: element.border,
          'border-radius': px(element.borderRadius),
          display: ['button', 'chip', 'toggle'].includes(element.semanticType) ? 'flex' : undefined,
          'align-items': ['button', 'chip', 'toggle'].includes(element.semanticType) ? 'center' : undefined,
          'justify-content': ['button', 'chip', 'toggle'].includes(element.semanticType) ? 'center' : undefined,
          color: element.textColor,
          'font-size': px(element.fontSize),
          'font-weight': element.fontWeight,
          'line-height': '1.2',
        });

      const textValue = escapeHtml(element.text || '');
      const filled = template
        .replace(/\{\{style\}\}/g, style)
        .replace(/\{\{text\}\}/g, textValue)
        .replace(/\{\{content\}\}/g, '');

      return injectAttrs(filled, attrs);
    };

    return hierarchy.roots
      .filter((element) => element.kind !== 'background')
      .map((element) => {
        const templated = renderTemplateSnippet(element);
        const html = templated || renderNode(element, hierarchy.childrenByParent, null, bodyBg, elements);
        return {
          id: element.id,
          sourceId: element.sourceId,
          kind: element.kind,
          semanticType: element.semanticType,
          x: element.x,
          y: element.y,
          width: element.width,
          height: element.height,
          html,
        };
      })
      .filter((snippet) => snippet.html && snippet.html.trim().length > 0);
  }

  static generateSemanticHTML(processed) {
    const image = processed.image;
    const elements = processed.elements || [];
    const bodyBg = image.backgroundColor || '#f6f8fa';
    const isDark = (() => { const rgb = hexToRgb(bodyBg); return rgb ? (rgb.r * 0.299 + rgb.g * 0.587 + rgb.b * 0.114) < 128 : false; })();
    const textColor = isDark ? '#f0f0f0' : '#1f2328';
    const mutedColor = isDark ? '#aaaacc' : '#57606a';
    const imgH = image.height || 900;

    const sorted = [...elements].sort((a, b) => (a.y - b.y) || (a.x - b.x));

    // Adaptive band detection - find actual nav/header positions
    const toolbars = sorted.filter(e => e.kind === 'shape' && e.semanticType === 'toolbar');
    const firstToolbar = toolbars.find(t => t.y < imgH * 0.15);
    const navH = firstToolbar ? (firstToolbar.y + firstToolbar.height + 10) : imgH * 0.12;
    
    // Find first large text (likely a heading) to determine header end
    const largeTexts = sorted.filter(e => e.kind === 'text' && e.height > 20);
    const firstHeading = largeTexts.find(t => t.y > navH);
    const headerH = firstHeading ? Math.min(firstHeading.y + firstHeading.height + 40, imgH * 0.35) : imgH * 0.30;
    
    const tabH = navH + (headerH - navH) * 0.3;
    const footerY = imgH * 0.85;

    const navTexts = sorted.filter(e => e.kind === 'text' && e.y < navH);
    const tabTexts = sorted.filter(e => e.kind === 'text' && e.y >= navH && e.y < tabH);
    const headerTexts = sorted.filter(e => e.kind === 'text' && e.y >= tabH && e.y < headerH);
    const bodyTexts = sorted.filter(e => e.kind === 'text' && e.y >= headerH && e.y < footerY);
    const footerTexts = sorted.filter(e => e.kind === 'text' && e.y >= footerY);
    const buttons = sorted.filter(e => e.kind === 'shape' && (e.semanticType === 'button' || e.semanticType === 'chip') && e.text);
    const inputs = sorted.filter(e => e.kind === 'shape' && e.semanticType === 'input');
    const toggles = sorted.filter(e => e.kind === 'shape' && e.semanticType === 'toggle');

    const navBg = sorted.find(e => e.kind === 'shape' && e.semanticType === 'toolbar' && e.y < navH)?.background || (isDark ? '#1c1a2a' : '#24292f');
    const tabBg = sorted.find(e => e.kind === 'shape' && e.semanticType === 'toolbar' && e.y >= navH && e.y < tabH)?.background || bodyBg;

    const esc = escapeHtml;
    const col = (e) => e.textColor || textColor;
    // Use actual fontSize from element, with fallback to height-based calculation
    const fs = (e, min = 12) => {
      // Prefer actual detected fontSize over height-based calculation
      if (e.fontSize && e.fontSize > 14) {
        return `${Math.round(e.fontSize)}px`;
      }
      const fromHeight = e.height ? Math.round(e.height * 0.72) : 0;
      const baseSize = fromHeight || e.fontSize || 14;
      // Scale up large headings properly
      if (baseSize > 24) return `${Math.round(baseSize * 1.2)}px`;
      if (baseSize > 18) return `${Math.round(baseSize * 1.1)}px`;
      return `${Math.max(min, baseSize)}px`;
    };
    const fw = (e) => e.fontWeight || 400;
    // Derive button height from element height
    const btnH = (e) => e.height ? `${e.height}px` : '32px';

    // NAV
    const logoEl = navTexts.sort((a,b) => a.x - b.x)[0];
    const navLinkEls = navTexts.filter(e => e !== logoEl).sort((a,b) => a.x - b.x);
    const navBtnEls = buttons.filter(e => e.y < navH);
    const navInputEls = inputs.filter(e => e.y < navH);

    const navHTML = `<nav style="background:${navBg};display:flex;align-items:center;padding:0 1.5rem;height:60px;gap:1rem;border-bottom:1px solid rgba(128,128,128,0.2);">
  ${logoEl ? `<span style="color:${col(logoEl)};font-size:${fs(logoEl,16)};font-weight:700;white-space:nowrap;">${esc(logoEl.text)}</span>` : ''}
  ${navInputEls.map(e => `<input placeholder="${esc(e.text||'Search')}" style="background:${e.background};border:${e.border};border-radius:${e.borderRadius}px;padding:0 10px;height:${btnH(e)};font-size:${fs(e,13)};color:${col(e)};outline:none;width:200px;" />`).join('')}
  <div style="display:flex;align-items:center;gap:0.25rem;margin-left:auto;">
    ${navLinkEls.map(e => `<a href="#" style="color:${col(e)};font-size:${fs(e,13)};font-weight:${fw(e)};padding:5px 10px;text-decoration:none;white-space:nowrap;">${esc(e.text)}</a>`).join('')}
    ${navBtnEls.map(e => `<button style="background:${e.background};color:${e.textColor||bestContrastText(e.background)};border:${e.border};border-radius:${e.borderRadius}px;padding:0 14px;height:${btnH(e)};font-size:${fs(e,12)};font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`).join('')}
  </div>
</nav>`;

    // TABS / SUB-NAV
    const tabHTML = tabTexts.length ? `<div style="background:${tabBg};display:flex;align-items:center;padding:0 1.5rem;border-bottom:1px solid #d0d7de;gap:0.25rem;">
  ${tabTexts.sort((a,b)=>a.x-b.x).map(e => `<a href="#" style="color:${col(e)};font-size:${fs(e,13)};font-weight:${fw(e)};padding:10px 12px;text-decoration:none;white-space:nowrap;border-bottom:2px solid transparent;">${esc(e.text)}</a>`).join('')}
</div>` : '';

    // HEADER ROW (repo title, badges, action buttons)
    const headerBtnEls = buttons.filter(e => e.y >= tabH && e.y < headerH);
    const headerHTML = (headerTexts.length || headerBtnEls.length) ? `<div style="display:flex;align-items:center;gap:0.75rem;padding:1rem 1.5rem;flex-wrap:wrap;border-bottom:1px solid #d0d7de;">
  ${headerTexts.sort((a,b)=>a.x-b.x).map(e => `<span style="color:${col(e)};font-size:${fs(e,13)};font-weight:${fw(e)};white-space:nowrap;">${esc(e.text)}</span>`).join('')}
  <div style="margin-left:auto;display:flex;gap:0.5rem;flex-wrap:wrap;">
    ${headerBtnEls.map(e => `<button style="background:${e.background};color:${e.textColor||bestContrastText(e.background)};border:${e.border};border-radius:${e.borderRadius}px;padding:0 12px;height:${btnH(e)};font-size:${fs(e,12)};font-weight:600;cursor:pointer;white-space:nowrap;">${esc(e.text)}</button>`).join('')}
  </div>
</div>` : '';

    // BODY — group by rows, split left/right by x midpoint
    const midX = image.width * 0.7;
    const leftTexts = bodyTexts.filter(e => e.x < midX);
    const rightTexts = bodyTexts.filter(e => e.x >= midX);
    const bodyBtnEls = buttons.filter(e => e.y >= headerH && e.y < footerY);
    const bodyInputEls = inputs.filter(e => e.y >= headerH && e.y < footerY);
    const bodyToggleEls = toggles.filter(e => e.y >= headerH && e.y < footerY);

    // Group left texts into rows — use element height as tolerance (60% overlap needed)
    const rows = [];
    for (const el of [...leftTexts, ...bodyBtnEls.filter(e=>e.x<midX), ...bodyInputEls.filter(e=>e.x<midX), ...bodyToggleEls.filter(e=>e.x<midX)].sort((a,b)=>(a.y-b.y)||(a.x-b.x))) {
      const elH = el.height || 14;
      const row = rows.find(r => Math.abs(r.y - el.y) < elH * 0.6);
      if (row) {
        row.items.push(el);
      } else {
        // Calculate spacing from previous row
        const prevRow = rows[rows.length - 1];
        const spacingTop = prevRow ? Math.max(0, el.y - (prevRow.y + (prevRow.maxHeight || 14))) : 0;
        rows.push({ y: el.y, items: [el], spacingTop, maxHeight: elH });
      }
      // Update max height for the row
      const currentRow = rows[rows.length - 1];
      if (currentRow && elH > (currentRow.maxHeight || 0)) {
        currentRow.maxHeight = elH;
      }
    }

    const renderItem = (el) => {
      if (el.kind === 'text') return `<span style="color:${col(el)};font-size:${fs(el,12)};font-weight:${fw(el)};">${esc(el.text)}</span>`;
      if (el.semanticType === 'input') return `<input placeholder="${esc(el.text||'')}" style="background:${el.background};border:${el.border};border-radius:${el.borderRadius}px;padding:0 8px;height:${btnH(el)};font-size:${fs(el,12)};color:${col(el)};outline:none;" />`;
      if (el.semanticType === 'toggle') {
        const isOn = !isTransparent(el.background);
        return `<button type="button" aria-pressed="${isOn}" style="background:${el.background};border:${el.border};border-radius:${el.borderRadius}px;width:${el.width}px;height:${el.height}px;cursor:pointer;"></button>`;
      }
      return `<button style="background:${el.background};color:${el.textColor||bestContrastText(el.background)};border:${el.border};border-radius:${el.borderRadius}px;padding:0 12px;height:${btnH(el)};font-size:${fs(el,12)};font-weight:600;cursor:pointer;white-space:nowrap;">${esc(el.text)}</button>`;
    };

    const mainHTML = `<div style="display:flex;gap:1.5rem;padding:1rem 1.5rem;max-width:1280px;margin:0 auto;">
  <div style="flex:1;min-width:0;">
    ${rows.map(row => {
      const gap = row.items.reduce((m, e) => Math.max(m, e.spacingRight || 0), 0);
      const mt = row.spacingTop > 0 ? Math.min(row.spacingTop, 24) : 0;
      return `<div style="display:flex;align-items:center;gap:${gap||12}px;margin-top:${mt}px;flex-wrap:wrap;">${row.items.sort((a,b)=>a.x-b.x).map(renderItem).join('')}</div>`;
    }).join('\n    ')}
  </div>
  ${rightTexts.length ? `<div style="width:280px;flex-shrink:0;display:flex;flex-direction:column;gap:0.5rem;">
    ${[...rightTexts, ...bodyBtnEls.filter(e=>e.x>=midX), ...bodyToggleEls.filter(e=>e.x>=midX)].sort((a,b)=>(a.y-b.y)||(a.x-b.x)).map(renderItem).join('\n    ')}
  </div>` : ''}
</div>`;

    // FOOTER
    const footerBg = sorted.find(e => e.kind === 'shape' && e.y >= footerY)?.background || bodyBg;
    const footerHTML = footerTexts.length ? `<footer style="background:${footerBg};padding:1rem 1.5rem;display:flex;gap:1.5rem;flex-wrap:wrap;border-top:1px solid #d0d7de;">
  ${footerTexts.sort((a,b)=>a.x-b.x).map(e => `<span style="color:${col(e)};font-size:${fs(e,12)};font-weight:${fw(e)};">${esc(e.text)}</span>`).join('')}
</footer>` : '';

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Generated UI</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif; background: ${bodyBg}; color: ${textColor}; min-height: 100vh; }
    a:hover { opacity: 0.8; }
    button { transition: opacity 0.15s; }
    button:hover { opacity: 0.9; cursor: pointer; }
    input:focus { outline: 2px solid #0969da; }
    /* T18: Per-component hover states */
    [data-hover="true"] { transition: opacity 0.15s, transform 0.1s, box-shadow 0.15s; }
    [data-hover="true"]:hover { opacity: 0.9; transform: translateY(-1px); box-shadow: 0 4px 12px rgba(0,0,0,0.12); cursor: pointer; }
    [data-hover="true"]:active { transform: scale(0.97) translateY(0); }
    .screen-card[data-hover="true"]:hover { box-shadow: 0 8px 24px rgba(0,0,0,0.15); }
  </style>
</head>
<body>
${navHTML}
${tabHTML}
${headerHTML}
${mainHTML}
${footerHTML}
</body>
</html>`;
  }
}

export default ComponentService;
