import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_URL = 'http://localhost/greenfuel-project/frontend/index.html';
const OUT_DIR = path.resolve('ppt-build/screenshots');
const VIEWPORT = { width: 1440, height: 900 };

await fs.mkdir(OUT_DIR, { recursive: true });

async function launchBrowser() {
  try {
    return await chromium.launch({ headless: true, channel: 'msedge' });
  } catch {
    return await chromium.launch({ headless: true });
  }
}

async function settle(page, ms = 900) {
  await page.waitForLoadState('domcontentloaded').catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 2500 }).catch(() => {});
  await page.waitForTimeout(ms);
}

async function shot(page, name) {
  const file = path.join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`captured ${name}`);
  return file;
}

async function gotoApp(page) {
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await settle(page, 700);
}

async function chooseRole(page, role) {
  const button = page.getByRole('button', { name: new RegExp(role, 'i') }).first();
  if (await button.count()) await button.click();
  await page.waitForTimeout(250);
}

async function login(page, { role, username, password, branch = 'b1' }) {
  await gotoApp(page);
  await chooseRole(page, role);
  await page.locator('#login-user').fill(username);
  await page.locator('#login-pass').fill(password);

  const branchSelect = page.locator('#login-branch');
  if (await branchSelect.count()) {
    const visible = await page.locator('#login-branch-field').evaluate(el => getComputedStyle(el).display !== 'none').catch(() => false);
    if (visible) await branchSelect.selectOption(branch).catch(() => {});
  }

  await page.locator('.btn-primary').click();
  await page.waitForFunction(() => document.querySelector('#main-screen')?.classList.contains('active'), null, { timeout: 8000 });
  await settle(page, 1000);
}

async function logoutToLogin(page) {
  await page.evaluate(() => {
    return fetch('../backend/routes/auth.php?action=logout', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
    }).catch(() => null);
  }).catch(() => null);
  await page.evaluate(() => {
    try {
      localStorage.clear();
      sessionStorage.clear();
    } catch {}
  });
  await gotoApp(page);
}

async function nav(page, label) {
  const item = page.locator('#sidebar-nav button').filter({ hasText: label }).first();
  await item.click({ timeout: 5000 });
  await settle(page, 1200);
}

async function maybeClick(page, label, timeout = 2500) {
  const item = page.getByRole('button', { name: new RegExp(label, 'i') }).first();
  if (await item.count()) {
    await item.click({ timeout }).catch(() => {});
    await settle(page, 800);
  }
}

async function main() {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
  });

  const page = await context.newPage();
  page.setDefaultTimeout(7000);

  await page.addInitScript(() => {
    if (!window.Chart) {
      window.Chart = class Chart {
        constructor() {}
        destroy() {}
        update() {}
      };
    }
  });

  await gotoApp(page);
  await shot(page, '01-login');

  await login(page, { role: 'Owner', username: 'admin', password: 'admin123' });
  await shot(page, '02-owner-dashboard');

  await nav(page, 'User Roles');
  await shot(page, '03-owner-user-roles');

  await nav(page, 'Fuel Prices');
  await shot(page, '04-owner-fuel-prices');

  await nav(page, 'Branches');
  await shot(page, '05-owner-branches');
  await maybeClick(page, 'View Dashboard');
  await shot(page, '06-owner-branch-detail');

  await nav(page, 'Branch Comparison');
  await shot(page, '07-owner-branch-comparison');

  await logoutToLogin(page);
  await login(page, { role: 'Manager', username: 'manager1', password: 'mgr123', branch: 'b1' });
  await shot(page, '08-manager-dashboard');

  await nav(page, 'Daily Entry');
  await shot(page, '09-manager-daily-entry');

  await nav(page, 'Records Log');
  await shot(page, '10-manager-records-log');
  await maybeClick(page, 'POS Transactions');
  await shot(page, '11-manager-pos-transactions');

  await nav(page, 'Weekly Reports');
  await shot(page, '12-manager-weekly-reports');

  await nav(page, 'Fuel Prices');
  await shot(page, '13-manager-price-request');

  await logoutToLogin(page);
  await login(page, { role: 'Cashier', username: 'cashier1', password: 'pos123', branch: 'b1' });
  await maybeClick(page, 'Start Shift');
  await shot(page, '14-cashier-pos-terminal');

  await browser.close();
}

main().catch(error => {
  console.error(error?.stack || error);
  process.exit(1);
});
