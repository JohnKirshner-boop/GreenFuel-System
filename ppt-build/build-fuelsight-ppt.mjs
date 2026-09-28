import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const ROOT = path.resolve('.');
const OUT = path.join(ROOT, 'FuelSight-System-Screenshots-Presentation.pptx');
const BUILD = path.join(ROOT, 'ppt-build');
const SHOTS = path.join(BUILD, 'screenshots');
const RENDERED = path.join(BUILD, 'rendered');
const TMP = path.join(BUILD, 'tmp');
const LOGO_PNG = path.join(SHOTS, 'greenfuel-logo.png');
const SOURCE_NOTES = path.join(TMP, 'source-notes.txt');
const imageCache = new Map();

const W = 1280;
const H = 720;
const green = '#147A3A';
const darkGreen = '#0F2D20';
const leaf = '#5BBF22';
const mint = '#EEF8F2';
const pale = '#F7FBF8';
const ink = '#0B1720';
const muted = '#586B63';
const border = '#DCE8E1';
const blue = '#2563EB';
const amber = '#D97706';

async function writeBlob(file, blob) {
  await fs.writeFile(file, new Uint8Array(await blob.arrayBuffer()));
}

async function fileExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

function p(...parts) {
  return path.join(...parts);
}

function screenshot(name) {
  return p(SHOTS, `${name}.png`);
}

function imageBytes(file) {
  const bytes = imageCache.get(file);
  if (!bytes) throw new Error(`Image not loaded: ${file}`);
  return bytes;
}

function addShape(slide, {
  x,
  y,
  w,
  h,
  fill = 'none',
  lineFill = 'none',
  lineWidth = 0,
  radius = 0,
  shadow = 'shadow-none',
  geometry = 'rect',
  name,
}) {
  const config = {
    geometry,
    name,
    position: { left: x, top: y, width: w, height: h },
    fill,
    line: { style: 'solid', fill: lineFill, width: lineWidth },
    shadow,
  };
  if (radius && ['rect', 'textbox', 'roundRect'].includes(geometry)) {
    config.borderRadius = radius;
  }
  return slide.shapes.add(config);
}

function addText(slide, text, {
  x,
  y,
  w,
  h,
  size = 18,
  color = ink,
  bold = false,
  fill = 'none',
  lineFill = 'none',
  radius = 0,
  shadow = 'shadow-none',
  geometry = 'textbox',
}) {
  const shape = addShape(slide, {
    x,
    y,
    w,
    h,
    fill,
    lineFill,
    radius,
    shadow,
    geometry,
  });
  shape.text = text;
  shape.text.style = { fontSize: size, color, bold };
  return shape;
}

function addLogo(slide, x, y, size = 54) {
  return slide.images.add({
    blob: imageBytes(LOGO_PNG),
    contentType: 'image/png',
    alt: 'GreenFuel Fuel Safe logo',
    fit: 'contain',
    position: { left: x, top: y, width: size, height: size },
  });
}

function addPill(slide, text, x, y, w, fill = mint, color = green) {
  const pill = addText(slide, text, {
    x,
    y,
    w,
    h: 34,
    size: 14,
    color,
    bold: true,
    fill,
    lineFill: border,
    radius: 'rounded-full',
    geometry: 'roundRect',
  });
  return pill;
}

function addHeader(slide, eyebrow, title, subtitle) {
  addLogo(slide, 58, 38, 48);
  addText(slide, eyebrow.toUpperCase(), {
    x: 120,
    y: 43,
    w: 480,
    h: 24,
    size: 12,
    color: green,
    bold: true,
  });
  addText(slide, title, {
    x: 120,
    y: 68,
    w: 700,
    h: 42,
    size: 34,
    color: ink,
    bold: true,
  });
  addText(slide, subtitle, {
    x: 120,
    y: 112,
    w: 760,
    h: 34,
    size: 17,
    color: muted,
  });
  addShape(slide, { x: 58, y: 154, w: 1164, h: 2, fill: border });
}

