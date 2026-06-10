import PDFDocument from 'pdfkit';

import type {
  ReportData,
  ReportFixture,
  ReportFixtureStatus,
} from './report.types';

// =============================================================================
// PDF rendering for the compliance report.
// =============================================================================
//
// TCC brand: warm monochrome (paper/surface/ink/graphite/steel/mist) + ONE
// signal red. COLOUR-BLIND SAFE is a hard requirement — the GRB CEO is colour
// blind and sees red — so every verdict carries an ICON GLYPH + a TEXT LABEL,
// never hue alone. Colour is decoration; the glyph + word carry the meaning.
//
// pdfkit ships Helvetica (a clean geometric-ish sans) by default — close enough
// to the Questrial/Futura family without bundling a font file into the API.
// =============================================================================

const BRAND = {
  paper: '#FBFBF9',
  surface: '#F3F2EE',
  ink: '#0E0E0D',
  graphite: '#3C3B36',
  steel: '#7E7D77',
  mist: '#BEBDB6',
  red: '#B23A2E', // the one signal accent
  green: '#3E7C5A',
  amber: '#C9892F',
} as const;

// Verdict presentation: glyph + label + colour. The glyph and label are what a
// colour-blind reader uses; colour merely reinforces.
const VERDICT_STYLE: Record<
  ReportFixtureStatus | 'incomplete',
  { glyph: string; label: string; color: string }
> = {
  perfect: { glyph: '★', label: 'PERFECT', color: BRAND.green }, // ★
  good: { glyph: '✓', label: 'GOOD', color: BRAND.green }, // ✓
  not_good: { glyph: '✕', label: 'NOT GOOD', color: BRAND.red }, // ✕
  needs_review: { glyph: '⚠', label: 'NEEDS REVIEW', color: BRAND.amber }, // ⚠
  not_submitted: { glyph: '○', label: 'NOT SUBMITTED', color: BRAND.steel }, // ○
  not_applicable: { glyph: '—', label: 'NOT APPLICABLE', color: BRAND.mist }, // —
  incomplete: { glyph: '○', label: 'INCOMPLETE', color: BRAND.amber }, // ○
};

const MARGIN = 54;
const PAGE_WIDTH = 595.28; // A4 portrait, points
const CONTENT_WIDTH = PAGE_WIDTH - MARGIN * 2;

/**
 * Render `data` into a streaming PDF document. The caller pipes the returned
 * doc into the HTTP response and is responsible for setting headers; here we
 * only build and `end()` the document.
 */
export function renderReport(data: ReportData): PDFKit.PDFDocument {
  const doc = new PDFDocument({
    size: 'A4',
    margins: { top: MARGIN, bottom: MARGIN, left: MARGIN, right: MARGIN },
    info: {
      Title: `Compliance Report — ${data.store.name} — ${data.campaign.key}`,
      Author: 'Wally · The Cookware Company',
      Subject: `Visual-merchandising compliance · ${data.campaign.name}`,
    },
  });

  paintHeader(doc, data);
  paintStoreVerdict(doc, data);
  paintSummary(doc, data);
  paintFixtures(doc, data);
  paintExtraQuestions(doc, data);
  paintFooter(doc, data);

  doc.end();
  return doc;
}

// ----- sections ------------------------------------------------------------

function paintHeader(doc: PDFKit.PDFDocument, data: ReportData): void {
  // Wordmark + product line.
  doc
    .fillColor(BRAND.ink)
    .font('Helvetica-Bold')
    .fontSize(22)
    .text('WALLY', MARGIN, MARGIN);
  doc
    .fillColor(BRAND.steel)
    .font('Helvetica')
    .fontSize(9)
    .text('VISUAL-MERCHANDISING COMPLIANCE  ·  THE COOKWARE COMPANY', {
      characterSpacing: 0.5,
    });

  // Title block.
  doc.moveDown(1.2);
  doc
    .fillColor(BRAND.ink)
    .font('Helvetica-Bold')
    .fontSize(16)
    .text('Compliance Report');
  doc
    .fillColor(BRAND.graphite)
    .font('Helvetica')
    .fontSize(11)
    .text(`${data.store.name}  ·  ${data.store.brand}`);
  doc
    .fillColor(BRAND.steel)
    .fontSize(10)
    .text(
      `Campaign ${data.campaign.key} — ${data.campaign.name}` +
        (data.store.externalRef ? `   ·   Store ref ${data.store.externalRef}` : ''),
    );

  rule(doc, doc.y + 8);
  doc.moveDown(1.4);
}

