#!/usr/bin/env node

import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { tmpdir } from 'os';
import { execFileSync } from 'child_process';
import { resolveColumns, parseTrackerRow } from './tracker-parse.mjs';

const DEFAULT_TRACKER = resolve('data/applications.md');

function usage() {
  console.error(
    'Usage: node export-tracker-workbook.mjs [--out FILE] [--tracker FILE] [--template]\n' +
    '  --out FILE      Output .xlsx path\n' +
    '  --tracker FILE  Source markdown tracker (default: data/applications.md)\n' +
    '  --template      Emit headers + definitions only (no application rows)'
  );
  process.exit(1);
}

function parseArgs(argv) {
  const args = { out: null, tracker: DEFAULT_TRACKER, template: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--out') args.out = argv[++i];
    else if (arg === '--tracker') args.tracker = resolve(argv[++i]);
    else if (arg === '--template') args.template = true;
    else if (arg === '--help' || arg === '-h') usage();
    else usage();
  }
  return args;
}

function escapeXml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function cellRef(colIndex, rowIndex) {
  let n = colIndex + 1;
  let label = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    label = String.fromCharCode(65 + rem) + label;
    n = Math.floor((n - 1) / 26);
  }
  return `${label}${rowIndex + 1}`;
}

function textCell(colIndex, rowIndex, value) {
  const text = String(value ?? '');
  const spaceAttr = (/^\s|\s$/.test(text)) ? ' xml:space="preserve"' : '';
  return `<c r="${cellRef(colIndex, rowIndex)}" t="inlineStr"><is><t${spaceAttr}>${escapeXml(text)}</t></is></c>`;
}

function buildSheetXml(rows, widths = []) {
  const dimensionRef = rows.length
    ? `A1:${cellRef(Math.max(rows[0].length - 1, 0), rows.length - 1)}`
    : 'A1';
  const colsXml = widths.length
    ? `<cols>${widths.map((width, idx) => `<col min="${idx + 1}" max="${idx + 1}" width="${width}" customWidth="1"/>`).join('')}</cols>`
    : '';
  const rowsXml = rows.map((row, rowIndex) => {
    const cells = row.map((value, colIndex) => textCell(colIndex, rowIndex, value)).join('');
    return `<row r="${rowIndex + 1}">${cells}</row>`;
  }).join('');
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    `<dimension ref="${dimensionRef}"/>` +
    '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>' +
    '<sheetFormatPr defaultRowHeight="15"/>' +
    colsXml +
    `<sheetData>${rowsXml}</sheetData>` +
    '</worksheet>'
  );
}

function readTrackerRows(trackerPath) {
  const lines = readFileSync(trackerPath, 'utf-8').replace(/\r/g, '').split('\n');
  const colmap = resolveColumns(lines);
  return lines
    .map((line) => parseTrackerRow(line, colmap))
    .filter(Boolean);
}

function deriveFollowup(notes) {
  const text = String(notes ?? '');
  if (/follow-up drafted \d{4}-\d{2}-\d{2}/i.test(text)) return 'Drafted';
  if (/follow-up(?: \d+)? sent \d{4}-\d{2}-\d{2}/i.test(text)) return 'Sent';
  return '';
}

function buildApplicationsRows(trackerRows, templateMode) {
  const header = ['#', 'Date', 'Company', 'Role', 'Score', 'Status', 'PDF', 'Report', 'Follow-up', 'Notes'];
  if (templateMode) return [header];
  return [
    header,
    ...trackerRows.map((row) => [
      String(row.num),
      row.date,
      row.company,
      row.role,
      row.score,
      row.status,
      row.pdf,
      row.report,
      deriveFollowup(row.notes),
      row.notes,
    ]),
  ];
}

