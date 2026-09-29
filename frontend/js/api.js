// frontend/js/api.js
// All calls to the PHP backend go through these functions.
// BASE_URL points to your backend folder.

const BASE_URL = '../backend/routes';
let GREENFUEL_CSRF_TOKEN = null;

async function apiFetch(route, params = {}, options = {}) {
  const url = new URL(`${BASE_URL}/${route}`, window.location.href);
  Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  const method = (options.method || 'GET').toUpperCase();
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
  };
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method) && GREENFUEL_CSRF_TOKEN) {
    headers['X-CSRF-Token'] = GREENFUEL_CSRF_TOKEN;
  }

  const res = await fetch(url.toString(), {
    credentials: 'include',
    ...options,
    headers,
  });

  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch (e) {
    throw new Error('Server returned an invalid response. Please check the backend logs.');
  }
  const payload = Object.prototype.hasOwnProperty.call(json, 'data') ? json.data : json;
  if (payload && typeof payload === 'object' && payload.csrf_token) {
    GREENFUEL_CSRF_TOKEN = payload.csrf_token;
  }
  if (json && typeof json === 'object' && json.csrf_token) {
    GREENFUEL_CSRF_TOKEN = json.csrf_token;
  }
  if (!json.success && res.status !== 200) {
    throw new Error(json.error || 'Request failed');
  }
  return payload;
}

// Shorthand helpers
const API = {
  // AUTH
  login:   (email, password, branch_id = null)  => apiFetch('auth.php', { action: 'login' },        { method: 'POST', body: JSON.stringify({ email, password, branch_id }) }),
  logout:  ()                    => apiFetch('auth.php', { action: 'logout' },        { method: 'POST' }),
  me:      ()                    => apiFetch('auth.php', { action: 'me' }),
  requestPasswordReset: (email)   => apiFetch('auth.php', { action: 'request_password_reset' }, { method: 'POST', body: JSON.stringify({ email }) }),
  resetPassword: (token, password) => apiFetch('auth.php', { action: 'reset_password' }, { method: 'POST', body: JSON.stringify({ token, password }) }),
  accountUpdate: (data)          => apiFetch('auth.php', { action: 'update_profile' }, { method: 'POST', body: JSON.stringify(data) }),
  accountThemeUpdate: (theme_preference) => apiFetch('auth.php', { action: 'update_theme' }, { method: 'POST', body: JSON.stringify({ theme_preference }) }),
  changePassword: (data)         => apiFetch('auth.php', { action: 'change_password' }, { method: 'POST', body: JSON.stringify(data) }),

  // BRANCHES + FUELS
  branches: ()                   => apiFetch('branches.php', { action: 'list' }),
  fuels:    (params = {})         => apiFetch('branches.php', { action: 'fuels', ...params }),
  fuelUpdatePrice: (id, price)    => apiFetch('branches.php', { action: 'update_price' }, { method: 'POST', body: JSON.stringify({ id, price }) }),
  fuelPriceRequests: (params = {})=> apiFetch('branches.php', { action: 'price_requests', ...params }),
  fuelRequestPrice: (data)        => apiFetch('branches.php', { action: 'request_price' }, { method: 'POST', body: JSON.stringify(data) }),
  fuelReviewPrice: (request_id, status, review_note = '') =>
    apiFetch('branches.php', { action: 'review_price' }, { method: 'POST', body: JSON.stringify({ request_id, status, review_note }) }),
  settings: ()                    => apiFetch('settings.php', { action: 'list' }),
  settingUpdate: (setting_key, setting_value) =>
    apiFetch('settings.php', { action: 'update' }, { method: 'POST', body: JSON.stringify({ setting_key, setting_value }) }),

  // USER ROLE ASSIGNMENTS
  users: ()                       => apiFetch('users.php', { action: 'list' }),
  userSave: (data)                => apiFetch('users.php', { action: 'save' }, { method: 'POST', body: JSON.stringify(data) }),

  // TRANSACTIONS
  txList:   (params = {})        => apiFetch('transactions.php', { action: 'list',   ...params }),
  txToday:  (branch_id)          => apiFetch('transactions.php', { action: 'today',  branch_id }),
  txRecent: (branch_id, limit=12)=> apiFetch('transactions.php', { action: 'recent', branch_id, limit }),
  txCreate: (data)               => apiFetch('transactions.php', { action: 'create' }, { method: 'POST', body: JSON.stringify(data) }),
  txVerify: (tx_id, status)      => apiFetch('transactions.php', { action: 'verify' }, { method: 'POST', body: JSON.stringify({ tx_id, status }) }),
  txVoid:   (tx_id, reason)      => apiFetch('transactions.php', { action: 'void' }, { method: 'POST', body: JSON.stringify({ tx_id, reason }) }),
  denominations: ()              => apiFetch('transactions.php', { action: 'denominations' }),

  // ANALYTICS
  summary:        ()             => apiFetch('analytics.php', { action: 'summary' }),
  daily:          (params = {})  => apiFetch('analytics.php', { action: 'daily',          ...params }),
  branchRanking:  ()             => apiFetch('analytics.php', { action: 'branch_ranking' }),
  branchComparison: (params = {})=> apiFetch('analytics.php', { action: 'branch_comparison', ...params }),
  fuelBreakdown:  (branch_id)    => apiFetch('analytics.php', { action: 'fuel_breakdown', branch_id }),
  forecast:       ()             => apiFetch('analytics.php', { action: 'forecast' }),
  insights:       ()             => apiFetch('analytics.php', { action: 'insights' }),

  // SHIFTS
  shiftsPending: (branch_id)     => apiFetch('shifts.php', { action: 'pending', branch_id }),
  shiftsHistory: (branch_id)     => apiFetch('shifts.php', { action: 'history', branch_id }),
  shiftCurrent: ()               => apiFetch('shifts.php', { action: 'current' }),
  shiftStart: ()                 => apiFetch('shifts.php', { action: 'start' }, { method: 'POST' }),
  shiftEnd: (data = {})          => apiFetch('shifts.php', { action: 'end' }, { method: 'POST', body: JSON.stringify(data) }),
  shiftVerify:   (shift_id, status, remarks='') =>
    apiFetch('shifts.php', { action: 'verify' }, { method: 'POST', body: JSON.stringify({ shift_id, status, remarks }) }),
  shiftOpen: (data)              => apiFetch('shifts.php', { action: 'open' }, { method: 'POST', body: JSON.stringify(data) }),

  // DAILY ENTRIES
  dailyEntries: (params = {})    => apiFetch('daily_entries.php', { action: 'list', ...params }),
  dailyCashSummary: (params = {})=> apiFetch('daily_entries.php', { action: 'cash_summary', ...params }),
  dailyEntrySave: (data)         => apiFetch('daily_entries.php', { action: 'save' }, { method: 'POST', body: JSON.stringify(data) }),

  // REPORTS
  weeklyReport:  (params = {})   => apiFetch('reports.php', { action: 'weekly', ...params }),
  submitReport:  (data)          => apiFetch('reports.php', { action: 'submit' }, { method: 'POST', body: JSON.stringify(data) }),
  reportList:    (params = {})   => apiFetch('reports.php', { action: 'list', ...params }),
};
