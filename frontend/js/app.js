// frontend/js/app.js — main application logic

let currentUser = null;
let selectedFuel = null;
let allFuels = [];
const charts = {};
const destroyChart = k => { if (charts[k]) { try { charts[k].destroy(); } catch(e){} delete charts[k]; }};
const loadedPages = new Set();
const PAGE_FRAGMENTS = {
  'page-pos': 'tabs/pos/index.html',
  'page-mgr-dash': 'tabs/manager-dashboard/index.html',
  'page-daily-entry': 'tabs/daily-entry/index.html',
  'page-records': 'tabs/records-log/index.html',
  'page-weekly': 'tabs/weekly-report/index.html',
  'page-verification': 'tabs/shift-verification/index.html',
  'page-owner-dash': 'tabs/owner-dashboard/index.html',
  'page-comparison': 'tabs/branch-comparison/index.html',
  'page-forecast': 'tabs/forecasting/index.html',
  'page-analytics': 'tabs/analytics/index.html',
  'page-branches': 'tabs/branches/index.html',
  'page-fuel-prices': 'tabs/fuel-prices/index.html',
  'page-user-roles': 'tabs/user-roles/index.html',
  'page-account': 'tabs/account-settings/index.html',
};

// ---- Formatters ----
const safeNum = n => Number.isFinite(parseFloat(n)) ? parseFloat(n) : 0;
const fmt   = n => '₱' + safeNum(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtL  = n => safeNum(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + 'L';
const denomLabel = n => fmt(n).replace(/\.00$/, '');
const fmtDT = iso => { const d = new Date(iso); return d.toLocaleDateString('en-PH',{month:'short',day:'numeric'}) + ' ' + d.toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}); };
const fmtD  = iso => new Date(iso).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
const normalizeTheme = theme => theme === 'dark' ? 'dark' : 'light';

function applyTheme(theme) {
  const selected = normalizeTheme(theme);
  document.documentElement.dataset.theme = selected;
  localStorage.setItem('greenfuel-theme', selected);
}

applyTheme(localStorage.getItem('greenfuel-theme') || 'light');

// ---- Toast ----
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  document.getElementById('toast-msg').textContent = msg;
  t.className = 'toast' + (type === 'error' ? ' error' : type === 'warn' ? ' warn' : '');
  t.classList.add('show');
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove('show'), 2800);
}

// ---- Loading placeholder ----
const loadingHTML = `<div class="loading"><span class="spinner"></span>Loading…</div>`;

// ============================================================
// AUTH
// ============================================================
function updateLoginBranchVisibility() {
  // Branch selection is account-based now; non-owner users enter the
  // branch assigned to their account automatically after login.
}

async function doLogin() {
  const email = document.getElementById('login-user').value.trim();
  const password = document.getElementById('login-pass').value.trim();
  const err = document.getElementById('login-err');
  err.style.display = 'none';
  if (!email || !password) { err.textContent = 'Enter email and password.'; err.style.display = 'block'; return; }
  try {
    const user = await API.login(email, password);
    currentUser = user;
    applyTheme(currentUser.theme_preference || localStorage.getItem('greenfuel-theme') || 'light');
    // Load fuels once
    allFuels = await API.fuels();
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    setupSidebar();
  } catch(e) {
    err.textContent = e.message || 'Invalid credentials.';
    err.style.display = 'block';
  }
}

function setLoginEntryVisible(visible) {
  const display = visible ? '' : 'none';
  ['login-email-field', 'login-password-field', 'login-submit-btn', 'forgot-open-btn'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = display;
  });
}

function setLoginHeading(titleText, subText) {
  const title = document.querySelector('.login-title');
  const sub = document.querySelector('.login-sub');
  if (title) title.textContent = titleText;
  if (sub) sub.textContent = subText;
}

function setPasswordResetMode(active, token = '') {
  setLoginEntryVisible(!active);
  const forgotPanel = document.getElementById('forgot-panel');
  const resetPanel = document.getElementById('reset-panel');
  if (forgotPanel) forgotPanel.style.display = 'none';
  if (resetPanel) resetPanel.style.display = active ? 'block' : 'none';

  setLoginHeading(
    active ? 'Reset password' : 'Welcome back',
    active
      ? 'Create a new password from your email reset link.'
      : 'Sign in to access the centralized management system.'
  );

  const tokenInput = document.getElementById('reset-token');
  if (tokenInput) tokenInput.value = token;
}

function setForgotPasswordMode(active, updateUrl = true) {
  setLoginEntryVisible(!active);
  const forgotPanel = document.getElementById('forgot-panel');
  const resetPanel = document.getElementById('reset-panel');
  const err = document.getElementById('login-err');
  const result = document.getElementById('forgot-result');
  if (resetPanel) resetPanel.style.display = 'none';
  if (forgotPanel) forgotPanel.style.display = active ? 'block' : 'none';
  if (err) err.style.display = 'none';
  if (active && result) {
    result.style.display = 'none';
    result.innerHTML = '';
  }

  setLoginHeading(
    active ? 'Forgot password' : 'Welcome back',
    active
      ? 'Enter the Gmail account connected to your GreenFuel account.'
      : 'Sign in to access the centralized management system.'
  );

  if (updateUrl && window.history?.pushState) {
    const url = new URL(window.location.href);
    url.searchParams.delete('reset_token');
    if (active) {
      url.searchParams.set('forgot_password', '1');
    } else {
      url.searchParams.delete('forgot_password');
    }
    window.history.pushState({}, document.title, url);
  }

  if (active) {
    document.getElementById('login-screen')?.classList.add('active');
    document.getElementById('main-screen')?.classList.remove('active');
    const loginEmail = document.getElementById('login-user')?.value.trim() || '';
    const forgotEmail = document.getElementById('forgot-email');
    if (forgotEmail && !forgotEmail.value) forgotEmail.value = loginEmail;
    forgotEmail?.focus();
  }
}

function initPasswordResetFromUrl() {
  const params = new URLSearchParams(window.location.search);
  const token = params.get('reset_token') || '';
  const forgot = params.get('forgot_password') === '1' || window.location.hash === '#forgot-password';
  if (!token && !forgot) return false;
  document.getElementById('login-screen')?.classList.add('active');
  document.getElementById('main-screen')?.classList.remove('active');
  if (token) {
    setPasswordResetMode(true, token);
    document.getElementById('reset-pass')?.focus();
    return true;
  }
  if (forgot) {
    setForgotPasswordMode(true, false);
    return true;
  }
  return false;
}

function toggleForgotPassword() {
  setForgotPasswordMode(true, true);
}

async function submitForgotPassword() {
  const email = document.getElementById('forgot-email')?.value.trim() || '';
  const err = document.getElementById('login-err');
  const resultBox = document.getElementById('forgot-result');
  if (err) err.style.display = 'none';
  if (resultBox) {
    resultBox.style.display = 'none';
    resultBox.innerHTML = '';
  }
  if (!email) {
    if (err) {
      err.textContent = 'Enter your account email.';
      err.style.display = 'block';
    }
    return;
  }
  try {
    const result = await API.requestPasswordReset(email);
    document.getElementById('login-user').value = email;
    document.getElementById('login-pass').value = '';
    if (resultBox) {
      const devLink = result?.dev_reset_link || '';
      resultBox.style.display = 'block';
      resultBox.innerHTML = devLink
        ? `Email is not configured on this local server. For testing, open this reset page: <a href="${devLink}">Change password</a>`
        : 'Check your email for the password reset link.';
    }
    showToast(result?.mail_sent === false ? 'Reset link created. Local email is not configured.' : 'Password reset link sent.');
  } catch(e) {
    if (err) {
      err.textContent = e.message || 'Could not send reset link.';
      err.style.display = 'block';
    }
  }
}

async function submitTokenPasswordReset() {
  const token = document.getElementById('reset-token')?.value || '';
  const password = document.getElementById('reset-pass')?.value || '';
  const confirmPassword = document.getElementById('reset-confirm-pass')?.value || '';
  const err = document.getElementById('login-err');
  if (err) err.style.display = 'none';

  if (password.length < 8) {
    if (err) {
      err.textContent = 'New password must be at least 8 characters.';
      err.style.display = 'block';
    }
    return;
  }
  if (password !== confirmPassword) {
    if (err) {
      err.textContent = 'Passwords do not match.';
      err.style.display = 'block';
    }
    return;
  }

  try {
    await API.resetPassword(token, password);
    document.getElementById('reset-pass').value = '';
    document.getElementById('reset-confirm-pass').value = '';
    if (window.history?.replaceState) {
      window.history.replaceState({}, document.title, window.location.pathname);
    }
    returnToLoginFromReset();
    showToast('Password updated. Sign in with the new password.');
  } catch(e) {
    if (err) {
      err.textContent = e.message || 'Could not reset password.';
      err.style.display = 'block';
    }
  }
}

function returnToLoginFromReset() {
  setPasswordResetMode(false, '');
  if (window.history?.pushState) {
    const url = new URL(window.location.href);
    url.searchParams.delete('reset_token');
    url.searchParams.delete('forgot_password');
    window.history.pushState({}, document.title, url);
  }
  updateLoginBranchVisibility();
  const err = document.getElementById('login-err');
  if (err) err.style.display = 'none';
}

function returnToLoginFromForgot() {
  setForgotPasswordMode(false, true);
  updateLoginBranchVisibility();
  document.getElementById('login-user')?.focus();
}

function finishLogoutClientSide() {
  if (typeof gfActiveShift !== 'undefined') gfActiveShift = null;
  window.fsActiveShift = null;
  window.gfPendingLogoutAfterShift = false;
  currentUser = null; selectedFuel = null;
  document.getElementById('main-screen').classList.remove('active');
  document.getElementById('login-screen').classList.add('active');
  document.getElementById('login-user').value = '';
  document.getElementById('login-pass').value = '';
  Object.keys(charts).forEach(destroyChart);
}

async function doLogout() {
  stopBranchWeeklyAutoRefresh();
  if (currentUser?.role === 'cashier') {
    let activeShift = null;
    try {
      activeShift = await API.shiftCurrent();
    } catch(e) {
      activeShift = window.fsActiveShift || (typeof gfActiveShift !== 'undefined' ? gfActiveShift : null);
    }

    if (activeShift) {
      const started = activeShift.start_time ? `\nStarted: ${fmtDT(activeShift.start_time)}` : '';
      const shouldEnd = confirm(`You still have an active shift.${started}\n\nEnd this shift before signing out?`);
      if (!shouldEnd) return;

      if (typeof openEndShiftModal === 'function') {
        window.gfPendingLogoutAfterShift = true;
        if (typeof gfActiveShift !== 'undefined') gfActiveShift = activeShift;
        window.fsActiveShift = activeShift;
        await openEndShiftModal({ afterLogout: true });
        return;
      }

      try {
        await API.shiftEnd({ cash_breakdown: {} });
        if (typeof gfActiveShift !== 'undefined') gfActiveShift = null;
        window.fsActiveShift = null;
        showToast('Shift ended and submitted.');
      } catch(e) {
        showToast(e.message || 'Could not end the active shift.', 'error');
        return;
      }
    }
  }

  try { await API.logout(); } catch(e) {}
  finishLogoutClientSide();
}

// Check if already logged in on page load
window.addEventListener('load', async () => {
  updateLoginBranchVisibility();
  if (initPasswordResetFromUrl()) return;
  try {
    currentUser = await API.me();
    applyTheme(currentUser.theme_preference || localStorage.getItem('greenfuel-theme') || 'light');
    allFuels    = await API.fuels();
    document.getElementById('login-screen').classList.remove('active');
    document.getElementById('main-screen').classList.add('active');
    setupSidebar();
  } catch(e) {
    // Not logged in — show login screen (already visible)
  }
});

