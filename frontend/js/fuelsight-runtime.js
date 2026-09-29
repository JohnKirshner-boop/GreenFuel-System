// Runtime takeover for the FuelSight POS workflow.
// Loaded after app.js so older cached route handlers cannot keep the legacy POS alive.

function fsFuelName(f) {
  const map = { diesel: 'Diesel 7KL', unleaded: 'Unleaded 7.5KL', premium: 'Premium 10KL', e10: 'Diesel 10KL' };
  return map[f.id] || f.name;
}

function fsDateLong() {
  return new Date().toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
}

function fsDenomLabel(value) {
  return typeof denomLabel === 'function' ? denomLabel(value) : fmt(value).replace(/\.00$/, '');
}

function fsTaxLabel(rate) {
  return `${safeNum(rate).toFixed(2).replace(/\.00$/, '')}%`;
}

function fsFmtLiters(value) {
  return safeNum(value).toLocaleString('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 4,
  }) + ' L';
}

function fsCurrentTaxRate() {
  const field = document.getElementById('pos-tax-rate');
  const rate = safeNum(field?.value || window.fsPosTaxRate || 12);
  return Math.min(100, Math.max(0, rate));
}

window.fsPosTaxRate = 12;
window.gfPendingLogoutAfterShift = false;
window.fsPosLastInput = 'liters';