function buildDefinitionsRows() {
  return [
    ['Section', 'Key', 'Definition', 'Allowed values / example'],
    ['Columns', '#', 'Stable application identifier from the markdown tracker.', '8'],
    ['Columns', 'Date', 'Application or evaluation date in ISO format.', '2026-08-04'],
    ['Columns', 'Company', 'Employer or organization name.', 'Affirm'],
    ['Columns', 'Role', 'Role title as tracked.', 'Chief of Staff Director, People'],
    ['Columns', 'Score', 'Evaluation score or sentinel when no evaluation exists.', '4.4/5, N/A, -, —'],
    ['Columns', 'Status', 'Canonical application state.', 'Evaluated, Applied, Responded, Interview, Offer, Hired, Rejected, Discarded, SKIP'],
    ['Columns', 'PDF', 'Whether a finalized PDF exists for the package.', '✅ or ❌'],
    ['Columns', 'Report', 'Linked evaluation report path or placeholder.', '[008](../reports/008-affirm-chief-of-staff-director-people-2026-08-04.md)'],
    ['Columns', 'Follow-up', 'Derived workbook field. Not a markdown source column.', 'Drafted, Sent, blank'],
    ['Columns', 'Notes', 'Free-text context, rationale, req IDs, and workflow history.', 'Follow-up drafted 2026-08-10 with attached resume bashir_aaliya_resume.pdf.'],
    ['Workflow', 'Attachment filename', 'Outbound application and follow-up resume attachments should present as a standardized filename.', 'bashir_aaliya_resume.pdf'],
    ['Workflow', 'Drafted follow-up', 'Use when a follow-up email exists as a draft but has not been sent.', 'Drafted'],
    ['Workflow', 'Sent follow-up', 'Use when the user confirms the follow-up was actually sent.', 'Sent'],
    ['Workflow', 'Source of truth', 'The markdown tracker and follow-up log remain canonical. Workbook follow-up values are derived for readability.', 'data/applications.md + data/follow-ups.md'],
    ['Statuses', 'Evaluated', 'Report completed, pending decision.', ''],
    ['Statuses', 'Applied', 'Application sent.', ''],
    ['Statuses', 'Responded', 'Company responded.', ''],
    ['Statuses', 'Interview', 'In interview process.', ''],
    ['Statuses', 'Offer', 'Offer received.', ''],
    ['Statuses', 'Hired', 'Offer accepted.', ''],
    ['Statuses', 'Rejected', 'Rejected by company.', ''],
    ['Statuses', 'Discarded', 'Discarded by candidate or closed/stale.', ''],
    ['Statuses', 'SKIP', 'Low fit, not pursuing.', ''],
  ];
}

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function buildWorkbookFiles(appRows, defRows) {
  return {
    '[Content_Types].xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
      '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
      '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
      '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>' +
      '</Types>',
    '_rels/.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>' +
      '</Relationships>',
    'docProps/app.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">' +
      '<Application>career-ops</Application><DocSecurity>0</DocSecurity><ScaleCrop>false</ScaleCrop>' +
      '<HeadingPairs><vt:vector size="2" baseType="variant"><vt:variant><vt:lpstr>Worksheets</vt:lpstr></vt:variant><vt:variant><vt:i4>2</vt:i4></vt:variant></vt:vector></HeadingPairs>' +
      '<TitlesOfParts><vt:vector size="2" baseType="lpstr"><vt:lpstr>Applications</vt:lpstr><vt:lpstr>Definitions</vt:lpstr></vt:vector></TitlesOfParts>' +
      '<Company></Company><LinksUpToDate>false</LinksUpToDate><SharedDoc>false</SharedDoc><HyperlinksChanged>false</HyperlinksChanged><AppVersion>1.0</AppVersion>' +
      '</Properties>',
    'docProps/core.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
      '<dc:title>Applications Tracker Workbook</dc:title><dc:creator>career-ops</dc:creator><cp:lastModifiedBy>career-ops</cp:lastModifiedBy>' +
      '</cp:coreProperties>',
    'xl/workbook.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">' +
      '<sheets>' +
      '<sheet name="Applications" sheetId="1" r:id="rId1"/>' +
      '<sheet name="Definitions" sheetId="2" r:id="rId2"/>' +
      '</sheets>' +
      '</workbook>',
    'xl/_rels/workbook.xml.rels':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>' +
      '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>' +
      '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
      '</Relationships>',
    'xl/styles.xml':
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<fonts count="1"><font><sz val="11"/><name val="Aptos"/></font></fonts>' +
      '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
      '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
      '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
      '<cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs>' +
      '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
      '</styleSheet>',
    'xl/worksheets/sheet1.xml': buildSheetXml(appRows, [8, 13, 24, 48, 10, 14, 8, 26, 14, 110]),
    'xl/worksheets/sheet2.xml': buildSheetXml(defRows, [14, 24, 80, 48]),
  };
}

function writeWorkbook(outPath, files) {
  ensureDir(outPath);
  const tmpRoot = mkdtempSync(join(tmpdir(), 'career-ops-tracker-xlsx-'));
  try {
    for (const [relPath, content] of Object.entries(files)) {
      const full = join(tmpRoot, relPath);
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content, 'utf-8');
    }
    execFileSync('zip', ['-q', '-X', '-r', outPath, '.'], { cwd: tmpRoot });
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const outPath = resolve(args.out || (args.template
    ? 'templates/applications-tracker-template.xlsx'
    : `output/applications-tracker-${new Date().toISOString().slice(0, 10)}.xlsx`));
  const trackerRows = args.template ? [] : readTrackerRows(args.tracker);
  const files = buildWorkbookFiles(
    buildApplicationsRows(trackerRows, args.template),
    buildDefinitionsRows(),
  );
  writeWorkbook(outPath, files);
  console.log(outPath);
}

main();
