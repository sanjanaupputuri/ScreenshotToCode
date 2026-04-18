/**
 * auditService.js
 * Analyses detected elements + generated HTML and returns a structured QA report.
 */

const SEVERITY = { HIGH: 'high', MEDIUM: 'medium', LOW: 'low' };

// ── Helpers ──────────────────────────────────────────────────────────────────

function center(el) {
  return { cx: el.x + el.width / 2, cy: el.y + el.height / 2 };
}

function overlaps(a, b) {
  return (
    a.x < b.x + b.width && a.x + a.width > b.x &&
    a.y < b.y + b.height && a.y + a.height > b.y
  );
}

function overlapArea(a, b) {
  const ox = Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x));
  const oy = Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y));
  return ox * oy;
}

function sameRow(a, b) {
  const ay = a.y + a.height / 2, by = b.y + b.height / 2;
  return Math.abs(ay - by) <= Math.max(8, Math.min(a.height, b.height) * 0.5);
}

function sameCol(a, b) {
  return Math.abs(a.x - b.x) <= 8;
}

function label(el) {
  return el.text ? `"${el.text.slice(0, 40)}"` : `${el.type}@(${el.x},${el.y})`;
}

// ── Analysis passes ──────────────────────────────────────────────────────────

function checkBoundaries(elements, imageWidth, imageHeight) {
  const issues = [];
  for (const el of elements) {
    if (el.kind === 'background') continue;
    if (el.x < 0 || el.y < 0 || el.x + el.width > imageWidth || el.y + el.height > imageHeight) {
      issues.push({
        element: label(el),
        issue: 'Element extends outside canvas bounds',
        expected: `Within 0,0 – ${imageWidth}x${imageHeight}`,
        actual: `x:${el.x} y:${el.y} w:${el.width} h:${el.height}`,
        severity: SEVERITY.HIGH,
      });
    }
  }
  return issues;
}

function checkOverlaps(elements) {
  const issues = [];
  const visible = elements.filter(e => e.kind !== 'background');
  for (let i = 0; i < visible.length; i++) {
    for (let j = i + 1; j < visible.length; j++) {
      const a = visible[i], b = visible[j];
      // Skip intentional parent-child containment
      if (a.parentId === b.sourceId || b.parentId === a.sourceId) continue;
      if (a.parentId !== null && a.parentId === b.parentId) continue;
      const area = overlapArea(a, b);
      const smaller = Math.min(a.width * a.height, b.width * b.height);
      if (smaller > 0 && area / smaller > 0.25) {
        issues.push({
          element: `${label(a)} ↔ ${label(b)}`,
          issue: `Unintended overlap (${Math.round(area / smaller * 100)}% of smaller element)`,
          expected: 'No overlap between sibling elements',
          actual: `Overlap area: ${Math.round(area)}px²`,
          severity: area / smaller > 0.6 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
        });
      }
    }
  }
  return issues;
}

function checkRowAlignment(elements) {
  const issues = [];
  // Group into rows
  const rows = [];
  for (const el of elements.filter(e => e.kind !== 'background').sort((a, b) => a.y - b.y)) {
    const row = rows.find(r => sameRow(r[0], el));
    if (row) row.push(el); else rows.push([el]);
  }
  for (const row of rows) {
    if (row.length < 2) continue;
    const ys = row.map(e => e.y);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    if (maxY - minY > 8) {
      issues.push({
        element: row.map(label).join(', '),
        issue: `Row elements have inconsistent y positions (spread: ${maxY - minY}px)`,
        expected: 'All row elements aligned to same baseline',
        actual: `y values: ${ys.join(', ')}`,
        severity: maxY - minY > 20 ? SEVERITY.HIGH : SEVERITY.MEDIUM,
      });
    }
  }
  return issues;
}

function checkSpacing(elements) {
  const issues = [];
  // Find groups of 3+ elements in the same row with same parent
  const rows = [];
  for (const el of elements.filter(e => e.kind !== 'background').sort((a, b) => a.y - b.y)) {
    const row = rows.find(r => sameRow(r[0], el) && r[0].parentId === el.parentId);
    if (row) row.push(el); else rows.push([el]);
  }
  for (const row of rows) {
    if (row.length < 3) continue;
    const sorted = [...row].sort((a, b) => a.x - b.x);
    const gaps = [];
    for (let i = 1; i < sorted.length; i++) {
      gaps.push(sorted[i].x - (sorted[i - 1].x + sorted[i - 1].width));
    }
    const median = [...gaps].sort((a, b) => a - b)[Math.floor(gaps.length / 2)];
    const uneven = gaps.filter(g => Math.abs(g - median) > 12);
    if (uneven.length > 0) {
      issues.push({
        element: sorted.map(label).join(', '),
        issue: `Uneven horizontal spacing between row elements`,
        expected: `Consistent gap ~${Math.round(median)}px`,
        actual: `Gaps: ${gaps.map(Math.round).join(', ')}px`,
        severity: SEVERITY.MEDIUM,
      });
    }
  }
  return issues;
}

