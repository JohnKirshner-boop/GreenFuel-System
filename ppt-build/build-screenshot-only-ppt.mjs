import fs from 'node:fs/promises';
import path from 'node:path';
import { Presentation, PresentationFile } from '@oai/artifact-tool';

const ROOT = path.resolve('.');
const OUT = path.join(ROOT, 'FuelSight-System-Screenshots-Only-Objectives.pptx');
const BUILD = path.join(ROOT, 'ppt-build');
const SHOTS = path.join(BUILD, 'screenshots');
const RENDERED = path.join(BUILD, 'rendered-objectives');
const TMP = path.join(BUILD, 'tmp');
const SOURCE_NOTES = path.join(TMP, 'source-notes.txt');

const SLIDE_WIDTH = 1440;
const SLIDE_HEIGHT = 900;

const objectiveText = {
  '1': 'Identify and analyze the current process of sales reporting, invoicing and inventory monitoring carried out by Greenfuel Gas Station.',
  '2': 'Provide a centralized web based invoicing and sales report for Greenfuel Gas Station.',
  '2.1': 'Synchronization of real-time sale information from all branches.',
  '2.2': 'Automated invoicing and receipt issuance once fuel is purchased.',
  '2.3': 'Sales records are monitored and analysis done graphically for sales.',
  '2.4': 'Records audit trail log to monitor cashier transactions.',
  '2.5': 'Reports can be generated on a daily or weekly basis.',
  '2.6': 'Forecast and reports on branch performance.',
  '3': 'Develop the application software through web-based technologies such as MySQL, HTML, CSS and JavaScript.',
  '4': 'Test and evaluate the developed system using ISO 25010 Software Quality Standards in terms of functionality, usability, reliability, performance efficiency, and security.',
};

const titleObjectives = {
  'Login Page': ['2', '3', '4'],
  'Owner Dashboard': ['2.1', '2.3', '2.6'],
  'Owner User Role Assignment': ['2.4', '4'],
  'Owner Fuel Prices': ['2.1', '2.4', '4'],
  'Owner Branches List': ['2.1', '2.6'],
  'Owner Branch Dashboard Daily Records': ['2.1', '2.5', '2.6'],
  'Owner Branch Comparison': ['2.3', '2.6'],
  'Manager Dashboard': ['2.1', '2.3', '2.5'],
  'Manager Daily Entry': ['1', '2.5'],
  'Manager Daily Records Log': ['2.4', '2.5'],
  'Manager POS Transactions Log': ['2.4'],
  'Manager Weekly Reports': ['2.5', '2.6'],
  'Manager Fuel Price Request': ['2.1', '2.4', '4'],
  'Cashier POS Terminal': ['2.2', '2.4', '2.5'],
};

function buildSpeakerNotes(item) {
  const description = item.notes.split(' Specific objective')[0];
  const objectives = titleObjectives[item.title] || [];
  return [
    `Screenshot: ${item.title}`,
    description,
    'Objective/s:',
    ...objectives.map(key => `Objective ${key}: ${objectiveText[key]}`),
  ];
}