function addScreenshot(slide, name, {
  x = 58,
  y = 174,
  w = 780,
  h = 488,
  alt = 'FuelSight system screenshot',
  fit = 'contain',
}) {
  addShape(slide, {
    x: x - 8,
    y: y - 8,
    w: w + 16,
    h: h + 16,
    fill: 'white',
    lineFill: border,
    lineWidth: 1,
    radius: 'rounded-2xl',
    shadow: 'shadow-md',
    geometry: 'roundRect',
  });
  return slide.images.add({
    blob: imageBytes(screenshot(name)),
    contentType: 'image/png',
    alt,
    fit,
    geometry: 'roundRect',
    borderRadius: 'rounded-xl',
    position: { left: x, top: y, width: w, height: h },
  });
}

function addSidePanel(slide, title, bullets, objectives, accent = green) {
  addShape(slide, {
    x: 885,
    y: 174,
    w: 337,
    h: 488,
    fill: 'white',
    lineFill: border,
    lineWidth: 1,
    radius: 'rounded-2xl',
    shadow: 'shadow-sm',
    geometry: 'roundRect',
  });
  addShape(slide, {
    x: 885,
    y: 174,
    w: 337,
    h: 8,
    fill: accent,
    lineFill: accent,
    radius: 'rounded-full',
    geometry: 'roundRect',
  });
  addText(slide, title, {
    x: 912,
    y: 204,
    w: 282,
    h: 60,
    size: 25,
    color: ink,
    bold: true,
  });

  let y = 286;
  for (const bullet of bullets) {
    addShape(slide, {
      x: 914,
      y: y + 7,
      w: 8,
      h: 8,
      fill: accent,
      lineFill: accent,
      radius: 'rounded-full',
      geometry: 'ellipse',
    });
    addText(slide, bullet, {
      x: 936,
      y,
      w: 245,
      h: 52,
      size: 16,
      color: muted,
    });
    y += 67;
  }

  addShape(slide, {
    x: 912,
    y: 582,
    w: 282,
    h: 1,
    fill: border,
  });
  addText(slide, 'Objective link', {
    x: 912,
    y: 602,
    w: 130,
    h: 22,
    size: 12,
    color: muted,
    bold: true,
  });
  addText(slide, objectives, {
    x: 912,
    y: 627,
    w: 282,
    h: 32,
    size: 16,
    color: accent,
    bold: true,
  });
}

function addNotes(slide, lines) {
  slide.speakerNotes.textFrame.setText(lines);
  slide.speakerNotes.setVisible(true);
}

function sourceBlock(assetNames) {
  const assets = Array.isArray(assetNames) ? assetNames.join(', ') : assetNames;
  return [
    '[Sources]',
    `Local screenshot(s): ${assets}, captured from http://localhost/greenfuel-project/frontend/index.html on 2026-08-29.`,
    'Study objectives: supplied by the user in this Codex task.',
  ].join('\n');
}

function featureSlide(presentation, {
  eyebrow,
  title,
  subtitle,
  shot,
  panelTitle,
  bullets,
  objectives,
  accent = green,
  notes,
}) {
  const slide = presentation.slides.add();
  slide.background.fill = pale;
  addHeader(slide, eyebrow, title, subtitle);
  addScreenshot(slide, shot, {
    x: 58,
    y: 174,
    w: 780,
    h: 488,
    alt: `${title} screenshot`,
  });
  addSidePanel(slide, panelTitle, bullets, objectives, accent);
  addNotes(slide, [
    `What the screenshot shows: ${notes}`,
    `Specific objective supported: ${objectives}.`,
    sourceBlock(shot),
  ]);
  return slide;
}