function checkTextHierarchy(elements) {
  const issues = [];
  const texts = elements.filter(e => e.kind === 'text');
  const fontSizes = texts.map(e => e.fontSize || e.font_size || 14).sort((a, b) => b - a);
  if (fontSizes.length < 2) return issues;

  // Check: no text should be larger than the largest by more than 3x (likely OCR error)
  const maxSize = fontSizes[0];
  for (const el of texts) {
    const fs = el.fontSize || el.font_size || 14;
    if (fs > maxSize * 0.9 && texts.filter(t => (t.fontSize || t.font_size || 14) >= fs * 0.9).length === 1) {
      // Only one element at max size — check it's not absurdly large
      if (fs > 72) {
        issues.push({
          element: label(el),
          issue: `Font size ${fs}px is unusually large (possible OCR height misread)`,
          expected: 'Font size proportional to element height',
          actual: `font-size: ${fs}px`,
          severity: SEVERITY.MEDIUM,
        });
      }
    }
    // Check: text wider than its parent
    if (el.parentId !== null && el.parentId !== undefined) {
      const parent = elements.find(e => e.sourceId === el.parentId || e.id === el.parentId);
      if (parent && el.width > parent.width * 1.1) {
        issues.push({
          element: label(el),
          issue: 'Text element wider than its parent container',
          expected: `Width ≤ ${parent.width}px`,
          actual: `Width: ${el.width}px`,
          severity: SEVERITY.MEDIUM,
        });
      }
    }
  }
  return issues;
}

function checkAbsolutePositioning(html) {
  const matches = (html.match(/position:\s*absolute/g) || []).length;
  const total = (html.match(/<div|<button|<input|<header|<section/g) || []).length;
  if (total === 0) return [];
  const ratio = matches / total;
  if (ratio > 0.7) {
    return [{
      element: 'Generated HTML',
      issue: `${Math.round(ratio * 100)}% of elements use absolute positioning`,
      expected: 'Flex/Grid layout for most elements',
      actual: `${matches} absolute out of ~${total} elements`,
      severity: SEVERITY.MEDIUM,
    }];
  }
  return [];
}

function checkMisclassifiedButtons(elements) {
  const issues = [];
  for (const el of elements) {
    if (el.kind !== 'shape') continue;
    const type = el.semanticType || el.type;
    // Wide, moderate-height shape with text that isn't classified as button
    if (type === 'panel' || type === 'container' || type === 'shape') {
      const aspect = el.width / Math.max(el.height, 1);
      if (aspect >= 2 && aspect <= 10 && el.height >= 24 && el.height <= 80 && el.text) {
        issues.push({
          element: label(el),
          issue: `Shape with text looks like a button but is classified as "${type}"`,
          expected: 'type: button',
          actual: `type: ${type}`,
          severity: SEVERITY.LOW,
        });
      }
    }
  }
  return issues;
}

function checkRefinementEffectiveness(html) {
  const issues = [];
  // Check if Ollama refinement was skipped (HTML has no improved CSS markers)
  if (!html.includes('font-family') || html.includes('refinement skipped')) {
    issues.push({
      element: 'CSS refinement stage',
      issue: 'Visual refinement step appears to have been skipped or failed',
      expected: 'Improved font-family and colour accuracy from Ollama',
      actual: 'Base CSS unchanged',
      severity: SEVERITY.LOW,
    });
  }
  return issues;
}

// ── Main audit function ───────────────────────────────────────────────────────

export function auditLayout(elements, html, image) {
  const imageWidth  = image?.width  || 1440;
  const imageHeight = image?.height || 900;

  const allIssues = [
    ...checkBoundaries(elements, imageWidth, imageHeight),
    ...checkOverlaps(elements),
    ...checkRowAlignment(elements),
    ...checkSpacing(elements),
    ...checkTextHierarchy(elements),
    ...checkAbsolutePositioning(html),
    ...checkMisclassifiedButtons(elements),
    ...checkRefinementEffectiveness(html),
  ];

  const high   = allIssues.filter(i => i.severity === SEVERITY.HIGH);
  const medium = allIssues.filter(i => i.severity === SEVERITY.MEDIUM);
  const low    = allIssues.filter(i => i.severity === SEVERITY.LOW);

  const score = Math.max(0, 100 - high.length * 15 - medium.length * 5 - low.length * 2);

  const drawbacks = [
    high.length   > 0 && `${high.length} high-severity issue(s): boundary violations and major overlaps`,
    medium.length > 0 && `${medium.length} medium-severity issue(s): alignment drift and spacing inconsistency`,
    low.length    > 0 && `${low.length} low-severity issue(s): classification and refinement gaps`,
  ].filter(Boolean);

  const suggestedFixes = [];
  if (high.filter(i => i.issue.includes('bounds')).length)
    suggestedFixes.push('Re-run boundary clamp in correctCoordinates before rendering');
  if (allIssues.some(i => i.issue.includes('overlap')))
    suggestedFixes.push('Increase overlap resolution threshold in correctCoordinates (currently 8px)');
  if (allIssues.some(i => i.issue.includes('y positions')))
    suggestedFixes.push('Tighten row-snapping tolerance in correctCoordinates (currently 6px)');
  if (allIssues.some(i => i.issue.includes('spacing')))
    suggestedFixes.push('Enable spacing normalisation for rows with 2+ elements (currently requires 3+)');
  if (allIssues.some(i => i.issue.includes('absolute positioning')))
    suggestedFixes.push('generateFlexHTML is active — ensure all root elements are being grouped into rows');
  if (allIssues.some(i => i.issue.includes('button but is classified')))
    suggestedFixes.push('Lower classifySemanticType button detection threshold or pass text presence from Python');
  if (allIssues.some(i => i.issue.includes('refinement')))
    suggestedFixes.push('Check Ollama service health at /api/status — refinement requires llama3.2 running');

  return {
    summary: `Layout accuracy score: ${score}/100. ${allIssues.length} issue(s) found across ${elements.length} elements.`,
    drawbacks,
    deviations: allIssues.map(({ severity: _, ...rest }) => rest),
    severity: {
      high:   high.map(i => i.issue),
      medium: medium.map(i => i.issue),
      low:    low.map(i => i.issue),
    },
    suggested_fixes: suggestedFixes,
  };
}