function paintStoreVerdict(doc: PDFKit.PDFDocument, data: ReportData): void {
  const style = VERDICT_STYLE[data.overall];
  const boxTop = doc.y;
  const boxHeight = 64;

  // Surface card with a thin signal rule on the left in the verdict colour.
  doc.save();
  doc.roundedRect(MARGIN, boxTop, CONTENT_WIDTH, boxHeight, 4).fill(BRAND.surface);
  doc.rect(MARGIN, boxTop, 5, boxHeight).fill(style.color);
  doc.restore();

  // Glyph + label (the colour-blind-safe pair).
  doc
    .fillColor(style.color)
    .font('Helvetica-Bold')
    .fontSize(26)
    .text(style.glyph, MARGIN + 18, boxTop + 16, { lineBreak: false });
  doc
    .fillColor(BRAND.ink)
    .font('Helvetica-Bold')
    .fontSize(18)
    .text(`STORE VERDICT: ${style.label}`, MARGIN + 54, boxTop + 14);

  doc
    .fillColor(BRAND.graphite)
    .font('Helvetica')
    .fontSize(10)
    .text(
      `${data.submitted} of ${data.expected} applicable fixtures scored` +
        (data.totalScore != null ? `   ·   score ${data.totalScore}%` : '') +
        (data.status ? `   ·   ${data.status.toLowerCase()}` : '') +
        (data.submittedAt
          ? `   ·   submitted ${formatDate(data.submittedAt)}`
          : `   ·   generated ${formatDate(data.generatedAt)}`),
      MARGIN + 54,
      boxTop + 40,
    );

  doc.y = boxTop + boxHeight + 22;
}

/** The AI prose summary, when present (a short paragraph under the verdict). */
function paintSummary(doc: PDFKit.PDFDocument, data: ReportData): void {
  if (!data.aiSummary) return;
  ensureSpace(doc, 60);
  doc
    .fillColor(BRAND.ink)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('AI summary');
  doc.moveDown(0.4);
  doc
    .fillColor(BRAND.graphite)
    .font('Helvetica')
    .fontSize(10)
    .text(data.aiSummary, { width: CONTENT_WIDTH });
  doc.moveDown(1.2);
}

/** The extra-question answers (the non-photo report steps). */
function paintExtraQuestions(doc: PDFKit.PDFDocument, data: ReportData): void {
  const answers = data.extraAnswers ?? [];
  if (answers.length === 0) return;
  ensureSpace(doc, 60);
  doc.moveDown(0.5);
  doc
    .fillColor(BRAND.ink)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('Questions');
  doc.moveDown(0.6);
  for (const a of answers) {
    ensureSpace(doc, 34);
    doc
      .fillColor(BRAND.graphite)
      .font('Helvetica-Bold')
      .fontSize(10)
      .text(a.label, MARGIN, doc.y, { width: CONTENT_WIDTH });
    const val = a.isNA
      ? 'N/A'
      : a.type === 'YES_NO'
        ? a.valueBool == null
          ? '—'
          : a.valueBool
            ? 'Yes'
            : 'No'
        : a.valueText && a.valueText.trim()
          ? a.valueText
          : '—';
    doc
      .fillColor(BRAND.ink)
      .font('Helvetica')
      .fontSize(10)
      .text(val, MARGIN, doc.y + 1, { width: CONTENT_WIDTH });
    doc.moveDown(0.6);
  }
}

function paintFixtures(doc: PDFKit.PDFDocument, data: ReportData): void {
  doc
    .fillColor(BRAND.ink)
    .font('Helvetica-Bold')
    .fontSize(12)
    .text('Fixtures');
  doc.moveDown(0.6);

  for (const fixture of data.fixtures) {
    ensureSpace(doc, 70);
    paintFixtureRow(doc, fixture);
  }
}