function twoShotSlide(presentation, {
  eyebrow,
  title,
  subtitle,
  leftShot,
  rightShot,
  leftLabel,
  rightLabel,
  objectives,
  notes,
}) {
  const slide = presentation.slides.add();
  slide.background.fill = pale;
  addHeader(slide, eyebrow, title, subtitle);
  addScreenshot(slide, leftShot, {
    x: 62,
    y: 184,
    w: 540,
    h: 338,
    alt: `${leftLabel} screenshot`,
  });
  addScreenshot(slide, rightShot, {
    x: 682,
    y: 184,
    w: 540,
    h: 338,
    alt: `${rightLabel} screenshot`,
  });
  addPill(slide, leftLabel, 86, 548, 210, mint, green);
  addPill(slide, rightLabel, 706, 548, 210, '#EFF6FF', blue);
  addText(slide, objectives, {
    x: 86,
    y: 614,
    w: 980,
    h: 34,
    size: 21,
    color: green,
    bold: true,
  });
  addText(slide, 'Screenshots demonstrate role visibility, transaction traceability, and report continuity across portals.', {
    x: 86,
    y: 650,
    w: 1030,
    h: 28,
    size: 16,
    color: muted,
  });
  addNotes(slide, [
    `What the screenshots show: ${notes}`,
    `Specific objective supported: ${objectives}.`,
    sourceBlock([leftShot, rightShot]),
  ]);
  return slide;
}