async function initFuelSightPOS() {
  const page = document.getElementById('page-pos');
  if (!page || !currentUser || currentUser.role !== 'cashier') return;
  const branch = currentUser.branch_name || 'Unknown Branch';
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
    window.fsDenoms = denoms.length ? denoms : [
      { value: 1000, label: 'P1000' }, { value: 500, label: 'P500' }, { value: 200, label: 'P200' },
      { value: 100, label: 'P100' }, { value: 50, label: 'P50' }, { value: 20, label: 'P20' },
      { value: 10, label: 'P10' }, { value: 5, label: 'P5' }, { value: 1, label: 'P1' },
    ];
    window.fsActiveShift = shift || null;
    if (typeof gfActiveShift !== 'undefined') gfActiveShift = shift || null;
    window.fsPosTaxRate = safeNum(settings?.pos_vat_rate || 12) || 12;
  } catch(e) {
    window.fsDenoms = [];
    window.fsActiveShift = null;
    if (typeof gfActiveShift !== 'undefined') gfActiveShift = null;
    window.fsPosTaxRate = 12;
  }
  if (!selectedFuel && allFuels.length) selectedFuel = allFuels[0];
  const shiftOpen = !!window.fsActiveShift;
  const started = window.fsActiveShift?.start_time ? fmtDT(window.fsActiveShift.start_time) : 'Not started';
  const branchSafe = posReceiptSafe(branch);
  const cashierSafe = posReceiptSafe(currentUser.name || 'Cashier');
  const startedSafe = posReceiptSafe(started);
  page.innerHTML = `
    <div class="gf-pos gf-pos-clean">
      <div class="gf-pos-top">
        <div class="gf-pos-title">
          <span>⛽</span>
          <div>
            <h2>${branchSafe}</h2>
            <p>${posReceiptSafe(fsDateLong())} · Cashier: ${cashierSafe} · ${shiftOpen ? `Shift started ${startedSafe}` : 'No active shift'}</p>
          </div>
        </div>
        <div class="gf-shift-actions">
          <button class="btn-green" onclick="startCashierShift()" ${shiftOpen ? 'disabled' : ''}>Start Shift</button>
          <button class="gf-end-shift" onclick="openEndShiftModal()" ${shiftOpen ? '' : 'disabled'}>End Shift</button>
        </div>
      </div>
      <div class="gf-pos-grid gf-pos-grid-clean">
        <div class="gf-card gf-pos-sale">
          <div class="gf-card-head">
            <div><h3>New Fuel Sale</h3><p>Enter liters purchased and amount paid. VAT is computed automatically.</p></div>
          </div>
          <div class="gf-pos-fuels" id="pos-fuels"></div>
          <div class="gf-pos-entry gf-sale-form">
            <div class="gf-selected-product">
              <span>Selected Product</span>
              <h3 id="pos-selected-name">${selectedFuel ? fsFuelName(selectedFuel) : 'Select fuel'}</h3>
            </div>
            <div class="gf-sale-input-grid">
              <label>Liters Purchased <input type="number" id="pos-liters" min="0.01" step="0.0001" placeholder="0.0000" oninput="calcPosTotal('liters')"></label>
              <label>Amount Paid <input type="number" id="pos-amount-paid" min="0.01" step="0.01" placeholder="0.00" oninput="calcPosTotal('amount')"></label>
              <label class="gf-sale-tax">VAT Rate (%) <input type="number" id="pos-tax-rate" min="0" max="100" step="0.01" value="${safeNum(window.fsPosTaxRate).toFixed(2)}" oninput="updatePosTaxRate(this.value)"></label>
            </div>
            <div class="gf-pos-facts">
              <div><span>Price/L</span><b id="pos-price-display">₱0.00</b></div>
              <div><span>Amount Due</span><b id="pos-amount-due-display">₱0.00</b></div>
              <div><span>Change</span><b id="pos-change-display">₱0.00</b></div>
              <div><span>VATable Sale</span><b id="pos-subtotal-display">₱0.00</b></div>
              <div><span>VAT</span><b id="pos-tax-display">₱0.00</b></div>
              <div><span>Total Amount</span><b id="pos-amount-display">₱0.00</b></div>
            </div>
            <input type="hidden" id="pos-customer" value="Walk-in">
            <div class="gf-sale-action-row">
              <div class="gf-pos-total-line"><span>Total (incl. VAT)</span><b id="pos-total-display">₱0.00</b></div>
              <button class="btn-green full" id="pos-submit-btn" onclick="submitTransaction()" ${shiftOpen ? '' : 'disabled'}>Add Sale</button>
            </div>
          </div>
        </div>
        <div class="gf-card gf-pos-log">
          <div class="gf-card-head">
            <div><h3>Current Shift Transactions</h3><p>Sales are logged immediately; cash count is entered when ending the shift.</p></div>
            <div class="gf-pos-counters"><span id="today-count-badge">Count: 0</span><span id="pos-volume-badge">Volume: 0.00L</span><span id="pos-tax-total-badge">VAT: ₱0.00</span></div>
          </div>
          <div id="pos-recent-list" class="tbl-wrap">${loadingHTML}</div>
          <div class="gf-pos-grand"><span>Total Sales Amount</span><b id="pos-shift-total">₱0.00</b></div>
        </div>
      </div>
      <div id="gf-global-modal-root"></div>
    </div>`;
  renderFuelButtons();
  calcPosTotal();
  loadRecentTx();
}

window.fsRenderFuelSightPOS = initFuelSightPOS;

function updatePosTaxRate(value) {
  window.fsPosTaxRate = Math.min(100, Math.max(0, safeNum(value)));
  calcPosTotal(window.fsPosLastInput || 'liters');
}

function renderFuelButtons() {
  const wrap = document.getElementById('pos-fuels');
  if (!wrap) return;
  wrap.innerHTML = allFuels.map(f => `
    <button class="gf-fuel-tile ${selectedFuel?.id === f.id ? 'selected' : ''}" onclick="selectPosFuel('${f.id}')">
      <strong>${fsFuelName(f)}</strong><span>${fmt(f.price)}/L</span>
    </button>`).join('');
  const name = document.getElementById('pos-selected-name');
  if (name) name.textContent = selectedFuel ? fsFuelName(selectedFuel) : 'Select fuel';
}

function selectPosFuel(id) {
  selectedFuel = allFuels.find(f => f.id === id) || selectedFuel;
  renderFuelButtons();
  calcPosTotal(window.fsPosLastInput || 'liters');
}