function paintFixtureRow(doc: PDFKit.PDFDocument, fixture: ReportFixture): void {
  const style = VERDICT_STYLE[fixture.status];
  const top = doc.y;

  // Glyph in the left gutter.
  doc
    .fillColor(style.color)
    .font('Helvetica-Bold')
    .fontSize(13)
    .text(style.glyph, MARGIN, top, { width: 18, lineBreak: false });

  // Label + status word.
  doc
    .fillColor(BRAND.ink)
    .font('Helvetica-Bold')
    .fontSize(11)
    .text(fixture.label, MARGIN + 22, top, { width: CONTENT_WIDTH - 22 - 110, continued: false });

  // Status word, right-aligned on the same baseline.
  doc
    .fillColor(style.color)
    .font('Helvetica-Bold')
    .fontSize(10)
    .text(style.label, MARGIN + CONTENT_WIDTH - 110, top, {
      width: 110,
      align: 'right',
    });

  // Rubric stamp / confidence line.
  if (fixture.rubricVersion) {
    const conf =
      typeof fixture.confidence === 'number'
        ? `   ·   confidence ${(fixture.confidence * 100).toFixed(0)}%`
        : '';
    doc
      .fillColor(BRAND.steel)
      .font('Helvetica')
      .fontSize(8)
      .text(`rubric ${fixture.rubricVersion}${conf}`, MARGIN + 22, doc.y + 2, {
        width: CONTENT_WIDTH - 22,
      });
  }

  // Completed-by attribution (who took the most recent shot).
  if (fixture.completedBy) {
    doc
      .fillColor(BRAND.steel)
      .font('Helvetica')
      .fontSize(8)
      .text(`captured by ${fixture.completedBy}`, MARGIN + 22, doc.y + 2, {
        width: CONTENT_WIDTH - 22,
      });
  }

  // Flagged criteria, each with evidence.
  if (fixture.flags && fixture.flags.length > 0) {
    doc.moveDown(0.2);
    for (const flag of fixture.flags) {
      ensureSpace(doc, 28);
      const flagStyle =
        flag.verdict === 'fail' ? VERDICT_STYLE.not_good : VERDICT_STYLE.needs_review;
      doc
        .fillColor(flagStyle.color)
        .font('Helvetica-Bold')
        .fontSize(9)
        .text(`${flagStyle.glyph} ${flag.criterionId}`, MARGIN + 22, doc.y + 2, {
          width: 130,
          continued: false,
        });
      doc
        .fillColor(BRAND.graphite)
        .font('Helvetica')
        .fontSize(9)
        .text(
          `${flag.evidence}  (conf ${(flag.confidence * 100).toFixed(0)}%)`,
          MARGIN + 160,
          doc.y - doc.currentLineHeight(),
          { width: CONTENT_WIDTH - 160 },
        );
    }
  } else if (isScoredStatus(fixture.status)) {
    doc
      .fillColor(BRAND.steel)
      .font('Helvetica-Oblique')
      .fontSize(8)
      .text('No flagged criteria.', MARGIN + 22, doc.y + 2);
  }

  doc.moveDown(0.5);
  rule(doc, doc.y, BRAND.mist);
  doc.moveDown(0.5);
}

function paintFooter(doc: PDFKit.PDFDocument, data: ReportData): void {
  ensureSpace(doc, 60);
  doc.moveDown(1);
  rule(doc, doc.y);
  doc.moveDown(0.6);
  doc
    .fillColor(BRAND.steel)
    .font('Helvetica')
    .fontSize(8)
    .text(
      'Reproducibility — every verdict in this report is stamped to the exact rubric, ' +
        'model, and prompt version that produced it.',
      { width: CONTENT_WIDTH },
    );
  if (data.rubricVersions.length > 0) {
    doc
      .fillColor(BRAND.graphite)
      .font('Helvetica')
      .fontSize(8)
      .text(`Rubric versions: ${data.rubricVersions.join('  ·  ')}`, {
        width: CONTENT_WIDTH,
      });
  }
  doc
    .fillColor(BRAND.mist)
    .fontSize(7)
    .text(
      'THE CUSTOM CHEF™  By Cuisine::pro®   ·   Generated by Wally',
      { width: CONTENT_WIDTH },
    );
}

// ----- helpers -------------------------------------------------------------

function rule(doc: PDFKit.PDFDocument, y: number, color: string = BRAND.graphite): void {
  doc
    .save()
    .moveTo(MARGIN, y)
    .lineTo(MARGIN + CONTENT_WIDTH, y)
    .lineWidth(0.5)
    .strokeColor(color)
    .stroke()
    .restore();
}

/** Add a page if fewer than `needed` points remain before the bottom margin. */
function ensureSpace(doc: PDFKit.PDFDocument, needed: number): void {
  const bottom = doc.page.height - MARGIN;
  if (doc.y + needed > bottom) {
    doc.addPage();
  }
}

function isScoredStatus(status: ReportFixtureStatus): boolean {
  return (
    status === 'perfect' ||
    status === 'good' ||
    status === 'not_good' ||
    status === 'needs_review'
  );
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
}
