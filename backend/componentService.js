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
  const fontSize =
    textRole === 'title' ? Math.max(Number(raw.font_size) || 14, 18) :
    textRole === 'muted' ? Math.max(11, (Number(raw.font_size) || 12) - 1) :
    Number(raw.font_size) || 14;
  const fontWeight =
    textRole === 'title' ? Math.max(Number(raw.font_weight) || 600, 700) :
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

  return {
    id: `${kind}-${sourceId}`,
    sourceId,
    kind,
    type: raw.type || kind,
    semanticType,
    textRole,
    text: raw.text || '',
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
    zIndex: kind === 'text' ? 100 : (Number(raw.z_index) || 1),  // FORCE text to z=100
    confidence: Number(raw.confidence) || 0,
    quality: Number(raw.quality) || 0,
    parentId: raw.parent_id ?? null,
    parentType: raw.parent_type ?? null,
    rowId: raw.row_id ?? null,
    layoutHint: raw.layout_hint || null,
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
  return `<div class="screen-bg" style="${styleString({
    position: 'absolute',
    inset: '0',
    background: element.background,
    'z-index': element.zIndex,
  })}"></div>`;
}

function textMetricsForEstimate(text, fontSize, fontWeight = 400, maxWidth = Infinity) {
  const normalized = String(text || '').replace(/\r/g, '');
  const lines = normalized.split('\n');
  const weightFactor = fontWeight >= 700 ? 0.62 : fontWeight >= 600 ? 0.59 : 0.56;
  const spaceWidth = fontSize * 0.33;

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
      const wordWidth = Math.max(fontSize * 0.5, word.length * fontSize * weightFactor);
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

function fitTextSize(text, preferredSize, maxWidth, maxHeight, fontWeight = 400, minSize = 9) {
  let size = Math.max(minSize, Math.round(preferredSize || 14));
  const targetWidth = Math.max(8, maxWidth || 8);
  const targetHeight = Math.max(size, maxHeight || size);

  while (size > minSize) {
    const metrics = textMetricsForEstimate(text, size, fontWeight, targetWidth);
    const lineHeight = size * 1.18;
    if (metrics.widestLine <= targetWidth + 0.5 && (metrics.lineCount * lineHeight) <= targetHeight + 0.5) {
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
      if (Math.abs(centerY - row.centerY) <= Math.max(8, row.maxHeight * 0.78, child.height * 0.78)) {
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

function renderDetachedChildren(children, childrenByParent, frame = null, pageBg = null) {
  return children.map((child) => {
    if (child.kind === 'text') {
      return renderText({
        ...child,
        layoutHint: null,
        textAlign: child.textAlign === 'center' ? 'left' : child.textAlign,
      }, frame, pageBg);
    }
    return renderNode(child, childrenByParent, frame, pageBg);
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
  })}" />`;
}

function renderInlineControl(element, textValue, tagName = 'button') {
  const fontSize = fitTextSize(textValue, element.fontSize || 14, element.width * 0.82, element.height * 0.72, element.fontWeight || 600, 10);
  return `<${tagName} ${tagName === 'button' ? 'type="button"' : ''} style="${styleString({
    position: 'absolute',
    left: px(element.x),
    top: px(element.y),
    width: px(element.width),
    height: px(element.height),
    display: 'flex',
    'align-items': 'center',
    'justify-content': 'center',
    padding: '0 8%',
    color: element.textColor,
    'font-size': px(fontSize),
    'font-weight': element.fontWeight,
    'line-height': '1.18',
    'text-align': 'center',
    background: element.background,
    border: element.border,
    'border-radius': px(element.borderRadius),
    'z-index': element.zIndex,
    overflow: 'hidden',
  })}">${escapeHtml(textValue)}</${tagName}>`;
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
  // Toolbars get a subtle bottom border for visual separation
  const borderBottom = element.semanticType === 'toolbar' ? '1px solid #d0d7de' : undefined;
  return `<${tagName} class="screen-shape screen-${element.type}" ${tagName === 'button' ? 'type="button"' : ''} style="${styleString({
    position: 'absolute',
    left: px(metrics.left),
    top: px(metrics.top),
    width: px(metrics.width),
    height: px(metrics.height),
    background: element.background,
    border: element.border,
    'border-bottom': borderBottom,
    'border-radius': px(radius),
    overflow,
    'z-index': element.zIndex,
    isolation: hasChildren ? 'isolate' : undefined,
  })}" data-parent-id="${element.parentId ?? ''}" data-row-id="${element.rowId ?? ''}">${content || ''}</${tagName}>`;
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
    'line-height': '1.18',
    'text-align': element.textAlign,
    'white-space': 'pre-wrap',
    'word-break': 'break-word',
    overflow: 'hidden',
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

  return `<div class="screen-text" style="${styleString(baseStyle)}" data-parent-id="${element.parentId ?? ''}" data-row-id="${element.rowId ?? ''}">${escapeHtml(element.text)}</div>`;
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
  if (element.kind === 'text') return renderText(element, frame, pageBg);

  const children = childrenByParent.get(element.sourceId) || [];
  const inlineSelection = selectInlineText(children, element.semanticType);
  const inlineText = inlineSelection.text;
  const inlineTextNode = inlineSelection.node;

  // Only drop truly invisible/noise shapes (generic 'shape' type with no children and no background)
  if (children.length === 0) {
    const isTransparentShape = (element.type === 'shape' || element.semanticType === 'shape')
      && isTransparent(element.background)
      && element.border === 'none';
    if (isTransparentShape) return '';
    if (element.semanticType === 'input' && element.width < 100) return '';
  }

  if (
    element.semanticType === 'chip' &&
    inlineText &&
    (!CHIP_BADGE_PATTERN.test(inlineText.trim()) || inlineText.split(/\s+/).length > 2 || element.width > 120)
  ) {
    return renderDetachedChildren(children, childrenByParent, element, pageBg);
  }

  if (element.semanticType === 'input' && inlineText && !INPUT_LABEL_PATTERN.test(inlineText)) {
    return renderDetachedChildren(children, childrenByParent, element, pageBg);
  }

  if ((element.semanticType === 'button' || element.semanticType === 'chip') && inlineText) {
    const textColor = inlineTextNode?.textColor || element.textColor || '#111827';
    const fontSize = inlineTextNode?.fontSize || Math.max(12, Math.round(element.height * 0.34));
    const fontWeight = inlineTextNode?.fontWeight || 600;
    // Ensure button text contrasts against button background
    const bg = element.background;
    const finalTextColor = (!isTransparent(bg) && (contrastRatio(textColor, bg) < 1.5 || colorDistance(textColor, bg) < 30))
      ? bestContrastText(bg)
      : textColor;
    return renderInlineControl({ ...element, textColor: finalTextColor, fontSize, fontWeight }, inlineText, element.semanticType === 'button' ? 'button' : 'div');
  }

  // Button with no text children — find nearest orphan text as label
  if ((element.semanticType === 'button' || element.semanticType === 'chip') && !inlineText) {
    const bg = element.background;
    const labelColor = isTransparent(bg) ? '#24292f' : bestContrastText(bg);
    // Special case: green GitHub "Code" button
    const isGreenCodeBtn = bg === '#1f883d' || bg === '#2da44e' || bg === '#1a7f37';
    let label = '';
    if (isGreenCodeBtn) {
      label = '⬇ Code';
    } else if (allElements.length) {
      const nearest = findNearestText(element, allElements);
      // Only use nearest text if it's actually overlapping or very close (not just nearby)
      if (nearest) {
        const dist = Math.hypot((nearest.x + nearest.width/2) - (element.x + element.width/2), (nearest.y + nearest.height/2) - (element.y + element.height/2));
        if (dist < Math.max(element.width, element.height) * 0.6) label = nearest.text;
      }
    }
    return renderInlineControl({ ...element, textColor: labelColor, fontSize: Math.max(11, Math.round(element.height * 0.34)), fontWeight: 600 }, label, element.semanticType === 'button' ? 'button' : 'div');
  }

  if (element.semanticType === 'input' && inlineText) {
    const textColor = inlineTextNode?.textColor || '#6b7280';
    const fontSize = inlineTextNode?.fontSize || Math.max(12, Math.round(element.height * 0.3));
    const fontWeight = inlineTextNode?.fontWeight || 400;
    return renderInputControl({ ...element, textColor, fontSize, fontWeight }, inlineText);
  }

  const content = children.map((child) => renderNode(child, childrenByParent, element, pageBg, allElements)).join('');
  return renderShape(element, content, frame);
}

export class ComponentService {
  static processElements(
    elements = [],
    image = { width: 1440, height: 900, background_color: '#ffffff' },
    refinement = { page_kind: 'generic', hide_shape_ids: [], notes: [] },
  ) {
    const normalized = enrichDetectedElements(elements)
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
    };
  }

  static generateHTML(processed) {
    const image = processed.image;
    const elements = processed.elements || [];
    const bodyBg = image.backgroundColor || '#f6f8fa';
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
</html>`;
  }
}

export default ComponentService;