function fsRenderDenomButtons(group = 'shiftcash') {
  return (window.fsDenoms || []).map(d => {
    const value = safeNum(d.value);
    const label = fsDenomLabel(value);
    return `<div class="gf-denom-btn" role="button" tabindex="0" data-denom-group="${group}" data-denom-value="${value}" data-denom-count="0" onclick="addPosDenom(${value}, '${group}')" onkeydown="handlePosDenomKey(event, ${value}, '${group}')"><span class="gf-denom-value">${label}</span><span class="gf-denom-bottom"><span class="gf-denom-count">x0</span><button type="button" class="gf-denom-minus" onclick="removePosDenom(event, ${value}, '${group}')" aria-label="Remove one ${label}">−</button></span></div>`;
  }).join('');
}

function getPosDenomBreakdown(group = 'shiftcash') {
  const breakdown = {};
  document.querySelectorAll(`#page-pos .gf-denom-btn[data-denom-group="${group}"][data-denom-value]`).forEach(btn => {
    const qty = Math.max(0, parseInt(btn.dataset.denomCount || '0', 10) || 0);
    if (qty > 0) breakdown[String(safeNum(btn.dataset.denomValue))] = qty;
  });
  return breakdown;
}

function getPosDenomBreakdownTotal(group = 'shiftcash') {
  return Object.entries(getPosDenomBreakdown(group)).reduce((sum, [value, qty]) => sum + safeNum(value) * safeNum(qty), 0);
}

function updatePosDenomButton(btn, count) {
  btn.dataset.denomCount = String(count);
  btn.classList.toggle('has-count', count > 0);
  const countEl = btn.querySelector('.gf-denom-count');
  if (countEl) countEl.textContent = `x${count}`;
}

function updateShiftCashTotal() {
  const total = getPosDenomBreakdownTotal('shiftcash');
  const expected = safeNum(document.getElementById('shift-cash-total')?.dataset.expected);
  const diff = total - expected;
  const totalEl = document.getElementById('shift-cash-total');
  const diffEl = document.getElementById('shift-cash-diff');
  if (totalEl) totalEl.textContent = fmt(total);
  if (diffEl) {
    diffEl.textContent = `${diff >= 0 ? 'Over' : 'Short'} ${fmt(Math.abs(diff))}`;
    diffEl.classList.toggle('negative', diff < 0);
  }
}

function addPosDenom(value, group = 'shiftcash') {
  const denomValue = safeNum(value);
  const btn = Array.from(document.querySelectorAll(`#page-pos .gf-denom-btn[data-denom-group="${group}"][data-denom-value]`))
    .find(el => safeNum(el.dataset.denomValue) === denomValue);
  if (!btn) return;
  const count = (parseInt(btn.dataset.denomCount || '0', 10) || 0) + 1;
  updatePosDenomButton(btn, count);
  updateShiftCashTotal();
}

function removePosDenom(event, value, group = 'shiftcash') {
  event?.preventDefault?.();
  event?.stopPropagation?.();
  const denomValue = safeNum(value);
  const btn = Array.from(document.querySelectorAll(`#page-pos .gf-denom-btn[data-denom-group="${group}"][data-denom-value]`))
    .find(el => safeNum(el.dataset.denomValue) === denomValue);
  if (!btn) return;
  const count = Math.max(0, (parseInt(btn.dataset.denomCount || '0', 10) || 0) - 1);
  updatePosDenomButton(btn, count);
  updateShiftCashTotal();
}

function handlePosDenomKey(event, value, group = 'shiftcash') {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  addPosDenom(value, group);
}