// ============================================================
// NAVIGATION
// ============================================================
const NAV = {
  owner: [
    { label: 'Dashboard',         page: 'page-owner-dash', icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
    { label: 'User Roles',        page: 'page-user-roles', icon: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z' },
    { label: 'Fuel Prices',        page: 'page-fuel-prices',  icon: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm1 17h-2v-2h2v2zm0-4h-2V6h2v8z' },
    { label: 'Branches',          page: 'page-branches',   icon: 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5c-1.38 0-2.5-1.12-2.5-2.5s1.12-2.5 2.5-2.5 2.5 1.12 2.5 2.5-1.12 2.5-2.5 2.5z' },
    { label: 'Branch Comparison', page: 'page-comparison', icon: 'M5 9.2h3V19H5zM10.6 5h2.8v14h-2.8zm5.6 8H19v6h-2.8z' },
    { label: 'Forecasting',       page: 'page-forecast',   icon: 'M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z' },
    { label: 'Analytics & Reports', page: 'page-analytics',  icon: 'M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z' },
    { label: 'Account Settings',   page: 'page-account',    icon: 'M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.49 1a7.28 7.28 0 0 0-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42L9.12 5.07c-.61.24-1.18.56-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.02.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.37.31.6.22l2.49-1c.51.4 1.08.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.24 1.18-.56 1.69-.98l2.49 1c.23.08.48 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z' },
  ],
  manager: [
    { label: 'Dashboard',          page: 'page-mgr-dash',     icon: 'M3 13h8V3H3v10zm0 8h8v-6H3v6zm10 0h8V11h-8v10zm0-18v6h8V3h-8z' },
    { label: 'Cashier Accounts',   page: 'page-user-roles',   icon: 'M16 11c1.66 0 2.99-1.34 2.99-3S17.66 5 16 5s-3 1.34-3 3 1.34 3 3 3zm-8 0c1.66 0 2.99-1.34 2.99-3S9.66 5 8 5 5 6.34 5 8s1.34 3 3 3zm0 2c-2.33 0-7 1.17-7 3.5V19h14v-2.5C15 14.17 10.33 13 8 13zm8 0c-.29 0-.62.02-.97.05 1.16.84 1.97 1.97 1.97 3.45V19h6v-2.5c0-2.33-4.67-3.5-7-3.5z' },
    { label: 'Daily Entry',        page: 'page-daily-entry',  icon: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-2 14H7v-2h10v2zm0-4H7v-2h10v2z' },
    { label: 'Records Log',        page: 'page-records',      icon: 'M14 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V8l-6-6zm2 16H8v-2h8v2zm0-4H8v-2h8v2zm-3-5V3.5L18.5 9H13z' },
    { label: 'Weekly Reports',     page: 'page-weekly',       icon: 'M19 3h-1V1h-2v2H8V1H6v2H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V8h14v11z' },
    { label: 'Fuel Prices',        page: 'page-fuel-prices',  icon: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm1 17h-2v-2h2v2zm0-4h-2V6h2v8z' },
    { label: 'Account Settings',   page: 'page-account',      icon: 'M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.49 1a7.28 7.28 0 0 0-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42L9.12 5.07c-.61.24-1.18.56-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.02.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.37.31.6.22l2.49-1c.51.4 1.08.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.24 1.18-.56 1.69-.98l2.49 1c.23.08.48 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z' },
  ],
  cashier: [
    { label: 'POS Terminal', page: 'page-pos', icon: 'M20 4H4c-1.11 0-2 .89-2 2v12c0 1.11.89 2 2 2h16c1.11 0 2-.89 2-2V6c0-1.11-.89-2-2-2zm0 14H4v-6h16v6zm0-10H4V6h16v2z' },
    { label: 'Fuel Prices',  page: 'page-fuel-prices', icon: 'M12 1L3 5v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V5l-9-4zm1 17h-2v-2h2v2zm0-4h-2V6h2v8z' },
    { label: 'Account Settings', page: 'page-account', icon: 'M19.43 12.98c.04-.32.07-.65.07-.98s-.02-.66-.07-.98l2.11-1.65c.19-.15.24-.42.12-.64l-2-3.46c-.12-.22-.37-.31-.6-.22l-2.49 1a7.28 7.28 0 0 0-1.69-.98L14.5 2.42A.5.5 0 0 0 14 2h-4a.5.5 0 0 0-.5.42L9.12 5.07c-.61.24-1.18.56-1.69.98l-2.49-1a.5.5 0 0 0-.6.22l-2 3.46a.5.5 0 0 0 .12.64l2.11 1.65c-.04.32-.07.65-.07.98s.02.66.07.98l-2.11 1.65a.5.5 0 0 0-.12.64l2 3.46c.12.22.37.31.6.22l2.49-1c.51.4 1.08.73 1.69.98l.38 2.65c.04.24.25.42.5.42h4c.25 0 .46-.18.5-.42l.38-2.65c.61-.24 1.18-.56 1.69-.98l2.49 1c.23.08.48 0 .6-.22l2-3.46a.5.5 0 0 0-.12-.64l-2.11-1.65zM12 15.5A3.5 3.5 0 1 1 12 8a3.5 3.5 0 0 1 0 7.5z' },
  ],
};
Object.keys(NAV).forEach(role => {
  NAV[role] = NAV[role].filter(item => item.page !== 'page-account');
});

function userInitials(user = currentUser) {
  const name = (user?.name || user?.email || '?').trim();
  return name.split(/\s+/).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || '?';
}

function paintAvatar(el, user = currentUser) {
  if (!el || !user) return;
  const hasPhoto = !!user.profile_image;
  el.classList.toggle('has-photo', hasPhoto);
  el.style.backgroundImage = hasPhoto ? `url("${user.profile_image}")` : '';
  el.textContent = hasPhoto ? '' : userInitials(user);
}

function updateUserChrome() {
  if (!currentUser) return;
  paintAvatar(document.getElementById('user-avatar'), currentUser);
  document.getElementById('user-name-display').textContent = currentUser.name;
  document.getElementById('user-role-display').textContent = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
  document.getElementById('sidebar-role-label').textContent = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1) + ' Portal';
}

function setupSidebar() {
  updateUserChrome();
  const nav = document.getElementById('sidebar-nav');
  nav.innerHTML = '';
  const items = NAV[currentUser.role] || [];
  items.forEach((item, i) => {
    const btn = document.createElement('button');
    btn.className = 'nav-item' + (i === 0 ? ' active' : '');
    btn.innerHTML = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="${item.icon}"/></svg>${item.label}`;
    btn.onclick = () => {
      document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
      document.querySelector('.account-trigger')?.classList.remove('active');
      btn.classList.add('active');
      loadPage(item.page);
    };
    nav.appendChild(btn);
  });
  if (items.length > 0) loadPage(items[0].page);
}

function openAccountSettings() {
  document.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
  document.querySelector('.account-trigger')?.classList.add('active');
  loadPage('page-account');
}

async function ensurePageLoaded(pageId) {
  if (loadedPages.has(pageId)) return;
  const path = PAGE_FRAGMENTS[pageId];
  if (!path) throw new Error('Unknown page: ' + pageId);
  const host = document.getElementById('page-host');
  const res = await fetch(path, { cache: 'no-store' });
  if (!res.ok) throw new Error('Could not load ' + path);
  host.insertAdjacentHTML('beforeend', await res.text());
  loadedPages.add(pageId);
}

async function loadPage(pageId) {
  stopBranchWeeklyAutoRefresh();
  try {
    await ensurePageLoaded(pageId);
  } catch(e) {
    showToast(e.message, 'error');
    return;
  }
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(pageId).classList.add('active');
  const loaders = {
    'page-pos': () => (window.fsRenderFuelSightPOS || initFuelSightPOS)(), 'page-mgr-dash': initMgrDash, 'page-records': initRecords,
    'page-daily-entry': initDailyEntry, 'page-weekly': initWeekly, 'page-verification': initVerification,
    'page-owner-dash': initOwnerDash, 'page-comparison': initComparison,
    'page-forecast': initForecast, 'page-analytics': initAnalytics, 'page-branches': initBranches,
    'page-fuel-prices': initFuelPrices, 'page-user-roles': initUserRoles, 'page-account': initAccountSettings,
  };
  if (loaders[pageId]) await loaders[pageId]();
}

// ============================================================
// ACCOUNT SETTINGS
// ============================================================
let accountPhotoData = '';
let accountThemeSelection = 'light';
let accountThemeSaveSeq = 0;

function accountBranchLabel() {
  if (currentUser?.role === 'owner') return 'Network-wide access';
  return currentUser?.branch_name || currentUser?.branch_id || 'No branch selected';
}

function renderAccountAvatarPreview() {
  const preview = document.getElementById('account-avatar-preview');
  if (!preview) return;
  const user = { ...currentUser, profile_image: accountPhotoData };
  paintAvatar(preview, user);
}

function updateAccountThemeButtons() {
  document.querySelectorAll('.theme-choice').forEach(btn => btn.classList.remove('active'));
  document.getElementById(`account-theme-${accountThemeSelection}`)?.classList.add('active');
}

function initAccountSettings() {
  if (!currentUser) return;
  accountPhotoData = currentUser.profile_image || '';
  accountThemeSelection = normalizeTheme(currentUser.theme_preference || localStorage.getItem('greenfuel-theme') || 'light');

  const roleLabel = currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1);
  document.getElementById('account-role-chip').textContent = `${roleLabel} Portal`;
  document.getElementById('account-name').value = currentUser.name || '';
  document.getElementById('account-email').value = currentUser.email || currentUser.username || '';
  document.getElementById('account-role').textContent = roleLabel;
  document.getElementById('account-branch').textContent = accountBranchLabel();
  ['account-current-password', 'account-new-password', 'account-confirm-password'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  const passwordCard = document.querySelector('.account-side-stack .card:last-child');
  if (passwordCard) passwordCard.style.display = currentUser.role === 'owner' ? 'none' : '';
  const photoInput = document.getElementById('account-photo-input');
  if (photoInput) photoInput.value = '';
  renderAccountAvatarPreview();
  updateAccountThemeButtons();
}

function handleAccountPhotoUpload(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const validTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'];
  if (!validTypes.includes(file.type)) {
    showToast('Choose a PNG, JPG, WEBP, or GIF image.', 'error');
    event.target.value = '';
    return;
  }
  if (file.size > 1024 * 1024) {
    showToast('Profile picture must be 1 MB or smaller.', 'error');
    event.target.value = '';
    return;
  }
  const reader = new FileReader();
  reader.onload = () => {
    accountPhotoData = String(reader.result || '');
    renderAccountAvatarPreview();
  };
  reader.onerror = () => showToast('Could not read that image.', 'error');
  reader.readAsDataURL(file);
}

function removeAccountPhoto() {
  accountPhotoData = '';
  const photoInput = document.getElementById('account-photo-input');
  if (photoInput) photoInput.value = '';
  renderAccountAvatarPreview();
}

async function setAccountTheme(theme) {
  const selected = normalizeTheme(theme);
  const previous = normalizeTheme(currentUser?.theme_preference || accountThemeSelection || localStorage.getItem('greenfuel-theme') || 'light');
  accountThemeSelection = selected;
  if (currentUser) currentUser.theme_preference = selected;
  applyTheme(selected);
  updateAccountThemeButtons();

  if (!currentUser) return;
  const seq = ++accountThemeSaveSeq;
  const buttons = document.querySelectorAll('.theme-choice');
  buttons.forEach(btn => btn.disabled = true);

  try {
    const updatedUser = await API.accountThemeUpdate(selected);
    if (seq !== accountThemeSaveSeq) return;
    currentUser = { ...currentUser, ...updatedUser };
    accountThemeSelection = normalizeTheme(currentUser.theme_preference || selected);
    applyTheme(accountThemeSelection);
    updateAccountThemeButtons();
    showToast(`${accountThemeSelection === 'dark' ? 'Night' : 'Light'} mode saved.`);
  } catch(e) {
    if (seq !== accountThemeSaveSeq) return;
    accountThemeSelection = previous;
    if (currentUser) currentUser.theme_preference = previous;
    applyTheme(previous);
    updateAccountThemeButtons();
    showToast(e.message || 'Could not save display mode.', 'error');
  } finally {
    if (seq === accountThemeSaveSeq) buttons.forEach(btn => btn.disabled = false);
  }
}

async function saveAccountSettings() {
  const name = document.getElementById('account-name')?.value.trim() || '';
  if (!name) { showToast('Display name is required.', 'error'); return; }
  const btn = document.querySelector('.account-profile-card .account-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    currentUser = await API.accountUpdate({
      name,
      profile_image: accountPhotoData,
      theme_preference: accountThemeSelection,
    });
    applyTheme(currentUser.theme_preference || accountThemeSelection);
    updateUserChrome();
    initAccountSettings();
    showToast('Account settings saved.');
  } catch(e) {
    showToast(e.message || 'Could not save account settings.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Save Account Settings'; }
  }
}

async function changeAccountPassword() {
  const current = document.getElementById('account-current-password')?.value || '';
  const next = document.getElementById('account-new-password')?.value || '';
  const confirmNext = document.getElementById('account-confirm-password')?.value || '';
  if (!current || !next || !confirmNext) { showToast('Complete all password fields.', 'error'); return; }
  if (next.length < 8) { showToast('New password must be at least 8 characters.', 'error'); return; }
  if (next !== confirmNext) { showToast('New passwords do not match.', 'error'); return; }
  const btn = document.querySelector('.account-side-stack .card:last-child .account-save-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Updating...'; }
  try {
    await API.changePassword({ current_password: current, new_password: next });
    ['account-current-password', 'account-new-password', 'account-confirm-password'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    showToast('Password updated.');
  } catch(e) {
    showToast(e.message || 'Could not update password.', 'error');
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Update Password'; }
  }
}

// ============================================================
// POS
// ============================================================
function initPOS() {
  const branch = currentUser.branch_name || currentUser.branch_id || 'Branch';
  document.getElementById('pos-branch-sub').textContent = `Recording fuel sales — ${branch}`;
  renderFuelButtons();
  loadRecentTx();
}

function renderFuelButtons() {
  const wrap = document.getElementById('fuel-buttons');
  wrap.innerHTML = '';
  allFuels.forEach(f => {
    const btn = document.createElement('button');
    btn.className = 'fuel-btn' + (selectedFuel && selectedFuel.id === f.id ? ' selected' : '');
    btn.innerHTML = `<span class="fuel-dot" style="background:${f.color}"></span><span class="fuel-name">${f.name}</span><span class="fuel-price">₱${parseFloat(f.price).toFixed(2)} / liter</span>`;
    btn.onclick = () => {
      selectedFuel = f;
      document.getElementById('pos-price').value = parseFloat(f.price).toFixed(2);
      calcPosTotal();
      renderFuelButtons();
    };
    wrap.appendChild(btn);
  });
}

function calcPosTotal() {
  const liters = parseFloat(document.getElementById('pos-liters').value) || 0;
  const price  = parseFloat(document.getElementById('pos-price').value)  || 0;
  const total  = liters * price;
  document.getElementById('pos-total-display').textContent = fmt(total);
  document.getElementById('pos-breakdown-text').textContent = selectedFuel
    ? `${fmtL(liters)} × ₱${price.toFixed(2)}/L = ${fmt(total)}`
    : 'Select a fuel type first';
}

async function submitTransaction() {
  const liters = parseFloat(document.getElementById('pos-liters').value);
  const errL = document.getElementById('err-liters');
  errL.style.display = 'none';
  if (!selectedFuel) { showToast('Select a fuel type first', 'error'); return; }
  if (!liters || liters <= 0) { errL.style.display = 'block'; return; }
  const btn = document.querySelector('.btn-pos-confirm');
  btn.disabled = true; btn.textContent = 'Saving…';
  try {
    const res = await API.txCreate({
      branch_id: currentUser.branch_id,
      fuel_type: selectedFuel.id,
      liters,
      customer: document.getElementById('pos-customer').value || 'Walk-in',
    });
    document.getElementById('pos-liters').value = '';
    document.getElementById('pos-customer').value = '';
    document.getElementById('pos-total-display').textContent = '₱0.00';
    document.getElementById('pos-breakdown-text').textContent = 'Select fuel type and enter liters';
    showToast(`Saved — ${fmt(res.total_amount)}`);
    loadRecentTx();
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '✓  Process Transaction';
  }
}

async function loadRecentTx() {
  const wrap = document.getElementById('pos-recent-list');
  wrap.innerHTML = loadingHTML;
  try {
    const txs = await API.txRecent(currentUser.branch_id, 12);
    const today = txs.filter(t => new Date(t.timestamp).toDateString() === new Date().toDateString());
    document.getElementById('today-count-badge').textContent = today.length + ' today';
    if (!txs.length) { wrap.innerHTML = '<div class="loading">No transactions yet</div>'; return; }
    wrap.innerHTML = txs.map(t => `
      <div style="display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)">
        <span style="width:8px;height:8px;border-radius:50%;background:${t.fuel_color||'#ccc'};flex-shrink:0"></span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:500">${t.fuel_name || t.fuel_type}</div>
          <div style="font-size:11px;color:var(--muted)">${fmtDT(t.timestamp)} · ${fmtL(t.liters)}</div>
        </div>
        <div style="font-size:13px;font-weight:600;color:var(--green)">${fmt(t.total_amount)}</div>
      </div>`).join('');
  } catch(e) { wrap.innerHTML = `<div class="loading">${e.message}</div>`; }
}

// ============================================================
// MANAGER DASHBOARD
// ============================================================
async function initMgrDash() {
  document.getElementById('mgr-stat-grid').innerHTML = loadingHTML;
  try {
    const [todayData, txs, fuelData] = await Promise.all([
      API.txToday(currentUser.branch_id),
      API.txList({ branch_id: currentUser.branch_id, limit: 20 }),
      API.fuelBreakdown(currentUser.branch_id),
    ]);
    const { summary, transactions: todayTxs } = todayData;
    const allTxs = txs;
    const totalRev = allTxs.reduce((a, t) => a + parseFloat(t.total_amount), 0);
    const totalL   = allTxs.reduce((a, t) => a + parseFloat(t.liters), 0);

    document.getElementById('mgr-stat-grid').innerHTML = `
      <div class="stat-card highlight">
        <div class="stat-label">Today's Revenue</div>
        <div class="stat-value">${fmt(summary.revenue)}</div>
        <div class="stat-sub">${summary.count} transactions</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Revenue</div>
        <div class="stat-value green">${fmt(totalRev)}</div>
        <div class="stat-sub">All time</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Liters</div>
        <div class="stat-value">${fmtL(totalL)}</div>
        <div class="stat-sub">All fuel types</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Branch</div>
        <div class="stat-value" style="font-size:17px">${currentUser.branch_name || '—'}</div>
        <div class="stat-sub">${currentUser.branch_location || '—'}</div>
      </div>`;

    // Daily trend
    const daily = await API.daily({ branch_id: currentUser.branch_id, days: 7 });
    const labels = [...new Set(daily.map(d => d.day))].sort();
    destroyChart('mgr-trend');
    charts['mgr-trend'] = new Chart(document.getElementById('mgr-trend-chart'), {
      type: 'bar',
      data: { labels: labels.map(d => fmtD(d)), datasets: [{ label: 'Revenue', data: labels.map(l => Math.round(daily.find(d => d.day === l)?.revenue || 0)), backgroundColor: '#16a34a', borderRadius: 5 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '₱' + v.toLocaleString() }, grid: { color: 'rgba(0,0,0,0.05)' } }, x: { grid: { display: false } } } }
    });

    // Fuel pie
    destroyChart('mgr-fuel');
    charts['mgr-fuel'] = new Chart(document.getElementById('mgr-fuel-chart'), {
      type: 'doughnut',
      data: { labels: fuelData.map(f => f.name), datasets: [{ data: fuelData.map(f => Math.round(f.revenue)), backgroundColor: fuelData.map(f => f.color), borderWidth: 3, borderColor: '#fff' }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 8, boxWidth: 10 } } }, cutout: '60%' }
    });

    document.getElementById('mgr-tx-table').innerHTML = buildTxTable(allTxs);
  } catch(e) { showToast(e.message, 'error'); }
}

function buildTxTable(txs) {
  if (!txs.length) return '<p class="loading">No transactions found</p>';
  return `<table><thead><tr>
    <th>Tx ID</th><th>Fuel Type</th><th class="td-right">Liters</th>
    <th class="td-right">Price/L</th><th class="td-right">Total</th>
    <th>Timestamp</th><th class="td-center">Status</th>
  </tr></thead><tbody>` +
  txs.map(t => `<tr>
    <td class="mono">${t.id}</td>
    <td><span style="display:inline-flex;align-items:center;gap:6px">
      <span style="width:8px;height:8px;border-radius:50%;background:${t.fuel_color||'#ccc'}"></span>
      ${t.fuel_name || t.fuel_type}</span></td>
    <td class="td-right">${fmtL(t.liters)}</td>
    <td class="td-right">₱${parseFloat(t.price_per_liter).toFixed(2)}</td>
    <td class="td-right" style="font-weight:600;color:var(--green)">${fmt(t.total_amount)}</td>
    <td style="white-space:nowrap;color:var(--muted)">${fmtDT(t.timestamp)}</td>
    <td class="td-center"><span class="badge ${t.status==='verified'?'badge-green':'badge-amber'}">${t.status}</span></td>
  </tr>`).join('') + '</tbody></table>';
}

// ============================================================
// RECORDS LOG
// ============================================================
async function initRecords() {
  const sel = document.getElementById('filter-fuel');
  if (sel.options.length === 1) {
    allFuels.forEach(f => { const o = document.createElement('option'); o.value = f.id; o.textContent = f.name; sel.appendChild(o); });
  }
  renderRecords();
}

async function renderRecords() {
  const wrap = document.getElementById('records-table');
  wrap.innerHTML = loadingHTML;
  const params = { branch_id: currentUser.branch_id };
  const df = document.getElementById('filter-date').value;
  const ff = document.getElementById('filter-fuel').value;
  if (df) params.date = df;
  if (ff) params.fuel_type = ff;
  try {
    const txs = await API.txList(params);
    document.getElementById('records-count').textContent = txs.length + ' records';
    wrap.innerHTML = buildTxTable(txs);
  } catch(e) { wrap.innerHTML = `<div class="loading">${e.message}</div>`; }
}

function clearFilters() {
  document.getElementById('filter-date').value = '';
  document.getElementById('filter-fuel').value = '';
  renderRecords();
}

// ============================================================
// WEEKLY REPORT
// ============================================================
async function initWeekly() {
  document.getElementById('weekly-stat-grid').innerHTML = loadingHTML;
  try {
    const data = await API.weeklyReport({ branch_id: currentUser.branch_id });
    const { totals, fuel_breakdown, daily } = data;
    const expenses = safeNum(totals.total_expenses);
    const net = totals.total_sales - expenses;

    document.getElementById('weekly-stat-grid').innerHTML = `
      <div class="stat-card highlight"><div class="stat-label">Total Sales</div><div class="stat-value">${fmt(totals.total_sales)}</div></div>
      <div class="stat-card"><div class="stat-label">Expenses</div><div class="stat-value">${fmt(expenses)}</div></div>
      <div class="stat-card"><div class="stat-label">Net Sales</div><div class="stat-value green">${fmt(net)}</div></div>
      <div class="stat-card"><div class="stat-label">Total Liters</div><div class="stat-value">${fmtL(totals.total_liters)}</div></div>`;

    document.getElementById('weekly-fuel-table').innerHTML = `<table>
      <thead><tr><th>Fuel Type</th><th class="td-right">Liters</th><th class="td-right">Revenue</th></tr></thead>
      <tbody>${fuel_breakdown.map(f => `<tr>
        <td><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:8px;height:8px;border-radius:50%;background:${f.color}"></span>${f.name}</span></td>
        <td class="td-right">${fmtL(f.liters)}</td>
        <td class="td-right" style="font-weight:600;color:var(--green)">${fmt(f.revenue)}</td>
      </tr>`).join('')}
      <tr style="font-weight:700;background:var(--surface)">
        <td>Total</td><td class="td-right">${fmtL(totals.total_liters)}</td>
        <td class="td-right" style="color:var(--green)">${fmt(totals.total_sales)}</td>
      </tr></tbody></table>`;

    document.getElementById('weekly-daily-table').innerHTML = `<table>
      <thead><tr><th>Date</th><th class="td-right">Transactions</th><th class="td-right">Revenue</th><th class="td-center">Status</th></tr></thead>
      <tbody>${daily.map(d => `<tr>
        <td>${fmtD(d.day)}</td><td class="td-right">${d.tx_count}</td>
        <td class="td-right" style="font-weight:600;color:var(--green)">${fmt(d.revenue)}</td>
        <td class="td-center"><span class="badge badge-green">Verified</span></td>
      </tr>`).join('')}</tbody></table>`;

    document.getElementById('weekly-submitted').style.display = 'none';
    document.getElementById('weekly-submit-area').style.display = 'flex';
  } catch(e) { showToast(e.message, 'error'); }
}

async function submitWeeklyReport() {
  const range = getWeeklyRangeFromInputs(false) || gfWeeklyRange || gfCurrentWeekRange();
  const btn = document.getElementById('weekly-submit-btn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Submitting...';
  }
  try {
    await API.submitReport({ branch_id: currentUser.branch_id, week_start: range.start, week_end: range.end });
    const legacyArea = document.getElementById('weekly-submit-area');
    const legacySubmitted = document.getElementById('weekly-submitted');
    if (legacyArea) legacyArea.style.display = 'none';
    if (legacySubmitted) legacySubmitted.style.display = 'flex';
    showToast(`Weekly report submitted to owner (${weeklyRangeLabel(range)}).`);
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Submit Weekly Report';
    }
  }
}

// ============================================================
// SHIFT VERIFICATION
// ============================================================
async function initVerification() {
  document.getElementById('pending-table').innerHTML = loadingHTML;
  try {
    const [pending, history] = await Promise.all([
      API.shiftsPending(currentUser.branch_id),
      API.shiftsHistory(currentUser.branch_id),
    ]);
    document.getElementById('pending-badge').textContent = pending.length;

    document.getElementById('pending-table').innerHTML = pending.length
      ? `<table><thead><tr><th>Record ID</th><th>Date & Shift</th><th>Cashier</th>
           <th class="td-right">Total Sales</th><th class="td-right">Liters</th>
           <th class="td-center">Status</th><th class="td-right">Action</th></tr></thead>
         <tbody>${pending.map(r => `<tr>
           <td class="mono">${r.id}</td>
           <td><div style="font-weight:500">${r.date}</div><div style="font-size:11px;color:var(--muted)">${r.shift}</div></td>
           <td>${r.cashier_name || '—'}</td>
           <td class="td-right" style="font-weight:600">${fmt(r.total_sales)}</td>
           <td class="td-right">${fmtL(r.total_liters)}</td>
           <td class="td-center"><span class="badge badge-amber">${r.status}</span></td>
           <td class="td-right" style="display:flex;gap:6px;justify-content:flex-end">
             <button class="btn-green btn-sm" onclick="verifyShift('${r.id}','Verified')">Verify</button>
             <button class="btn-danger-sm" onclick="verifyShift('${r.id}','Flagged')">Flag</button>
           </td></tr>`).join('')}</tbody></table>`
      : '<p class="loading">No pending records</p>';

    const statusMap = { Verified: 'badge-green', Recalibrated: 'badge-blue', Flagged: 'badge-red' };
    document.getElementById('history-table').innerHTML = history.length
      ? `<table><thead><tr><th>Record ID</th><th>Date & Shift</th><th>Cashier</th>
           <th class="td-right">Total Sales</th><th class="td-center">Status</th><th>Verified By</th></tr></thead>
         <tbody>${history.map(r => `<tr>
           <td class="mono">${r.id}</td>
           <td><div style="font-weight:500">${r.date}</div><div style="font-size:11px;color:var(--muted)">${r.shift}</div></td>
           <td>${r.cashier_name||'—'}</td>
           <td class="td-right">${fmt(r.total_sales)}</td>
           <td class="td-center"><span class="badge ${statusMap[r.status]||'badge-gray'}">${r.status}</span></td>
           <td style="color:var(--muted)">${r.verifier_name||'—'}</td>
         </tr>`).join('')}</tbody></table>`
      : '<p class="loading">No history yet</p>';
  } catch(e) { showToast(e.message, 'error'); }
}

async function verifyShift(id, status) {
  try {
    await API.shiftVerify(id, status);
    showToast(`Shift ${status.toLowerCase()}`, status === 'Flagged' ? 'warn' : 'success');
    setTimeout(initVerification, 300);
  } catch(e) { showToast(e.message, 'error'); }
}

// ============================================================
// OWNER DASHBOARD
// ============================================================
async function initOwnerDash() {
  document.getElementById('owner-stat-grid').innerHTML = loadingHTML;
  try {
    const [summary, ranking, daily, fuels] = await Promise.all([
      API.summary(), API.branchRanking(), API.daily({ days: 7 }), API.fuelBreakdown(),
    ]);
    const { all_time, today } = summary;
    document.getElementById('owner-stat-grid').innerHTML = `
      <div class="stat-card highlight">
        <div class="stat-label">Today's Revenue</div>
        <div class="stat-value">${fmt(today.revenue)}</div>
        <div class="stat-sub">${today.tx_count} transactions</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Revenue</div>
        <div class="stat-value green">${fmt(all_time.total_revenue)}</div>
        <div class="stat-sub">All branches, all time</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Liters Sold</div>
        <div class="stat-value">${fmtL(all_time.total_liters)}</div>
        <div class="stat-sub">Network-wide</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Top Branch</div>
        <div class="stat-value" style="font-size:17px">${ranking[0]?.name || '—'}</div>
        <div class="stat-sub">${ranking[0] ? fmt(ranking[0].revenue) : ''}</div>
      </div>`;

    if (ranking.length > 1) {
      const diff = ((ranking[0].revenue - ranking[ranking.length-1].revenue) / ranking[0].revenue * 100).toFixed(1);
      document.getElementById('owner-insight-banner').innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg><span><strong>${ranking[0].name}</strong> leads with ${fmt(ranking[0].revenue)}. <strong>${ranking[ranking.length-1].name}</strong> is ${diff}% behind.</span>`;
    }

    const days    = [...new Set(daily.map(d => d.day))].sort();
    const branches= [...new Set(daily.map(d => d.branch_id))];
    const colors  = ['#16a34a','#2563eb','#d97706','#9333ea'];
    destroyChart('owner-trend');
    charts['owner-trend'] = new Chart(document.getElementById('owner-trend-chart'), {
      type: 'line',
      data: { labels: days.map(d => fmtD(d)), datasets: branches.map((bid, i) => {
        const bname = daily.find(d => d.branch_id === bid)?.branch_name || bid;
        return { label: bname, data: days.map(day => Math.round(daily.find(d => d.branch_id===bid && d.day===day)?.revenue||0)), borderColor: colors[i], backgroundColor: colors[i]+'18', fill: false, tension: 0.35, pointRadius: 3 };
      }) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position:'top', labels:{ font:{size:11}, padding:12, boxWidth:12 } } }, scales: { y: { ticks:{ callback: v=>'₱'+v.toLocaleString() }, grid:{ color:'rgba(0,0,0,0.04)' } }, x:{ grid:{display:false} } } }
    });
    destroyChart('owner-fuel');
    charts['owner-fuel'] = new Chart(document.getElementById('owner-fuel-chart'), {
      type: 'doughnut',
      data: { labels: fuels.map(f=>f.name), datasets: [{ data: fuels.map(f=>Math.round(f.revenue)), backgroundColor: fuels.map(f=>f.color), borderWidth:3, borderColor:'#fff' }] },
      options: { responsive:true, maintainAspectRatio:false, cutout:'58%', plugins:{ legend:{position:'bottom',labels:{font:{size:11},padding:8,boxWidth:10}} } }
    });
  } catch(e) { showToast(e.message, 'error'); }
}

// ============================================================
// BRANCH COMPARISON
// ============================================================
async function initComparison() {
  document.getElementById('rank-list').innerHTML = loadingHTML;
  try {
    const ranking = await API.branchRanking();
    const maxRev = ranking[0]?.revenue || 1;
    const medals = ['medal-1','medal-2','medal-3','medal-other'];
    document.getElementById('rank-list').innerHTML = ranking.map((r, i) => `
      <div class="rank-item">
        <div class="rank-medal ${medals[i]||'medal-other'}">${i+1}</div>
        <div class="rank-info">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span class="rank-name">${r.name}</span>
            <span class="rank-revenue">${fmt(r.revenue)}</span>
          </div>
          <div class="rank-bar-bg"><div class="rank-bar-fill" style="width:${Math.round(r.revenue/maxRev*100)}%"></div></div>
          <div class="rank-meta">${r.tx_count} transactions · ${fmtL(r.liters)}</div>
        </div>
      </div>`).join('');

    const colors = ['#16a34a','#2563eb','#d97706','#9333ea'];
    destroyChart('branch-bar');
    charts['branch-bar'] = new Chart(document.getElementById('branch-bar-chart'), {
      type: 'bar',
      data: { labels: ranking.map(r=>r.name), datasets: [{ label:'Revenue', data: ranking.map(r=>Math.round(r.revenue)), backgroundColor: colors, borderRadius: 5 }] },
      options: { responsive:true, maintainAspectRatio:false, indexAxis:'y', plugins:{legend:{display:false}}, scales:{ x:{ticks:{callback:v=>'₱'+v.toLocaleString()},grid:{color:'rgba(0,0,0,0.04)'}}, y:{grid:{display:false}} } }
    });

    const statusLabel = (i, n) => i===0 ? '<span class="badge badge-green">Top Branch</span>' : i===n-1 ? '<span class="badge badge-red">Lowest</span>' : '<span class="badge badge-gray">Normal</span>';
    document.getElementById('branch-detail-table').innerHTML = `<table>
      <thead><tr><th>Rank</th><th>Branch</th><th>Location</th><th class="td-right">Transactions</th><th class="td-right">Liters</th><th class="td-right">Revenue</th><th class="td-right">Avg/Tx</th><th class="td-center">Status</th></tr></thead>
      <tbody>${ranking.map((r,i)=>`<tr>
        <td style="font-weight:700;color:var(--muted)">#${i+1}</td>
        <td style="font-weight:600">${r.name}</td>
        <td style="color:var(--muted)">${r.location}</td>
        <td class="td-right">${r.tx_count}</td>
        <td class="td-right">${fmtL(r.liters)}</td>
        <td class="td-right" style="font-weight:600;color:var(--green)">${fmt(r.revenue)}</td>
        <td class="td-right">${fmt(r.revenue/Math.max(1,r.tx_count))}</td>
        <td class="td-center">${statusLabel(i,ranking.length)}</td>
      </tr>`).join('')}</tbody></table>`;
  } catch(e) { showToast(e.message, 'error'); }
}

// ============================================================
// FORECASTING
// ============================================================
async function initForecast() {
  document.getElementById('forecast-cards').innerHTML = loadingHTML;
  try {
    const forecasts = await API.forecast();
    const tagMap = { 'refill urgent':'tag-low', 'monitor stock':'tag-high', 'stock healthy':'tag-normal', 'no sales data':'tag-high' };
    const stockBasisLabel = f => {
      if (f.stock_source === 'daily_entry') return f.stock_date ? `Daily Entry · ${fmtD(f.stock_date)}` : 'Daily Entry';
      if (f.stock_source === 'inventory_level') return 'Inventory Level';
      return 'No submitted stock';
    };
    const basis = forecasts[0]?.basis_label || 'Recent 7 calendar days';
    const urgent = forecasts.filter(f => f.suggestion === 'refill urgent');
    const monitor = forecasts.filter(f => f.suggestion === 'monitor stock');
    const healthy = forecasts.filter(f => f.suggestion === 'stock healthy');
    const noData = forecasts.filter(f => f.suggestion === 'no sales data');
    const activeRows = forecasts.filter(f => f.suggestion !== 'no sales data');
    const priority = [...urgent, ...monitor];
    const avgCoverage = activeRows
      .filter(f => f.days_remaining !== null && f.days_remaining !== undefined)
      .reduce((sum, f, _, arr) => sum + safeNum(f.days_remaining) / Math.max(1, arr.length), 0);

    document.getElementById('forecast-summary').innerHTML = `
      <div class="forecast-summary-card danger"><span>Urgent</span><b>${urgent.length}</b><small>Needs refill</small></div>
      <div class="forecast-summary-card warn"><span>Watch</span><b>${monitor.length}</b><small>Monitor stock</small></div>
      <div class="forecast-summary-card ok"><span>Healthy</span><b>${healthy.length}</b><small>Covered demand</small></div>
      <div class="forecast-summary-card"><span>Avg Coverage</span><b>${avgCoverage ? safeNum(avgCoverage).toFixed(1) : '-'}</b><small>days remaining</small></div>`;

    const actionRows = priority.slice(0, 6);
    document.getElementById('forecast-cards').innerHTML = `
      <div class="forecast-action-shell">
        <div class="forecast-action-head">
          <div>
            <h3>Restock Attention</h3>
            <p>${basis}${noData.length ? ` · ${noData.length} inactive fuel records hidden` : ''}</p>
          </div>
          <span>${priority.length} item${priority.length === 1 ? '' : 's'}</span>
        </div>
        <div class="forecast-action-list">
          ${actionRows.length ? actionRows.map(f => {
      const daysLabel = f.days_remaining === null || f.days_remaining === undefined
        ? 'No sales pattern'
        : `${safeNum(f.days_remaining).toFixed(1)} days left`;
      return `
            <div class="forecast-action-row ${f.suggestion === 'refill urgent' ? 'urgent' : 'watch'}">
              <div>
                <b>${gfEscape(f.branch_name)}</b>
                <small>${gfEscape(f.fuel_name)} · ${daysLabel}</small>
              </div>
              <div class="forecast-action-metrics">
                <span><small>${gfEscape(stockBasisLabel(f))}</small><b>${fmtL(f.current_stock)}</b></span>
                <span><small>Demand</small><b>${fmtL(f.projected_7day_liters)}</b></span>
              </div>
              <span class="forecast-tag ${tagMap[f.suggestion]||'tag-normal'}">${gfEscape(f.suggestion)}</span>
            </div>`;
          }).join('') : '<div class="forecast-empty">No urgent stock actions right now.</div>'}
        </div>
      </div>`;

    const tableRows = activeRows.length ? activeRows : forecasts;
    document.getElementById('forecast-table').innerHTML = `<table>
      <thead><tr><th>Branch</th><th>Fuel</th><th class="td-right">Current Stock</th><th class="td-right">Projected Demand</th><th class="td-right">Critical</th><th class="td-right">Days Left</th><th>Status</th></tr></thead>
      <tbody>${tableRows.map(f => `<tr>
        <td><b>${gfEscape(f.branch_name)}</b><br><small>${gfEscape(f.branch_location || '')}</small></td>
        <td>${gfEscape(f.fuel_name)}</td>
        <td class="td-right">${fmtL(f.current_stock)}<br><small>${gfEscape(stockBasisLabel(f))}</small></td>
        <td class="td-right">${fmtL(f.projected_7day_liters)}</td>
        <td class="td-right">${fmtL(f.critical_liters)}</td>
        <td class="td-right">${f.days_remaining === null || f.days_remaining === undefined ? '-' : `${safeNum(f.days_remaining).toFixed(1)} days`}</td>
        <td><span class="forecast-tag ${tagMap[f.suggestion]||'tag-normal'}">${gfEscape(f.suggestion)}</span></td>
      </tr>`).join('') || '<tr><td colspan="7" class="td-center">No forecast data yet.</td></tr>'}</tbody>
    </table>`;

    const chartRows = (activeRows.length ? activeRows : forecasts)
      .filter(f => safeNum(f.current_stock) || safeNum(f.projected_7day_liters) || safeNum(f.critical_liters))
      .slice(0, 8);
    const labels = chartRows.map(f => `${f.branch_name} · ${f.fuel_name}`);
    destroyChart('forecast-chart');
    charts['forecast-chart'] = new Chart(document.getElementById('forecast-chart'), {
      type: 'bar',
      data: {
        labels,
        datasets: [
          { label: 'Current Stock', data: chartRows.map(f => Math.round(safeNum(f.current_stock))), backgroundColor: '#16a34a', borderRadius: 5 },
          { label: 'Projected 7-Day Sales', data: chartRows.map(f => Math.round(safeNum(f.projected_7day_liters))), backgroundColor: '#2563eb', borderRadius: 5 },
          { label: 'Critical Stock', data: chartRows.map(f => Math.round(safeNum(f.critical_liters))), backgroundColor: '#d97706', borderRadius: 5 },
        ],
      },
      options: {
        indexAxis: 'y',
        responsive:true,
        maintainAspectRatio:false,
        plugins:{legend:{position:'top',labels:{font:{size:11},padding:12,boxWidth:12}}},
        scales:{
          x:{beginAtZero:true,ticks:{callback:v=>v.toLocaleString()+'L'},grid:{color:'rgba(0,0,0,0.04)'}},
          y:{grid:{display:false},ticks:{font:{size:10}}},
        },
      },
    });
  } catch(e) { showToast(e.message, 'error'); }
}

// ============================================================
// ANALYTICS
// ============================================================
async function initAnalytics() {
  document.getElementById('analytics-stat-grid').innerHTML = loadingHTML;
  try {
    const [summary, forecasts, insights, fuels, daily] = await Promise.all([
      API.summary(), API.forecast(), API.insights(), API.fuelBreakdown(), API.daily({ days:7 }),
    ]);
    const { all_time, today } = summary;
    document.getElementById('analytics-stat-grid').innerHTML = `
      <div class="stat-card highlight"><div class="stat-label">Network Revenue</div><div class="stat-value">${fmt(all_time.total_revenue)}</div></div>
      <div class="stat-card"><div class="stat-label">Total Transactions</div><div class="stat-value green">${parseInt(all_time.tx_count).toLocaleString()}</div></div>
      <div class="stat-card"><div class="stat-label">Avg. Transaction</div><div class="stat-value">${fmt(all_time.avg_tx)}</div></div>
      <div class="stat-card"><div class="stat-label">Today's Revenue</div><div class="stat-value">${fmt(today.revenue)}</div></div>`;

    const alertHTML = forecasts.filter(f => ['refill urgent', 'monitor stock'].includes(f.suggestion)).map(f => `
      <div class="alert alert-${f.suggestion==='refill urgent'?'danger':'warn'}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"/></svg>
        <span><strong>${gfEscape(f.branch_name)} · ${gfEscape(f.fuel_name)}:</strong> ${fmtL(f.current_stock)} stock vs ${fmtL(f.projected_7day_liters)} projected demand — ${f.suggestion==='refill urgent'?'refill immediately.':'monitor stock before it reaches critical level.'}</span>
      </div>`).join('');
    document.getElementById('analytics-alert-list').innerHTML = alertHTML || '<div class="gf-empty-note">No fuel stock alerts from the current forecast.</div>';

    destroyChart('an-fuel');
    charts['an-fuel'] = new Chart(document.getElementById('analytics-fuel-chart'), {
      type: 'bar',
      data: { labels: fuels.map(f=>f.name), datasets: [{ label:'Revenue', data: fuels.map(f=>Math.round(f.revenue)), backgroundColor: fuels.map(f=>f.color), borderRadius:5 }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{ticks:{callback:v=>'₱'+v.toLocaleString()},grid:{color:'rgba(0,0,0,0.04)'}}, x:{grid:{display:false}} } }
    });

    const days = [...new Set(daily.map(d=>d.day))].sort();
    const dayVols = days.map(day => Math.round(daily.filter(d=>d.day===day).reduce((a,d)=>a+parseFloat(d.liters),0)*10)/10);
    destroyChart('an-vol');
    charts['an-vol'] = new Chart(document.getElementById('analytics-volume-chart'), {
      type: 'line',
      data: { labels: days.map(d=>fmtD(d)), datasets: [{ label:'Liters', data: dayVols, borderColor:'#2563eb', backgroundColor:'#2563eb18', fill:true, tension:0.35, pointRadius:3 }] },
      options: { responsive:true, maintainAspectRatio:false, plugins:{legend:{display:false}}, scales:{ y:{ticks:{callback:v=>v+'L'},grid:{color:'rgba(0,0,0,0.04)'}}, x:{grid:{display:false}} } }
    });

    const iconMap = { success:'M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z', warning:'M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z', danger:'M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-6h2v6zm0-8h-2V7h2v2z' };
    const clsMap = { success:'green', warning:'amber', danger:'red' };
    document.getElementById('insights-container').innerHTML = insights.map(ins => `
      <div class="insight-item">
        <div class="insight-icon ${clsMap[ins.type]||'blue'}">
          <svg viewBox="0 0 24 24"><path d="${iconMap[ins.type]||iconMap.success}"/></svg>
        </div>
        <div>
          <div class="insight-label">${ins.label}</div>
          <div class="insight-text">${ins.text}</div>
        </div>
      </div>`).join('');
  } catch(e) { showToast(e.message, 'error'); }
}

// ============================================================
// BRANCHES
// ============================================================
async function initBranches() {
  document.getElementById('branch-cards-grid').innerHTML = loadingHTML;
  try {
    const branches = await API.branches();
    const medalBadge = ['badge-green','badge-blue','badge-amber','badge-gray'];
    document.getElementById('branch-cards-grid').innerHTML = branches.map((b,i) => `
      <div class="branch-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:1rem">
          <div>
            <div style="font-size:16px;font-weight:600">${b.name}</div>
            <div style="font-size:12px;color:var(--muted);margin-top:2px">${b.location}</div>
          </div>
          <span class="badge ${medalBadge[i]||'badge-gray'}">Rank #${i+1}</span>
        </div>
        <div class="branch-stat-grid">
          <div class="branch-mini-stat"><div class="branch-mini-label">Revenue</div><div class="branch-mini-val green">${fmt(b.revenue)}</div></div>
          <div class="branch-mini-stat"><div class="branch-mini-label">Liters</div><div class="branch-mini-val">${fmtL(b.liters)}</div></div>
          <div class="branch-mini-stat"><div class="branch-mini-label">Transactions</div><div class="branch-mini-val">${b.tx_count}</div></div>
          <div class="branch-mini-stat"><div class="branch-mini-label">Avg/Tx</div><div class="branch-mini-val">${fmt(b.revenue/Math.max(1,b.tx_count))}</div></div>
        </div>
      </div>`).join('');
  } catch(e) { showToast(e.message, 'error'); }
}

// ============================================================
// DAILY ENTRY
// ============================================================
const DAILY_TANKS = [
  ['diesel_7kl', 'Diesel 7KL'],
  ['diesel_10kl', 'Diesel 10KL'],
  ['unleaded_7_5kl', 'Unleaded 7.5KL'],
  ['premium_10kl', 'Premium 10KL'],
];
const DAILY_INV_ROWS = [
  ['beginning', 'Beginning'],
  ['ending', 'Ending'],
  ['consumed', 'Consumed'],
  ['delivery', 'Delivery (L)'],
];
const DAILY_DENOMS = [
  [1000, '1000'], [500, '500'], [200, '200'], [100, '100'], [50, '50'],
  [20, '20 (bills)'], [20, '20 (coins)'], [10, '10'], [5, '5'], [1, '1'],
  [0.5, '0.50'], [0.25, '0.25'], [0.2, '0.20'],
];
let dailyEntryCache = [];
let dailyEntryEditing = null;
const DAILY_DRAFT_PREFIX = 'fuelsight_daily_entry_draft_v1';

function dailyMoneyInput(name, value = 0, attrs = '') {
  return `<input class="daily-input money-input" name="${name}" type="number" min="0" step="0.01" value="${value}" ${attrs}/>`;
}

function dailyNumberInput(name, value = 0, attrs = '') {
  return `<input class="daily-input" name="${name}" type="number" min="0" step="0.01" value="${value}" ${attrs}/>`;
}

function dailyProductOptions(selected = '') {
  const fallback = [
    { id: 'diesel', name: 'Diesel' },
    { id: 'unleaded', name: 'Unleaded' },
    { id: 'premium', name: 'Premium' },
    { id: 'e10', name: 'E10' },
  ];
  return (allFuels.length ? allFuels : fallback).map(f =>
    `<option value="${f.id}" ${selected === f.id ? 'selected' : ''}>${f.name}</option>`
  ).join('');
}

function dailyInventoryHeader() {
  return `<thead>
    <tr>
      <th rowspan="2">Tank</th>
      <th colspan="3">CM Reading</th>
      <th colspan="3">Liter Reading</th>
      <th rowspan="2">Delivery</th>
    </tr>
    <tr>
      <th>Beginning</th><th>Ending</th><th>Consumed</th>
      <th>Beginning</th><th>Ending</th><th>Consumed</th>
    </tr>
  </thead>`;
}

function dailyInventoryInputRows() {
  return DAILY_TANKS.map(t => `<tr>
    <td class="td-left"><strong>${t[1]}</strong></td>
    <td>${dailyNumberInput(`inv__${t[0]}__beginning__cm`, 0, 'data-daily-calc="inventory"')}</td>
    <td>${dailyNumberInput(`inv__${t[0]}__ending__cm`, 0, 'data-daily-calc="inventory"')}</td>
    <td>${dailyNumberInput(`inv__${t[0]}__consumed__cm`, 0, 'readonly')}</td>
    <td>${dailyNumberInput(`inv__${t[0]}__beginning__l`, 0, 'data-daily-calc="inventory"')}</td>
    <td>${dailyNumberInput(`inv__${t[0]}__ending__l`, 0, 'data-daily-calc="inventory"')}</td>
    <td>${dailyNumberInput(`inv__${t[0]}__consumed__l`, 0, 'readonly')}</td>
    <td class="daily-inventory-delivery">${dailyNumberInput(`inv__${t[0]}__delivery__l`)}</td>
  </tr>`).join('');
}

function dailyInventoryDisplayRows(payload = {}) {
  return DAILY_TANKS.map(t => `<tr>
    <td class="td-left"><strong>${t[1]}</strong></td>
    <td>${dailyRecordCell(payload[`inv__${t[0]}__beginning__cm`])}</td>
    <td>${dailyRecordCell(payload[`inv__${t[0]}__ending__cm`])}</td>
    <td>${dailyRecordCell(payload[`inv__${t[0]}__consumed__cm`])}</td>
    <td>${dailyRecordCell(payload[`inv__${t[0]}__beginning__l`])}</td>
    <td>${dailyRecordCell(payload[`inv__${t[0]}__ending__l`])}</td>
    <td>${dailyRecordCell(payload[`inv__${t[0]}__consumed__l`])}</td>
    <td>${dailyRecordCell(payload[`inv__${t[0]}__delivery__l`] || payload[`inv__${t[0]}__delivery__cm`])}</td>
  </tr>`).join('');
}

function dailyEntryDraftKey(date = null) {
  const form = document.getElementById('daily-entry-form');
  const entryDate = date || form?.elements?.entry_date?.value || gfToday();
  return `${DAILY_DRAFT_PREFIX}:${currentUser?.id || 'guest'}:${currentUser?.branch_id || 'all'}:${entryDate}`;
}

function getDailyEntryDraftValues(form = document.getElementById('daily-entry-form')) {
  const values = {};
  if (!form) return values;
  [...form.elements].forEach(el => {
    if (!el.name || el.disabled || el.readOnly || ['button', 'submit', 'reset'].includes(el.type)) return;
    values[el.name] = el.value;
  });
  return values;
}

function saveDailyEntryDraft() {
  const form = document.getElementById('daily-entry-form');
  if (!form) return;
  try {
    localStorage.setItem(dailyEntryDraftKey(), JSON.stringify({
      saved_at: new Date().toISOString(),
      values: getDailyEntryDraftValues(form),
    }));
  } catch(e) {}
}

function restoreDailyEntryDraft(date) {
  const form = document.getElementById('daily-entry-form');
  if (!form) return;
  try {
    const raw = localStorage.getItem(dailyEntryDraftKey(date));
    if (!raw) return;
    const draft = JSON.parse(raw);
    Object.entries(draft.values || {}).forEach(([name, value]) => {
      const field = form.elements[name];
      if (!field || field.disabled || field.readOnly) return;
      field.value = value;
    });
  } catch(e) {}
}

function clearDailyEntryDraft(date = null) {
  try { localStorage.removeItem(dailyEntryDraftKey(date)); } catch(e) {}
}

function dailyEntryDisplayId(entry) {
  if (!entry) return 'DE-DRAFT';
  const datePart = String(entry.entry_date || gfToday()).replaceAll('-', '');
  return `DE-${datePart}-${String(entry.id || 0).padStart(4, '0')}`;
}

function fillDailyEntryForm(entry) {
  const form = document.getElementById('daily-entry-form');
  if (!form || !entry) return;
  const values = {
    ...(entry.payload || {}),
    entry_date: entry.entry_date || '',
    shift: entry.shift || '',
    time_in: entry.time_in || '',
    time_out: entry.time_out || '',
    duty_personnel: entry.duty_personnel || '',
    total_cash_expected: entry.total_cash_expected || 0,
    less_expenses: entry.total_expenses || 0,
    actual_cash_remitted: entry.actual_cash_remitted || 0,
    cash_payment: entry.cash_payment || 0,
    over_short: entry.over_short || 0,
  };
  Object.entries(values).forEach(([name, value]) => {
    const field = form.elements[name];
    if (!field) return;
    field.value = value ?? '';
  });
  form.dataset.editingId = entry.id || '';
  form.dataset.expectedCash = safeNum(entry.total_cash_expected).toFixed(2);
  form.dataset.actualCash = safeNum(entry.actual_cash_remitted).toFixed(2);
}

function dailyEntryKeepAfterSubmit(form) {
  const values = {};
  if (!form) return values;
  [...form.elements].forEach(el => {
    if (!el.name || ['button', 'submit', 'reset'].includes(el.type)) return;
    const name = el.name;
    const keep =
      ['entry_date', 'time_in', 'time_out', 'shift', 'duty_personnel'].includes(name) ||
      name.startsWith('inv__') ||
      name.startsWith('digital__') ||
      name.startsWith('mechanical__') ||
      name === 'prepared_by';
    if (keep) values[name] = el.value;
  });
  return values;
}

function applyDailyEntryValues(values = {}) {
  const form = document.getElementById('daily-entry-form');
  if (!form) return;
  Object.entries(values).forEach(([name, value]) => {
    const field = form.elements[name];
    if (!field) return;
    field.value = value ?? '';
  });
  syncDailyEntryTotals();
}

function renderDailyCashRows(cashSummary = {}) {
  const denomRows = (cashSummary.denominations || []).map((d, i) => {
    const qty = safeNum(d.quantity);
    const amount = safeNum(d.amount);
    const qtyText = value => Number.isInteger(value) ? String(value) : value.toFixed(2);
    return `<tr>
      <td>${denomLabel(d.value)}</td>
      <td><input class="daily-input ${qty < 0 ? 'negative' : ''}" name="cash__count__${i}" value="${qtyText(qty)}" readonly></td>
      <td class="td-right mono ${amount < 0 ? 'negative' : ''}">${fmt(amount)}</td>
    </tr>`;
  }).join('');
  return denomRows || '<tr><td colspan="3">No cashier cash denominations recorded for this date.</td></tr>';
}

function renderDailyShiftNotes(cashSummary = {}) {
  const notes = cashSummary.shift_notes || [];
  return notes.map(note => `
    <div class="daily-shift-note-item">
      <div>
        <b>${gfEscape(note.cashier_name || 'Cashier')}</b>
        <small>${fmtDT(note.start_time)}${note.end_time ? ` - ${fmtDT(note.end_time)}` : ''}</small>
      </div>
      <p>${gfEscape(note.cashier_note || '')}</p>
    </div>`).join('') || '<div class="daily-empty-note">No cashier end-shift notes for this date.</div>';
}

function renderDailyCashSummaryStrip(cashSummary = {}) {
  const totals = cashSummary.totals || {};
  const countedCash = safeNum(totals.denomination_cash ?? totals.cash_received);
  return `
    <div><span>POS Transactions</span><b id="daily-cash-pos-count">${safeNum(totals.tx_count)}</b></div>
    <div><span>Transaction Sales</span><b id="daily-cash-tx-total">${fmt(totals.transaction_total)}</b></div>
    <div><span>Cash Counted</span><b id="daily-cash-counted-total">${fmt(countedCash)}</b></div>
    <div><span>Cash Difference</span><b id="daily-cash-over-short" class="${safeNum(totals.over_short) < 0 ? 'negative' : ''}">${fmt(totals.over_short)}</b></div>`;
}

function emptyDailyCashSummary(date = gfToday()) {
  return {
    date,
    denominations: [],
    shift_notes: [],
    totals: {
      tx_count: 0,
      transaction_total: 0,
      total_liters: 0,
      cash_received: 0,
      denomination_cash: 0,
      change_total: 0,
      expected_cash: 0,
      actual_remitted_cash: 0,
      over_short: 0,
    },
  };
}

function applyDailyCashSummary(cashSummary = {}) {
  const form = document.getElementById('daily-entry-form');
  if (!form) return;
  const totals = cashSummary.totals || {};
  const countedCash = safeNum(totals.denomination_cash ?? totals.cash_received);
  const tbody = document.getElementById('daily-auto-cash-body');
  const totalGiven = document.getElementById('daily-auto-cash-total');
  const actualCell = document.getElementById('daily-auto-actual-total');
  const txCount = document.getElementById('daily-auto-tx-count');
  const noteList = document.getElementById('daily-shift-note-list');
  const posCount = document.getElementById('daily-cash-pos-count');
  const txTotal = document.getElementById('daily-cash-tx-total');
  const countedTotal = document.getElementById('daily-cash-counted-total');
  const cashDiff = document.getElementById('daily-cash-over-short');
  delete form.dataset.cashCleared;
  delete form.dataset.reviewReset;
  if (tbody) tbody.innerHTML = renderDailyCashRows(cashSummary);
  if (totalGiven) totalGiven.textContent = fmt(countedCash);
  if (actualCell) actualCell.textContent = fmt(countedCash);
  if (txCount) txCount.textContent = `${safeNum(totals.tx_count)} POS transactions`;
  if (noteList) noteList.innerHTML = renderDailyShiftNotes(cashSummary);
  if (posCount) posCount.textContent = safeNum(totals.tx_count);
  if (txTotal) txTotal.textContent = fmt(totals.transaction_total);
  if (countedTotal) countedTotal.textContent = fmt(countedCash);
  if (cashDiff) {
    cashDiff.textContent = fmt(totals.over_short);
    cashDiff.classList.toggle('negative', safeNum(totals.over_short) < 0);
  }
  form.dataset.actualCash = countedCash.toFixed(2);
  syncDailyEntryTotals();
}

function clearDailyReviewSection(resetTotals = false) {
  const form = document.getElementById('daily-entry-form');
  if (!form) return;
  ['shift_note', 'validated_by', 'audited_by'].forEach(name => {
    const field = form.elements[name];
    if (field) field.value = '';
  });
  const preparedBy = form.elements.prepared_by;
  if (preparedBy) preparedBy.value = currentUser?.name || '';
  if (!resetTotals) return;
  form.dataset.reviewReset = '1';
  ['total_cash_expected', 'less_expenses', 'net_expected_total', 'actual_cash_remitted', 'over_short'].forEach(name => {
    const field = form.elements[name];
    if (field) field.value = '0.00';
  });
  const label = document.getElementById('daily-over-short-label');
  if (label) {
    label.textContent = `Over ${fmt(0)}`;
    label.classList.remove('short');
  }
}

function clearDailyCashExpenseSection() {
  const form = document.getElementById('daily-entry-form');
  if (!form) return;
  form.dataset.cashCleared = '1';
  form.dataset.actualCash = '0.00';
  const tbody = document.getElementById('daily-auto-cash-body');
  const totalGiven = document.getElementById('daily-auto-cash-total');
  const actualCell = document.getElementById('daily-auto-actual-total');
  const txCount = document.getElementById('daily-auto-tx-count');
  const noteList = document.getElementById('daily-shift-note-list');
  const posCount = document.getElementById('daily-cash-pos-count');
  const txTotal = document.getElementById('daily-cash-tx-total');
  const countedTotal = document.getElementById('daily-cash-counted-total');
  const cashDiff = document.getElementById('daily-cash-over-short');
  if (tbody) tbody.innerHTML = '<tr><td colspan="3">Cash count cleared after submission.</td></tr>';
  if (totalGiven) totalGiven.textContent = fmt(0);
  if (actualCell) actualCell.textContent = fmt(0);
  if (txCount) txCount.textContent = 'Cash count cleared';
  if (noteList) noteList.innerHTML = '<div class="daily-empty-note">Cashier notes cleared after submission.</div>';
  if (posCount) posCount.textContent = '0';
  if (txTotal) txTotal.textContent = fmt(0);
  if (countedTotal) countedTotal.textContent = fmt(0);
  if (cashDiff) {
    cashDiff.textContent = fmt(0);
    cashDiff.classList.remove('negative');
  }
  form.querySelectorAll('input[name^="expense__"]').forEach(input => { input.value = ''; });
  const expenseCell = document.getElementById('daily-total-expenses');
  if (expenseCell) expenseCell.textContent = fmt(0);
  clearDailyReviewSection(true);
}

async function refreshDailyCashSummary() {
  const form = document.getElementById('daily-entry-form');
  if (!form) return;
  const date = form.elements.entry_date?.value || gfToday();
  try {
    const summary = await API.dailyCashSummary({ date });
    applyDailyCashSummary(summary);
    saveDailyEntryDraft();
  } catch(e) {
    showToast(e.message || 'Could not refresh POS cash count.', 'error');
  }
}

function handleDailyEntryDateChange(value) {
  saveDailyEntryDraft();
  if (dailyEntryEditing) {
    const mark = document.getElementById('daily-entry-date-mark');
    if (mark) mark.textContent = `Editing ${dailyEntryDisplayId({ ...dailyEntryEditing, entry_date: value })}`;
    return;
  }
  renderDailyEntryManager(value);
}

function cancelDailyEntryEdit() {
  dailyEntryEditing = null;
  clearDailyEntryDraft();
  showToast('Daily entry edit cancelled.', 'warn');
  renderDailyEntryManager(gfToday());
}

function editDailyEntry(index) {
  const entry = dailyEntryCache[index];
  if (!entry) return;
  dailyEntryEditing = entry;
  document.querySelectorAll('.nav-item').forEach(btn => {
    btn.classList.toggle('active', btn.textContent.trim() === 'Daily Entry');
  });
  loadPage('page-daily-entry');
}

function initDailyEntry() {
  const mark = document.getElementById('daily-entry-date-mark');
  if (mark) mark.textContent = new Date().toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  if (currentUser.role === 'owner') renderDailyEntryOwner();
  else renderDailyEntryManager(dailyEntryEditing?.entry_date || undefined);
}

function renderDailyEntryManager() {
  const branch = currentUser.branch_name || 'Branch';
  document.getElementById('daily-entry-sub').textContent = `${branch} daily manager report`;
  const today = new Date().toISOString().slice(0, 10);
  const fuels = allFuels.length ? allFuels : [];
  const pumpProducts = ['unleaded', 'diesel', 'premium', 'diesel'];
  const pumpRows = [1, 2, 3, 4].map((n, i) => ({ n, product: pumpProducts[i], price: fuels.find(f => f.id === pumpProducts[i])?.price || 0 }));

  document.getElementById('daily-entry-workspace').innerHTML = `
    <form id="daily-entry-form" class="daily-entry-form">
      <div class="daily-form-card daily-header-card">
        <div class="daily-brand-block">
          <div class="daily-station-name">GreenFuel ${branch}</div>
          <div class="daily-form-name">Official Daily Sales Record Form</div>
        </div>
        <div class="daily-header-grid">
          <label>Date <input name="entry_date" type="date" value="${today}" required></label>
          <label>Time In <input name="time_in" type="time" value="06:00"></label>
          <label>Time Out <input name="time_out" type="time" value="14:00"></label>
          <label>Shift
            <select name="shift" required>
              <option>Morning</option><option>Afternoon</option><option>Night</option>
            </select>
          </label>
          <label>Duty Personnel <input name="duty_personnel" type="text" value="${currentUser.name || ''}"></label>
        </div>
      </div>

      <div class="daily-form-card">
        <div class="daily-section-title">Inventory Stocks (Dip-Stick)</div>
        <div class="daily-table-wrap">
          <table class="daily-sheet-table daily-inventory-table">
            ${dailyInventoryHeader()}
            <tbody>${dailyInventoryInputRows()}</tbody>
          </table>
        </div>
      </div>

      ${['digital', 'mechanical'].map(type => `
        <div class="daily-form-card">
          <div class="daily-section-title">Pump ${type.charAt(0).toUpperCase() + type.slice(1)} Reading</div>
          <div class="daily-table-wrap">
            <table class="daily-sheet-table daily-pump-table" data-pump-type="${type}">
              <thead><tr><th>Pump</th><th>Product</th><th>Beginning</th><th>Ending</th><th>Consumed (L)</th><th>Pump Price</th><th>Amount</th></tr></thead>
              <tbody>
                ${pumpRows.map(r => `<tr>
                  <td>${r.n}</td>
                  <td><select name="${type}__pump${r.n}__product">${dailyProductOptions(r.product)}</select></td>
                  <td>${dailyNumberInput(`${type}__pump${r.n}__beginning`, 0, 'data-daily-calc="pump"')}</td>
                  <td>${dailyNumberInput(`${type}__pump${r.n}__ending`, 0, 'data-daily-calc="pump"')}</td>
                  <td>${dailyNumberInput(`${type}__pump${r.n}__consumed`, 0, 'readonly')}</td>
                  <td>${dailyMoneyInput(`${type}__pump${r.n}__price`, parseFloat(r.price || 0).toFixed(2), 'data-daily-calc="pump"')}</td>
                  <td>${dailyMoneyInput(`${type}__pump${r.n}__amount`, 0, 'readonly data-daily-amount')}</td>
                </tr>`).join('')}
              </tbody>
              <tfoot><tr><td colspan="6">Total Sales</td><td class="daily-total-cell" id="${type}-expected-sales">₱0.00</td></tr></tfoot>
            </table>
          </div>
        </div>
      `).join('')}

      <div class="daily-two-col">
        <div class="daily-form-card">
          <div class="daily-section-title">Cash Count</div>
          <table class="daily-sheet-table">
            <thead><tr><th>Denomination</th><th>Count</th><th>Amount</th></tr></thead>
            <tbody>
              ${DAILY_DENOMS.map((d, i) => `<tr>
                <td>${d[1]}</td>
                <td>${dailyNumberInput(`cash__count__${i}`, 0, `data-denom="${d[0]}" data-daily-calc="cash"`)}</td>
                <td class="td-right mono" data-cash-amount="cash__count__${i}">₱0.00</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr><td colspan="2">Total Cash Remitted</td><td class="daily-total-cell" id="daily-total-cash-remitted">₱0.00</td></tr></tfoot>
          </table>
        </div>
        <div class="daily-form-card">
          <div class="daily-section-title">Expenses Summary</div>
          <table class="daily-sheet-table">
            <thead><tr><th>Expense Description</th><th>Liters</th><th>Amount</th></tr></thead>
            <tbody>
              ${Array.from({ length: 8 }, (_, i) => `<tr>
                <td><input name="expense__${i}__description" type="text" placeholder="${i === 0 ? 'Calibration expenses' : ''}"></td>
                <td>${dailyNumberInput(`expense__${i}__liters`)}</td>
                <td>${dailyMoneyInput(`expense__${i}__amount`, 0, 'data-daily-calc="expense"')}</td>
              </tr>`).join('')}
            </tbody>
            <tfoot><tr><td colspan="2">Total Expenses</td><td class="daily-total-cell" id="daily-total-expenses">₱0.00</td></tr></tfoot>
          </table>
        </div>
      </div>

      <div class="daily-two-col totals-layout">
        <div class="daily-form-card daily-totals-card">
          <label>Total Cash (Expected) ${dailyMoneyInput('total_cash_expected', 0, 'readonly')}</label>
          <label>Less: Expenses ${dailyMoneyInput('less_expenses', 0, 'readonly')}</label>
          <label>Total ${dailyMoneyInput('net_expected_total', 0, 'readonly')}</label>
          <label>Actual Cash Remitted ${dailyMoneyInput('actual_cash_remitted', 0, 'readonly')}</label>
          <input name="cash_payment" type="hidden" value="0">
          <div class="over-short-pill" id="daily-over-short-label">Over +₱0.00</div>
          <input name="over_short" type="hidden" value="0">
        </div>
        <div class="daily-form-card">
          <div class="daily-section-title">Shift Note / Accident</div>
          <textarea name="shift_note" rows="8" placeholder="Write remarks, incidents, calibration notes, or cash explanations here."></textarea>
          <div class="daily-sign-grid">
            <label>Prepared By <input name="prepared_by" type="text" value="${currentUser.name || ''}"></label>
            <label>DSR & Cash Sales Received / Validated By <input name="validated_by" type="text"></label>
            <label>Audited By <input name="audited_by" type="text"></label>
          </div>
        </div>
      </div>

      <div class="daily-actions">
        <button type="button" class="btn-outline" onclick="window.print()">Print Form</button>
        <button type="button" class="btn-green" onclick="submitDailyEntry()">Submit Daily Report</button>
      </div>
    </form>`;

  document.querySelectorAll('#daily-entry-form [data-daily-calc]').forEach(el => el.addEventListener('input', syncDailyEntryTotals));
  document.querySelectorAll('#daily-entry-form select[name*="__product"]').forEach(el => el.addEventListener('change', syncDailyPumpPrice));
  syncDailyEntryTotals();
}

function syncDailyPumpPrice(e) {
  const select = e.target;
  const row = select.closest('tr');
  const product = allFuels.find(f => f.id === select.value);
  const price = row.querySelector('input[name$="__price"]');
  if (product && price) price.value = parseFloat(product.price).toFixed(2);
  syncDailyEntryTotals();
}

function syncDailyEntryTotals() {
  const form = document.getElementById('daily-entry-form');
  if (!form) return;

  DAILY_TANKS.forEach(tank => {
    ['cm', 'l'].forEach(unit => {
      const beginning = safeNum(form.elements[`inv__${tank[0]}__beginning__${unit}`]?.value);
      const ending = safeNum(form.elements[`inv__${tank[0]}__ending__${unit}`]?.value);
      const consumed = Math.max(0, beginning - ending);
      const consumedField = form.elements[`inv__${tank[0]}__consumed__${unit}`];
      if (consumedField) consumedField.value = consumed.toFixed(2);
    });
  });

  ['digital', 'mechanical'].forEach(type => {
    let expected = 0;
    form.querySelectorAll(`.daily-pump-table[data-pump-type="${type}"] tbody tr`).forEach(row => {
      const beginning = parseFloat(row.querySelector('input[name$="__beginning"]').value) || 0;
      const ending = parseFloat(row.querySelector('input[name$="__ending"]').value) || 0;
      const price = parseFloat(row.querySelector('input[name$="__price"]').value) || 0;
      const consumed = Math.abs(ending - beginning);
      const amount = consumed * price;
      row.querySelector('input[name$="__consumed"]').value = consumed.toFixed(2);
      row.querySelector('input[name$="__amount"]').value = amount.toFixed(2);
      expected += amount;
    });
    document.getElementById(`${type}-expected-sales`).textContent = fmt(expected);
  });

  let cashTotal = 0;
  form.querySelectorAll('[data-denom]').forEach(input => {
    const amount = (parseFloat(input.value) || 0) * (parseFloat(input.dataset.denom) || 0);
    cashTotal += amount;
    const cell = form.querySelector(`[data-cash-amount="${input.name}"]`);
    if (cell) cell.textContent = fmt(amount);
  });

  const expenseTotal = [...form.querySelectorAll('input[name*="__amount"][name^="expense__"]')]
    .reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0);
  const expected = [...form.querySelectorAll('[data-daily-amount]')]
    .reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0);
  const cashPayment = parseFloat(form.elements.cash_payment?.value) || 0;
  const netExpected = expected - expenseTotal;
  const overShort = cashTotal + cashPayment - netExpected;

  document.getElementById('daily-total-cash-remitted').textContent = fmt(cashTotal);
  document.getElementById('daily-total-expenses').textContent = fmt(expenseTotal);
  form.elements.total_cash_expected.value = expected.toFixed(2);
  form.elements.less_expenses.value = expenseTotal.toFixed(2);
  form.elements.net_expected_total.value = netExpected.toFixed(2);
  form.elements.actual_cash_remitted.value = cashTotal.toFixed(2);
  form.elements.over_short.value = overShort.toFixed(2);
  const label = document.getElementById('daily-over-short-label');
  label.textContent = `${overShort >= 0 ? 'Over' : 'Short'} ${fmt(Math.abs(overShort))}`;
  label.classList.toggle('short', overShort < 0);
}

function collectDailyEntryPayload() {
  const form = document.getElementById('daily-entry-form');
  const payload = {};
  [...form.elements].forEach(el => {
    if (!el.name) return;
    payload[el.name] = el.value;
  });
  return payload;
}

async function submitDailyEntry() {
  const form = document.getElementById('daily-entry-form');
  if (!form.reportValidity()) return;
  syncDailyEntryTotals();
  const btn = document.querySelector('.daily-actions .btn-green');
  btn.disabled = true;
  btn.textContent = 'Submitting...';
  try {
    await API.dailyEntrySave({
      entry_date: form.elements.entry_date.value,
      shift: form.elements.shift.value,
      time_in: form.elements.time_in.value,
      time_out: form.elements.time_out.value,
      duty_personnel: form.elements.duty_personnel.value,
      total_cash_expected: form.elements.total_cash_expected.value,
      total_expenses: form.elements.less_expenses.value,
      actual_cash_remitted: form.elements.actual_cash_remitted.value,
      cash_payment: form.elements.cash_payment.value,
      over_short: form.elements.over_short.value,
      payload: collectDailyEntryPayload(),
    });
    showToast('Daily entry submitted to owner/admin');
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Submit Daily Report';
  }
}

async function renderDailyEntryOwner() {
  document.getElementById('daily-entry-sub').textContent = 'Submitted manager daily reports across branches';
  const wrap = document.getElementById('daily-entry-workspace');
  wrap.innerHTML = `<div class="daily-form-card">${loadingHTML}</div>`;
  try {
    const entries = await API.dailyEntries();
    dailyEntryCache = entries;
    if (!entries.length) {
      wrap.innerHTML = '<div class="daily-form-card"><p class="loading">No daily entries submitted yet</p></div>';
      return;
    }
    wrap.innerHTML = `
      <div class="daily-form-card">
        <div class="daily-section-title">Daily Entry Submissions</div>
        <div class="tbl-wrap">
          <table>
            <thead><tr><th>Date</th><th>Branch</th><th>Shift</th><th>Duty</th><th class="td-right">Expected</th><th class="td-right">Expenses</th><th class="td-right">Over/Short</th><th>Submitted By</th><th class="td-right">Action</th></tr></thead>
            <tbody>${entries.map(e => `<tr>
              <td>${fmtD(e.entry_date)}</td>
              <td><div style="font-weight:600">${e.branch_name}</div><div style="font-size:11px;color:var(--muted)">${e.branch_location || ''}</div></td>
              <td>${e.shift}</td>
              <td>${e.duty_personnel || '-'}</td>
              <td class="td-right">${fmt(e.total_cash_expected)}</td>
              <td class="td-right">${fmt(e.total_expenses)}</td>
              <td class="td-right" style="font-weight:600;color:${parseFloat(e.over_short) < 0 ? '#b91c1c' : 'var(--green)'}">${parseFloat(e.over_short) < 0 ? '-' : '+'}${fmt(Math.abs(e.over_short))}</td>
              <td>${e.submitted_by_name || '-'}</td>
              <td class="td-right"><button class="btn-outline btn-sm" onclick="showDailyEntryDetail(${entries.indexOf(e)})">View</button></td>
            </tr>`).join('')}</tbody>
          </table>
        </div>
      </div>
      <div id="daily-entry-detail"></div>`;
    showDailyEntryDetail(0);
  } catch(e) {
    wrap.innerHTML = `<div class="daily-form-card"><p class="loading">${e.message}</p></div>`;
  }
}

function showDailyEntryDetail(index) {
  const entry = dailyEntryCache[index];
  const target = document.getElementById('daily-entry-detail');
  if (!entry || !target) return;
  const p = entry.payload || {};
  const expectedRows = ['digital', 'mechanical'].map(type => {
    const total = [1, 2, 3, 4].reduce((sum, n) => sum + (parseFloat(p[`${type}__pump${n}__amount`]) || 0), 0);
    return `<tr><td>${type.charAt(0).toUpperCase() + type.slice(1)} pump reading</td><td class="td-right">${fmt(total)}</td></tr>`;
  }).join('');
  const signatureRows = ['prepared_by', 'validated_by', 'audited_by'].map(k =>
    `<tr><td>${k.replaceAll('_', ' ')}</td><td>${p[k] || '-'}</td></tr>`
  ).join('');
  target.innerHTML = `
    <div class="daily-form-card daily-review-card">
      <div style="display:flex;justify-content:space-between;gap:1rem;align-items:flex-start;margin-bottom:1rem">
        <div>
          <div class="daily-section-title" style="margin-bottom:4px">Submitted Daily Document</div>
          <div style="font-size:13px;color:var(--muted)">${entry.branch_name} · ${entry.shift} · ${fmtD(entry.entry_date)}</div>
        </div>
        <button class="btn-outline btn-sm" onclick="window.print()">Print</button>
      </div>
      <div class="daily-two-col">
        <table class="daily-sheet-table">
          <tbody>
            <tr><td>Date</td><td>${entry.entry_date}</td></tr>
            <tr><td>Time In</td><td>${entry.time_in || '-'}</td></tr>
            <tr><td>Time Out</td><td>${entry.time_out || '-'}</td></tr>
            <tr><td>Duty Personnel</td><td>${entry.duty_personnel || '-'}</td></tr>
            ${signatureRows}
          </tbody>
        </table>
        <table class="daily-sheet-table">
          <tbody>
            ${expectedRows}
            <tr><td>Total Cash Expected</td><td class="td-right">${fmt(entry.total_cash_expected)}</td></tr>
            <tr><td>Total Expenses</td><td class="td-right">${fmt(entry.total_expenses)}</td></tr>
            <tr><td>Actual Cash Remitted</td><td class="td-right">${fmt(entry.actual_cash_remitted)}</td></tr>
            <tr><td>Over / Short</td><td class="td-right" style="font-weight:800;color:${parseFloat(entry.over_short) < 0 ? '#991b1b' : 'var(--green)'}">${fmt(entry.over_short)}</td></tr>
          </tbody>
        </table>
      </div>
      <div style="margin-top:1rem">
        <div class="daily-section-title">Shift Note / Accident</div>
        <div class="daily-note-box">${p.shift_note || 'No note provided.'}</div>
      </div>
      <div id="gf-global-modal-root"></div>
    </div>`;
}

// ============================================================
// TABS
// ============================================================
function switchTab(btn, paneId) {
  const container = btn.closest('.tab-bar');
  const parent = container.parentElement;
  container.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  parent.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(paneId).classList.add('active');
  if (paneId === 'branch-weekly-report') refreshBranchWeeklyReports(gfSelectedBranch, true);
}

// ============================================================
// GREENFUEL 2.0 SCREEN OVERRIDES
// Richer owner/manager/cashier screens matching the supplied references.
// ============================================================
let gfBranchCache = [];
let gfSelectedBranch = null;
let gfSelectedBranchData = null;
let gfBranchWeeklyReports = [];
let gfBranchWeeklyRefreshTimer = null;
let gfActiveShift = null;
let gfDenoms = [];
let gfPosTaxRate = 12;
let gfRecordTxCache = [];
let gfWeeklyRange = null;
let gfUserCache = [];
let gfUserBranches = [];
let gfPriceRequests = [];
let gfComparisonMonth = '';
let gfComparisonWeek = 0;

const gfEscape = value => String(value ?? '').replace(/[&<>"']/g, ch => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
}[ch]));
const gfPct = n => (safeNum(n) >= 0 ? '+' : '') + safeNum(n).toFixed(1) + '%';
const gfToday = () => gfDateValue(new Date());
const gfDateLong = () => new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
const gfDateValue = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const gfDateFromValue = value => {
  const [year, month, day] = String(value || '').split('-').map(Number);
  return year && month && day ? new Date(year, month - 1, day) : new Date();
};
const gfAddDays = (value, days) => {
  const d = gfDateFromValue(value);
  d.setDate(d.getDate() + days);
  return gfDateValue(d);
};
const gfCurrentWeekRange = () => {
  const now = new Date();
  const dayOffset = (now.getDay() + 6) % 7;
  now.setDate(now.getDate() - dayOffset);
  const start = gfDateValue(now);
  return { start, end: gfAddDays(start, 6) };
};
const gfMonthValue = () => gfDateValue(new Date()).slice(0, 7);
const gfMonthLabel = month => {
  const [year, monthNo] = String(month || gfMonthValue()).split('-').map(Number);
  return new Date(year || new Date().getFullYear(), (monthNo || 1) - 1, 1)
    .toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
};
const gfShortDateRange = range => range ? `${fmtD(range.start)} - ${fmtD(range.end)}` : '';
const gfFuelName = f => {
  const map = { diesel: 'Diesel 7KL', unleaded: 'Unleaded 7.5KL', premium: 'Premium 10KL', e10: 'Diesel 10KL' };
  return map[f.id] || f.name;
};
const gfTaxLabel = rate => `${safeNum(rate).toFixed(2).replace(/\.00$/, '')}%`;
const gfCard = (title, value, sub = '', cls = '') => `
  <div class="gf-stat ${cls}">
    <div class="gf-stat-label">${title}</div>
    <div class="gf-stat-value">${value}</div>
    ${sub ? `<div class="gf-stat-sub">${sub}</div>` : ''}
  </div>`;
const managerPresenceLabel = status => ({
  active: 'Active',
  away: 'Away',
  offline: 'Offline',
  unassigned: 'No manager',
}[status] || 'Offline');
function renderManagerPresence(branch = {}, compact = false) {
  const managers = Array.isArray(branch.managers) ? branch.managers : [];
  if (!managers.length) {
    return `<div class="manager-presence ${compact ? 'compact' : ''}"><span class="manager-chip unassigned"><i></i>No manager assigned</span></div>`;
  }
  return `<div class="manager-presence ${compact ? 'compact' : ''}">
    ${managers.map(m => {
      const status = m.presence_status || 'offline';
      const seen = m.last_seen_at ? `Last seen ${fmtDT(m.last_seen_at)}` : 'Not seen yet';
      return `<span class="manager-chip ${status}" title="${gfEscape(seen)}"><i></i>${gfEscape(m.name || m.email || 'Manager')} · ${managerPresenceLabel(status)}</span>`;
    }).join('')}
  </div>`;
}

function gfPageShell(pageId, title, sub, body, actions = '') {
  document.getElementById(pageId).innerHTML = `
    <div class="gf-page-head">
      <div>
        <h1>${title}</h1>
        <p>${sub}</p>
      </div>
      ${actions}
    </div>
    ${body}`;
}

function loadComparisonMonth() {
  gfComparisonMonth = document.getElementById('cmp-month')?.value || gfMonthValue();
  gfComparisonWeek = 0;
  initComparison();
}

function loadComparisonWeek(week) {
  gfComparisonWeek = Math.max(1, parseInt(week, 10) || 1);
  initComparison();
}

function comparisonGrowth(row) {
  const pct = safeNum(row.growth_pct);
  const positive = pct >= 0;
  return `<span class="${positive ? 'trend-up' : 'trend-down'}">${positive ? '↗' : '↘'} ${Math.abs(pct).toFixed(1)}%</span>`;
}

function priceRequestBadge(status) {
  return {
    pending: 'badge-amber',
    approved: 'badge-green',
    rejected: 'badge-red',
  }[String(status || '').toLowerCase()] || 'badge-gray';
}

function priceSourceLabel(fuel) {
  return fuel.branch_price !== null && fuel.branch_price !== undefined
    ? '<span class="badge badge-blue">Branch Approved</span>'
    : '<span class="badge badge-green">Owner Ceiling</span>';
}

function priceRequestCeiling(request) {
  return safeNum(request?.current_ceiling_price ?? request?.base_price);
}

function ownerBranchTrendRows(dailyRows = [], entryRows = [], txRows = []) {
  const byDate = new Map();
  const ensure = date => {
    const key = String(date || '').slice(0, 10);
    if (!key) return null;
    if (!byDate.has(key)) {
      byDate.set(key, { date: key, dailySales: 0, entrySales: 0, txSales: 0, liters: 0, txCount: 0, entryCount: 0 });
    }
    return byDate.get(key);
  };

  dailyRows.forEach(row => {
    const bucket = ensure(row.day || row.entry_date);
    if (!bucket) return;
    bucket.dailySales += safeNum(row.revenue || row.total_cash_expected);
    bucket.liters += safeNum(row.liters);
    bucket.txCount += safeNum(row.tx_count);
  });

  entryRows.forEach(row => {
    const bucket = ensure(row.entry_date);
    if (!bucket) return;
    bucket.entrySales += safeNum(row.total_cash_expected);
    bucket.entryCount += 1;
  });

  txRows.forEach(row => {
    if (String(row.status || '').toLowerCase() === 'void') return;
    const bucket = ensure(row.timestamp || row.created_at);
    if (!bucket) return;
    bucket.txSales += safeNum(row.total_amount);
    bucket.liters += safeNum(row.liters);
    bucket.txCount += 1;
  });

  const buildWindow = endDate => {
    const start = gfAddDays(endDate, -6);
    return Array.from({ length: 7 }, (_, i) => {
    const date = gfAddDays(start, i);
    const bucket = byDate.get(date) || { date, dailySales: 0, entrySales: 0, txSales: 0, liters: 0, txCount: 0, entryCount: 0 };
    const value = bucket.entrySales > 0 ? bucket.entrySales : (bucket.txSales > 0 ? bucket.txSales : bucket.dailySales);
    const source = bucket.entrySales > 0 ? 'Daily Entries' : (bucket.txSales > 0 || bucket.dailySales > 0 ? 'POS Transactions' : 'No Data');
    return { ...bucket, date, value, source };
  });
  };

  const recentRows = buildWindow(gfToday());
  if (recentRows.some(row => safeNum(row.value) > 0) || !byDate.size) {
    recentRows.mode = 'recent';
    return recentRows;
  }

  const latest = [...byDate.keys()].sort().pop();
  const fallbackRows = buildWindow(latest);
  fallbackRows.mode = 'fallback';
  return fallbackRows;
}

async function updateFuelPrice(id) {
  const input = document.getElementById(`price-${id}`);
  const price = safeNum(input?.value);
  if (price <= 0) { showToast('Enter a valid price.', 'error'); return; }
  const btn = document.getElementById(`save-ceiling-${id}`);
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Saving...';
    }
    await API.fuelUpdatePrice(id, price);
    allFuels = await API.fuels();
    showToast('Owner ceiling price updated.');
    if (document.getElementById('fuel-prices-workspace')) initFuelPrices();
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    if (btn && document.body.contains(btn)) {
      btn.disabled = false;
      btn.textContent = 'Save Ceiling';
    }
  }
}

async function requestFuelPriceChange(id) {
  const price = safeNum(document.getElementById(`request-price-${id}`)?.value);
  const reason = document.getElementById(`request-reason-${id}`)?.value.trim() || '';
  if (price <= 0) { showToast('Enter a valid requested price.', 'error'); return; }
  try {
    await API.fuelRequestPrice({ fuel_type: id, requested_price: price, reason });
    showToast('Price change request sent to the manager.');
    await initFuelPrices();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function submitFuelPriceRequests() {
  const note = (document.getElementById('price-request-note')?.value || '').trim();
  const changes = allFuels.map(f => {
    const requestedPrice = safeNum(document.getElementById(`request-price-${f.id}`)?.value);
    const currentPrice = safeNum(f.price);
    const ceiling = safeNum(f.base_price ?? f.price);
    return {
      fuel_type: f.id,
      fuel_name: gfFuelName(f),
      requested_price: requestedPrice,
      ceiling,
      reason: note,
      changed: requestedPrice > 0 && Math.abs(requestedPrice - currentPrice) >= 0.01,
    };
  }).filter(item => item.changed);
  if (!changes.length) {
    showToast('Change at least one fuel price before submitting.', 'error');
    return;
  }
  const aboveCeiling = changes.find(item => item.requested_price > item.ceiling);
  if (aboveCeiling) {
    showToast(`${aboveCeiling.fuel_name} request cannot exceed owner ceiling ${fmt(aboveCeiling.ceiling)}.`, 'error');
    document.getElementById(`request-price-${aboveCeiling.fuel_type}`)?.focus();
    return;
  }
  const btn = document.getElementById('submit-price-requests-btn');
  try {
    if (btn) {
      btn.disabled = true;
      btn.textContent = 'Submitting...';
    }
    await Promise.all(changes.map(item => API.fuelRequestPrice({
      fuel_type: item.fuel_type,
      requested_price: item.requested_price,
      reason: item.reason,
    })));
    showToast(`${changes.length} price request${changes.length === 1 ? '' : 's'} sent to the manager.`);
    await initFuelPrices();
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    if (btn && document.body.contains(btn)) {
      btn.disabled = false;
      btn.textContent = 'Submit Price Requests';
    }
  }
}

async function reviewFuelPriceRequest(id, status) {
  const noteField = document.getElementById('price-review-note');
  const note = (noteField?.value || '').trim();
  if (!note) {
    showToast('Add a manager note before approving or rejecting.', 'error');
    noteField?.focus();
    return;
  }
  try {
    await API.fuelReviewPrice(id, status, note || '');
    showToast(status === 'approved' ? 'Branch price approved.' : 'Price request rejected.');
    closeGfModal();
    await initFuelPrices();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

function priceRequestById(id) {
  return gfPriceRequests.find(r => String(r.id) === String(id));
}

function openPriceRequestDetail(id) {
  const request = priceRequestById(id);
  const root = document.getElementById('gf-modal-root') || document.getElementById('gf-global-modal-root');
  if (!request || !root) return;
  const currentPrice = request.current_branch_price !== null && request.current_branch_price !== undefined
    ? safeNum(request.current_branch_price)
    : safeNum(request.base_price);
  const ceilingPrice = priceRequestCeiling(request);
  const difference = safeNum(request.requested_price) - currentPrice;
  root.innerHTML = `
    <div class="gf-modal-backdrop">
      <div class="gf-modal price-request-modal">
        <button class="gf-modal-x" onclick="closeGfModal()">×</button>
        <h2>Fuel Price Request</h2>
        <p>${gfEscape(request.branch_name || currentUser.branch_name || 'Branch')} · ${gfEscape(request.fuel_name || request.fuel_type || 'Fuel')}</p>
        <div class="price-request-detail-grid">
          <div><span>Owner Ceiling</span><b>${fmt(ceilingPrice)}</b></div>
          <div><span>Current POS Price</span><b>${fmt(currentPrice)}</b></div>
          <div><span>Requested Price</span><b>${fmt(request.requested_price)}</b></div>
          <div><span>Change</span><b class="${difference < 0 ? 'negative' : ''}">${difference >= 0 ? '+' : '-'}${fmt(Math.abs(difference))}</b></div>
        </div>
        <div class="gf-soft-box price-request-reason">
          <h3>Cashier Reason</h3>
          <p>${gfEscape(request.reason || 'No reason provided.')}</p>
          <small>Requested by ${gfEscape(request.requested_by_name || '-')} on ${fmtDT(request.requested_at)}</small>
        </div>
        <label class="price-review-note">
          Manager Note <span>required for approval or rejection</span>
          <textarea id="price-review-note" rows="4" placeholder="Explain why this request is approved or rejected."></textarea>
        </label>
        <div class="gf-modal-actions">
          <button class="btn-outline" onclick="closeGfModal()">Cancel</button>
          <button class="btn-outline" onclick="reviewFuelPriceRequest(${Number(request.id)}, 'rejected')">Reject Request</button>
          <button class="btn-green" onclick="reviewFuelPriceRequest(${Number(request.id)}, 'approved')">Approve Request</button>
        </div>
      </div>
    </div>`;
  setTimeout(() => document.getElementById('price-review-note')?.focus(), 0);
}

function renderManagerPriceRequestCards(requests) {
  return requests.map(r => {
    const currentPrice = r.current_branch_price !== null && r.current_branch_price !== undefined
      ? safeNum(r.current_branch_price)
      : safeNum(r.base_price);
    const ceilingPrice = priceRequestCeiling(r);
    const difference = safeNum(r.requested_price) - currentPrice;
    return `
      <article class="price-request-card">
        <div class="price-request-card-head">
          <div>
            <span>${gfEscape(r.fuel_name || r.fuel_type)}</span>
            <h3>${fmt(r.requested_price)}</h3>
          </div>
          <span class="badge badge-amber">Pending</span>
        </div>
        <div class="price-request-metrics">
          <div><small>Owner Ceiling</small><b>${fmt(ceilingPrice)}</b></div>
          <div><small>Current POS</small><b>${fmt(currentPrice)}</b></div>
          <div><small>Difference</small><b class="${difference < 0 ? 'negative' : ''}">${difference >= 0 ? '+' : '-'}${fmt(Math.abs(difference))}</b></div>
        </div>
        <p>${gfEscape(r.reason || 'No reason provided.')}</p>
        <div class="price-request-footer">
          <small>${gfEscape(r.requested_by_name || '-')} · ${fmtDT(r.requested_at)}</small>
          <button class="btn-green btn-sm" type="button" onclick="openPriceRequestDetail(${Number(r.id)})">View Request</button>
        </div>
      </article>`;
  }).join('') || '<div class="price-empty">No pending cashier requests</div>';
}

function userRoleBadge(role) {
  return { owner: 'badge-blue', manager: 'badge-green', cashier: 'badge-amber' }[role] || 'badge-gray';
}

function userRoleBranchOptions(selected = '') {
  const selectedId = String(selected || '');
  return `<option value="">Select branch</option>${gfUserBranches.map(b =>
    `<option value="${gfEscape(b.id)}" ${selectedId === String(b.id) ? 'selected' : ''}>${gfEscape(b.name)} - ${gfEscape(b.location)}</option>`
  ).join('')}`;
}

function managerBranchRow(selected = '') {
  return `<div class="manager-branch-row">
    <select class="manager-branch-select">${userRoleBranchOptions(selected)}</select>
    <button type="button" class="btn-outline btn-sm" onclick="removeManagerBranchSelect(this)">Remove</button>
  </div>`;
}

function addManagerBranchSelect(selected = '') {
  const list = document.getElementById('user-role-manager-branches');
  if (!list) return;
  list.insertAdjacentHTML('beforeend', managerBranchRow(selected));
  const rows = list.querySelectorAll('.manager-branch-row');
  rows[rows.length - 1]?.querySelector('select')?.focus();
}

function removeManagerBranchSelect(btn) {
  const list = document.getElementById('user-role-manager-branches');
  const row = btn?.closest('.manager-branch-row');
  if (!list || !row) return;
  if (list.querySelectorAll('.manager-branch-row').length <= 1) {
    row.querySelector('select').value = '';
    return;
  }
  row.remove();
}

function getManagerBranchSelections() {
  const values = [...document.querySelectorAll('.manager-branch-select')]
    .map(select => select.value)
    .filter(Boolean);
  return [...new Set(values)];
}

function setManagerBranches(branchIds = []) {
  const list = document.getElementById('user-role-manager-branches');
  if (!list) return;
  const ids = Array.isArray(branchIds) && branchIds.length ? branchIds : [''];
  list.innerHTML = ids.map(id => managerBranchRow(id)).join('');
}

function isManagerUserRoleMode() {
  return currentUser?.role === 'manager';
}

function userRoleBranchSummary(user) {
  if (user.role === 'owner') return 'All branches';
  if (user.role === 'manager') {
    const labels = Array.isArray(user.branch_labels) ? user.branch_labels.filter(Boolean) : [];
    if (labels.length) {
      return `${labels.map(gfEscape).join('<br>')}<br><small>${labels.length} assigned branch${labels.length === 1 ? '' : 'es'}</small>`;
    }
  }
  return `${gfEscape(user.branch_name || 'Unassigned')}${user.branch_location ? `<br><small>${gfEscape(user.branch_location)}</small>` : ''}`;
}

function toggleUserRoleBranch() {
  const managerMode = isManagerUserRoleMode();
  const roleSelect = document.getElementById('user-role-role');
  if (managerMode && roleSelect) roleSelect.value = 'cashier';
  const role = managerMode ? 'cashier' : (roleSelect?.value || 'cashier');
  const branch = document.getElementById('user-role-branch');
  const branchWrap = document.getElementById('user-role-branch-wrap');
  const positionWrap = document.getElementById('user-role-position-wrap');
  const managerWrap = document.getElementById('user-role-manager-wrap');
  const passwordWrap = document.getElementById('user-role-password-wrap');
  const password = document.getElementById('user-role-password');
  const lockedNote = document.getElementById('user-role-password-note');
  const help = document.getElementById('user-role-help');
  const isOwner = role === 'owner';
  const isManager = role === 'manager';
  const isCashier = role === 'cashier';
  if (branch) {
    branch.disabled = !isCashier;
    if (!isCashier) branch.value = '';
  }
  if (branchWrap) branchWrap.style.display = isCashier ? 'block' : 'none';
  if (positionWrap) positionWrap.style.display = managerMode ? 'none' : 'block';
  if (managerWrap) managerWrap.style.display = (!managerMode && isManager) ? 'block' : 'none';
  if (!managerMode && isManager && !document.querySelector('.manager-branch-select')) setManagerBranches(['']);
  if (password) {
    password.disabled = !managerMode && isOwner;
    if (isOwner) password.value = '';
  }
  if (passwordWrap) passwordWrap.classList.toggle('muted-field', !managerMode && isOwner);
  if (lockedNote) lockedNote.style.display = (!managerMode && isOwner) ? 'block' : 'none';
  if (help) help.textContent = managerMode
    ? 'Managers can create and update cashier accounts only for their assigned branch access.'
    : isOwner
    ? 'Owner accounts can access all branches. Owner passwords are hidden and managed outside this portal.'
    : isManager
      ? 'Managers can hold multiple branches. The first selected branch becomes their default branch.'
      : 'Cashiers can only sign in to the one branch assigned here.';
}

async function initUserRoles() {
  const page = 'page-user-roles';
  const managerMode = isManagerUserRoleMode();
  gfPageShell(page, managerMode ? 'Cashier Accounts' : 'User Role Assignment', managerMode ? 'Create and manage cashier logins for your assigned branch.' : 'Assign staff portal access, branch, and position.', `<div class="gf-card">${loadingHTML}</div>`);
  try {
    const [users, branches] = await Promise.all([API.users(), API.branches()]);
    gfUserCache = users;
    if (managerMode) {
      const assigned = currentUser.assigned_branches?.length ? currentUser.assigned_branches : [currentUser.branch_id].filter(Boolean);
      gfUserBranches = branches.filter(branch => assigned.includes(branch.id));
    } else {
      gfUserBranches = branches;
    }
    renderUserRoles();
  } catch(e) {
    gfPageShell(page, managerMode ? 'Cashier Accounts' : 'User Role Assignment', managerMode ? 'Create and manage cashier logins for your assigned branch.' : 'Assign staff portal access, branch, and position.', `<div class="gf-card"><p class="loading">${gfEscape(e.message)}</p></div>`);
  }
}

function renderUserRoles() {
  const managerMode = isManagerUserRoleMode();
  const counts = {
    owner: gfUserCache.filter(u => u.role === 'owner').length,
    manager: gfUserCache.filter(u => u.role === 'manager').length,
    cashier: gfUserCache.filter(u => u.role === 'cashier').length,
  };
  const statsHtml = managerMode
    ? `<div class="gf-stat-grid three user-role-stats">
         ${gfCard('Cashier Accounts', counts.cashier)}
         ${gfCard('Assigned Branches', gfUserBranches.length)}
         ${gfCard('Access Scope', 'Cashiers only')}
       </div>`
    : `<div class="gf-stat-grid three user-role-stats">
       ${gfCard('Owners', counts.owner)}
       ${gfCard('Managers', counts.manager)}
       ${gfCard('Cashiers', counts.cashier)}
     </div>`;
  gfPageShell('page-user-roles', managerMode ? 'Cashier Accounts' : 'User Role Assignment', managerMode ? 'Create and manage cashier logins for your assigned branch.' : 'Assign staff portal access, branch, and position.',
    `${statsHtml}
     <div class="gf-user-role-grid">
       <div class="gf-card user-role-form-card">
         <div class="gf-card-head"><div><h3>${managerMode ? 'Cashier Account' : 'Assign User'}</h3><p>${managerMode ? 'Create cashier access for your branch POS terminal.' : 'Create staff accounts or update their role and branch.'}</p></div></div>
         <form id="user-role-form" onsubmit="submitUserRole(event)">
           <input type="hidden" id="user-role-id">
           <label>Full Name<input id="user-role-name" required placeholder="e.g. Ana Reyes"></label>
           <label>Email<input id="user-role-email" type="email" required placeholder="e.g. cashier.branch@greenfuel.local"></label>
           <label id="user-role-password-wrap">Password<input id="user-role-password" type="password" placeholder="${managerMode ? 'Required for new cashier users' : 'Required for new manager/cashier users'}"></label>
           <p id="user-role-password-note" class="password-locked-note">Owner passwords are not shown or changed in this portal.</p>
           <div class="user-role-two">
             <label id="user-role-position-wrap">Position
               <select id="user-role-role" required onchange="toggleUserRoleBranch()">
                 ${managerMode ? '<option value="cashier">Cashier</option>' : `
                 <option value="manager">Manager</option>
                 <option value="cashier">Cashier</option>
                 <option value="owner">Owner</option>
                 `}
               </select>
             </label>
             <label id="user-role-branch-wrap">Cashier Branch
               <select id="user-role-branch">${userRoleBranchOptions()}</select>
             </label>
           </div>
           <div id="user-role-manager-wrap" class="manager-branch-wrap">
             <div class="manager-branch-head">
               <span>Manager Branches</span>
               <button type="button" class="btn-outline btn-sm" onclick="addManagerBranchSelect()">+ Add Branch</button>
             </div>
             <div id="user-role-manager-branches" class="manager-branch-list"></div>
           </div>
           <p id="user-role-help" class="user-role-help">Managers can hold multiple branches. The first selected branch becomes their default branch.</p>
           <div class="user-role-actions">
             <button type="button" class="btn-outline" onclick="resetUserRoleForm()">${managerMode ? 'New Cashier' : 'New User'}</button>
             <button type="submit" class="btn-green">Save Assignment</button>
           </div>
         </form>
       </div>
       <div class="gf-card">
         <div class="gf-card-head"><div><h3>${managerMode ? 'Branch Cashiers' : 'Assigned Staff'}</h3><p>${managerMode ? 'Cashier accounts under your assigned branch access.' : 'Owner-controlled portal access list.'}</p></div></div>
         <div class="tbl-wrap">
           <table>
             <thead><tr><th>Name</th><th>Email</th><th>Position</th><th>Branch Access</th><th class="td-right">Action</th></tr></thead>
             <tbody>${gfUserCache.map(u => `
               <tr>
                 <td><b>${gfEscape(u.name)}</b></td>
                 <td class="mono">${gfEscape(u.email || u.username)}</td>
                 <td><span class="badge ${userRoleBadge(u.role)}">${String(u.role).toUpperCase()}</span></td>
                 <td>${userRoleBranchSummary(u)}</td>
                 <td class="td-right"><button class="btn-outline btn-sm" onclick="editUserRole(${u.id})">Edit</button></td>
               </tr>`).join('') || '<tr><td colspan="5" class="td-center">No users found</td></tr>'}
             </tbody>
           </table>
         </div>
       </div>
     </div>`);
  resetUserRoleForm();
}

function resetUserRoleForm() {
  const form = document.getElementById('user-role-form');
  if (!form) return;
  const managerMode = isManagerUserRoleMode();
  form.reset();
  document.getElementById('user-role-id').value = '';
  document.getElementById('user-role-role').value = managerMode ? 'cashier' : 'manager';
  document.getElementById('user-role-branch').value = managerMode && gfUserBranches.length === 1 ? gfUserBranches[0].id : '';
  document.getElementById('user-role-password').disabled = false;
  document.getElementById('user-role-password').placeholder = managerMode ? 'Required for new cashier users' : 'Required for new manager/cashier users';
  if (!managerMode) setManagerBranches(['']);
  toggleUserRoleBranch();
}

function editUserRole(id) {
  const user = gfUserCache.find(u => Number(u.id) === Number(id));
  if (!user) return;
  const managerMode = isManagerUserRoleMode();
  document.getElementById('user-role-id').value = user.id;
  document.getElementById('user-role-name').value = user.name || '';
  document.getElementById('user-role-email').value = user.email || user.username || '';
  document.getElementById('user-role-password').value = '';
  document.getElementById('user-role-role').value = managerMode ? 'cashier' : (user.role || 'cashier');
  document.getElementById('user-role-password').placeholder = user.role === 'owner'
    ? 'Owner password cannot be changed here'
    : 'Leave blank to keep current password';
  document.getElementById('user-role-branch').innerHTML = userRoleBranchOptions(user.branch_id || '');
  if (!managerMode) setManagerBranches(user.role === 'manager' ? (user.branch_ids || []) : ['']);
  toggleUserRoleBranch();
  document.getElementById('user-role-form').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function submitUserRole(event) {
  event.preventDefault();
  const btn = event.submitter;
  const id = document.getElementById('user-role-id').value;
  const managerMode = isManagerUserRoleMode();
  const role = managerMode ? 'cashier' : document.getElementById('user-role-role').value;
  const managerBranches = role === 'manager' ? getManagerBranchSelections() : [];
  const cashierBranch = document.getElementById('user-role-branch').value;
  const data = {
    id: id || undefined,
    name: document.getElementById('user-role-name').value.trim(),
    email: document.getElementById('user-role-email').value.trim(),
    password: role === 'owner' ? '' : document.getElementById('user-role-password').value,
    role,
    branch_id: role === 'manager' ? (managerBranches[0] || '') : role === 'cashier' ? cashierBranch : '',
    branch_ids: role === 'manager' ? managerBranches : role === 'cashier' ? [cashierBranch] : [],
  };
  if (role === 'manager' && !managerBranches.length) {
    showToast('Assign at least one branch to this manager.', 'error');
    return;
  }
  if (role === 'cashier' && !cashierBranch) {
    showToast('Choose a branch for this cashier.', 'error');
    return;
  }
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
    await API.userSave(data);
    showToast(id ? (managerMode ? 'Cashier account updated.' : 'User assignment updated.') : (managerMode ? 'Cashier account created.' : 'User assignment created.'));
    gfUserCache = await API.users();
    renderUserRoles();
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    if (btn && document.body.contains(btn)) {
      btn.disabled = false;
      btn.textContent = 'Save Assignment';
    }
  }
}

function renderFuelPriceCards(fuels, mode = 'readonly') {
  return fuels.map(f => {
    const ceiling = safeNum(f.base_price ?? f.price);
    const branch = safeNum(f.price);
    const requestedInput = mode === 'request'
      ? `<div class="price-editor price-editor-request">
          <span>PHP/L</span>
          <input type="number" min="0" max="${ceiling.toFixed(2)}" step="0.01" value="${branch.toFixed(2)}" id="request-price-${f.id}" aria-label="Requested ${gfEscape(gfFuelName(f))} price">
        </div>`
      : mode === 'ceiling'
      ? `<div class="price-editor price-editor-ceiling">
          <span>PHP/L</span>
          <input type="number" min="0" step="0.01" value="${ceiling.toFixed(2)}" id="price-${f.id}" aria-label="Owner ceiling ${gfEscape(gfFuelName(f))} price">
          <button type="button" class="btn-outline btn-sm" id="save-ceiling-${f.id}" onclick="updateFuelPrice('${gfEscape(String(f.id))}')">Save Ceiling</button>
        </div>`
      : `<div class="price-readout-grid">
          <span><small>Ceiling</small><b>${fmt(ceiling)}</b></span>
          <span><small>POS Price</small><b>${fmt(branch)}</b></span>
        </div>`;
    return `
      <div class="${mode === 'request' ? 'manager-price-item cashier-price-item' : 'price-base-item'}">
        <div class="price-base-head">
          <span class="price-fuel-dot"></span>
          <div>
            <b>${gfFuelName(f)}</b>
            <small>${mode === 'request' ? `Ceiling: ${fmt(ceiling)} · Current POS: ${fmt(branch)} ${priceSourceLabel(f)}` : gfEscape(f.name)}</small>
          </div>
        </div>
        ${requestedInput}
      </div>`;
  }).join('');
}

async function initFuelPrices() {
  const wrap = document.getElementById('fuel-prices-workspace');
  if (!wrap) return;
  wrap.innerHTML = `<div class="gf-card">${loadingHTML}</div>`;
  try {
    const [fuels, requests] = await Promise.all([
      API.fuels(),
      API.fuelPriceRequests().catch(() => []),
    ]);
    allFuels = fuels;
    gfPriceRequests = requests;

    if (currentUser.role === 'owner') {
      const branches = await API.branches().catch(() => []);
      const branchFuelPairs = await Promise.all(branches.map(async branch => {
        const branchFuels = await API.fuels({ branch_id: branch.id }).catch(() => []);
        return [branch.id, new Map(branchFuels.map(f => [String(f.id), f]))];
      }));
      const branchFuelMap = new Map(branchFuelPairs);
      wrap.innerHTML = `
        <div class="fuel-pricing-page owner-price-page">
          <div class="pricing-hero owner-pricing-hero">
            <div>
              <span class="pricing-kicker">Owner Price Overview</span>
              <h2>Ceiling prices and branch pump prices</h2>
              <p>Monitor the official ceiling price for every fuel type and compare the approved POS price used by each branch.</p>
            </div>
            <div class="pricing-hero-stats">
              <span><b>${allFuels.length}</b><small>Fuel Types</small></span>
              <span><b>${branches.length}</b><small>Branches</small></span>
              <span><b>${gfPriceRequests.filter(r => r.status === 'approved').length}</b><small>Approved</small></span>
            </div>
          </div>

          <div class="gf-card price-control-card ceiling-card">
            <div class="gf-card-head">
              <div><h3>Fuel Ceiling Prices</h3><p>Official maximum price per liter set by the owner.</p></div>
              <span class="badge badge-green">Owner Ceiling</span>
            </div>
            <div class="price-card-grid ceiling-price-grid">${renderFuelPriceCards(allFuels, 'ceiling')}</div>
          </div>

          <div class="gf-card branch-price-card">
            <div class="gf-card-head">
              <div><h3>Branch Price Board</h3><p>Approved branch prices currently used by cashier POS terminals.</p></div>
              <span class="badge badge-blue">Live Branch Prices</span>
            </div>
            <div class="tbl-wrap price-table owner-price-table">
              <table>
                <thead><tr><th>Branch</th>${allFuels.map(f => `<th class="td-right">${gfEscape(gfFuelName(f))}</th>`).join('')}</tr></thead>
                <tbody>${branches.map(branch => {
                  const prices = branchFuelMap.get(branch.id) || new Map();
                  return `<tr>
                    <td><b>${gfEscape(branch.name)}</b><br><small>${gfEscape(branch.location || '')}</small></td>
                    ${allFuels.map(baseFuel => {
                      const branchFuel = prices.get(String(baseFuel.id));
                      const value = branchFuel ? safeNum(branchFuel.price) : safeNum(baseFuel.price);
                      const isOverride = branchFuel && branchFuel.branch_price !== null && branchFuel.branch_price !== undefined;
                      return `<td class="td-right"><b>${fmt(value)}</b><br><small>${isOverride ? 'Approved branch' : 'Ceiling price'}</small></td>`;
                    }).join('')}
                  </tr>`;
                }).join('') || `<tr><td colspan="${allFuels.length + 1}"><div class="price-empty">No branches recorded yet</div></td></tr>`}</tbody>
              </table>
            </div>
          </div>
        </div>`;
      return;
    }

    if (currentUser.role === 'manager') {
      const pending = gfPriceRequests.filter(r => r.status === 'pending');
      const reviewed = gfPriceRequests.filter(r => r.status !== 'pending');
      wrap.innerHTML = `
        <div class="fuel-pricing-page manager-approval-page">
          <div class="pricing-hero manager">
            <div>
              <span class="pricing-kicker">Manager Price Approval</span>
              <h2>${gfEscape(currentUser.branch_name || 'Branch')} Fuel Prices</h2>
              <p>Review cashier requests based on local competitor prices. Approved requests update this branch's POS price.</p>
            </div>
            <div class="pricing-hero-stats">
              <span><b>${allFuels.length}</b><small>Fuel Types</small></span>
              <span><b>${pending.length}</b><small>Pending</small></span>
              <span><b>${reviewed.length}</b><small>Reviewed</small></span>
            </div>
          </div>

          <div class="gf-card price-control-card branch-current-card">
            <div class="gf-card-head">
              <div><h3>Current Branch Prices</h3><p>These are the prices currently reflected in the POS terminal.</p></div>
              <span class="badge badge-blue">Manager Approval</span>
            </div>
            <div class="price-card-grid">${renderFuelPriceCards(allFuels, 'readonly')}</div>
          </div>

          <div class="manager-price-tabs">
            <div class="tab-bar price-tab-bar">
              <button type="button" class="tab-btn active" onclick="switchTab(this,'price-pending')">Pending Requests <span class="badge badge-amber">${pending.length}</span></button>
              <button type="button" class="tab-btn" onclick="switchTab(this,'price-history')">Review History</button>
            </div>

            <div class="tab-pane active" id="price-pending">
              <div class="gf-card manager-price-section">
                <div class="gf-card-head">
                  <div><h3>Pending Cashier Requests</h3><p>Open a request to review its details, then approve or reject with a manager note.</p></div>
                  <span class="badge badge-amber">${pending.length} Pending</span>
                </div>
                <div class="price-request-list">${renderManagerPriceRequestCards(pending)}</div>
              </div>
            </div>

            <div class="tab-pane" id="price-history">
              <div class="gf-card manager-price-section">
                <div class="gf-card-head">
                  <div><h3>Review History</h3><p>Approved and rejected price decisions for this branch.</p></div>
                  <span class="badge badge-blue">${reviewed.length} Reviewed</span>
                </div>
                <div class="tbl-wrap price-table compact">
                  <table>
                    <thead><tr><th>Requested</th><th>Fuel</th><th class="td-right">Price</th><th>Status</th><th>Manager Note</th></tr></thead>
                    <tbody>${reviewed.map(r => `
                      <tr>
                        <td>${fmtDT(r.requested_at)}<br><small>${r.reviewed_at ? `Reviewed ${fmtDT(r.reviewed_at)}` : ''}</small></td>
                        <td>${gfEscape(r.fuel_name)}</td>
                        <td class="td-right"><b>${fmt(r.requested_price)}</b></td>
                        <td><span class="badge ${priceRequestBadge(r.status)}">${String(r.status).toUpperCase()}</span></td>
                        <td>${gfEscape(r.review_note || '-')}</td>
                      </tr>`).join('') || '<tr><td colspan="5"><div class="price-empty">No reviewed requests yet</div></td></tr>'}</tbody>
                  </table>
                </div>
              </div>
            </div>
          </div>
          <div id="gf-modal-root"></div>
        </div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="fuel-pricing-page cashier-price-page">
        <div class="pricing-hero cashier">
          <div>
            <span class="pricing-kicker">Cashier Price Request</span>
            <h2>${gfEscape(currentUser.branch_name || 'Branch')} Fuel Prices</h2>
            <p>Send competitor-based fuel price change requests to the branch manager for approval.</p>
          </div>
          <div class="pricing-hero-stats">
            <span><b>${allFuels.length}</b><small>Fuel Types</small></span>
            <span><b>${gfPriceRequests.filter(r => r.status === 'pending').length}</b><small>Pending</small></span>
            <span><b>${gfPriceRequests.filter(r => r.status === 'approved').length}</b><small>Approved</small></span>
          </div>
        </div>

        <div class="manager-request-grid cashier-request-grid">${renderFuelPriceCards(allFuels, 'request')}</div>
        <div class="gf-card cashier-price-submit-card">
          <div class="cashier-price-submit-grid">
            <label>
              Optional Note
              <textarea id="price-request-note" rows="3" placeholder="Optional competitor price or local market note"></textarea>
            </label>
            <div>
              <h3>Submit price changes</h3>
              <p>Change one or more fuel prices above, then send them to the manager in one action.</p>
              <button type="button" class="btn-green" id="submit-price-requests-btn" onclick="submitFuelPriceRequests()">Submit Price Requests</button>
            </div>
          </div>
        </div>

        <div class="gf-card">
          <div class="gf-card-head"><div><h3>My Branch Price Requests</h3><p>Manager approval history for this branch.</p></div></div>
          <div class="tbl-wrap price-table">
            <table>
              <thead><tr><th>Date</th><th>Fuel</th><th class="td-right">Ceiling</th><th class="td-right">Requested</th><th>Status</th><th>Manager Note</th></tr></thead>
              <tbody>${gfPriceRequests.map(r => `
                <tr>
                  <td>${fmtDT(r.requested_at)}</td>
                  <td>${gfEscape(r.fuel_name)}</td>
                  <td class="td-right">${fmt(r.base_price)}</td>
                  <td class="td-right"><b>${fmt(r.requested_price)}</b></td>
                  <td><span class="badge ${priceRequestBadge(r.status)}">${String(r.status).toUpperCase()}</span></td>
                  <td>${gfEscape(r.review_note || '-')}</td>
                </tr>`).join('') || '<tr><td colspan="6"><div class="price-empty">No price requests yet</div></td></tr>'}</tbody>
            </table>
          </div>
        </div>
      </div>`;
  } catch(e) {
    wrap.innerHTML = `<div class="gf-card"><p class="loading">${e.message}</p></div>`;
  }
}

async function initOwnerDash() {
  const page = 'page-owner-dash';
  gfPageShell(page, 'Head Office Dashboard', 'Network-wide performance overview.', `<div class="gf-card">${loadingHTML}</div>`,
    `<span class="gf-source-badge">Data Source: Verified Shift Records Only</span>`);
  try {
    const [summary, ranking, daily, reports] = await Promise.all([
      API.summary(), API.branchRanking(), API.daily({ days: 7 }), API.reportList().catch(() => []),
    ]);
    const totalSales = safeNum(summary.all_time.total_revenue);
    const totalExpenses = Math.round(totalSales * 0.12 * 100) / 100;
    const netSales = totalSales - totalExpenses;
    const pending = reports.filter(r => String(r.status || '').toLowerCase() === 'submitted').length;
    gfPageShell(page, 'Head Office Dashboard', 'Network-wide performance overview.',
      `<div class="gf-alert gf-alert-warn"><strong>Action Required: ${pending} Pending Reports</strong><span>Weekly consolidated reports from managers waiting for final approval.</span></div>
       <div class="gf-stat-grid">
         ${gfCard('Total Network Sales', fmt(totalSales), `${gfPct(8.2)} vs last week`, 'dark')}
         ${gfCard('Total Transactions', parseInt(summary.all_time.tx_count || 0).toLocaleString(), `Avg ${fmt(summary.all_time.avg_tx)} / transaction`)}
         ${gfCard('Total Expenses', fmt(totalExpenses), '-2.4% vs last week')}
         ${gfCard('Net Sales', fmt(netSales), '88% Profit Margin')}
       </div>
       <div class="gf-dash-grid">
         <div class="gf-card">
           <div class="gf-card-head"><div><h3>Branch Performance</h3><p>Weekly sales summary by location.</p></div></div>
           <div class="gf-branch-list">
             ${ranking.map((b, i) => `
               <button class="gf-branch-row" onclick="showBranchDetail('${b.id}')">
                 <span><strong>${b.name}</strong><small>${b.location}</small></span>
                 <span><b>${fmt(b.revenue)}</b><small>${b.tx_count} txns</small></span>
                 <span>→</span>
               </button>`).join('')}
           </div>
         </div>
         <div>
           <div class="gf-card gf-insight">
             <h3>Stock Allocation Insight</h3>
             <p><strong>${ranking[0]?.name || 'Top branch'}</strong> has the highest weekly sales volume.</p>
             <div>Consider allocating 15% more Diesel stock to the leading branch next week to prevent shortages during peak hours.</div>
           </div>
           <div class="gf-card">
             <div class="gf-card-head"><div><h3>Sales Distribution</h3><p>Revenue contribution by branch.</p></div></div>
             <div class="chart-wrap-sm"><canvas id="owner-sales-dist"></canvas></div>
           </div>
         </div>
       </div>
       <div class="gf-alert gf-alert-green"><strong>Automated Weekly Insight</strong><span>Diesel remains the highest selling fuel type this week. ${ranking[0]?.name || 'A branch'} showed the strongest network contribution.</span></div>`,
      `<span class="gf-source-badge">Data Source: Verified Shift Records Only</span>`);
    destroyChart('owner-sales-dist');
    charts['owner-sales-dist'] = new Chart(document.getElementById('owner-sales-dist'), {
      type: 'bar',
      data: { labels: ranking.map(b => b.name), datasets: [{ data: ranking.map(b => Math.round(b.revenue)), backgroundColor: '#218b61', borderRadius: 5 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '₱' + (v / 1000) + 'k' } }, x: { grid: { display: false } } } }
    });
  } catch(e) { showToast(e.message, 'error'); }
}

async function initComparison() {
  const page = 'page-comparison';
  const month = gfComparisonMonth || gfMonthValue();
  const params = { month };
  if (gfComparisonWeek) params.week = gfComparisonWeek;
  gfPageShell(page, 'Branch Comparison', 'Performance analysis by weeks of the selected month.', `<div class="gf-card">${loadingHTML}</div>`);
  try {
    const data = await API.branchComparison(params);
    gfComparisonMonth = data.month || month;
    gfComparisonWeek = safeNum(data.selected_week) || 1;
    const weeks = data.weeks || [];
    const selectedRange = data.selected_range || weeks[0] || null;
    const ranking = data.ranking || [];
    const trends = data.trends || [];
    const top = ranking[0] || {};
    const totalSales = ranking.reduce((sum, row) => sum + safeNum(row.revenue), 0);
    const totalTx = ranking.reduce((sum, row) => sum + safeNum(row.tx_count), 0);
    const totalLiters = ranking.reduce((sum, row) => sum + safeNum(row.liters), 0);
    const activeSources = [...new Set(ranking.map(r => r.source).filter(source => source && source !== 'none'))];
    const sourceLabel = activeSources.includes('daily_entries')
      ? 'Source: Daily Entries, with POS fallback for branches without entries'
      : 'Source: POS transactions for this week';
    const weekChips = weeks.map(w => `
      <button type="button" class="gf-week-chip ${safeNum(w.number) === gfComparisonWeek ? 'active' : ''}" onclick="loadComparisonWeek(${safeNum(w.number)})">
        <strong>${gfEscape(w.label)}</strong>
        <span>${gfShortDateRange(w)}</span>
      </button>`).join('');
    const rangeLabel = selectedRange ? `${selectedRange.label} · ${gfShortDateRange(selectedRange)}` : 'Selected week';
    gfPageShell(page, 'Branch Comparison', 'Performance analysis by weeks of the selected month.',
      `<div class="gf-comparison-controls gf-card">
        <div>
          <h3>${gfEscape(gfMonthLabel(gfComparisonMonth))}</h3>
          <p>Branch ranking is based on ${gfEscape(rangeLabel)}.</p>
        </div>
        <label>Month<input type="month" id="cmp-month" value="${gfEscape(gfComparisonMonth)}" onchange="loadComparisonMonth()"></label>
      </div>
      <div class="gf-week-chip-row">${weekChips}</div>
      <div class="gf-stat-grid three">
        ${gfCard('Selected Week Sales', fmt(totalSales), rangeLabel, 'dark')}
        ${gfCard('Transactions / Entries', totalTx.toLocaleString(), sourceLabel)}
        ${gfCard('Total Liters', fmtL(totalLiters), 'Across all branches')}
      </div>
      <div class="gf-comparison-top">
        <div class="gf-card gf-top-performer">
          <span>Top Performer</span>
          <small>Highest sales for ${gfEscape(rangeLabel)}</small>
          <h2>${gfEscape(top.name || 'No branch')}</h2>
          <strong>${fmt(top.revenue)}</strong>
          <em>${top.id ? comparisonGrowth(top) + ' vs previous week' : 'No weekly data yet'}</em>
        </div>
        <div class="gf-card">
          <div class="gf-card-head"><div><h3>Performance Ranking</h3><p>${gfEscape(rangeLabel)}</p></div></div>
          <table><thead><tr><th>Rank</th><th>Branch</th><th class="td-right">Week Sales</th><th>Growth</th><th class="td-right">AVG Record</th></tr></thead>
          <tbody>${ranking.map((b, i) => `<tr><td>#${i + 1}</td><td><b>${gfEscape(b.name)}</b><br><small>${gfEscape(b.location || '')}</small></td><td class="td-right">${fmt(b.revenue)}</td><td>${comparisonGrowth(b)}</td><td class="td-right">${fmt(b.avg_tx)}</td></tr>`).join('') || '<tr><td colspan="5" class="td-center">No branch data for this week yet</td></tr>'}</tbody></table>
        </div>
      </div>
      <div class="gf-two-col">
        <div class="gf-card"><div class="gf-card-head"><div><h3>Weekly Sales Comparison</h3><p>Total revenue per branch for ${gfEscape(rangeLabel)}.</p></div></div><div class="chart-wrap"><canvas id="cmp-bars"></canvas></div></div>
        <div class="gf-card"><div class="gf-card-head"><div><h3>Month Week Trend</h3><p>Performance from Week 1 to the final week of ${gfEscape(gfMonthLabel(gfComparisonMonth))}.</p></div></div><div class="chart-wrap"><canvas id="cmp-lines"></canvas></div></div>
      </div>`);
    destroyChart('cmp-bars');
    charts['cmp-bars'] = new Chart(document.getElementById('cmp-bars'), {
      type: 'bar',
      data: { labels: ranking.map(b => b.name), datasets: [{ data: ranking.map(b => Math.round(b.revenue)), backgroundColor: '#218b61', borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { y: { ticks: { callback: v => '₱' + (v / 1000) + 'k' } } } }
    });
    destroyChart('cmp-lines');
    const colors = ['#218b61', '#2563eb', '#eab308', '#dc2626', '#7c3aed', '#0891b2'];
    const weekLabels = weeks.map(w => w.label);
    charts['cmp-lines'] = new Chart(document.getElementById('cmp-lines'), {
      type: 'line',
      data: { labels: weekLabels, datasets: trends.map((branch, i) => ({ label: branch.branch_name, data: weekLabels.map((_, idx) => Math.round(safeNum(branch.data?.[idx]?.revenue))), borderColor: colors[i % colors.length], backgroundColor: 'transparent', tension: 0.35, pointRadius: 3 })) },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, scales: { y: { ticks: { callback: v => '₱' + (v / 1000) + 'k' } } } }
    });
  } catch(e) { showToast(e.message, 'error'); }
}

async function initBranches() {
  const page = 'page-branches';
  stopBranchWeeklyAutoRefresh();
  gfSelectedBranch = null;
  gfSelectedBranchData = null;
  destroyChart('branch-fuel-mix');
  destroyChart('branch-daily-trend');
  gfPageShell(page, 'Branches', 'Manage and monitor your gas station network.', `<div class="gf-card">${loadingHTML}</div>`);
  try {
    gfBranchCache = await API.branches();
    const totals = gfBranchCache.reduce((acc, b) => {
      acc.revenue += safeNum(b.revenue);
      acc.liters += safeNum(b.liters);
      acc.tx += safeNum(b.tx_count);
      return acc;
    }, { revenue: 0, liters: 0, tx: 0 });
    gfPageShell(page, 'Branches', 'Manage and monitor your gas station network.',
      `<div class="gf-stat-grid three owner-branch-stats">
        ${gfCard('Total Branch Sales', fmt(totals.revenue), 'All active branches')}
        ${gfCard('Total Liters Sold', fmtL(totals.liters), `${Math.round(totals.tx)} recorded transactions`)}
        ${gfCard('Active Branches', gfBranchCache.length, 'Owner dashboard access', 'dark')}
      </div>
      <div class="owner-branch-grid">
        ${gfBranchCache.map(b => `
          <div class="owner-branch-card">
            <div class="owner-branch-card-head">
              <div class="gf-branch-icon">⌂</div>
              <span class="manager-status-pill ${gfEscape(b.manager_status || 'unassigned')}">${managerPresenceLabel(b.manager_status || 'unassigned')}</span>
            </div>
            <h3>${gfEscape(b.name)}</h3>
            <p>${gfEscape(b.location)}</p>
            ${renderManagerPresence(b, true)}
            <div class="owner-branch-metrics">
              <span><small>Revenue</small><b>${fmt(b.revenue)}</b></span>
              <span><small>Liters</small><b>${fmtL(b.liters)}</b></span>
              <span><small>Transactions</small><b>${Math.round(safeNum(b.tx_count))}</b></span>
            </div>
            <button class="btn-outline full" onclick="showBranchDetail('${gfEscape(b.id)}')">View Dashboard</button>
          </div>`).join('')}
      </div>`);
  } catch(e) { showToast(e.message, 'error'); }
}

async function showBranchDetail(branchId) {
  gfSelectedBranch = branchId;
  await ensurePageLoaded('page-branches');
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-branches').classList.add('active');
  try {
    if (!gfBranchCache.length) gfBranchCache = await API.branches();
    const branch = gfBranchCache.find(b => b.id === branchId) || {};
    const [daily, fuels, entries, reports, txRows] = await Promise.all([
      API.daily({ branch_id: branchId, days: 7 }),
      API.fuelBreakdown(branchId),
      API.dailyEntries({ branch_id: branchId }).catch(() => []),
      API.reportList({ branch_id: branchId }).catch(() => []),
      API.txList({ branch_id: branchId, limit: 300 }).catch(() => []),
    ]);
    dailyEntryCache = entries;
    gfSelectedBranchData = branch;
    gfBranchWeeklyReports = reports;
    const weeklyFuels = fuels;
    const trendRows = ownerBranchTrendRows(daily, entries, txRows);
    const trendMode = trendRows.mode || 'recent';
    const trendCaption = trendMode === 'recent'
      ? 'Recent 7 calendar days from Daily Entries and POS transactions.'
      : 'No sales in the recent 7 calendar days, showing the latest 7 recorded days.';
    const trendKpiLabel = trendMode === 'recent' ? 'Recent 7 Days' : 'Latest Records';
    const trendTotal = trendRows.reduce((sum, row) => sum + safeNum(row.value), 0);
    const latestTrend = trendRows[trendRows.length - 1] || {};
    gfPageShell('page-branches', branch.name || 'Branch', `${branch.location || ''} · ID: ${branch.id || branchId}`,
      `<div class="branch-detail-hero">
        <div>
          <span class="pricing-kicker">Owner Branch View</span>
          <h2>${gfEscape(branch.name || 'Branch Dashboard')}</h2>
          <p>${gfEscape(branch.location || '')} branch performance from submitted daily records and POS transactions.</p>
          ${renderManagerPresence(branch)}
        </div>
        <div class="branch-detail-kpis">
          <span><small>Branch Sales</small><b>${fmt(branch.revenue)}</b></span>
          <span><small>${trendKpiLabel}</small><b>${fmt(trendTotal)}</b></span>
          <span><small>Latest Day</small><b>${fmt(latestTrend.value || 0)}</b></span>
        </div>
       </div>
       <div class="gf-alert gf-alert-info"><strong>Performance Summary</strong><span>Total recorded sales reached ${fmt(branch.revenue)}. Top selling fuel is ${weeklyFuels[0]?.name || 'Diesel'}.</span></div>
       <div class="gf-two-col">
         <div class="gf-card"><div class="gf-card-head"><div><h3>Fuel Type Mix</h3><p>Sales distribution by product type.</p></div></div><div class="chart-wrap-sm"><canvas id="branch-fuel-mix"></canvas></div></div>
         <div class="gf-card"><div class="gf-card-head"><div><h3>Daily Sales Trend</h3><p>${trendCaption}</p></div></div><div class="chart-wrap-sm"><canvas id="branch-daily-trend"></canvas></div></div>
       </div>
       <div class="tab-bar"><button class="tab-btn active" onclick="switchTab(this,'branch-daily-records')">Daily Records</button><button class="tab-btn" onclick="switchTab(this,'branch-weekly-report')">Weekly Reports</button></div>
       <div class="tab-pane active" id="branch-daily-records">
         <div class="gf-card"><div class="gf-card-head"><div><h3>Daily Breakdown</h3><p>All daily sales entries submitted by this branch.</p></div></div>
         <table><thead><tr><th>Date</th><th>Date Filed</th><th>Time In / Time Out</th><th class="td-right">Total Sales</th><th class="td-right">Action</th></tr></thead><tbody>
         ${entries.slice(0, 10).map((e, i) => `<tr><td>${e.entry_date}</td><td>${e.submitted_at ? fmtDT(e.submitted_at) : '-'}</td><td>${e.time_in || '-'} - ${e.time_out || '-'}</td><td class="td-right">${fmt(e.total_cash_expected)}</td><td class="td-right"><button class="btn-outline btn-sm" onclick="showDailyEntryDetail(${i})">View</button></td></tr>`).join('') || '<tr><td colspan="5" class="td-center">No submitted daily entries yet</td></tr>'}
         </tbody></table></div>
         <div id="branch-daily-entry-detail"></div>
       </div>
       <div class="tab-pane" id="branch-weekly-report">${renderBranchWeeklyRecords(branch, reports)}</div>`,
      `<button class="btn-outline" onclick="initBranches()">Back to Branches</button>`);
    startBranchWeeklyAutoRefresh(branchId);
    destroyChart('branch-fuel-mix');
    charts['branch-fuel-mix'] = new Chart(document.getElementById('branch-fuel-mix'), { type: 'doughnut', data: { labels: weeklyFuels.map(f => f.name), datasets: [{ data: weeklyFuels.map(f => Math.round(f.revenue)), backgroundColor: weeklyFuels.map(f => f.color), borderWidth: 3, borderColor: '#fff' }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom' } }, cutout: '62%' } });
    destroyChart('branch-daily-trend');
    charts['branch-daily-trend'] = new Chart(document.getElementById('branch-daily-trend'), { type: 'bar', data: { labels: trendRows.map(d => fmtD(d.date)), datasets: [{ data: trendRows.map(d => Math.round(d.value || 0)), backgroundColor: trendRows.map(d => d.source === 'Daily Entries' ? '#218b61' : '#2563eb'), borderRadius: 5 }] }, options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false }, tooltip: { callbacks: { afterLabel: ctx => `Source: ${trendRows[ctx.dataIndex]?.source || 'No Data'}` } } }, scales: { y: { beginAtZero: true, ticks: { callback: v => '₱' + (v / 1000) + 'k' } } } } });
  } catch(e) { showToast(e.message, 'error'); }
}

function renderOwnerWeeklyReport(branch, weekly, fuels, entries) {
  const totals = weekly?.totals || {};
  const sales = safeNum(totals.total_sales || branch.revenue);
  const expenses = safeNum(totals.total_expenses);
  const net = sales - expenses;
  const weeklyDailyRows = weekly?.daily?.length ? weekly.daily : entries;
  return `<div class="gf-report">
    <div class="gf-report-actions"><button class="btn-outline" onclick="window.print()">Print Report</button><button class="btn-green" onclick="showToast('Weekly report approved')">Approve Report</button></div>
    <div class="gf-stat-grid three">${gfCard('Total Weekly Sales', fmt(sales))}${gfCard('Total Expenses', fmt(expenses))}${gfCard('Net Sales', fmt(net), '', 'dark')}</div>
    <div class="gf-two-col">
      <div class="gf-card"><h3>Sales Breakdown by Fuel Type</h3><p>Consolidated volume and amount for the week.</p>${weeklyFuelTable(fuels, sales)}</div>
      <div class="gf-card"><h3>Expense Summary</h3>${weeklyExpenseTable(weekly?.expense_summary || [], expenses)}</div>
    </div>
    <div class="gf-card"><h3>Daily Summary</h3><p>Day-by-day performance overview.</p>${dailyEntriesTable(weeklyDailyRows)}</div>
  </div>`;
}

function renderBranchWeeklyRecords(branch, reports = []) {
  const rows = (reports || []).map((report, i) => {
    const sales = safeNum(report.total_sales);
    const expenses = safeNum(report.total_expenses);
    const net = sales - expenses;
    const status = String(report.status || 'submitted').toLowerCase();
    const badge = status === 'approved' ? 'badge-green' : 'badge-amber';
    return `<tr>
      <td>${report.week_start} - ${report.week_end}<br><small>Submitted ${report.submitted_at ? fmtDT(report.submitted_at) : '-'}</small></td>
      <td>${gfEscape(report.branch_name || branch.name || '')}</td>
      <td class="td-right">${fmt(sales)}</td>
      <td class="td-right">${fmt(expenses)}</td>
      <td class="td-right">${fmt(net)}</td>
      <td><span class="badge ${badge}">${gfEscape(status)}</span></td>
      <td class="td-right"><button class="btn-outline btn-sm" onclick="showBranchWeeklyReportDetail(${i})">View</button></td>
    </tr>`;
  }).join('');
  return `
    <div class="gf-card">
      <div class="gf-card-head">
        <div><h3>Weekly Reports</h3><p>Consolidated weekly submissions for this branch.</p></div>
        <button class="btn-outline btn-sm" onclick="refreshBranchWeeklyReports(gfSelectedBranch)">Refresh</button>
      </div>
      <table>
        <thead><tr><th>Week</th><th>Branch</th><th class="td-right">Total Sales</th><th class="td-right">Expenses</th><th class="td-right">Net Sales</th><th>Status</th><th class="td-right">Action</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" class="td-center">No weekly reports submitted yet.</td></tr>'}</tbody>
      </table>
    </div>
    <div id="branch-weekly-detail"></div>
    <div class="daily-cash-note">This list only shows weekly reports after the branch manager submits them. It refreshes automatically while this tab is open.</div>`;
}

function stopBranchWeeklyAutoRefresh() {
  if (gfBranchWeeklyRefreshTimer) {
    clearInterval(gfBranchWeeklyRefreshTimer);
    gfBranchWeeklyRefreshTimer = null;
  }
}

function startBranchWeeklyAutoRefresh(branchId) {
  if (currentUser?.role !== 'owner') return;
  stopBranchWeeklyAutoRefresh();
  gfBranchWeeklyRefreshTimer = setInterval(() => {
    const branchPageActive = document.getElementById('page-branches')?.classList.contains('active');
    const tabActive = document.getElementById('branch-weekly-report')?.classList.contains('active');
    if (branchPageActive && tabActive && gfSelectedBranch === branchId) {
      refreshBranchWeeklyReports(branchId, true);
    }
  }, 10000);
}

async function refreshBranchWeeklyReports(branchId = gfSelectedBranch, silent = false) {
  const target = document.getElementById('branch-weekly-report');
  if (!branchId || !target) return;
  const branch = gfSelectedBranchData || gfBranchCache.find(b => b.id === branchId) || {};
  try {
    const reports = await API.reportList({ branch_id: branchId });
    gfBranchWeeklyReports = reports;
    target.innerHTML = renderBranchWeeklyRecords(branch, reports);
    if (!silent) showToast('Weekly reports refreshed.');
  } catch(e) {
    if (!silent) showToast(e.message || 'Could not refresh weekly reports.', 'error');
  }
}

async function showBranchWeeklyReportDetail(index) {
  const target = document.getElementById('branch-weekly-detail');
  const report = gfBranchWeeklyReports[index];
  const branch = gfSelectedBranchData || gfBranchCache.find(b => b.id === gfSelectedBranch) || {};
  if (!target || !report) return;
  target.innerHTML = `<div class="gf-card">${loadingHTML}</div>`;
  try {
    const weekly = await API.weeklyReport({
      branch_id: report.branch_id || gfSelectedBranch,
      week_start: report.week_start,
      week_end: report.week_end,
    });
    weekly.submitted_report = report;
    if (!weekly.totals) weekly.totals = {};
    weekly.totals.total_sales = safeNum(report.total_sales);
    weekly.totals.total_expenses = safeNum(report.total_expenses);
    weekly.totals.total_liters = safeNum(report.total_liters);
    target.innerHTML = renderOwnerWeeklyReport(branch, weekly, weekly.fuel_breakdown || [], weekly.daily || [], report);
  } catch(e) {
    target.innerHTML = `<div class="gf-card"><p class="loading">${gfEscape(e.message || 'Could not load submitted report.')}</p></div>`;
  }
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function weeklyFuelTable(fuels, totalSales = 0) {
  const rows = fuels.map(f => `<tr><td>${f.name}</td><td class="td-right">${fmtL(f.liters)}</td><td class="td-right">${fmt(f.revenue)}</td></tr>`).join('');
  const liters = fuels.reduce((a, f) => a + safeNum(f.liters), 0);
  const revenue = totalSales || fuels.reduce((a, f) => a + safeNum(f.revenue), 0);
  return `<table><thead><tr><th>Fuel Type</th><th class="td-right">Total Liters</th><th class="td-right">Total Amount</th></tr></thead><tbody>${rows}<tr><td><b>Total</b></td><td class="td-right"><b>${fmtL(liters)}</b></td><td class="td-right"><b>${fmt(revenue)}</b></td></tr></tbody></table>`;
}

function weeklyExpenseTable(expenseRows = [], totalExpenses = 0) {
  const rows = (expenseRows || []).filter(e => safeNum(e.amount) || safeNum(e.liters) || e.description).map(e =>
    `<tr><td>${gfEscape(e.description || 'Expense')}</td><td class="td-right">${safeNum(e.liters) ? fmtL(e.liters) : '-'}</td><td class="td-right">${fmt(e.amount)}</td></tr>`
  ).join('');
  if (!rows) return `<div class="gf-empty-note">No expenses recorded for this span.</div>`;
  return `<table><thead><tr><th>Description</th><th class="td-right">Liters</th><th class="td-right">Amount</th></tr></thead><tbody>${rows}<tr><td colspan="2"><b>Total Expenses</b></td><td class="td-right"><b>${fmt(totalExpenses)}</b></td></tr></tbody></table>`;
}

function dailyEntriesTable(entries, daily = []) {
  const rows = (entries.length ? entries : daily).map(d => {
    const status = d.status || 'submitted';
    const badge = status === 'reviewed' || status === 'verified' ? 'badge-green' : 'badge-amber';
    return `<tr><td>${d.entry_date || d.day}</td><td>${d.shift || 'Automatic'}</td><td><span class="badge ${badge}">${status}</span></td><td class="td-right">${fmt(d.total_cash_expected || d.revenue)}</td></tr>`;
  }).join('');
  return `<table><thead><tr><th>Date</th><th>Shift</th><th>Status</th><th class="td-right">Daily Total</th></tr></thead><tbody>${rows || '<tr><td colspan="4" class="td-center">No records yet</td></tr>'}</tbody></table>`;
}

function getWeeklyRangeFromInputs(showError = true) {
  const start = document.getElementById('weekly-start')?.value || gfWeeklyRange?.start || gfCurrentWeekRange().start;
  const end = document.getElementById('weekly-end')?.value || gfWeeklyRange?.end || gfCurrentWeekRange().end;
  if (!start || !end) {
    if (showError) showToast('Choose a start and end date.', 'error');
    return null;
  }
  if (gfDateFromValue(end) < gfDateFromValue(start)) {
    if (showError) showToast('End date must be on or after the start date.', 'error');
    return null;
  }
  return { start, end };
}

function weeklyRangeLabel(range) {
  return `${fmtD(range.start)} - ${fmtD(range.end)}`;
}

function applyWeeklyRange() {
  const range = getWeeklyRangeFromInputs();
  if (!range) return;
  gfWeeklyRange = range;
  initWeekly(range);
}

function setWeeklySevenDaySpan() {
  const start = document.getElementById('weekly-start')?.value || gfToday();
  const range = { start, end: gfAddDays(start, 6) };
  gfWeeklyRange = range;
  initWeekly(range);
}

function setCurrentWeekSpan() {
  gfWeeklyRange = gfCurrentWeekRange();
  initWeekly(gfWeeklyRange);
}

async function initWeekly(rangeArg = null) {
  const page = 'page-weekly';
  const requestedRange = rangeArg || gfWeeklyRange || gfCurrentWeekRange();
  gfWeeklyRange = requestedRange;
  gfPageShell(page, currentUser.role === 'owner' ? 'Weekly Sales Report' : 'Weekly Consolidated Report',
    currentUser.role === 'owner' ? 'Consolidated report for the selected branch.' : 'Review and submit consolidated weekly sales and expenses.',
    `<div class="gf-card">${loadingHTML}</div>`);
  try {
    const [data, entries] = await Promise.all([
      API.weeklyReport({ branch_id: currentUser.branch_id, week_start: requestedRange.start, week_end: requestedRange.end }),
      API.dailyEntries({ branch_id: currentUser.branch_id, date_from: requestedRange.start, date_to: requestedRange.end }).catch(() => []),
    ]);
    const range = { start: data.week_start || requestedRange.start, end: data.week_end || requestedRange.end };
    gfWeeklyRange = range;
    const totals = data.totals || {};
    const sales = safeNum(totals.total_sales);
    const expenses = safeNum(totals.total_expenses);
    const net = sales - expenses;
    const fuels = data.fuel_breakdown || [];
    const weeklyDailyRows = (data.daily && data.daily.length) ? data.daily : entries;
    const sourceBadge = data.source === 'daily_entries'
      ? `<span class="badge badge-green">Source: Daily Entry Submissions</span>`
      : `<span class="badge badge-amber">Source: Transaction Records</span>`;
    gfPageShell(page, 'Weekly Consolidated Report', 'Review and submit consolidated weekly sales and expenses.',
      `<div class="gf-weekly-layout">
       <div class="gf-card gf-week-range-card">
         <div class="gf-card-head gf-week-range-head">
           <div><h3>Report Span</h3><p>Choose the exact dates included before submitting to the owner.</p></div>
           <div class="gf-week-range-controls">
             <label>Start Date<input type="date" id="weekly-start" value="${range.start}"></label>
             <label>End Date<input type="date" id="weekly-end" value="${range.end}"></label>
             <button class="btn-outline btn-sm" type="button" onclick="applyWeeklyRange()">Load Report</button>
             <button class="btn-outline btn-sm" type="button" onclick="setWeeklySevenDaySpan()">7-Day Span</button>
             <button class="btn-outline btn-sm" type="button" onclick="setCurrentWeekSpan()">Current Week</button>
           </div>
         </div>
       </div>
       <div class="gf-status-line"><span class="badge badge-amber">Status: Pending Submission</span><span class="badge badge-blue">Span: ${weeklyRangeLabel(range)}</span>${sourceBadge}</div>
       <div class="gf-stat-grid three">
         ${gfCard('Total Sales', fmt(sales))}
         ${gfCard('Expenses', fmt(expenses))}
         ${gfCard('Net Cash Position', fmt(net), '', 'dark')}
       </div>
       <div class="gf-two-col">
         <div class="gf-card"><h3>Sales Breakdown by Fuel Type</h3><p>Consolidated volume and amount for the week.</p>${weeklyFuelTable(fuels, sales)}</div>
         <div class="gf-card"><h3>Expense Summary</h3>${weeklyExpenseTable(data.expense_summary || [], expenses)}</div>
       </div>
       <div class="gf-card"><h3>Daily Entry Summary</h3><p>Submitted daily entries included in this weekly report.</p>${dailyEntriesTable(weeklyDailyRows)}</div>
       <div class="gf-report-actions"><button class="btn-outline" onclick="window.print()">Print Report</button><button class="btn-green" id="weekly-submit-btn" onclick="submitWeeklyReport()">Submit Weekly Report</button></div>
      </div>`);
  } catch(e) { showToast(e.message, 'error'); }
}

async function initRecords() {
  const page = 'page-records';
  gfPageShell(page, 'Daily Records Log', 'Review submitted manager documents and POS terminal transactions.', `<div class="gf-card">${loadingHTML}</div>`);
  try {
    const [entries, txs, fuels] = await Promise.all([
      API.dailyEntries({ branch_id: currentUser.branch_id }).catch(() => []),
      API.txList({ branch_id: currentUser.branch_id, limit: 500 }).catch(() => []),
      API.fuels().catch(() => allFuels),
    ]);
    if (fuels && fuels.length) allFuels = fuels;
    dailyEntryCache = entries;
    gfRecordTxCache = txs;
    gfPageShell(page, 'Daily Records Log', 'Review submitted manager documents and POS terminal transactions.',
      `<div class="gf-record-tabs">
        <div class="tab-bar">
          <button class="tab-btn active" onclick="switchTab(this,'records-daily-entries')">Daily Entries</button>
          <button class="tab-btn" onclick="switchTab(this,'records-pos-transactions')">POS Transactions</button>
        </div>
        <div class="tab-pane active" id="records-daily-entries">
          <div class="gf-card">
            <div class="gf-card-head">
              <div><h3>Shift Records</h3><p>Daily Entry forms submitted by this branch.</p></div>
              <div class="gf-filter-row"><input id="daily-record-search" placeholder="Search date or personnel..." oninput="renderRecordsFiltered()"><select id="daily-status-filter" onchange="renderRecordsFiltered()"><option value="">All Status</option><option>submitted</option><option>reviewed</option></select></div>
            </div>
            <div id="daily-records-table"></div>
          </div>
          <div id="daily-entry-detail"></div>
        </div>
        <div class="tab-pane" id="records-pos-transactions">
          <div class="gf-card">
            <div class="gf-card-head">
              <div><h3>POS Daily Transactions</h3><p>Cashier transactions entered through the POS terminal.</p></div>
              <div class="gf-filter-row records-pos-filters">
                <input id="pos-record-date" type="date" value="${gfToday()}" onchange="renderPosRecordsFiltered()">
                <select id="pos-record-fuel" onchange="renderPosRecordsFiltered()">
                  <option value="">All Fuel</option>
                  ${allFuels.map(f => `<option value="${f.id}">${gfFuelName(f)}</option>`).join('')}
                </select>
                <select id="pos-record-status" onchange="renderPosRecordsFiltered()">
                  <option value="">All Status</option>
                  <option value="pending">Pending</option>
                  <option value="verified">Verified</option>
                  <option value="void">Void</option>
                </select>
                <input id="pos-record-search" placeholder="Search tx, cashier, customer..." oninput="renderPosRecordsFiltered()">
                <button type="button" class="btn-outline btn-sm" onclick="clearPosRecordFilters()">All Dates</button>
              </div>
            </div>
            <div class="gf-auto-summary records-pos-summary" id="records-pos-summary"></div>
            <div id="records-pos-table" class="tbl-wrap"></div>
          </div>
        </div>
      </div>
      <div id="gf-modal-root"></div>`);
    renderRecordsFiltered();
    renderPosRecordsFiltered();
  } catch(e) { showToast(e.message, 'error'); }
}

function renderRecordsFiltered() {
  const q = (document.getElementById('daily-record-search')?.value || '').toLowerCase();
  const status = document.getElementById('daily-status-filter')?.value || '';
  const rows = dailyEntryCache.filter(e =>
    (!status || e.status === status) &&
    (`${dailyEntryDisplayId(e)} ${e.entry_date} ${e.time_in} ${e.time_out} ${e.branch_name} ${e.duty_personnel} ${e.submitted_by_name}`.toLowerCase().includes(q))
  );
  const target = document.getElementById('daily-records-table');
  if (!target) return;
  target.innerHTML = `<div class="tbl-wrap records-entry-table"><table><thead><tr><th>Entry ID</th><th>Date</th><th>Time In / Time Out</th><th>Branch</th><th>Prepared By</th><th class="td-right">Total Sales</th><th>Status</th><th class="td-right">Actions</th></tr></thead><tbody>
    ${rows.map(e => {
      const index = dailyEntryCache.indexOf(e);
      return `<tr><td class="mono">${dailyEntryDisplayId(e)}</td><td>${e.entry_date}</td><td>${e.time_in || '-'} - ${e.time_out || '-'}</td><td>${e.branch_name || currentUser.branch_name}</td><td>${e.duty_personnel || e.submitted_by_name || '-'}</td><td class="td-right">${fmt(e.total_cash_expected)}</td><td><span class="badge ${e.status === 'reviewed' ? 'badge-green' : 'badge-amber'}">${e.status}</span></td><td class="td-right"><button class="btn-outline btn-sm" onclick="showDailyEntryDetail(${index})">View</button> <button class="btn-green btn-sm" onclick="editDailyEntry(${index})">Edit</button></td></tr>`;
    }).join('') || '<tr><td colspan="8" class="td-center">No daily entries yet</td></tr>'}
  </tbody></table></div>`;
}

function posRecordStatusKey(status) {
  const key = String(status || 'pending').toLowerCase();
  if (key === 'void') return 'void';
  if (key === 'verified') return 'verified';
  return 'pending';
}

function posRecordStatusText(status) {
  return { verified: 'VERIFIED', void: 'VOID', pending: 'PENDING' }[posRecordStatusKey(status)] || 'PENDING';
}

function posRecordStatusBadge(status) {
  return { verified: 'badge-green', pending: 'badge-amber', void: 'badge-red' }[posRecordStatusKey(status)] || 'badge-gray';
}

function isVoidTx(tx) {
  return String(tx.status || '').toLowerCase() === 'void';
}

function renderPosRecordsFiltered() {
  const date = document.getElementById('pos-record-date')?.value || '';
  const fuel = document.getElementById('pos-record-fuel')?.value || '';
  const status = document.getElementById('pos-record-status')?.value || '';
  const q = (document.getElementById('pos-record-search')?.value || '').toLowerCase();
  const rows = gfRecordTxCache.filter(t => {
    const txDate = String(t.timestamp || '').slice(0, 10);
    const txStatus = posRecordStatusKey(t.status);
    const haystack = `${t.id} ${t.fuel_name} ${t.fuel_type} ${t.cashier_name} ${t.customer} ${t.branch_name} ${txStatus}`.toLowerCase();
    return (!date || txDate === date) &&
      (!fuel || t.fuel_type === fuel) &&
      (!status || txStatus === status) &&
      (!q || haystack.includes(q));
  });
  const activeRows = rows.filter(t => !isVoidTx(t));
  const totalAmount = activeRows.reduce((sum, t) => sum + safeNum(t.total_amount || t.amount_paid), 0);
  const totalVat = activeRows.reduce((sum, t) => sum + safeNum(t.tax_amount), 0);
  const totalLiters = activeRows.reduce((sum, t) => sum + safeNum(t.liters), 0);
  const voidCount = rows.filter(isVoidTx).length;
  const summary = document.getElementById('records-pos-summary');
  if (summary) {
    summary.innerHTML = `
      <div><span>Transactions</span><b>${activeRows.length}</b></div>
      <div><span>Total Amount</span><b>${fmt(totalAmount)}</b></div>
      <div><span>VAT Collected</span><b>${fmt(totalVat)}</b></div>
      <div><span>Total Liters</span><b>${totalLiters.toFixed(2)} L</b></div>
      <div><span>Voided</span><b class="${voidCount ? 'negative' : ''}">${voidCount}</b></div>`;
  }
  const target = document.getElementById('records-pos-table');
  if (!target) return;
  target.innerHTML = `<table><thead><tr><th>Time</th><th>Transaction</th><th>Cashier</th><th>Fuel</th><th class="td-right">Total Amount</th><th class="td-right">Liters</th><th class="td-right">Price/L</th><th class="td-right">VAT</th><th>Status</th><th class="td-right">Actions</th></tr></thead><tbody>
    ${rows.map(t => {
      const txId = String(t.id || '').replace(/'/g, "\\'");
      const statusText = String(t.status || 'pending');
      return `<tr class="${isVoidTx(t) ? 'void-row' : ''}">
        <td>${fmtDT(t.timestamp)}</td>
        <td class="mono">${t.id}</td>
        <td>${t.cashier_name || '-'}</td>
        <td><b>${t.fuel_name || gfFuelName({ id: t.fuel_type, name: t.fuel_type })}</b></td>
        <td class="td-right"><b>${fmt(t.total_amount || t.amount_paid)}</b></td>
        <td class="td-right">${safeNum(t.liters).toFixed(2)} L</td>
        <td class="td-right">${fmt(t.price_per_liter)}</td>
        <td class="td-right">${fmt(t.tax_amount)}</td>
        <td><span class="badge ${posRecordStatusBadge(statusText)}">${posRecordStatusText(statusText)}</span>${isVoidTx(t) && t.void_reason ? `<small class="record-void-note">${t.void_reason}</small>` : ''}</td>
        <td class="td-right"><button class="btn-outline btn-sm" onclick="showPosTransactionDetail('${txId}')">View</button> ${isVoidTx(t) ? '' : `<button class="btn-outline btn-sm" onclick="voidTransaction('${txId}')">Void</button>`}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="10" class="td-center">No POS transactions found</td></tr>'}
  </tbody></table>`;
}

function showPosTransactionDetail(txId) {
  const tx = gfRecordTxCache.find(t => String(t.id) === String(txId));
  const root = document.getElementById('gf-modal-root');
  if (!tx || !root) return;
  root.innerHTML = `
    <div class="gf-modal-backdrop">
      <div class="gf-modal">
        <button class="gf-modal-x" onclick="closeGfModal()">×</button>
        <h2>POS Transaction ${posReceiptSafe(tx.id || '')}</h2>
        <p>${posReceiptSafe(tx.branch_name || currentUser.branch_name || 'Branch')} · ${fmtDT(tx.timestamp)}</p>
        <div class="gf-soft-box">
          <div class="gf-kv"><span>Status</span><b><span class="badge ${posRecordStatusBadge(tx.status)}">${posRecordStatusText(tx.status)}</span></b></div>
          <div class="gf-kv"><span>Cashier</span><b>${posReceiptSafe(tx.cashier_name || '-')}</b></div>
          <div class="gf-kv"><span>Customer</span><b>${posReceiptSafe(tx.customer || 'Walk-in')}</b></div>
        </div>
        <table class="daily-sheet-table">
          <tbody>
            <tr><td>Fuel Type</td><td>${posReceiptSafe(tx.fuel_name || tx.fuel_type || '-')}</td></tr>
            <tr><td>Liters</td><td class="td-right">${safeNum(tx.liters).toFixed(2)} L</td></tr>
            <tr><td>Price Per Liter</td><td class="td-right">${fmt(tx.price_per_liter)}</td></tr>
            <tr><td>Total (incl. VAT)</td><td class="td-right"><b>${fmt(tx.total_amount || tx.amount_paid)}</b></td></tr>
            <tr><td>VATable Sale</td><td class="td-right">${fmt(tx.subtotal_amount || ((safeNum(tx.total_amount) || safeNum(tx.amount_paid)) - safeNum(tx.tax_amount)))}</td></tr>
            <tr><td>VAT Amount ${safeNum(tx.tax_rate) ? `(${gfTaxLabel(tx.tax_rate)})` : ''}</td><td class="td-right">${fmt(tx.tax_amount)}</td></tr>
            ${isVoidTx(tx) && tx.void_reason ? `<tr><td>Void Reason</td><td>${posReceiptSafe(tx.void_reason)}</td></tr>` : ''}
          </tbody>
        </table>
        <div class="gf-modal-actions">
          <button class="btn-outline" onclick="closeGfModal()">Close</button>
          ${isVoidTx(tx) ? '' : `<button class="btn-outline" onclick="closeGfModal(); voidTransaction('${String(tx.id || '').replace(/'/g, "\\'")}')">Void Transaction</button>`}
        </div>
      </div>
    </div>`;
}

function clearPosRecordFilters() {
  const date = document.getElementById('pos-record-date');
  const fuel = document.getElementById('pos-record-fuel');
  const status = document.getElementById('pos-record-status');
  const search = document.getElementById('pos-record-search');
  if (date) date.value = '';
  if (fuel) fuel.value = '';
  if (status) status.value = '';
  if (search) search.value = '';
  renderPosRecordsFiltered();
}

async function refreshRecordsPosTransactions() {
  try {
    gfRecordTxCache = await API.txList({ branch_id: currentUser.branch_id, limit: 500 });
    renderPosRecordsFiltered();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function initVerification() {
  const page = 'page-verification';
  gfPageShell(page, 'Shift Verification & Calibration', 'Review Daily Shift Sales Records from POS before consolidation.', `<div class="gf-card">${loadingHTML}</div>`);
  try {
    const [pending, history, txs] = await Promise.all([
      API.shiftsPending(currentUser.branch_id),
      API.shiftsHistory(currentUser.branch_id),
      API.txList({ branch_id: currentUser.branch_id, limit: 100 }),
    ]);
    window.gfPendingShifts = pending;
    window.gfHistoryShifts = history;
    window.gfShiftTxs = txs;
    gfPageShell(page, 'Shift Verification & Calibration', 'Review Daily Shift Sales Records from POS before consolidation.',
      `<div class="gf-alert gf-alert-info"><strong>Data Flow Note:</strong><span>POS data is held in Pending state until verified here. Only Verified or Recalibrated records are used for Daily/Weekly Reports and Owner Analytics.</span></div>
       <div class="tab-bar">
         <button class="tab-btn active" onclick="switchTab(this,'cal-pending')">Pending Review <span class="badge badge-red">${pending.length}</span></button>
         <button class="tab-btn" onclick="switchTab(this,'cal-history')">Verification History</button>
       </div>
       <div class="tab-pane active" id="cal-pending">
         <div class="gf-card"><h3>Pending Shift Records</h3><p>Records waiting for manager verification.</p>
         <table><thead><tr><th>Record ID</th><th>Date & Shift</th><th>Cashier</th><th class="td-right">Total Sales</th><th>Status</th><th class="td-right">Action</th></tr></thead><tbody>
         ${pending.map((r, i) => `<tr><td>${r.id}</td><td><b>${r.date}</b><br><small>${r.shift}</small></td><td>${r.cashier_name || '-'}</td><td class="td-right">${fmt(r.total_sales)}</td><td><span class="badge badge-amber">Pending Verification</span></td><td class="td-right"><button class="btn-green btn-sm" onclick="openVerifyModal(${i})">Review & Verify</button></td></tr>`).join('') || '<tr><td colspan="6" class="td-center">No pending records</td></tr>'}
         </tbody></table></div>
       </div>
       <div class="tab-pane" id="cal-history">
         <div class="gf-card"><h3>Verification Logs</h3><p>History of approved and flagged shift records.</p>
         <table><thead><tr><th>Record ID</th><th>Date & Shift</th><th>Cashier</th><th class="td-right">Total Sales</th><th>Status</th><th class="td-right">Action</th></tr></thead><tbody>
         ${history.map((r, i) => `<tr><td>${r.id}</td><td><b>${r.date}</b><br><small>${r.shift}</small></td><td>${r.cashier_name || '-'}</td><td class="td-right">${fmt(r.total_sales)}</td><td><span class="badge ${r.status === 'Verified' ? 'badge-green' : 'badge-blue'}">${r.status}</span></td><td class="td-right"><button class="btn-outline btn-sm" onclick="openHistoryModal(${i})">View</button></td></tr>`).join('') || '<tr><td colspan="6" class="td-center">No verification history yet</td></tr>'}
         </tbody></table></div>
       </div>
       <div id="gf-modal-root"></div>`);
  } catch(e) { showToast(e.message, 'error'); }
}

function shiftTransactionsFor(record) {
  const day = record.date;
  return (window.gfShiftTxs || []).filter(t => !day || String(t.timestamp).slice(0, 10) === day);
}

function openVerifyModal(index) {
  const r = (window.gfPendingShifts || [])[index];
  if (!r) return;
  const txs = shiftTransactionsFor(r);
  document.getElementById('gf-modal-root').innerHTML = verifyModalHTML(r, txs, false);
}

function openHistoryModal(index) {
  const r = (window.gfHistoryShifts || [])[index];
  if (!r) return;
  const txs = shiftTransactionsFor(r);
  document.getElementById('gf-modal-root').innerHTML = verifyModalHTML(r, txs, true);
}

function verifyModalHTML(r, txs, history) {
  const summaryRows = allFuels.map(f => {
    const productTxs = txs.filter(t => t.fuel_type === f.id);
    return `<tr><td>${gfFuelName(f)}</td><td class="td-right">${productTxs.length}</td><td class="td-right">${fmtL(productTxs.reduce((a, t) => a + safeNum(t.liters), 0))}</td><td class="td-right">${fmt(productTxs.reduce((a, t) => a + safeNum(t.total_amount), 0))}</td></tr>`;
  }).join('');
  return `<div class="gf-modal-backdrop">
    <div class="gf-modal wide">
      <button class="gf-modal-x" onclick="closeGfModal()">×</button>
      <h2>${history ? 'Shift Record' : 'Verify Shift Record'} - ${r.id} <span class="badge ${r.status === 'Verified' ? 'badge-green' : 'badge-blue'}">${r.status}</span></h2>
      <p>Compare POS totals with expected values and assign a status.</p>
      <div class="gf-modal-grid">
        <div>
          <div class="tab-bar"><button class="tab-btn active" onclick="switchTab(this,'verify-summary')">Summary & Readings</button><button class="tab-btn" onclick="switchTab(this,'verify-tx')">Transaction Log</button></div>
          <div class="tab-pane active" id="verify-summary">
            <div class="gf-soft-box"><h3>POS Summary</h3><div class="gf-kv"><span>Cashier</span><b>${r.cashier_name || '-'}</b><span>Shift</span><b>${r.shift}</b><span>Total Sales</span><b>${fmt(r.total_sales)}</b><span>Total Volume</span><b>${fmtL(r.total_liters)}</b></div></div>
            ${r.cashier_note ? `<div class="gf-soft-box"><h3>Cashier Note / Explanation</h3><p>${gfEscape(r.cashier_note)}</p></div>` : ''}
            <div class="gf-card flat"><h3>Detailed Pump Readings</h3><table><thead><tr><th>Product</th><th class="td-right">Txns</th><th class="td-right">Volume</th><th class="td-right">Amount</th></tr></thead><tbody>${summaryRows}</tbody></table></div>
          </div>
          <div class="tab-pane" id="verify-tx"><table><thead><tr><th>Time</th><th>Product</th><th class="td-right">Liters</th><th class="td-right">Amount</th></tr></thead><tbody>${txs.slice(0, 12).map(t => `<tr><td>${new Date(t.timestamp).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</td><td>${t.fuel_name}</td><td class="td-right">${fmtL(t.liters)}</td><td class="td-right">${fmt(t.total_amount)}</td></tr>`).join('') || '<tr><td colspan="4" class="td-center">No transactions found</td></tr>'}</tbody></table></div>
        </div>
        <div>
          <h3>Verification Status</h3>
          <label class="gf-radio"><input type="radio" name="verify-status" value="Verified" checked><span><b>Verified</b><small>Data matches expected values.</small></span></label>
          <label class="gf-radio"><input type="radio" name="verify-status" value="Recalibrated"><span><b>Recalibrated</b><small>Minor variance adjusted via calibration.</small></span></label>
          <label class="gf-radio danger"><input type="radio" name="verify-status" value="Flagged"><span><b>Flag for Review</b><small>Hold record for audit.</small></span></label>
          <label class="gf-remarks">Manager Remarks<textarea id="verify-remarks" placeholder="Add notes about this verification...">${r.remarks || ''}</textarea></label>
        </div>
      </div>
      <div class="gf-modal-actions"><button class="btn-outline" onclick="closeGfModal()">Cancel</button>${history ? '<button class="btn-green" onclick="closeGfModal()">Close</button>' : `<button class="btn-green" onclick="confirmShiftVerify('${r.id}')">Confirm Verify</button>`}</div>
    </div>
  </div>`;
}

function closeGfModal() {
  const root = document.getElementById('gf-modal-root') || document.getElementById('gf-global-modal-root');
  if (root) root.innerHTML = '';
}

async function confirmShiftVerify(id) {
  const status = document.querySelector('input[name="verify-status"]:checked')?.value || 'Verified';
  const remarks = document.getElementById('verify-remarks')?.value || '';
  try {
    await API.shiftVerify(id, status, remarks);
    showToast(`Shift ${status.toLowerCase()}`);
    closeGfModal();
    initVerification();
  } catch(e) { showToast(e.message, 'error'); }
}

function initPOS() {
  gfShift = gfShift || 'Morning';
  const branch = currentUser.branch_name || 'Unknown Branch';
  document.getElementById('page-pos').innerHTML =
    `<div class="gf-pos">
      <div class="gf-pos-top">
        <div class="gf-pos-title"><span>⛽</span><div><h2>${branch}</h2><p>${gfDateLong()} · <select id="pos-shift-select" onchange="gfShift=this.value"><option ${gfShift==='Morning'?'selected':''}>Morning</option><option ${gfShift==='Afternoon'?'selected':''}>Afternoon</option><option ${gfShift==='Night'?'selected':''}>Night</option></select> · Cashier: ${currentUser.name}</p></div></div>
        <button class="gf-end-shift" onclick="openEndShiftModal()">↪ End Shift</button>
      </div>
      <div class="gf-pos-grid">
        <div class="gf-card gf-pos-sale">
          <h3>New Sale</h3>
          <div class="gf-pos-fuels" id="fuel-buttons"></div>
          <div class="gf-pos-entry">
            <span>Selected Product</span>
            <h3 id="pos-selected-name">${selectedFuel ? gfFuelName(selectedFuel) : 'Select fuel'}</h3>
            <label>Liters <input type="number" id="pos-liters" min="0.01" step="0.01" placeholder="0.00" oninput="calcPosTotal()"></label>
            <input type="hidden" id="pos-price" value="${selectedFuel ? selectedFuel.price : 0}">
            <input type="hidden" id="pos-customer" value="Walk-in">
            <div class="gf-pos-total-line"><span>Total Amount</span><b id="pos-total-display">₱0.00</b></div>
            <div id="pos-breakdown-text" class="gf-muted">Select fuel and enter liters</div>
            <span class="form-err" id="err-liters">Enter valid liters (> 0)</span>
            <button class="btn-pos-confirm" onclick="submitTransaction()">+ Add Sale</button>
          </div>
        </div>
        <div class="gf-card gf-pos-transactions">
          <div class="gf-card-head">
            <div><h3>Current Shift Transactions</h3></div>
            <div class="gf-pos-counters"><span id="today-count-badge">Count: 0</span><span id="pos-volume-badge">Volume: 0.00 L</span></div>
          </div>
          <div id="pos-recent-list"></div>
          <div class="gf-pos-grand"><span>Total Sales Amount</span><b id="pos-shift-total">₱0.00</b></div>
        </div>
      </div>
      <div id="gf-global-modal-root"></div>
    </div>`;
  if (!selectedFuel && allFuels[0]) selectedFuel = allFuels[0];
  renderFuelButtons();
  calcPosTotal();
  loadRecentTx();
}

function renderFuelButtons() {
  const wrap = document.getElementById('fuel-buttons');
  if (!wrap) return;
  wrap.innerHTML = allFuels.map(f => `
    <button class="gf-fuel-tile ${selectedFuel?.id === f.id ? 'selected' : ''}" onclick="selectPosFuel('${f.id}')">
      <strong>${gfFuelName(f)}</strong>
      <span>${fmt(f.price)}/L</span>
    </button>`).join('');
  const name = document.getElementById('pos-selected-name');
  if (name) name.textContent = selectedFuel ? gfFuelName(selectedFuel) : 'Select fuel';
}

function selectPosFuel(id) {
  selectedFuel = allFuels.find(f => f.id === id);
  const price = document.getElementById('pos-price');
  if (price && selectedFuel) price.value = safeNum(selectedFuel.price).toFixed(2);
  renderFuelButtons();
  calcPosTotal();
}

function calcPosTotal() {
  const liters = safeNum(document.getElementById('pos-liters')?.value);
  const price = safeNum(document.getElementById('pos-price')?.value || selectedFuel?.price);
  const total = liters * price;
  const display = document.getElementById('pos-total-display');
  const breakdown = document.getElementById('pos-breakdown-text');
  if (display) display.textContent = fmt(total);
  if (breakdown) breakdown.textContent = selectedFuel ? `${fmtL(liters)} × ${fmt(price)}/L` : 'Select fuel and enter liters';
}

async function submitTransaction() {
  const liters = safeNum(document.getElementById('pos-liters')?.value);
  const errL = document.getElementById('err-liters');
  if (errL) errL.style.display = 'none';
  if (!selectedFuel) { showToast('Select a fuel type first', 'error'); return; }
  if (!liters || liters <= 0) { if (errL) errL.style.display = 'block'; return; }
  const btn = document.querySelector('.btn-pos-confirm');
  btn.disabled = true; btn.textContent = 'Saving...';
  try {
    const res = await API.txCreate({
      branch_id: currentUser.branch_id,
      fuel_type: selectedFuel.id,
      liters,
      customer: 'Walk-in',
    });
    document.getElementById('pos-liters').value = '';
    calcPosTotal();
    showToast(`Sale added: ${fmt(res.total_amount)}`);
    loadRecentTx();
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false; btn.textContent = '+ Add Sale';
  }
}

async function loadRecentTx() {
  const wrap = document.getElementById('pos-recent-list');
  if (!wrap) return;
  wrap.innerHTML = loadingHTML;
  try {
    const txs = await API.txRecent(currentUser.branch_id, 50);
    const today = txs.filter(t => new Date(t.timestamp).toDateString() === new Date().toDateString());
    const active = today.filter(t => t.status !== 'flagged');
    const total = active.reduce((a, t) => a + safeNum(t.total_amount), 0);
    const volume = active.reduce((a, t) => a + safeNum(t.liters), 0);
    document.getElementById('today-count-badge').textContent = `Count: ${active.length}`;
    document.getElementById('pos-volume-badge').textContent = `Volume: ${fmtL(volume)}`;
    document.getElementById('pos-shift-total').textContent = fmt(total);
    if (!active.length) { wrap.innerHTML = '<div class="loading">No transactions this shift</div>'; return; }
    wrap.innerHTML = `<table><thead><tr><th>Time</th><th>Product</th><th class="td-right">Liters</th><th class="td-right">Price</th><th class="td-right">Amount</th><th></th></tr></thead><tbody>
      ${active.slice(0, 12).map(t => `<tr><td>${new Date(t.timestamp).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</td><td>${t.fuel_name}</td><td class="td-right">${safeNum(t.liters).toFixed(2)}</td><td class="td-right">${safeNum(t.price_per_liter).toFixed(2)}</td><td class="td-right"><b>${fmt(t.total_amount)}</b></td><td class="td-right">⌫</td></tr>`).join('')}
    </tbody></table>`;
  } catch(e) { wrap.innerHTML = `<div class="loading">${e.message}</div>`; }
}

async function openEndShiftModal() {
  try {
    const txs = await API.txRecent(currentUser.branch_id, 50);
    const today = txs.filter(t => new Date(t.timestamp).toDateString() === new Date().toDateString() && t.status !== 'flagged');
    const rows = allFuels.map(f => {
      const fuelTxs = today.filter(t => t.fuel_type === f.id);
      if (!fuelTxs.length) return '';
      return `<div class="gf-shift-row"><span>${gfFuelName(f)} (${fuelTxs.length} txns)</span><b>${fmtL(fuelTxs.reduce((a,t)=>a+safeNum(t.liters),0))}<br>${fmt(fuelTxs.reduce((a,t)=>a+safeNum(t.total_amount),0))}</b></div>`;
    }).join('');
    const total = today.reduce((a, t) => a + safeNum(t.total_amount), 0);
    const modalRoot = document.getElementById('gf-global-modal-root') || (() => {
      const el = document.createElement('div');
      el.id = 'gf-global-modal-root';
      document.body.appendChild(el);
      return el;
    })();
    modalRoot.innerHTML = `
      <div class="gf-modal-backdrop">
        <div class="gf-modal shift">
          <button class="gf-modal-x" onclick="closeGfModal()">×</button>
          <h2>Generate Daily Shift Sales Record</h2>
          <p>This will lock entries and generate a summary for verification.</p>
          <div class="gf-soft-box">
            <h3>Shift Summary - ${document.getElementById('pos-shift-select')?.value || gfShift}</h3>
            ${rows || '<p>No sales recorded.</p>'}
            <div class="gf-shift-total"><span>Total Sales</span><b>${fmt(total)}</b></div>
          </div>
          <div class="gf-alert gf-alert-warn"><strong>Action cannot be undone.</strong><span>Record will be marked as Pending Manager Verification.</span></div>
          <div class="gf-modal-actions"><button class="btn-outline" onclick="closeGfModal()">Cancel</button><button class="btn-green" onclick="submitShiftRecord()">Submit Record</button></div>
        </div>
      </div>`;
  } catch(e) { showToast(e.message, 'error'); }
}

async function submitShiftRecord() {
  try {
    await API.shiftOpen({ branch_id: currentUser.branch_id, shift: document.getElementById('pos-shift-select')?.value || gfShift });
    closeGfModal();
    showToast('Shift record submitted for manager verification.');
  } catch(e) { showToast(e.message, 'error'); }
}

function dailyRecordCell(value, fallback = '-') {
  const text = String(value ?? '').trim();
  return text ? gfEscape(text) : `<span class="gf-muted">${fallback}</span>`;
}

function dailyRecordFuelLabel(value) {
  const fuel = allFuels.find(f => String(f.id) === String(value));
  return fuel ? gfEscape(gfFuelName(fuel)) : dailyRecordCell(value);
}

function dailyRecordMetric(label, value, tone = '') {
  return `<div class="daily-record-metric ${tone}"><span>${label}</span><strong>${value}</strong></div>`;
}

function showDailyEntryDetail(index) {
  const entry = dailyEntryCache[index];
  const activePage = document.querySelector('.page.active');
  const target = activePage?.querySelector('#branch-daily-entry-detail, #daily-entry-detail, #daily-entry-workspace')
    || document.getElementById('daily-entry-detail')
    || document.getElementById('daily-entry-workspace');
  if (!entry || !target) return;
  const p = entry.payload || {};
  const invRows = dailyInventoryDisplayRows(p);
  const pumpTotal = type => [1,2,3,4].reduce((a,n)=>a+safeNum(p[`${type}__pump${n}__amount`]),0);
  const pumpTable = type => `
    <div class="daily-table-wrap">
      <table class="daily-sheet-table daily-review-table">
        <thead><tr><th>Pump</th><th>Product</th><th>Beginning</th><th>Ending</th><th>Consumed (L)</th><th>Price</th><th>Amount</th></tr></thead>
        <tbody>${[1,2,3,4].map(n => `<tr>
          <td>${n}</td>
          <td class="td-left">${dailyRecordFuelLabel(p[`${type}__pump${n}__product`])}</td>
          <td>${dailyRecordCell(p[`${type}__pump${n}__beginning`])}</td>
          <td>${dailyRecordCell(p[`${type}__pump${n}__ending`])}</td>
          <td>${dailyRecordCell(p[`${type}__pump${n}__consumed`])}</td>
          <td>${fmt(p[`${type}__pump${n}__price`])}</td>
          <td class="td-right">${fmt(p[`${type}__pump${n}__amount`])}</td>
        </tr>`).join('')}</tbody>
        <tfoot><tr><td colspan="6">Total Sales</td><td class="daily-total-cell">${fmt(pumpTotal(type))}</td></tr></tfoot>
      </table>
    </div>`;
  const cashRows = DAILY_DENOMS.map((d, i) => {
    const count = safeNum(p[`cash__count__${i}`]);
    return count ? `<tr><td class="td-left">${gfEscape(denomLabel(d[0]))}</td><td>${count}</td><td class="td-right">${fmt(count * d[0])}</td></tr>` : '';
  }).join('');
  const expenseRows = Array.from({ length: 8 }, (_, i) => p[`expense__${i}__description`] || safeNum(p[`expense__${i}__amount`]) ? `<tr><td class="td-left">${dailyRecordCell(p[`expense__${i}__description`])}</td><td>${dailyRecordCell(p[`expense__${i}__liters`])}</td><td class="td-right">${fmt(p[`expense__${i}__amount`])}</td></tr>` : '').join('');
  const entryRef = dailyEntryDisplayId(entry);
  const entryIndex = dailyEntryCache.indexOf(entry);
  const overShort = safeNum(entry.over_short);
  const status = entry.status || 'submitted';
  const statusBadge = status === 'reviewed' ? 'badge-green' : 'badge-amber';
  const branchName = entry.branch_name || currentUser.branch_name || 'GreenFuel Branch';
  const isBranchPage = activePage?.id === 'page-branches';
  const canEditEntry = currentUser?.role === 'manager';
  const backAction = isBranchPage
    ? 'showBranchDetail(gfSelectedBranch)'
    : 'initRecords()';

  target.innerHTML = `
    <div class="gf-record-view">
      <div class="gf-record-toolbar">
        <button class="btn-outline btn-sm" onclick="${backAction}">Back</button>
        <div class="gf-record-actions">
          ${canEditEntry ? `<button class="btn-green btn-sm" onclick="editDailyEntry(${entryIndex})">Edit Record</button>` : ''}
          <button class="btn-outline btn-sm" onclick="window.print()">Print Record</button>
        </div>
      </div>

      <section class="daily-record-document">
        <div class="daily-record-head">
          <img class="daily-record-logo" src="assets/greenfuel-logo.svg?v=20260526-logo-crop" alt="GreenFuel Fuel Safe logo">
          <div>
            <div class="daily-record-kicker">Official Daily Sales Record Form</div>
            <h1>Daily Sales Record</h1>
            <p>${gfEscape(entryRef)} · ${dailyRecordCell(entry.entry_date)} · ${gfEscape(branchName)}</p>
          </div>
          <span class="badge ${statusBadge}">${gfEscape(status)}</span>
        </div>

        <div class="daily-record-meta">
          <div><span>Date</span><strong>${dailyRecordCell(entry.entry_date)}</strong></div>
          <div><span>Time In</span><strong>${dailyRecordCell(entry.time_in)}</strong></div>
          <div><span>Time Out</span><strong>${dailyRecordCell(entry.time_out)}</strong></div>
          <div><span>Shift</span><strong>${dailyRecordCell(entry.shift)}</strong></div>
          <div><span>Duty Personnel</span><strong>${dailyRecordCell(entry.duty_personnel)}</strong></div>
        </div>
      </section>

      <section class="daily-form-card">
        <div class="daily-section-title">Inventory Stocks (Dip-Stick)</div>
        <div class="daily-table-wrap">
          <table class="daily-sheet-table daily-review-table daily-inventory-table">
            ${dailyInventoryHeader()}
            <tbody>${invRows}</tbody>
          </table>
        </div>
      </section>

      <div class="daily-record-reading-grid">
        <section class="daily-form-card"><div class="daily-section-title">Pump Digital Reading</div>${pumpTable('digital')}</section>
        <section class="daily-form-card"><div class="daily-section-title">Pump Mechanical Reading</div>${pumpTable('mechanical')}</section>
      </div>

      <div class="daily-record-lower-grid">
        <section class="daily-form-card">
          <div class="daily-section-title">Cash Count</div>
          <table class="daily-sheet-table daily-review-table"><thead><tr><th>Denom</th><th>Count</th><th>Amount</th></tr></thead><tbody>${cashRows || '<tr><td colspan="3" class="td-center">No cash count recorded</td></tr>'}</tbody><tfoot><tr><td colspan="2">Total Cash Remitted</td><td class="daily-total-cell">${fmt(entry.actual_cash_remitted)}</td></tr></tfoot></table>
        </section>
        <section class="daily-form-card">
          <div class="daily-section-title">Expenses Summary</div>
          <table class="daily-sheet-table daily-review-table"><thead><tr><th>Description</th><th>Liters</th><th>Amount</th></tr></thead><tbody>${expenseRows || '<tr><td colspan="3" class="td-center">No expenses recorded</td></tr>'}</tbody><tfoot><tr><td colspan="2">Total Expenses</td><td class="daily-total-cell">${fmt(entry.total_expenses)}</td></tr></tfoot></table>
        </section>
      </div>

      <section class="daily-record-summary">
        ${dailyRecordMetric('Total Cash Expected', fmt(entry.total_cash_expected))}
        ${dailyRecordMetric('Less Expenses', fmt(entry.total_expenses), 'danger')}
        ${dailyRecordMetric('Actual Cash Remitted', fmt(entry.actual_cash_remitted))}
        ${dailyRecordMetric(overShort < 0 ? 'Short' : 'Over', `${overShort < 0 ? '-' : '+'}${fmt(Math.abs(overShort))}`, overShort < 0 ? 'danger' : 'success')}
      </section>

      <div class="daily-record-lower-grid">
        <section class="daily-form-card">
          <div class="daily-section-title">Shift Note / Accident</div>
          <div class="daily-note-box">${gfEscape(p.shift_note || 'No note provided.')}</div>
        </section>
        <section class="daily-form-card">
          <div class="daily-section-title">Verification Lines</div>
          <div class="daily-sign-list">
            <div><span>Prepared By</span><strong>${dailyRecordCell(p.prepared_by || entry.submitted_by_name)}</strong></div>
            <div><span>Validated By</span><strong>${dailyRecordCell(p.validated_by)}</strong></div>
            <div><span>Audited By</span><strong>${dailyRecordCell(p.audited_by)}</strong></div>
          </div>
        </section>
      </div>
    </div>`;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ============================================================
// FUEL SIGHT CASHIER + DAILY CASH AUTOMATION OVERRIDES
// ============================================================
async function initFuelSightPOS() {
  const branch = currentUser.branch_name || 'Unknown Branch';
  const page = document.getElementById('page-pos');
  if (!page) return;
  try {
    const [fuels, denoms, shift, settings] = await Promise.all([
      API.fuels().catch(() => allFuels),
      API.denominations().catch(() => []),
      API.shiftCurrent().catch(() => null),
      API.settings().catch(() => ({})),
    ]);
    if (fuels && fuels.length) {
      allFuels = fuels;
      selectedFuel = allFuels.find(f => f.id === selectedFuel?.id) || allFuels[0];
    }
    gfDenoms = denoms.length ? denoms : [
      { value: 1000, label: '₱1000' }, { value: 500, label: '₱500' },
      { value: 200, label: '₱200' }, { value: 100, label: '₱100' },
      { value: 50, label: '₱50' }, { value: 20, label: '₱20' },
      { value: 10, label: '₱10' }, { value: 5, label: '₱5' }, { value: 1, label: '₱1' },
    ];
    gfActiveShift = shift || null;
    gfPosTaxRate = safeNum(settings?.pos_vat_rate || 12) || 12;
  } catch(e) {
    gfDenoms = [];
    gfActiveShift = null;
    gfPosTaxRate = 12;
  }
  if (!selectedFuel && allFuels.length) selectedFuel = allFuels[0];
  const shiftOpen = !!gfActiveShift;
  const started = gfActiveShift?.start_time ? fmtDT(gfActiveShift.start_time) : 'Not started';
  page.innerHTML = `
    <div class="gf-pos">
      <div class="gf-pos-top">
        <div class="gf-pos-title"><span>⛽</span><div><h2>${branch}</h2><p>${gfDateLong()} · Cashier: ${currentUser.name || 'Cashier'} · VAT ${gfTaxLabel(gfPosTaxRate)} included · ${shiftOpen ? `Started ${started}` : 'No active shift'}</p></div></div>
        <div class="gf-shift-actions">
          <button class="btn-green" onclick="startCashierShift()" ${shiftOpen ? 'disabled' : ''}>Start Shift</button>
          <button class="gf-end-shift" onclick="openEndShiftModal()" ${shiftOpen ? '' : 'disabled'}>End Shift</button>
        </div>
      </div>
      <div class="gf-pos-grid">
        <div class="gf-card gf-pos-sale">
          <h3>New Sale</h3>
          <div class="gf-pos-fuels" id="pos-fuels"></div>
          <div class="gf-pos-entry">
            <span>Selected Product</span>
            <h3 id="pos-selected-name">${selectedFuel ? gfFuelName(selectedFuel) : 'Select fuel'}</h3>
            <label>Liters <input type="number" id="pos-liters" min="0.01" step="0.01" placeholder="0.00" oninput="calcPosTotal()"></label>
            <label>Customer Cash Given <input type="number" id="pos-cash-paid" min="0" step="0.01" placeholder="0.00" oninput="calcPosTotal()"></label>
            <div class="gf-pos-facts">
              <div><span>Price/L</span><b id="pos-price-display">₱0.00</b></div>
              <div><span>VATable Sale</span><b id="pos-subtotal-display">₱0.00</b></div>
              <div><span>VAT (${gfTaxLabel(gfPosTaxRate)})</span><b id="pos-tax-display">₱0.00</b></div>
              <div><span>Amount Due</span><b id="pos-amount-display">₱0.00</b></div>
              <div><span>Cash Given</span><b id="pos-cash-display">₱0.00</b></div>
              <div><span>Change</span><b id="pos-change-display">₱0.00</b></div>
            </div>
            <input type="hidden" id="pos-price">
            <input type="hidden" id="pos-customer" value="Walk-in">
            <div class="gf-pos-total-line"><span>Total (incl. VAT)</span><b id="pos-total-display">₱0.00</b></div>
            <button class="btn-green full" id="pos-submit-btn" onclick="submitTransaction()" ${shiftOpen ? '' : 'disabled'}>Add Sale</button>
          </div>
        </div>
        <div class="gf-pos-denom-column">
          <div class="gf-card gf-denom-panel gf-denom-cash">
            <div class="gf-card-head"><div><h3>Cash Received</h3><p>Money handed by the customer.</p></div></div>
            <div class="gf-denom-grid">
              ${renderPosDenomButtons('cash')}
            </div>
          </div>
          <div class="gf-card gf-denom-panel gf-denom-change">
            <div class="gf-card-head"><div><h3>Change Given</h3><p>Record bills/coins handed back to the buyer.</p></div></div>
            <div class="gf-change-summary">
              <span><small>Due</small><b id="pos-change-due-display">₱0.00</b></span>
              <span><small>Recorded</small><b id="pos-change-recorded-display">₱0.00</b></span>
              <span><small>Balance</small><b id="pos-change-balance-display">₱0.00</b></span>
            </div>
            <div class="gf-denom-grid">
              ${renderPosDenomButtons('change')}
            </div>
          </div>
        </div>
        <div class="gf-card gf-pos-log">
          <div class="gf-card-head">
            <div><h3>Current Shift Transactions</h3><p>Completed transactions stay in the log; voided rows are preserved.</p></div>
            <div class="gf-pos-counters"><span id="today-count-badge">Count: 0</span><span id="pos-volume-badge">Volume: 0.00L</span><span id="pos-tax-total-badge">VAT: ₱0.00</span></div>
          </div>
          <div id="pos-recent-list" class="tbl-wrap">${loadingHTML}</div>
          <div class="gf-pos-grand"><span>Total Sales Amount</span><b id="pos-shift-total">₱0.00</b></div>
        </div>
      </div>
    </div>`;
  renderFuelButtons();
  calcPosTotal();
  loadRecentTx();
}

function renderFuelButtons() {
  const wrap = document.getElementById('pos-fuels');
  if (!wrap) return;
  wrap.innerHTML = allFuels.map(f => `
    <button class="gf-fuel-tile ${selectedFuel?.id === f.id ? 'selected' : ''}" onclick="selectPosFuel('${f.id}')">
      <strong>${gfFuelName(f)}</strong>
      <span>${fmt(f.price)}/L</span>
    </button>`).join('');
  const name = document.getElementById('pos-selected-name');
  if (name) name.textContent = selectedFuel ? gfFuelName(selectedFuel) : 'Select fuel';
}

function selectPosFuel(id) {
  selectedFuel = allFuels.find(f => f.id === id) || selectedFuel;
  renderFuelButtons();
  calcPosTotal();
}

function renderPosDenomButtons(group = 'cash') {
  return gfDenoms.map(d => {
    const value = safeNum(d.value);
    const label = denomLabel(value);
    return `<div class="gf-denom-btn" role="button" tabindex="0" data-denom-group="${group}" data-denom-value="${value}" data-denom-count="0" onclick="addPosDenom(${value}, '${group}')" onkeydown="handlePosDenomKey(event, ${value}, '${group}')"><span class="gf-denom-value">${label}</span><span class="gf-denom-bottom"><span class="gf-denom-count">x0</span><button type="button" class="gf-denom-minus" onclick="removePosDenom(event, ${value}, '${group}')" aria-label="Remove one ${label}">−</button></span></div>`;
  }).join('');
}

function getPosDenomBreakdown(group = 'cash') {
  const breakdown = {};
  document.querySelectorAll(`#page-pos .gf-denom-btn[data-denom-group="${group}"][data-denom-value]`).forEach(btn => {
    const qty = Math.max(0, parseInt(btn.dataset.denomCount || '0', 10) || 0);
    if (qty > 0) breakdown[String(safeNum(btn.dataset.denomValue))] = qty;
  });
  return breakdown;
}

function getPosCashBreakdown() {
  return getPosDenomBreakdown('cash');
}

function getPosChangeBreakdown() {
  return getPosDenomBreakdown('change');
}

function getPosDenomBreakdownTotal(group = 'cash') {
  return Object.entries(getPosDenomBreakdown(group)).reduce((sum, [value, qty]) => sum + safeNum(value) * safeNum(qty), 0);
}

function getPosCashBreakdownTotal() {
  return getPosDenomBreakdownTotal('cash');
}

function getPosChangeBreakdownTotal() {
  return getPosDenomBreakdownTotal('change');
}

function updatePosDenomButton(btn, count) {
  btn.dataset.denomCount = String(count);
  btn.classList.toggle('has-count', count > 0);
  const countEl = btn.querySelector('.gf-denom-count');
  if (countEl) countEl.textContent = `x${count}`;
}

function addPosDenom(value, group = 'cash') {
  const denomValue = safeNum(value);
  const btn = Array.from(document.querySelectorAll(`#page-pos .gf-denom-btn[data-denom-group="${group}"][data-denom-value]`))
    .find(el => safeNum(el.dataset.denomValue) === denomValue);
  const cashInput = document.getElementById('pos-cash-paid');
  if (!btn) return;
  const count = (parseInt(btn.dataset.denomCount || '0', 10) || 0) + 1;
  updatePosDenomButton(btn, count);
  if (group === 'cash' && cashInput) {
    cashInput.value = (safeNum(cashInput.value) + denomValue).toFixed(2);
  }
  calcPosTotal();
}

function removePosDenom(event, value, group = 'cash') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const denomValue = safeNum(value);
  const btn = Array.from(document.querySelectorAll(`#page-pos .gf-denom-btn[data-denom-group="${group}"][data-denom-value]`))
    .find(el => safeNum(el.dataset.denomValue) === denomValue);
  const cashInput = document.getElementById('pos-cash-paid');
  if (!btn) return;
  const count = Math.max(0, (parseInt(btn.dataset.denomCount || '0', 10) || 0) - 1);
  updatePosDenomButton(btn, count);
  if (group === 'cash' && cashInput) {
    cashInput.value = Math.max(0, safeNum(cashInput.value) - denomValue).toFixed(2);
  }
  calcPosTotal();
}

function handlePosDenomKey(event, value, group = 'cash') {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  addPosDenom(value, group);
}

function resetPosDenoms(group = '') {
  const selector = group
    ? `#page-pos .gf-denom-btn[data-denom-group="${group}"][data-denom-value]`
    : '#page-pos .gf-denom-btn[data-denom-value]';
  document.querySelectorAll(selector).forEach(btn => {
    updatePosDenomButton(btn, 0);
  });
}

function calcPosTotal() {
  const liters = safeNum(document.getElementById('pos-liters')?.value);
  const price = safeNum(selectedFuel?.price);
  const total = price > 0 && liters > 0 ? liters * price : 0;
  const taxRate = Math.max(0, safeNum(gfPosTaxRate));
  const subtotal = taxRate > 0 ? total / (1 + (taxRate / 100)) : total;
  const taxAmount = total - subtotal;
  const amountDue = total;
  const cash = safeNum(document.getElementById('pos-cash-paid')?.value);
  const change = cash - amountDue;
  const changeDue = Math.max(0, change);
  const changeRecorded = getPosChangeBreakdownTotal();
  const changeBalance = Math.max(0, changeDue - changeRecorded);
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('pos-price-display', fmt(price));
  setText('pos-subtotal-display', fmt(subtotal));
  setText('pos-tax-display', fmt(taxAmount));
  setText('pos-amount-display', fmt(amountDue));
  setText('pos-cash-display', fmt(cash));
  setText('pos-change-display', fmt(change));
  setText('pos-change-due-display', fmt(changeDue));
  setText('pos-change-recorded-display', fmt(changeRecorded));
  setText('pos-change-balance-display', fmt(changeBalance));
  setText('pos-total-display', fmt(amountDue));
  const priceInput = document.getElementById('pos-price');
  if (priceInput) priceInput.value = price.toFixed(2);
  const changeEl = document.getElementById('pos-change-display');
  if (changeEl) changeEl.classList.toggle('negative', change < 0);
  document.getElementById('pos-change-balance-display')?.classList.toggle('negative', changeBalance > 0.01);
}

function posReceiptSafe(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[ch]));
}

function posTxActionId(id) {
  return String(id ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
}

function posTxIsVoid(tx) {
  return String(tx?.status || '').toLowerCase() === 'void';
}

function renderPosTransactionCard(t) {
  const isVoid = posTxIsVoid(t);
  const statusText = isVoid ? 'VOID' : 'ACTIVE';
  const txId = posTxActionId(t.id);
  const time = new Date(t.timestamp).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  const product = t.fuel_name || t.fuel_type || 'Fuel';
  const changeRecorded = safeNum(t.change_recorded || t.change_amount);
  const drawerNet = safeNum(t.cash_received) - changeRecorded;
  return `
    <div class="gf-tx-card ${isVoid ? 'void-row' : ''}">
      <div class="gf-tx-head">
        <div><b>${posReceiptSafe(product)}</b><span>${time} · ${posReceiptSafe(t.id || 'Transaction')}</span></div>
        <span class="badge ${isVoid ? 'badge-red' : 'badge-green'}">${statusText}</span>
      </div>
      <div class="gf-tx-metrics">
        <span><small>Amount</small><b>${fmt(t.total_amount || t.amount_paid)}</b></span>
        <span><small>Liters</small><b>${safeNum(t.liters).toFixed(2)} L</b></span>
        <span><small>Cash</small><b>${fmt(t.cash_received)}</b></span>
        <span><small>Change Given</small><b>${fmt(changeRecorded)}</b></span>
        <span><small>Drawer Net</small><b>${fmt(drawerNet)}</b></span>
      </div>
      <div class="gf-tx-actions">
        <button class="btn-outline btn-sm" onclick="printReceipt('${txId}')">Print Receipt</button>
        ${isVoid ? '' : `<button class="btn-outline btn-sm" onclick="voidTransaction('${txId}')">Void</button>`}
      </div>
    </div>`;
}

function printReceipt(txId) {
  const tx = (window.gfPosReceiptTxs || []).find(item => String(item.id) === String(txId));
  if (!tx) { showToast('Receipt data was not found. Refresh the POS and try again.', 'error'); return; }
  const product = tx.fuel_name || tx.fuel_type || 'Fuel';
  const branch = currentUser?.branch_name || 'GreenFuel Branch';
  const cashier = currentUser?.name || tx.cashier_name || 'Cashier';
  const changeGiven = safeNum(tx.change_recorded || tx.change_amount);
  const drawerNet = safeNum(tx.cash_received) - changeGiven;
  const printedAt = new Date().toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  const soldAt = new Date(tx.timestamp || Date.now()).toLocaleString('en-PH', { dateStyle: 'medium', timeStyle: 'short' });
  const logoSrc = `${window.location.origin}${window.location.pathname.replace(/\/[^/]*$/, '/')}assets/greenfuel-logo.svg?v=20260526-logo-crop`;
  const receipt = window.open('', '_blank', 'width=380,height=640');
  if (!receipt) { showToast('Allow popups to print the receipt.', 'error'); return; }
  receipt.document.write(`<!doctype html>
<html><head><meta charset="UTF-8"><title>Receipt ${posReceiptSafe(tx.id || '')}</title>
<style>
body{margin:0;background:#f3f4f6;font-family:Arial,sans-serif;color:#111827}.receipt{width:320px;margin:18px auto;background:white;padding:18px;border:1px solid #d1d5db}.brand{text-align:center;border-bottom:1px dashed #9ca3af;padding-bottom:12px}.brand img{width:70px;height:70px;object-fit:contain;margin-bottom:4px}.brand h1{font-size:18px;margin:0;color:#0f7a3c}.brand p{font-size:11px;margin:4px 0 0;color:#6b7280}.meta{font-size:11px;color:#4b5563;margin:12px 0;line-height:1.55}.row{display:flex;justify-content:space-between;gap:16px;font-size:13px;margin:8px 0}.row strong{font-size:14px}.total{border-top:1px dashed #9ca3af;border-bottom:1px dashed #9ca3af;padding:10px 0;margin:12px 0}.total strong{font-size:18px}.foot{text-align:center;font-size:11px;color:#6b7280;margin-top:14px}@media print{body{background:white}.receipt{margin:0 auto;border:0}}
</style></head><body>
<div class="receipt">
  <div class="brand"><img src="${posReceiptSafe(logoSrc)}" alt="GreenFuel logo"><h1>GreenFuel</h1><p>Official Fuel Sales Receipt</p></div>
  <div class="meta">
    Transaction: ${posReceiptSafe(tx.id || '-')}<br>
    Branch: ${posReceiptSafe(branch)}<br>
    Cashier: ${posReceiptSafe(cashier)}<br>
    Sold: ${posReceiptSafe(soldAt)}<br>
    Printed: ${posReceiptSafe(printedAt)}
  </div>
  <div class="row"><span>Fuel Type</span><strong>${posReceiptSafe(product)}</strong></div>
  <div class="row"><span>Price/L</span><strong>${fmt(tx.price_per_liter)}</strong></div>
  <div class="row"><span>Liters</span><strong>${safeNum(tx.liters).toFixed(2)} L</strong></div>
  <div class="row total"><span>Total (incl. VAT)</span><strong>${fmt(tx.total_amount || tx.amount_paid)}</strong></div>
  <div class="row"><span>VATable Sale</span><strong>${fmt(tx.subtotal_amount || ((safeNum(tx.total_amount) || safeNum(tx.amount_paid)) - safeNum(tx.tax_amount)))}</strong></div>
  <div class="row"><span>VAT Amount ${safeNum(tx.tax_rate) ? `(${gfTaxLabel(tx.tax_rate)})` : ''}</span><strong>${fmt(tx.tax_amount)}</strong></div>
  <div class="row"><span>Cash Given</span><strong>${fmt(tx.cash_received)}</strong></div>
  <div class="row"><span>Change Given</span><strong>${fmt(changeGiven)}</strong></div>
  <div class="row"><span>Drawer Net</span><strong>${fmt(drawerNet)}</strong></div>
  <div class="row"><span>Status</span><strong>${posTxIsVoid(tx) ? 'VOID' : 'PAID'}</strong></div>
  <div class="foot">Thank you for choosing GreenFuel.</div>
</div>
</body></html>`);
  receipt.document.close();
  receipt.focus();
  setTimeout(() => receipt.print(), 250);
}

async function submitTransaction() {
  const btn = document.getElementById('pos-submit-btn');
  if (!gfActiveShift) { showToast('Start a shift before processing a sale.', 'error'); return; }
  if (!selectedFuel) { showToast('Select a fuel type first.', 'error'); return; }
  const liters = safeNum(document.getElementById('pos-liters')?.value);
  const total = Math.round(liters * safeNum(selectedFuel?.price) * 100) / 100;
  const taxRate = Math.max(0, safeNum(gfPosTaxRate));
  const subtotal = Math.round((taxRate > 0 ? total / (1 + (taxRate / 100)) : total) * 100) / 100;
  const taxAmount = Math.round((total - subtotal) * 100) / 100;
  const amountDue = total;
  const cashReceived = safeNum(document.getElementById('pos-cash-paid')?.value);
  const changeDue = Math.round(Math.max(0, cashReceived - amountDue) * 100) / 100;
  const changeRecorded = Math.round(getPosChangeBreakdownTotal() * 100) / 100;
  if (liters <= 0) { showToast('Enter liters purchased by the customer.', 'error'); return; }
  if (cashReceived < amountDue) { showToast('Amount paid is less than the amount due.', 'error'); return; }
  if (changeRecorded - changeDue > 0.01) {
    showToast('Recorded change is greater than the change due.', 'error');
    return;
  }
  if (changeDue > 0.01 && Math.abs(changeRecorded - changeDue) > 0.01) {
    const proceed = confirm(`Change due is ${fmt(changeDue)}, but recorded change is ${fmt(changeRecorded)}. Continue anyway?`);
    if (!proceed) return;
  }
  try {
    btn.disabled = true;
    btn.textContent = 'Saving...';
    await API.txCreate({
      branch_id: currentUser.branch_id,
      fuel_type: selectedFuel.id,
      liters,
      amount_paid: amountDue,
      cash_received: cashReceived,
      cash_breakdown: getPosCashBreakdown(),
      change_breakdown: getPosChangeBreakdown(),
      customer: document.getElementById('pos-customer')?.value || 'Walk-in',
    });
    document.getElementById('pos-liters').value = '';
    document.getElementById('pos-cash-paid').value = '';
    resetPosDenoms();
    calcPosTotal();
    await loadRecentTx();
    showToast('Transaction saved.');
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Add Sale';
  }
}

async function loadRecentTx() {
  const wrap = document.getElementById('pos-recent-list');
  if (!wrap) return;
  wrap.innerHTML = loadingHTML;
  try {
    const txs = await API.txRecent(currentUser.branch_id, 50);
    const today = txs.filter(t => new Date(t.timestamp).toDateString() === new Date().toDateString());
    const active = today.filter(t => t.status !== 'void' && t.status !== 'flagged');
    const total = active.reduce((a, t) => a + safeNum(t.total_amount), 0);
    const tax = active.reduce((a, t) => a + safeNum(t.tax_amount), 0);
    const volume = active.reduce((a, t) => a + safeNum(t.liters), 0);
    document.getElementById('today-count-badge').textContent = `Count: ${active.length}`;
    document.getElementById('pos-volume-badge').textContent = `Volume: ${fmtL(volume)}`;
    const taxBadge = document.getElementById('pos-tax-total-badge');
    if (taxBadge) taxBadge.textContent = `VAT: ${fmt(tax)}`;
    document.getElementById('pos-shift-total').textContent = fmt(total);
    window.gfPosReceiptTxs = today;
    if (!today.length) {
      wrap.innerHTML = '<div class="loading">No transactions recorded yet</div>';
      return;
    }
    wrap.innerHTML = `<div class="gf-tx-list">${today.slice(0, 14).map(renderPosTransactionCard).join('')}</div>`;
  } catch(e) {
    wrap.innerHTML = `<div class="loading">${e.message}</div>`;
  }
}

async function voidTransaction(txId) {
  const reason = prompt('Reason for voiding this transaction:');
  if (reason === null) return;
  if (!reason.trim()) { showToast('Void reason is required.', 'error'); return; }
  if (!confirm('Void this completed transaction? The record will stay in the logs.')) return;
  try {
    await API.txVoid(txId, reason.trim());
    if (document.getElementById('records-pos-table')) {
      await refreshRecordsPosTransactions();
    } else {
      await loadRecentTx();
    }
    showToast('Transaction marked as void.');
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function startCashierShift() {
  try {
    gfActiveShift = await API.shiftStart();
    showToast('Shift started.');
    await initFuelSightPOS();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function openEndShiftModal() {
  if (!gfActiveShift) { showToast('No active shift to end.', 'error'); return; }
  try {
    const txs = await API.txRecent(currentUser.branch_id, 50);
    const sessionId = String(gfActiveShift.id || '');
    const current = txs.filter(t => {
      const sameSession = sessionId && String(t.shift_session_id || '') === sessionId;
      const todayNoSession = !sessionId && new Date(t.timestamp).toDateString() === new Date().toDateString();
      return (sameSession || todayNoSession) && t.status !== 'void' && t.status !== 'flagged';
    });
    const rows = allFuels.map(f => {
      const fuelTxs = current.filter(t => t.fuel_type === f.id);
      if (!fuelTxs.length) return '';
      return `<div class="gf-shift-row"><span>${gfFuelName(f)} (${fuelTxs.length} txns)</span><b>${fmtL(fuelTxs.reduce((a,t)=>a+safeNum(t.liters),0))}<br>${fmt(fuelTxs.reduce((a,t)=>a+safeNum(t.total_amount),0))}</b></div>`;
    }).join('');
    const total = current.reduce((a, t) => a + safeNum(t.total_amount), 0);
    const modalRoot = document.getElementById('gf-global-modal-root') || (() => {
      const el = document.createElement('div');
      el.id = 'gf-global-modal-root';
      document.body.appendChild(el);
      return el;
    })();
    modalRoot.innerHTML = `
      <div class="gf-modal-backdrop">
        <div class="gf-modal shift">
          <button class="gf-modal-x" onclick="closeGfModal()">×</button>
          <h2>Generate Daily Shift Sales Record</h2>
          <p>This will close the active shift and send the summary for manager verification.</p>
          <div class="gf-soft-box">
            <h3>Shift Summary</h3>
            <div class="gf-shift-row"><span>Started</span><b>${fmtDT(gfActiveShift.start_time)}</b></div>
            ${rows || '<p>No sales recorded.</p>'}
            <div class="gf-shift-total"><span>Total Sales</span><b>${fmt(total)}</b></div>
          </div>
          <div class="gf-alert gf-alert-warn"><strong>Action cannot be undone.</strong><span>Record will be marked as Pending Manager Verification.</span></div>
          <div class="gf-modal-actions"><button class="btn-outline" onclick="closeGfModal()">Cancel</button><button class="btn-green" onclick="submitShiftRecord()">Submit Record</button></div>
        </div>
      </div>`;
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function submitShiftRecord() {
  try {
    await API.shiftEnd();
    gfActiveShift = null;
    closeGfModal();
    showToast('Shift record submitted for manager verification.');
    await initFuelSightPOS();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function renderDailyEntryManager(date = gfToday()) {
  date = date || gfToday();
  const branch = currentUser.branch_name || 'Branch';
  const editing = dailyEntryEditing;
  const isEditing = !!editing;
  const displayId = isEditing ? dailyEntryDisplayId(editing) : '';
  document.getElementById('daily-entry-sub').textContent = isEditing
    ? `Editing ${displayId} for ${branch}`
    : `${branch} daily manager report`;
  const mark = document.getElementById('daily-entry-date-mark');
  if (mark) mark.textContent = isEditing ? `Editing ${displayId}` : new Date(date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  const wrap = document.getElementById('daily-entry-workspace');
  wrap.innerHTML = `<div class="daily-form-card">${loadingHTML}</div>`;
  let cashSummary = null;
  try {
    cashSummary = await API.dailyCashSummary({ date });
  } catch(e) {
    cashSummary = emptyDailyCashSummary(date);
  }
  try {
    allFuels = await API.fuels();
  } catch(e) {}
  const totals = cashSummary.totals || {};
  const countedCash = safeNum(totals.denomination_cash ?? totals.cash_received);
  const actualRemitted = countedCash;
  const denomRows = renderDailyCashRows(cashSummary);
  const fuels = allFuels.length ? allFuels : [];
  const pumpProducts = ['unleaded', 'diesel', 'premium', 'diesel'];
  const pumpRows = [1, 2, 3, 4].map((n, i) => ({ n, product: pumpProducts[i], price: fuels.find(f => f.id === pumpProducts[i])?.price || 0 }));
  wrap.innerHTML = `
    <form id="daily-entry-form" class="daily-entry-form" data-auto-cash="1" data-actual-cash="${actualRemitted.toFixed(2)}" data-editing-id="${isEditing ? editing.id : ''}">
      ${isEditing ? `<div class="daily-edit-banner"><div><strong>Editing Daily Entry ${displayId}</strong><span>Changes will update the existing submitted record instead of creating a duplicate.</span></div><button type="button" class="btn-outline btn-sm" onclick="cancelDailyEntryEdit()">Cancel Edit</button></div>` : ''}
      <div class="daily-form-card daily-header-card">
        <div class="daily-brand-block">
          <div class="daily-station-name">FuelSight ${branch}</div>
          <div class="daily-form-name">Official Daily Sales Record Form</div>
        </div>
        <div class="daily-header-grid">
          <label>Date <input name="entry_date" type="date" value="${date}" onchange="handleDailyEntryDateChange(this.value)" required></label>
          <label>Time In <input name="time_in" type="time"></label>
          <label>Time Out <input name="time_out" type="time"></label>
          <label>Shift <input name="shift" value="Automatic Time Records" readonly></label>
          <label>Duty Personnel <input name="duty_personnel" type="text" value="${currentUser.name || ''}"></label>
        </div>
      </div>

      <div class="daily-tab-shell">
        <div class="daily-tab-nav" role="tablist" aria-label="Daily entry sections">
          <button type="button" class="daily-tab-btn active" onclick="switchDailyEntryTab('daily-tab-inventory', this)">Inventory</button>
          <button type="button" class="daily-tab-btn" onclick="switchDailyEntryTab('daily-tab-pumps', this)">Pump Readings</button>
          <button type="button" class="daily-tab-btn" onclick="switchDailyEntryTab('daily-tab-cash', this)">Cash & Expenses</button>
          <button type="button" class="daily-tab-btn" onclick="switchDailyEntryTab('daily-tab-review', this)">Review & Submit</button>
        </div>

        <section class="daily-tab-pane active" id="daily-tab-inventory">
      <div class="daily-form-card">
        <div class="daily-section-title">Inventory Stocks (Dip-Stick)</div>
        <div class="daily-table-wrap">
          <table class="daily-sheet-table daily-inventory-table">
            ${dailyInventoryHeader()}
            <tbody>${dailyInventoryInputRows()}</tbody>
          </table>
        </div>
      </div>
        </section>

        <section class="daily-tab-pane" id="daily-tab-pumps">
      ${['digital', 'mechanical'].map(type => `
        <div class="daily-form-card">
          <div class="daily-section-title">Pump ${type.charAt(0).toUpperCase() + type.slice(1)} Reading</div>
          <div class="daily-table-wrap">
            <table class="daily-sheet-table daily-pump-table" data-pump-type="${type}">
              <thead><tr><th>Pump</th><th>Product</th><th>Beginning</th><th>Ending</th><th>Consumed (L)</th><th>Pump Price</th><th>Amount</th></tr></thead>
              <tbody>${pumpRows.map(r => `<tr>
                <td>${r.n}</td>
                <td><select name="${type}__pump${r.n}__product">${dailyProductOptions(r.product)}</select></td>
                <td>${dailyNumberInput(`${type}__pump${r.n}__beginning`, 0, 'data-daily-calc="pump"')}</td>
                <td>${dailyNumberInput(`${type}__pump${r.n}__ending`, 0, 'data-daily-calc="pump"')}</td>
                <td>${dailyNumberInput(`${type}__pump${r.n}__consumed`, 0, 'readonly')}</td>
                <td>${dailyMoneyInput(`${type}__pump${r.n}__price`, parseFloat(r.price || 0).toFixed(2), 'data-daily-calc="pump"')}</td>
                <td>${dailyMoneyInput(`${type}__pump${r.n}__amount`, 0, 'readonly data-daily-amount')}</td>
              </tr>`).join('')}</tbody>
              <tfoot><tr><td colspan="6">Total Sales</td><td class="daily-total-cell" id="${type}-expected-sales">₱0.00</td></tr></tfoot>
            </table>
          </div>
        </div>`).join('')}
        </section>

        <section class="daily-tab-pane" id="daily-tab-cash">
      <div class="daily-cash-summary-strip">${renderDailyCashSummaryStrip(cashSummary)}</div>
      <div class="daily-cash-expense-grid">
        <div class="daily-form-card daily-cash-count-card">
          <div class="daily-card-title-row">
            <div>
              <div class="daily-section-title">Automated Cash Count</div>
              <div class="daily-cash-note" id="daily-auto-tx-count">${safeNum(totals.tx_count)} POS transactions</div>
            </div>
            <button type="button" class="btn-outline btn-sm" onclick="refreshDailyCashSummary()">Refresh POS Cash</button>
          </div>
          <table class="daily-sheet-table">
            <thead><tr><th>Denomination</th><th>Count</th><th>Amount</th></tr></thead>
            <tbody id="daily-auto-cash-body">${denomRows}</tbody>
            <tfoot>
              <tr><td colspan="2">Total Cash Counted</td><td class="daily-total-cell" id="daily-auto-cash-total">${fmt(countedCash)}</td></tr>
            </tfoot>
          </table>
        </div>
        <div class="daily-cash-side-stack">
          <div class="daily-form-card">
            <div class="daily-section-title">Expenses Summary</div>
            <table class="daily-sheet-table">
              <thead><tr><th>Expense Description</th><th>Liters</th><th>Amount</th></tr></thead>
              <tbody>${Array.from({ length: 8 }, (_, i) => `<tr>
                <td><input name="expense__${i}__description" type="text" placeholder="${i === 0 ? 'Calibration expenses' : ''}"></td>
                <td>${dailyNumberInput(`expense__${i}__liters`)}</td>
                <td>${dailyMoneyInput(`expense__${i}__amount`, 0, 'data-daily-calc="expense"')}</td>
              </tr>`).join('')}</tbody>
              <tfoot><tr><td colspan="2">Total Expenses</td><td class="daily-total-cell" id="daily-total-expenses">₱0.00</td></tr></tfoot>
            </table>
          </div>
          <div class="daily-form-card daily-shift-notes-card">
            <div class="daily-section-title">Cashier End-Shift Notes</div>
            <div class="daily-cash-note">Notes submitted by cashiers when ending their shift for this daily entry date.</div>
            <div id="daily-shift-note-list" class="daily-shift-note-list">${renderDailyShiftNotes(cashSummary)}</div>
          </div>
        </div>
      </div>
        </section>

        <section class="daily-tab-pane" id="daily-tab-review">
      <div class="daily-two-col totals-layout">
        <div class="daily-form-card daily-totals-card">
          <label>Total Cash (Expected) ${dailyMoneyInput('total_cash_expected', safeNum(totals.expected_cash).toFixed(2), 'readonly')}</label>
          <label>Less: Expenses ${dailyMoneyInput('less_expenses', 0, 'readonly')}</label>
          <label>Total ${dailyMoneyInput('net_expected_total', safeNum(totals.expected_cash).toFixed(2), 'readonly')}</label>
          <label>Actual Cash Remitted ${dailyMoneyInput('actual_cash_remitted', actualRemitted.toFixed(2), 'readonly')}</label>
          <input name="cash_payment" type="hidden" value="0">
          <div class="over-short-pill ${safeNum(totals.over_short) < 0 ? 'short' : ''}" id="daily-over-short-label">${safeNum(totals.over_short) < 0 ? 'Short' : 'Over'} ${fmt(Math.abs(safeNum(totals.over_short)))}</div>
          <input name="over_short" type="hidden" value="${safeNum(totals.over_short).toFixed(2)}">
        </div>
        <div class="daily-form-card">
          <div class="daily-section-title">Shift Note / Accident</div>
          <textarea name="shift_note" rows="8" placeholder="Write remarks, incidents, calibration notes, or cash explanations here."></textarea>
          <div class="daily-sign-grid">
            <label>Prepared By <input name="prepared_by" type="text" value="${currentUser.name || ''}"></label>
            <label>DSR & Cash Sales Received / Validated By <input name="validated_by" type="text"></label>
            <label>Audited By <input name="audited_by" type="text"></label>
          </div>
        </div>
      </div>
      <div class="daily-actions">
        <button type="button" class="btn-outline" onclick="window.print()">Print Form</button>
        <button type="button" class="btn-green" onclick="submitDailyEntry()">${isEditing ? 'Update Daily Report' : 'Submit Daily Report'}</button>
      </div>
        </section>
      </div>
    </form>`;
  if (isEditing) fillDailyEntryForm(editing);
  else restoreDailyEntryDraft(date);
  const form = document.getElementById('daily-entry-form');
  form.querySelectorAll('[data-daily-calc]').forEach(el => el.addEventListener('input', () => {
    delete form.dataset.reviewReset;
    syncDailyEntryTotals();
    saveDailyEntryDraft();
  }));
  form.querySelectorAll('select[name*="__product"]').forEach(el => el.addEventListener('change', e => {
    delete form.dataset.reviewReset;
    syncDailyPumpPrice(e);
    saveDailyEntryDraft();
  }));
  form.querySelectorAll('input, select, textarea').forEach(el => {
    if (el.matches('[data-daily-calc], select[name*="__product"]')) return;
    el.addEventListener('input', saveDailyEntryDraft);
    el.addEventListener('change', saveDailyEntryDraft);
    el.addEventListener('blur', saveDailyEntryDraft);
  });
  syncDailyEntryTotals();
}

function switchDailyEntryTab(tabId, btn) {
  saveDailyEntryDraft();
  syncDailyEntryTotals();
  document.querySelectorAll('#daily-entry-form .daily-tab-pane').forEach(pane => {
    pane.classList.toggle('active', pane.id === tabId);
  });
  document.querySelectorAll('#daily-entry-form .daily-tab-btn').forEach(button => {
    button.classList.toggle('active', button === btn);
  });
  const form = document.getElementById('daily-entry-form');
  if (tabId === 'daily-tab-cash' && form?.dataset.cashCleared !== '1') refreshDailyCashSummary();
  document.getElementById(tabId)?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function submitDailyEntry() {
  const form = document.getElementById('daily-entry-form');
  if (!form.reportValidity()) return;
  if (!form.dataset.autoCash) syncDailyEntryTotals();
  else syncDailyEntryTotals();
  const btn = document.querySelector('.daily-actions .btn-green');
  btn.disabled = true;
  const editId = form.dataset.editingId || '';
  const keepAfterSubmit = dailyEntryKeepAfterSubmit(form);
  btn.textContent = editId ? 'Updating...' : 'Submitting...';
  try {
    const submittedDate = form.elements.entry_date.value || gfToday();
    await API.dailyEntrySave({
      id: editId || undefined,
      entry_date: submittedDate,
      shift: form.elements.shift.value,
      time_in: form.elements.time_in.value,
      time_out: form.elements.time_out.value,
      duty_personnel: form.elements.duty_personnel.value,
      total_cash_expected: form.elements.total_cash_expected.value,
      total_expenses: form.elements.less_expenses.value,
      actual_cash_remitted: form.elements.actual_cash_remitted.value,
      cash_payment: form.elements.cash_payment.value,
      over_short: form.elements.over_short.value,
      payload: collectDailyEntryPayload(),
    });
    clearDailyEntryDraft(submittedDate);
    dailyEntryEditing = null;
    showToast(editId ? 'Daily entry updated and kept in weekly reports.' : 'Daily entry submitted and added to weekly reports.');
    await renderDailyEntryManager(submittedDate);
    applyDailyEntryValues(keepAfterSubmit);
    clearDailyCashExpenseSection();
    const inventoryBtn = document.querySelector('#daily-entry-form .daily-tab-btn');
    if (inventoryBtn) switchDailyEntryTab('daily-tab-inventory', inventoryBtn);
  } catch(e) {
    showToast(e.message, 'error');
  } finally {
    if (btn && document.body.contains(btn)) {
      btn.disabled = false;
      btn.textContent = editId ? 'Update Daily Report' : 'Submit Daily Report';
    }
  }
}

function syncDailyEntryTotals() {
  const form = document.getElementById('daily-entry-form');
  if (!form) return;

  DAILY_TANKS.forEach(tank => {
    ['cm', 'l'].forEach(unit => {
      const beginning = safeNum(form.elements[`inv__${tank[0]}__beginning__${unit}`]?.value);
      const ending = safeNum(form.elements[`inv__${tank[0]}__ending__${unit}`]?.value);
      const consumed = Math.max(0, beginning - ending);
      const consumedField = form.elements[`inv__${tank[0]}__consumed__${unit}`];
      if (consumedField) consumedField.value = consumed.toFixed(2);
    });
  });

  const pumpExpectedTotals = {};
  ['digital', 'mechanical'].forEach(type => {
    let expected = 0;
    form.querySelectorAll(`.daily-pump-table[data-pump-type="${type}"] tbody tr`).forEach(row => {
      const beginning = parseFloat(row.querySelector('input[name$="__beginning"]')?.value) || 0;
      const ending = parseFloat(row.querySelector('input[name$="__ending"]')?.value) || 0;
      const price = parseFloat(row.querySelector('input[name$="__price"]')?.value) || 0;
      const consumed = Math.abs(ending - beginning);
      const amount = consumed * price;
      const consumedInput = row.querySelector('input[name$="__consumed"]');
      const amountInput = row.querySelector('input[name$="__amount"]');
      if (consumedInput) consumedInput.value = consumed.toFixed(2);
      if (amountInput) amountInput.value = amount.toFixed(2);
      expected += amount;
    });
    const expectedCell = document.getElementById(`${type}-expected-sales`);
    if (expectedCell) expectedCell.textContent = fmt(expected);
    pumpExpectedTotals[type] = expected;
  });
  const pumpExpected = pumpExpectedTotals.digital || pumpExpectedTotals.mechanical || 0;

  const expenseTotal = [...form.querySelectorAll('input[name*="__amount"][name^="expense__"]')]
    .reduce((sum, input) => sum + (parseFloat(input.value) || 0), 0);
  const expenseCell = document.getElementById('daily-total-expenses');
  if (expenseCell) expenseCell.textContent = fmt(expenseTotal);

  if (form.dataset.reviewReset === '1') return;

  if (form.dataset.autoCash) {
    const expectedCash = pumpExpected;
    const actualCash = safeNum(form.dataset.actualCash);
    const netExpected = expectedCash - expenseTotal;
    const overShort = actualCash - netExpected;
    form.elements.total_cash_expected.value = expectedCash.toFixed(2);
    form.elements.less_expenses.value = expenseTotal.toFixed(2);
    form.elements.net_expected_total.value = netExpected.toFixed(2);
    form.elements.actual_cash_remitted.value = actualCash.toFixed(2);
    if (form.elements.cash_payment) form.elements.cash_payment.value = '0.00';
    form.elements.over_short.value = overShort.toFixed(2);
    const label = document.getElementById('daily-over-short-label');
    if (label) {
      label.textContent = `${overShort >= 0 ? 'Over' : 'Short'} ${fmt(Math.abs(overShort))}`;
      label.classList.toggle('short', overShort < 0);
    }
    return;
  }

  let cashTotal = 0;
  form.querySelectorAll('[data-denom]').forEach(input => {
    const amount = (parseFloat(input.value) || 0) * (parseFloat(input.dataset.denom) || 0);
    cashTotal += amount;
    const cell = form.querySelector(`[data-cash-amount="${input.name}"]`);
    if (cell) cell.textContent = fmt(amount);
  });

  const expected = pumpExpected;
  const cashPayment = parseFloat(form.elements.cash_payment?.value) || 0;
  const netExpected = expected - expenseTotal;
  const overShort = cashTotal + cashPayment - netExpected;

  const cashCell = document.getElementById('daily-total-cash-remitted');
  if (cashCell) cashCell.textContent = fmt(cashTotal);
  form.elements.total_cash_expected.value = expected.toFixed(2);
  form.elements.less_expenses.value = expenseTotal.toFixed(2);
  form.elements.net_expected_total.value = netExpected.toFixed(2);
  form.elements.actual_cash_remitted.value = cashTotal.toFixed(2);
  form.elements.over_short.value = overShort.toFixed(2);
  const label = document.getElementById('daily-over-short-label');
  if (label) {
    label.textContent = `${overShort >= 0 ? 'Over' : 'Short'} ${fmt(Math.abs(overShort))}`;
    label.classList.toggle('short', overShort < 0);
  }
}