async function main() {
  await fs.mkdir(RENDERED, { recursive: true });
  await fs.mkdir(TMP, { recursive: true });

  const required = [
    LOGO_PNG,
    screenshot('01-login'),
    screenshot('02-owner-dashboard'),
    screenshot('03-owner-user-roles'),
    screenshot('04-owner-fuel-prices'),
    screenshot('05-owner-branches'),
    screenshot('06-owner-branch-detail'),
    screenshot('07-owner-branch-comparison'),
    screenshot('09-manager-daily-entry'),
    screenshot('10-manager-records-log'),
    screenshot('11-manager-pos-transactions'),
    screenshot('12-manager-weekly-reports'),
    screenshot('13-manager-price-request'),
    screenshot('14-cashier-pos-terminal'),
  ];
  const missing = [];
  for (const file of required) {
    if (!(await fileExists(file))) missing.push(file);
  }
  if (missing.length) {
    throw new Error(`Missing required assets:\n${missing.join('\n')}`);
  }
  for (const file of required) {
    imageCache.set(file, await fs.readFile(file));
  }

  const presentation = Presentation.create({
    slideSize: { width: W, height: H },
  });
  presentation.theme.colorScheme = {
    name: 'FuelSight Green',
    themeColors: {
      accent1: green,
      accent2: leaf,
      accent3: amber,
      accent4: blue,
      accent5: '#0EA5E9',
      accent6: '#16A34A',
      bg1: '#FFFFFF',
      bg2: pale,
      tx1: ink,
      tx2: muted,
      dk1: '#000000',
      dk2: darkGreen,
      lt1: '#FFFFFF',
      lt2: '#E5EFE9',
      hlink: blue,
      folHlink: '#6D28D9',
    },
  };

  const cover = presentation.slides.add();
  cover.background.fill = darkGreen;
  addShape(cover, { x: 0, y: 0, w: 720, h: 720, fill: darkGreen, lineFill: darkGreen });
  cover.images.add({
    blob: imageBytes(screenshot('01-login')),
    contentType: 'image/png',
    alt: 'FuelSight login screenshot',
    fit: 'cover',
    position: { left: 610, top: 0, width: 670, height: 720 },
  });
  addShape(cover, { x: 0, y: 0, w: 630, h: 720, fill: darkGreen, lineFill: darkGreen });
  addLogo(cover, 76, 78, 86);
  addText(cover, 'FuelSight', {
    x: 76,
    y: 184,
    w: 520,
    h: 72,
    size: 58,
    color: '#FFFFFF',
    bold: true,
  });
  addText(cover, 'Centralized invoicing and sales reporting system for GreenFuel Gas Station', {
    x: 80,
    y: 274,
    w: 520,
    h: 96,
    size: 25,
    color: '#DDF5E6',
  });
  addShape(cover, { x: 80, y: 408, w: 450, h: 1, fill: '#6EE7A8' });
  addText(cover, 'Actual developed system screenshots with objective-aligned notes', {
    x: 80,
    y: 436,
    w: 500,
    h: 58,
    size: 20,
    color: '#BFEAD0',
  });
  addPill(cover, 'GreenFuel Fuel Safe', 80, 554, 230, '#E6F9ED', green);
  addNotes(cover, [
    'What the screenshot shows: the FuelSight login screen and role-based entry point for Owner, Manager, and Cashier portals.',
    'Specific objective supported: Objective 2, which introduces the centralized web-based invoicing and sales reporting application, and Objective 3, because it is implemented as a web-based system.',
    sourceBlock('01-login'),
  ]);

  featureSlide(presentation, {
    eyebrow: 'Owner portal',
    title: 'Centralized Monitoring Dashboard',
    subtitle: 'A single owner view for branch sales, revenue, and operating signals.',
    shot: '02-owner-dashboard',
    panelTitle: 'Network visibility',
    bullets: [
      'Owner can monitor multiple branch records from one portal.',
      'Dashboard cards and charts support fast operational review.',
      'Centralized view supports real-time branch sales synchronization.',
    ],
    objectives: 'Objectives 2.1, 2.3, 2.6',
    notes: 'the Owner Dashboard that summarizes branch-level sales and graphical performance indicators.',
  });

  featureSlide(presentation, {
    eyebrow: 'Security and administration',
    title: 'User Role Assignment',
    subtitle: 'Owner assigns each user to a role and branch before portal access.',
    shot: '03-owner-user-roles',
    panelTitle: 'Controlled access',
    bullets: [
      'Owner can assign users as owner, manager, or cashier.',
      'Manager and cashier accounts are tied to a specific branch.',
      'This supports accountability and separation of responsibilities.',
    ],
    objectives: 'Objectives 2.4, 4',
    accent: leaf,
    notes: 'the User Roles screen where the owner manages branch and position assignments for system users.',
  });

  featureSlide(presentation, {
    eyebrow: 'Price governance',
    title: 'Owner-Controlled Fuel Prices',
    subtitle: 'Base prices are set by the owner, with branch requests reviewed before applying to POS.',
    shot: '04-owner-fuel-prices',
    panelTitle: 'Approval workflow',
    bullets: [
      'Owner sets official base pump prices for all branches.',
      'Managers can request branch-specific changes when local competitors shift.',
      'Approved prices become the branch price used by cashier POS terminals.',
    ],
    objectives: 'Objectives 2.1, 2.4, 4',
    accent: blue,
    notes: 'the owner Fuel Prices module showing network base prices, pending manager requests, and price request history.',
  });

  featureSlide(presentation, {
    eyebrow: 'Branch records',
    title: 'Branch Daily Records View',
    subtitle: 'Owner can open a branch and review submitted daily records in a familiar table view.',
    shot: '06-owner-branch-detail',
    panelTitle: 'Branch drill-down',
    bullets: [
      'Branch detail view separates daily records and submitted weekly reports.',
      'Daily records are visible after manager submission.',
      'The branch dashboard connects operational data to owner review.',
    ],
    objectives: 'Objectives 2.1, 2.5, 2.6',
    notes: 'the Branches module after opening a specific branch, including its daily records tab and branch performance context.',
  });

  featureSlide(presentation, {
    eyebrow: 'Performance analytics',
    title: 'Branch Comparison by Week',
    subtitle: 'Branch performance is grouped by weeks of the selected month.',
    shot: '07-owner-branch-comparison',
    panelTitle: 'Month-week view',
    bullets: [
      'Owner selects a month and compares Week 1 through Week 5.',
      'Branch totals, liters, and transactions are presented side by side.',
      'Ranking and trend indicators support branch performance decisions.',
    ],
    objectives: 'Objectives 2.3, 2.6',
    accent: '#0EA5E9',
    notes: 'the Branch Comparison screen with month and week controls, branch ranking, and performance metrics.',
  });

  featureSlide(presentation, {
    eyebrow: 'Manager portal',
    title: 'Tabbed Daily Sales Entry',
    subtitle: 'Daily entry sections are organized into tabs to reduce scrolling for managers.',
    shot: '09-manager-daily-entry',
    panelTitle: 'Daily report form',
    bullets: [
      'Shift information remains visible above the tabs.',
      'Inventory, pump readings, cash and expenses, and submission are separated.',
      'Submitted daily entries feed the weekly report workflow.',
    ],
    objectives: 'Objectives 1, 2.5',
    notes: 'the Manager Daily Entry screen with inventory fields arranged in a tabbed layout as requested after adviser feedback.',
  });

  twoShotSlide(presentation, {
    eyebrow: 'Audit trail',
    title: 'Records Log and POS Transactions',
    subtitle: 'Managers can inspect submitted daily entries and cashier transaction activity.',
    leftShot: '10-manager-records-log',
    rightShot: '11-manager-pos-transactions',
    leftLabel: 'Daily Entry Records',
    rightLabel: 'POS Transaction Log',
    objectives: 'Objective 2.4',
    notes: 'the manager Records Log with daily entry IDs and the POS Transactions tab for monitoring cashier sales and voided records.',
  });

  featureSlide(presentation, {
    eyebrow: 'Weekly reporting',
    title: 'Weekly Consolidated Report',
    subtitle: 'Managers choose the exact date span before submitting weekly reports to the owner.',
    shot: '12-manager-weekly-reports',
    panelTitle: 'Report handoff',
    bullets: [
      'Weekly report span can be set using start and end dates.',
      'Fuel breakdown and daily entry summary come from submitted daily entries.',
      'Owner portal only sees reports after manager submission.',
    ],
    objectives: 'Objectives 2.5, 2.6',
    accent: amber,
    notes: 'the manager Weekly Reports module with configurable report span, daily entry summary, fuel breakdown, and submit/print controls.',
  });

  featureSlide(presentation, {
    eyebrow: 'Branch price request',
    title: 'Manager Price Change Request',
    subtitle: 'Managers propose branch-specific prices for owner review instead of directly changing network prices.',
    shot: '13-manager-price-request',
    panelTitle: 'Local competitor response',
    bullets: [
      'Manager sees current branch prices and official base prices.',
      'Manager submits a requested price and reason.',
      'Changes remain pending until the owner approves or rejects them.',
    ],
    objectives: 'Objectives 2.1, 2.4, 4',
    accent: blue,
    notes: 'the manager Fuel Prices module used to request local fuel price changes for the assigned branch.',
  });

  featureSlide(presentation, {
    eyebrow: 'Cashier portal',
    title: 'POS Terminal with VAT and Cash Tracking',
    subtitle: 'Cashiers process fuel transactions, cash denominations, change, voids, receipts, and shifts.',
    shot: '14-cashier-pos-terminal',
    panelTitle: 'Transaction workflow',
    bullets: [
      'Fuel type, liters, VAT, and total are computed during each sale.',
      'Cash received and change given are recorded by denomination.',
      'Shift totals and receipt printing support end-of-day reporting.',
    ],
    objectives: 'Objectives 2.2, 2.4, 2.5',
    accent: green,
    notes: 'the Cashier POS Terminal showing product selection, VAT included calculations, cash received denomination buttons, change given recording, and current shift totals.',
  });

  const coverage = presentation.slides.add();
  coverage.background.fill = pale;
  addHeader(
    coverage,
    'Study objectives',
    'Objective Coverage Summary',
    'Screenshots show how each objective is represented in the developed system.'
  );
  const miniShots = [
    ['02-owner-dashboard', 'Owner dashboard'],
    ['09-manager-daily-entry', 'Daily entry'],
    ['12-manager-weekly-reports', 'Weekly reports'],
    ['14-cashier-pos-terminal', 'Cashier POS'],
  ];
  miniShots.forEach(([name, label], i) => {
    const x = 58 + i * 296;
    addScreenshot(coverage, name, { x, y: 180, w: 252, h: 158, alt: label });
    addText(coverage, label, {
      x: x + 12,
      y: 348,
      w: 224,
      h: 22,
      size: 14,
      color: green,
      bold: true,
    });
  });
  const cards = [
    ['Objectives 1 and 3', 'Process and build method', 'Daily entry, records log, MySQL/PHP backend, and HTML/CSS/JavaScript frontend show the analyzed workflow as a working web system.'],
    ['Objectives 2.1 and 2.3', 'Centralized monitoring', 'Owner dashboard and branch comparison show synchronized branch data and graphical sales analysis.'],
    ['Objectives 2.2 and 2.4', 'POS and audit trail', 'Cashier POS, receipts, transaction logs, void status, and user roles support invoicing and traceable operations.'],
    ['Objectives 2.5, 2.6, and 4', 'Reports and evaluation', 'Daily/weekly reports, branch performance views, and role controls support usability, functionality, reliability, performance, and security review.'],
  ];
  cards.forEach(([obj, heading, body], idx) => {
    const col = idx % 2;
    const row = Math.floor(idx / 2);
    const x = 80 + col * 570;
    const y = 400 + row * 124;
    addShape(coverage, {
      x,
      y,
      w: 540,
      h: 104,
      fill: 'white',
      lineFill: border,
      lineWidth: 1,
      radius: 'rounded-2xl',
      shadow: 'shadow-sm',
      geometry: 'roundRect',
    });
    addShape(coverage, {
      x,
      y,
      w: 8,
      h: 104,
      fill: idx % 2 === 0 ? green : blue,
      lineFill: idx % 2 === 0 ? green : blue,
      radius: 'rounded-full',
      geometry: 'roundRect',
    });
    addText(coverage, obj, { x: x + 28, y: y + 18, w: 200, h: 22, size: 14, color: idx % 2 === 0 ? green : blue, bold: true });
    addText(coverage, heading, { x: x + 28, y: y + 42, w: 230, h: 28, size: 19, color: ink, bold: true });
    addText(coverage, body, { x: x + 278, y: y + 22, w: 228, h: 64, size: 15, color: muted });
  });
  addNotes(coverage, [
    'What the screenshots show: a compact overview of the developed modules used as evidence for the study objectives.',
    'Specific objective supported: Objectives 1, 2.1 through 2.6, 3, and 4.',
    sourceBlock(miniShots.map(([name]) => name)),
  ]);

  const sourceNotes = [
    'FuelSight presentation source notes',
    'Generated screenshot source: local GreenFuel system at http://localhost/greenfuel-project/frontend/index.html.',
    'Capture date: 2026-08-29.',
    'No external images or claims were used. The deck uses actual screenshots from the local developed system and study objectives supplied by the user.',
    '',
    'Screenshot assets:',
    ...(await fs.readdir(SHOTS)).filter(name => name.endsWith('.png')).sort().map(name => `- ${path.join(SHOTS, name)}`),
  ].join('\n');
  await fs.writeFile(SOURCE_NOTES, sourceNotes, 'utf8');

  for (const [index, slide] of presentation.slides.items.entries()) {
    const stem = `slide-${String(index + 1).padStart(2, '0')}`;
    const png = await presentation.export({ slide, format: 'png', scale: 1 });
    await writeBlob(path.join(RENDERED, `${stem}.png`), png);
    const layout = await slide.export({ format: 'layout' });
    await fs.writeFile(path.join(RENDERED, `${stem}.layout.json`), await layout.text());
  }
  const montage = await presentation.export({ format: 'webp', montage: true, scale: 1 });
  await writeBlob(path.join(RENDERED, 'deck-montage.webp'), montage);

  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(OUT);
  console.log(OUT);
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