function calcPosTotal(source = window.fsPosLastInput || 'liters') {
  window.fsPosLastInput = source === 'amount' ? 'amount' : 'liters';
  const amountEl = document.getElementById('pos-amount-paid');
  const liters = safeNum(document.getElementById('pos-liters')?.value);
  const price = safeNum(selectedFuel?.price);
  const amountPaid = Math.round(safeNum(amountEl?.value) * 100) / 100;
  const total = price > 0 && liters > 0 ? Math.round(liters * price * 100) / 100 : 0;
  const change = amountPaid > 0 ? Math.round((amountPaid - total) * 100) / 100 : 0;
  const taxRate = fsCurrentTaxRate();
  const subtotal = taxRate > 0 ? Math.round((total / (1 + (taxRate / 100))) * 100) / 100 : total;
  const taxAmount = Math.round((total - subtotal) * 100) / 100;
  const setText = (id, text) => { const el = document.getElementById(id); if (el) el.textContent = text; };
  setText('pos-price-display', fmt(price));
  setText('pos-amount-due-display', fmt(total));
  setText('pos-change-display', fmt(change));
  setText('pos-subtotal-display', fmt(subtotal));
  setText('pos-tax-display', `${fmt(taxAmount)} (${fsTaxLabel(taxRate)})`);
  setText('pos-amount-display', fmt(total));
  setText('pos-total-display', fmt(total));
  document.getElementById('pos-change-display')?.classList.toggle('negative', change < 0);
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
  const txId = posTxActionId(t.id);
  const time = new Date(t.timestamp).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
  const product = t.fuel_name || t.fuel_type || 'Fuel';
  return `
    <div class="gf-tx-card ${isVoid ? 'void-row' : ''}">
      <div class="gf-tx-head">
        <div><b>${posReceiptSafe(product)}</b><span>${time} · ${posReceiptSafe(t.id || 'Transaction')}</span></div>
        <span class="badge ${isVoid ? 'badge-red' : 'badge-green'}">${isVoid ? 'VOID' : 'PAID'}</span>
      </div>
      <div class="gf-tx-metrics">
        <span><small>Total</small><b>${fmt(t.total_amount || t.amount_paid)}</b></span>
        <span><small>Liters</small><b>${fsFmtLiters(t.liters)}</b></span>
        <span><small>Price/L</small><b>${fmt(t.price_per_liter)}</b></span>
        <span><small>Paid</small><b>${fmt(t.cash_received)}</b></span>
        <span><small>Change</small><b>${fmt(t.change_amount)}</b></span>
        <span><small>VATable</small><b>${fmt(t.subtotal_amount)}</b></span>
        <span><small>VAT</small><b>${fmt(t.tax_amount)}</b></span>
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
  <div class="row"><span>Liters</span><strong>${fsFmtLiters(tx.liters)}</strong></div>
  <div class="row"><span>VATable Sale</span><strong>${fmt(tx.subtotal_amount || ((safeNum(tx.total_amount) || safeNum(tx.amount_paid)) - safeNum(tx.tax_amount)))}</strong></div>
  <div class="row"><span>VAT Amount ${safeNum(tx.tax_rate) ? `(${fsTaxLabel(tx.tax_rate)})` : ''}</span><strong>${fmt(tx.tax_amount)}</strong></div>
  <div class="row total"><span>Total Amount</span><strong>${fmt(tx.total_amount || tx.amount_paid)}</strong></div>
  <div class="row"><span>Amount Paid</span><strong>${fmt(tx.cash_received)}</strong></div>
  <div class="row"><span>Change Given</span><strong>${fmt(tx.change_amount)}</strong></div>
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
  if (!window.fsActiveShift) { showToast('Start a shift before processing a sale.', 'error'); return; }
  if (!selectedFuel) { showToast('Select a fuel type first.', 'error'); return; }
  calcPosTotal(window.fsPosLastInput || 'liters');
  const liters = safeNum(document.getElementById('pos-liters')?.value);
  const amountPaid = safeNum(document.getElementById('pos-amount-paid')?.value);
  const taxRate = fsCurrentTaxRate();
  const amountDue = Math.round(liters * safeNum(selectedFuel?.price) * 100) / 100;
  if (liters <= 0) { showToast('Enter liters purchased by the customer.', 'error'); return; }
  if (amountPaid <= 0) { showToast('Enter the amount paid by the customer.', 'error'); return; }
  if (amountPaid < amountDue) { showToast('Amount paid is less than the amount due.', 'error'); return; }
  if (amountDue <= 0) { showToast('Fuel price or liters is invalid.', 'error'); return; }
  try {
    btn.disabled = true;
    btn.textContent = 'Saving...';
    await API.txCreate({
      branch_id: currentUser.branch_id,
      fuel_type: selectedFuel.id,
      liters,
      amount_paid: amountDue,
      cash_received: amountPaid,
      tax_rate: taxRate,
      customer: 'Walk-in',
    });
    document.getElementById('pos-liters').value = '';
    document.getElementById('pos-amount-paid').value = '';
    window.fsPosLastInput = 'liters';
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
    const active = today.filter(t => t.status !== 'void');
    const total = active.reduce((a, t) => a + safeNum(t.total_amount), 0);
    const tax = active.reduce((a, t) => a + safeNum(t.tax_amount), 0);
    const volume = active.reduce((a, t) => a + safeNum(t.liters), 0);
    document.getElementById('today-count-badge').textContent = `Count: ${active.length}`;
    document.getElementById('pos-volume-badge').textContent = `Volume: ${fsFmtLiters(volume)}`;
    const taxBadge = document.getElementById('pos-tax-total-badge');
    if (taxBadge) taxBadge.textContent = `VAT: ${fmt(tax)}`;
    document.getElementById('pos-shift-total').textContent = fmt(total);
    window.gfPosReceiptTxs = today;
    if (!today.length) { wrap.innerHTML = '<div class="loading">No transactions recorded yet</div>'; return; }
    wrap.innerHTML = `<div class="gf-tx-list">${today.slice(0, 18).map(renderPosTransactionCard).join('')}</div>`;
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
    if (document.getElementById('records-pos-table') && typeof refreshRecordsPosTransactions === 'function') {
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
    window.fsActiveShift = await API.shiftStart();
    if (typeof gfActiveShift !== 'undefined') gfActiveShift = window.fsActiveShift;
    showToast('Shift started.');
    await initFuelSightPOS();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

function cancelEndShiftModal() {
  window.gfPendingLogoutAfterShift = false;
  closeGfModal();
}

async function openEndShiftModal(options = {}) {
  if (options.afterLogout) window.gfPendingLogoutAfterShift = true;
  if (!window.fsActiveShift && typeof gfActiveShift !== 'undefined') window.fsActiveShift = gfActiveShift;
  if (!window.fsActiveShift) {
    if (options.afterLogout) window.gfPendingLogoutAfterShift = false;
    showToast('No active shift to end.', 'error');
    return;
  }
  try {
    const txs = await API.txRecent(currentUser.branch_id, 50);
    const sessionId = String(window.fsActiveShift.id || '');
    const current = txs.filter(t => {
      const sameSession = sessionId && String(t.shift_session_id || '') === sessionId;
      const todayNoSession = !sessionId && new Date(t.timestamp).toDateString() === new Date().toDateString();
      return (sameSession || todayNoSession) && t.status !== 'void';
    });
    const rows = allFuels.map(f => {
      const fuelTxs = current.filter(t => t.fuel_type === f.id);
      if (!fuelTxs.length) return '';
      return `<div class="gf-shift-row"><span>${fsFuelName(f)} (${fuelTxs.length} txns)</span><b>${fsFmtLiters(fuelTxs.reduce((a,t)=>a+safeNum(t.liters),0))}<br>${fmt(fuelTxs.reduce((a,t)=>a+safeNum(t.total_amount),0))}</b></div>`;
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
        <div class="gf-modal shift gf-end-shift-modal">
          <button class="gf-modal-x" onclick="cancelEndShiftModal()">×</button>
          <h2>End Shift Cash Count</h2>
          <p>Count the actual cash on hand before submitting the shift to the branch manager.</p>
          <div class="gf-soft-box">
            <h3>Shift Summary</h3>
            <div class="gf-shift-row"><span>Started</span><b>${fmtDT(window.fsActiveShift.start_time)}</b></div>
            ${rows || '<p>No sales recorded.</p>'}
            <div class="gf-shift-total"><span>Total POS Sales</span><b>${fmt(total)}</b></div>
          </div>
          <div class="shift-cash-count">
            <div class="gf-card-head">
              <div><h3>Cash on Hand</h3><p>Tap each denomination for every bill or coin counted.</p></div>
              <div class="shift-cash-kpis">
                <span><small>Counted Cash</small><b id="shift-cash-total" data-expected="${total.toFixed(2)}">₱0.00</b></span>
                <span><small>Difference</small><b id="shift-cash-diff">Short ${fmt(total)}</b></span>
              </div>
            </div>
            <div class="gf-denom-grid shift-denom-grid">${fsRenderDenomButtons('shiftcash')}</div>
          </div>
          <label class="shift-note-field">Cashier Note / Explanation
            <textarea id="shift-cashier-note" maxlength="2000" placeholder="Add reasons, explanations, incidents, or cash count notes for the manager..."></textarea>
          </label>
          <div class="gf-alert gf-alert-warn"><strong>Action cannot be undone.</strong><span>This closes the shift and sends the counted denominations to the manager.</span></div>
          <div class="gf-modal-actions"><button class="btn-outline" onclick="cancelEndShiftModal()">Cancel</button><button class="btn-green" onclick="submitShiftRecord()">Submit Shift</button></div>
        </div>
      </div>`;
    updateShiftCashTotal();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

async function submitShiftRecord() {
  const expected = safeNum(document.getElementById('shift-cash-total')?.dataset.expected);
  const counted = getPosDenomBreakdownTotal('shiftcash');
  if (expected > 0 && counted <= 0) {
    showToast('Enter the end-of-shift cash count before submitting.', 'error');
    return;
  }
  try {
    await API.shiftEnd({
      cash_breakdown: getPosDenomBreakdown('shiftcash'),
      cashier_note: document.getElementById('shift-cashier-note')?.value.trim() || ''
    });
    window.fsActiveShift = null;
    if (typeof gfActiveShift !== 'undefined') gfActiveShift = null;
    closeGfModal();
    if (window.gfPendingLogoutAfterShift) {
      window.gfPendingLogoutAfterShift = false;
      try { await API.logout(); } catch(e) {}
      if (typeof finishLogoutClientSide === 'function') finishLogoutClientSide();
      showToast('Shift submitted and signed out.');
      return;
    }
    showToast('Shift record submitted for manager verification.');
    await initFuelSightPOS();
  } catch(e) {
    showToast(e.message, 'error');
  }
}

const fsOriginalLoadPage = loadPage;
loadPage = async function(pageId) {
  await fsOriginalLoadPage(pageId);
  if (pageId === 'page-pos') await initFuelSightPOS();
};

window.addEventListener('load', () => {
  setTimeout(() => {
    if (currentUser?.role === 'cashier' && document.getElementById('page-pos')?.classList.contains('active')) {
      initFuelSightPOS();
    }
  }, 500);
  let attempts = 0;
  const timer = setInterval(() => {
    attempts += 1;
    const posActive = document.getElementById('page-pos')?.classList.contains('active');
    if (currentUser?.role === 'cashier' && posActive) {
      if (!document.querySelector('#page-pos .gf-pos-clean')) initFuelSightPOS();
      clearInterval(timer);
    }
    if (attempts > 20) clearInterval(timer);
  }, 300);
});