const slides = [
  {
    file: '01-login.png',
    title: 'Login Page',
    notes:
      'This screenshot shows the FuelSight login page where users choose their portal role. The owner can sign in without selecting a branch, while manager and cashier accounts are branch-based. Specific objectives supported: Objective 2, Objective 3, and Objective 4.',
  },
  {
    file: '02-owner-dashboard.png',
    title: 'Owner Dashboard',
    notes:
      'This screenshot shows the Owner Dashboard for centralized monitoring of branch sales, transactions, expenses, and branch performance. Specific objectives supported: Objective 2.1, Objective 2.3, and Objective 2.6.',
  },
  {
    file: '03-owner-user-roles.png',
    title: 'Owner User Role Assignment',
    notes:
      'This screenshot shows the User Role Assignment module where the owner manages user access, roles, and branch assignments for managers and cashiers. Specific objectives supported: Objective 2.4 and Objective 4.',
  },
  {
    file: '04-owner-fuel-prices.png',
    title: 'Owner Fuel Prices',
    notes:
      'This screenshot shows the owner-controlled fuel pricing module where official base prices are set and manager price change requests are reviewed. Specific objectives supported: Objective 2.1, Objective 2.4, and Objective 4.',
  },
  {
    file: '05-owner-branches.png',
    title: 'Owner Branches List',
    notes:
      'This screenshot shows the Branches module where the owner can view GreenFuel branch records and open a branch dashboard for more detail. Specific objectives supported: Objective 2.1 and Objective 2.6.',
  },
  {
    file: '06-owner-branch-detail.png',
    title: 'Owner Branch Dashboard Daily Records',
    notes:
      'This screenshot shows the branch dashboard with branch performance information and daily records submitted by the branch manager. Specific objectives supported: Objective 2.1, Objective 2.5, and Objective 2.6.',
  },
  {
    file: '07-owner-branch-comparison.png',
    title: 'Owner Branch Comparison',
    notes:
      'This screenshot shows the Branch Comparison module where branch performance is compared by weeks of the selected month. Specific objectives supported: Objective 2.3 and Objective 2.6.',
  },
  {
    file: '08-manager-dashboard.png',
    title: 'Manager Dashboard',
    notes:
      'This screenshot shows the Manager Dashboard for the assigned branch, giving the branch manager access to daily records, reports, and branch-specific operations. Specific objectives supported: Objective 2.1, Objective 2.3, and Objective 2.5.',
  },
  {
    file: '09-manager-daily-entry.png',
    title: 'Manager Daily Entry',
    notes:
      'This screenshot shows the tabbed Daily Sales Entry page used by managers for inventory, pump readings, cash and expenses, and final daily report submission. Specific objectives supported: Objective 1 and Objective 2.5.',
  },
  {
    file: '10-manager-records-log.png',
    title: 'Manager Daily Records Log',
    notes:
      'This screenshot shows the Records Log for submitted daily entries, including organized daily entry IDs, dates, branch information, totals, and actions. Specific objectives supported: Objective 2.4 and Objective 2.5.',
  },
  {
    file: '11-manager-pos-transactions.png',
    title: 'Manager POS Transactions Log',
    notes:
      'This screenshot shows the POS Transactions tab where the manager can inspect cashier transactions, transaction IDs, cash data, and transaction status. Specific objective supported: Objective 2.4.',
  },
  {
    file: '12-manager-weekly-reports.png',
    title: 'Manager Weekly Reports',
    notes:
      'This screenshot shows the Weekly Consolidated Report module where managers choose a report span, review daily entry summaries, and submit weekly reports to the owner. Specific objectives supported: Objective 2.5 and Objective 2.6.',
  },
  {
    file: '13-manager-price-request.png',
    title: 'Manager Fuel Price Request',
    notes:
      'This screenshot shows the manager fuel price request screen where branch managers can request branch-specific fuel price changes for owner approval. Specific objectives supported: Objective 2.1, Objective 2.4, and Objective 4.',
  },
  {
    file: '14-cashier-pos-terminal.png',
    title: 'Cashier POS Terminal',
    notes:
      'This screenshot shows the Cashier POS Terminal for processing fuel sales, VAT calculations, cash denominations, change given, receipt printing, transaction logging, and shift controls. Specific objectives supported: Objective 2.2, Objective 2.4, and Objective 2.5.',
  },
];

async function writeBlob(file, blob) {
  await fs.writeFile(file, new Uint8Array(await blob.arrayBuffer()));
}

async function main() {
  await fs.mkdir(RENDERED, { recursive: true });
  await fs.mkdir(TMP, { recursive: true });

  const presentation = Presentation.create({
    slideSize: { width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
  });

  for (const [index, item] of slides.entries()) {
    const imagePath = path.join(SHOTS, item.file);
    const imageBytes = await fs.readFile(imagePath);
    const slide = presentation.slides.add();
    slide.background.fill = '#ffffff';
    slide.images.add({
      blob: imageBytes,
      contentType: 'image/png',
      alt: item.title,
      fit: 'cover',
      position: { left: 0, top: 0, width: SLIDE_WIDTH, height: SLIDE_HEIGHT },
    });
    slide.speakerNotes.textFrame.setText(buildSpeakerNotes(item));
    slide.speakerNotes.setVisible(true);

    const stem = `slide-${String(index + 1).padStart(2, '0')}`;
    const png = await presentation.export({ slide, format: 'png', scale: 1 });
    await writeBlob(path.join(RENDERED, `${stem}.png`), png);
    const layout = await slide.export({ format: 'layout' });
    await fs.writeFile(path.join(RENDERED, `${stem}.layout.json`), await layout.text());
  }

  const montage = await presentation.export({ format: 'webp', montage: true, scale: 1 });
  await writeBlob(path.join(RENDERED, 'deck-montage.webp'), montage);

  const sourceNotes = [
    'FuelSight screenshot-only presentation source notes',
    'Generated screenshot source: local GreenFuel system at http://localhost/greenfuel-project/frontend/index.html.',
    'Capture date: 2026-08-29.',
    'Visible slide content intentionally contains only screenshots. Descriptions and exact objective mappings are stored in PowerPoint speaker notes. Source blocks are not included in speaker notes.',
    '',
    'Screenshot assets:',
    ...slides.map(item => `- ${path.join(SHOTS, item.file)}: ${item.title}`),
  ].join('\n');
  await fs.writeFile(SOURCE_NOTES, sourceNotes, 'utf8');

  const pptx = await PresentationFile.exportPptx(presentation);
  await pptx.save(OUT);
  console.log(OUT);
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
