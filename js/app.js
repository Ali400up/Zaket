import { dataService } from "./data-service.js";
import { menuSections, screenConfigs, reportDefinitions, roleLabels, statusLabels } from "./screen-config.js";
import { getOfflineQueue, removeQueueItem, clearCompletedQueue } from "./offline.js";
import { isOnline, checkConnectivity, subscribeConnection, getConnectionState } from "./connectivity.js";
import { importDefinitions, downloadImportTemplate, parseImportFile } from "./import-service.js";
import { roleDailyGuides, userGuideSections } from "./user-guide.js";
import { renderAssistantScreen, handleAssistantInteraction } from "./ai-assistant.js";
import { inspectV3Archive, normalizeLegacyBackup } from "./backup-v3.js";
import { createV4Archive, inspectV4Archive, downloadV4Archive, restoreV4Files, cleanupExactV4Files, clearV4Resume } from "./backup-v4.js";
import { validateCashboxUserAssignment } from "./state-machines.js";
import { normalizeAttachmentPolicy, prepareAttachment } from "./attachment-manager.js";
import { buildRecordPrintDocument, buildListPrintDocument } from "./print-service.js";
import { formatOperationError } from "./error-presenter.js";
import { RELEASE_NOTES } from "./release-notes.js";
import { getDeviceName } from "./device-identity.js";
import { buildNotifications, notificationCount, renderNotificationList } from "./notification-center.js";
import { formatPrivateValue } from "./screen-values.js";
import { convertCurrency, deriveExchangeRate, buildCashFlowSummary } from "./currency-service.js";
import { filterSearchOptions, shouldUseSearchableSelect } from "./searchable-select.js";
import { healthMetric, describeHealthError } from "./system-health.js";
import {
  escapeHtml, formatCurrency, formatDate, formatNumber, statusBadge, roleBadge, priorityBadge,
  initials, toast, openModal, closeModal, openDrawer, closeDrawer, confirmDialog, downloadText, objectDetails
} from "./ui.js";

const config = window.ZAKAT_CONFIG || {};

const routeMap = {
  dashboard: null,
  "ai-assistant": null,
  "global-search": null,
  guide: null,
  branches: "branches",
  devices: "authorized_devices",
  "login-attempts": "login_attempts",
  "user-tracking": "user_sessions",
  "user-archives": "user_archives",
  cashboxes: "cashboxes",
  "cashbox-users": "cashbox_users",
  "cash-transfers": "cash_transfers",
  "currency-exchanges": "currency_exchanges",
  "quick-delivery": "distribution_assignments",
  units: "units",
  currencies: "currencies",
  warehouses: "warehouses",
  "stock-balances": "stock_balances",
  imports: "import_jobs",
  users: "profiles",
  delegates: "delegates",
  donors: "donors",
  classifications: null,
  beneficiaries: "beneficiaries",
  campaigns: "campaigns",
  "campaign-funding": "campaign_funding",
  "campaign-distributors": "campaign_distributors",
  "cash-receipts": "cash_receipts",
  "cash-payments": "cash_payments",
  inventory: "items",
  "in-kind-receipts": "in_kind_receipts",
  "campaign-in-kind-funding": "campaign_in_kind_funding",
  baskets: "baskets",
  "in-kind-payments": "in_kind_payments",
  closings: "account_closings",
  reports: null,
  audit: "audit_logs",
  sync: null,
  settings: null
};

const configKeyMap = {
  profiles: "users",
  branches: "branches",
  authorized_devices: "devices",
  login_attempts: "login_attempts",
  user_sessions: "user_tracking",
  user_archives: "user_archives",
  cashboxes: "cashboxes",
  cashbox_users: "cashbox_users",
  cash_transfers: "cash_transfers",
  currency_exchanges: "currency_exchanges",
  distribution_assignments: "quick_delivery",
  units: "units",
  currencies: "currencies",
  warehouses: "warehouses",
  stock_balances: "stock_balances",
  import_jobs: "imports",
  delegates: "delegates",
  donors: "donors",
  beneficiary_categories: "beneficiary_categories",
  health_conditions: "health_conditions",
  beneficiaries: "beneficiaries",
  campaigns: "campaigns",
  campaign_funding: "campaign_funding",
  campaign_distributors: "campaign_distributors",
  cash_receipts: "cash_receipts",
  cash_payments: "cash_payments",
  items: "items",
  in_kind_receipts: "in_kind_receipts",
  campaign_in_kind_funding: "campaign_in_kind_funding",
  baskets: "baskets",
  in_kind_payments: "in_kind_payments",
  account_closings: "closings",
  audit_logs: "audit_logs"
};

const roleAccess = {
  admin: "*",
  supervisor: ["ai-assistant", "branches", "devices", "login-attempts", "user-tracking", "user-archives", "cashboxes", "cashbox-users", "cash-transfers", "currency-exchanges", "quick-delivery", "units", "currencies", "warehouses", "stock-balances", "imports", "dashboard", "delegates", "donors", "classifications", "beneficiaries", "campaigns", "campaign-funding", "campaign-distributors", "cash-receipts", "cash-payments", "inventory", "in-kind-receipts", "campaign-in-kind-funding", "baskets", "in-kind-payments", "closings", "reports", "audit", "sync"],
  accountant: ["ai-assistant", "cashboxes", "cashbox-users", "cash-transfers", "currency-exchanges", "currencies", "dashboard", "delegates", "donors", "beneficiaries", "campaigns", "campaign-funding", "campaign-distributors", "cash-receipts", "cash-payments", "closings", "reports"],
  distributor: ["ai-assistant", "quick-delivery", "dashboard", "beneficiaries", "cash-payments", "in-kind-payments", "sync"],
  data_entry: ["ai-assistant", "imports", "dashboard", "donors", "beneficiaries", "sync"],
  warehouse: ["ai-assistant", "units", "currencies", "warehouses", "stock-balances", "dashboard", "inventory", "in-kind-receipts", "campaign-in-kind-funding", "baskets", "in-kind-payments", "sync"],
  auditor: ["ai-assistant", "cashboxes", "stock-balances", "login-attempts", "user-tracking", "dashboard", "reports", "audit"]
};

const tableCreateRoles = {
  profiles: ["admin"], branches: ["admin", "supervisor"], delegates: ["admin", "supervisor", "accountant"],
  donors: ["admin", "supervisor", "accountant", "data_entry"], beneficiary_categories: ["admin", "supervisor"],
  health_conditions: ["admin", "supervisor"], beneficiaries: ["admin", "supervisor", "data_entry", "distributor"],
  units: ["admin", "supervisor", "warehouse"], items: ["admin", "supervisor", "warehouse"], warehouses: ["admin", "supervisor", "warehouse"],
  currencies: ["admin", "supervisor"], currency_exchanges: ["admin", "supervisor", "accountant"],
  cashboxes: ["admin", "supervisor", "accountant"], campaigns: ["admin", "supervisor", "accountant"],
  campaign_funding: ["admin", "supervisor", "accountant"], campaign_distributors: ["admin", "supervisor", "accountant"],
  cashbox_users: ["admin", "supervisor", "accountant"], cash_receipts: ["admin", "supervisor", "accountant"],
  cash_payments: ["admin", "supervisor", "accountant", "distributor"], cash_transfers: ["admin", "supervisor", "accountant"],
  distribution_assignments: ["admin", "supervisor", "accountant", "distributor"],
  in_kind_receipts: ["admin", "supervisor", "accountant", "warehouse"], campaign_in_kind_funding: ["admin", "supervisor", "warehouse"],
  baskets: ["admin", "supervisor", "warehouse"], in_kind_payments: ["admin", "supervisor", "warehouse", "distributor"],
  import_jobs: ["admin", "supervisor", "data_entry"],
  account_closings: ["admin", "supervisor", "accountant"]
};

const tableUpdateRoles = {
  ...tableCreateRoles,
  beneficiaries: ["admin", "supervisor", "data_entry"],
  distribution_assignments: [], import_jobs: [], authorized_devices: ["admin"]
};

const mutatingRowActions = new Set(["edit", "toggle", "reset-password", "approve", "open-close", "post", "cancel", "confirm-receipt", "settle", "reopen", "retry"]);

function roleCanWrite(table, mode = "update") {
  const role = state.session?.profile?.role || "data_entry";
  const roles = (mode === "create" ? tableCreateRoles : tableUpdateRoles)[table] || [];
  if (!roles.includes(role)) return false;
  if (table === "beneficiaries" && mode === "create" && role === "distributor") {
    return state.session?.profile?.can_create_beneficiaries === true;
  }
  return true;
}

const state = {
  session: null,
  currentScreen: "dashboard",
  previousScreen: "dashboard",
  classificationTab: "beneficiary_categories",
  dashboardCurrency: config.currency || "YER",
  reportId: "cash-donors",
  table: { page: 1, pageSize: config.pageSize || 10, search: "", filters: {}, dateFrom: "", dateTo: "" },
  charts: [],
  currentRows: [],
  currentConfig: null,
  currentPrint: { title: "", columns: [] },
  notifications: [],
  notificationsLoaded: false,
  notificationLoading: false
};

const backupUiState = {
  inspection: null,
  restoreSession: null,
  restoreMode: "merge",
  stagedParts: new Set(),
  preflight: null,
  busy: false,
  lastMessage: "اختر نطاق النسخة أو ملف الاستعادة للبدء."
};

const els = {
  loginView: document.getElementById("login-view"),
  appShell: document.getElementById("app-shell"),
  pageContent: document.getElementById("page-content"),
  pageTitle: document.getElementById("page-title"),
  breadcrumb: document.getElementById("breadcrumb-current"),
  mainNav: document.getElementById("main-nav"),
  sidebar: document.getElementById("sidebar")
};

function canAccess(screenId) {
  if (screenId === "guide") return true;
  const role = state.session?.profile?.role || "admin";
  const access = roleAccess[role] || [];
  return access === "*" || access.includes(screenId);
}

function getScreenMeta(screenId) {
  for (const section of menuSections) {
    const item = section.items.find(x => x.id === screenId);
    if (item) return item;
  }
  return { id: screenId, label: screenId, icon: "fa-solid fa-circle" };
}

function setLoading() {
  els.pageContent.innerHTML = `<div class="panel loading-card"><div class="loading-inner"><div class="spinner"></div><span>جاري تحميل البيانات...</span></div></div>`;
}

function destroyCharts() {
  state.charts.forEach(chart => { try { chart.destroy(); } catch {            } });
  state.charts = [];
}

function showLogin() {
  destroyCharts();
  state.notifications = [];
  state.notificationsLoaded = false;
  updateNotificationBadge();
  els.appShell.classList.add("hidden");
  els.loginView.classList.remove("hidden");
  document.body.style.overflow = "";
}

function showApp() {
  els.loginView.classList.add("hidden");
  els.appShell.classList.remove("hidden");
  const profile = state.session.profile || {};
  const displayName = profile.full_name || "مستخدم النظام";
  const role = roleLabels[profile.role] || profile.role || "مستخدم";
  document.getElementById("sidebar-user-name").textContent = displayName;
  document.getElementById("sidebar-user-role").textContent = role;
  document.getElementById("top-user-name").textContent = displayName;
  document.getElementById("top-user-role").textContent = role;
  document.getElementById("sidebar-avatar").textContent = initials(displayName);
  document.getElementById("top-avatar").textContent = initials(displayName);
  const version = document.getElementById("sidebar-version");
  if (version) version.textContent = `الإصدار V${config.version || "12.5.0"}`;
  buildNavigation();
  updateConnectionStatus();
  updateQueueBadge();
  navigate(location.hash.replace("#", "") || "dashboard", false);
  scheduleNotificationRefresh();
}

function renderMenuIcon(icon) {
  return `<i class="${escapeHtml(icon || "fa-solid fa-circle")}"></i>`;
}

function buildNavigation() {
  els.mainNav.innerHTML = menuSections.map(section => {
    const items = section.items.filter(item => canAccess(item.id));
    if (!items.length) return "";
    return `<span class="nav-section-label">${escapeHtml(section.label)}</span>${items.map(item => `
      <button class="nav-link ${state.currentScreen === item.id ? "active" : ""}" data-nav="${item.id}">
        ${renderMenuIcon(item.icon)}<span>${escapeHtml(item.label)}</span>
      </button>`).join("")}`;
  }).join("");
}

async function navigate(screenId, updateHash = true) {
  if (!routeMap.hasOwnProperty(screenId)) screenId = "dashboard";
  if (!canAccess(screenId)) {
    toast("لا تملك صلاحية فتح هذه الشاشة.", "error");
    screenId = "dashboard";
  }
  destroyCharts();
  if (screenId === "ai-assistant" && state.currentScreen !== "ai-assistant") state.previousScreen = state.currentScreen;
  state.currentScreen = screenId;
  state.table = { page: 1, pageSize: config.pageSize || 10, search: "", filters: {}, dateFrom: "", dateTo: "" };
  if (updateHash) history.pushState(null, "", `#${screenId}`);
  const meta = getScreenMeta(screenId);
  els.pageTitle.textContent = meta.label;
  els.breadcrumb.textContent = meta.label;
  const pageIcon = document.querySelector("#page-symbol i");
  if (pageIcon) pageIcon.className = meta.icon || "fa-solid fa-layer-group";
  document.title = `${meta.label} | ${config.appName || "نظام الزكاة"}`;
  buildNavigation();
  els.sidebar.classList.remove("open");
  setLoading();
  dataService.touchSession().catch(error => console.warn("تعذر تحديث وقت نشاط الجلسة", error));

  try {
    if (screenId === "dashboard") await renderDashboard();
    else if (screenId === "ai-assistant") await renderAssistantScreen(els.pageContent, dataService, state.session, { currentScreen: state.previousScreen });
    else if (screenId === "global-search") await renderReports();
    else if (screenId === "guide") await renderGuide();
    else if (screenId === "classifications") await renderClassifications();
    else if (screenId === "reports") await renderReports();
    else if (screenId === "sync") await renderSync();
    else if (screenId === "settings") await renderSettings();
    else {
      const table = routeMap[screenId];
      const cfgKey = configKeyMap[table];
      await renderDataScreen(screenConfigs[cfgKey]);
    }
  } catch (error) {
    console.error(error);
    els.pageContent.innerHTML = `<div class="panel empty-state"><i class="fa-solid fa-triangle-exclamation"></i><h3>تعذر تحميل الشاشة</h3><p>${escapeHtml(error.message || "حدث خطأ غير متوقع")}</p><button class="primary-button" data-retry style="margin:16px auto 0">إعادة المحاولة</button></div>`;
  }
  els.pageContent.focus({ preventScroll: true });
}

function dashboardMetric(iconClass, color, label, value, foot, screen) {
  return `<button class="metric-card" data-nav="${screen}">
    <div class="metric-top"><span class="metric-icon ${color}"><i class="${iconClass}" aria-hidden="true"></i></span><span class="metric-open" aria-hidden="true"><i class="fa-solid fa-arrow-left"></i></span></div>
    <span class="metric-label">${escapeHtml(label)}</span><strong class="metric-value">${value}</strong><small class="metric-foot">${escapeHtml(foot)}</small>
  </button>`;
}

async function renderDashboard() {
  const [beneficiaries, campaigns, receipts, payments, items, pendingCash, pendingInKind] = await Promise.all([
    dataService.list("beneficiaries", { pageSize: 1000 }),
    dataService.list("campaigns", { pageSize: 1000 }),
    dataService.list("cash_receipts", { pageSize: 1000 }),
    dataService.list("cash_payments", { pageSize: 1000 }),
    dataService.list("items", { pageSize: 1000 }),
    dataService.list("cash_payments", { filters: { status: "under_review" }, pageSize: 20 }),
    dataService.list("in_kind_payments", { filters: { status: "under_review" }, pageSize: 20 })
  ]);

  const displayCurrency = state.dashboardCurrency;
  const finance = buildCashFlowSummary(receipts.data, payments.data, displayCurrency);
  const currencyCodes = [...new Set([displayCurrency, "YER", "SAR", "USD", ...receipts.data.map(row => row.currency), ...payments.data.map(row => row.currency)])]
    .filter(code => /^[A-Z]{3}$/.test(code));
  const currencyNames = typeof Intl.DisplayNames === "function" ? new Intl.DisplayNames(["ar"], { type: "currency" }) : null;
  const currencyOptions = currencyCodes.map(code => `<option value="${escapeHtml(code)}" ${code === displayCurrency ? "selected" : ""}>${escapeHtml(currencyNames?.of(code) || code)}</option>`).join("");
  const stockTotal = items.data.reduce((a, x) => a + Number(x.available_qty || 0), 0);
  const activeBeneficiaries = beneficiaries.data.filter(x => x.status === "approved").length;
  const openCampaigns = campaigns.data.filter(x => x.status === "open").length;
  const profile = state.session.profile || {};
  const firstName = profile.full_name?.split(" ")[0] || "بك";
  const canAddBeneficiary = roleCanWrite("beneficiaries", "create");
  const canQuickDeliver = roleCanWrite("distribution_assignments", "create");
  const canAddInKindReceipt = roleCanWrite("in_kind_receipts", "create");

  const recent = [...receipts.data.map(x => ({ ...x, kind: "قبض نقدي", amountText: formatCurrency(x.amount, x.currency), person: x.donor_name, icon: "fa-arrow-down", color: "green" })),
    ...payments.data.map(x => ({ ...x, kind: "صرف نقدي", amountText: formatCurrency(x.amount, x.currency), person: x.beneficiary_name, icon: "fa-arrow-up", color: "blue" }))]
    .sort((a, b) => String(b.created_at || b.receipt_date || b.payment_date).localeCompare(String(a.created_at || a.receipt_date || a.payment_date))).slice(0, 6);

  const lowStock = items.data.filter(x => Number(x.available_qty || 0) <= Number(x.min_stock || 0));
  const duplicateCandidates = beneficiaries.data.filter((row, idx, arr) => row.phone && arr.findIndex(x => x.phone === row.phone) !== idx);
  const pendingCount = pendingCash.total + pendingInKind.total;

  els.pageContent.innerHTML = `
    <section class="welcome-banner">
      <div class="welcome-copy"><span><i class="fa-regular fa-sun" aria-hidden="true"></i> لوحة المتابعة اليومية</span><h2>مرحباً ${escapeHtml(firstName)}، إليك ملخص العمل.</h2><p>وقت العرض: ${formatDate(new Date().toISOString(), true)} • ${dataService.demoMode ? "بيانات تجريبية محلية" : isOnline() ? "وضع العمل المتصل" : "آخر بيانات محفوظة محلياً"}</p></div>
      <div class="welcome-actions">${canQuickDeliver ? `<button class="white-action primary" data-quick-delivery><i class="fa-solid fa-bolt"></i> تسليم سريع لمستفيد</button>` : ""}${canAddBeneficiary ? `<button class="white-action" data-quick-add="beneficiaries"><i class="fa-solid fa-user-plus"></i> مستفيد جديد</button>` : ""}</div>
    </section>
    <section class="metrics-grid">
      ${dashboardMetric("fa-solid fa-people-roof", "blue", "المستفيدون المعتمدون", formatNumber(activeBeneficiaries), `${beneficiaries.total} ملف مسجل`, "beneficiaries")}
      ${dashboardMetric("fa-solid fa-bullseye", "purple", "الحملات المفتوحة", formatNumber(openCampaigns), `${campaigns.total} حملة إجمالاً`, "campaigns")}
      ${dashboardMetric("fa-solid fa-arrow-trend-down", "green", "المقبوض بالعملة المختارة", formatCurrency(finance.receivedTotal, displayCurrency), "من السندات المرحلة المحمّلة", "cash-receipts")}
      ${dashboardMetric("fa-solid fa-arrow-trend-up", "amber", "المصروف بالعملة المختارة", formatCurrency(finance.spentTotal, displayCurrency), "من السندات المرحلة المحمّلة", "cash-payments")}
      ${dashboardMetric("fa-solid fa-boxes-stacked", "red", "المخزون المتاح", formatNumber(stockTotal), `${lowStock.length} أصناف تحت الحد`, "inventory")}
    </section>
    <section class="dashboard-grid">
      <article class="panel"><header class="panel-header"><div class="panel-title"><span class="title-icon"><i class="fa-solid fa-chart-line"></i></span><div><h3>حركة القبض والصرف</h3><p>آخر ستة أشهر من السندات المحمّلة، بالعملة المختارة</p></div></div><div class="panel-actions"><label class="cash-currency-control">عملة العرض<select class="form-control" data-cash-flow-currency>${currencyOptions}</select></label><button class="secondary-button" data-nav="reports"><i class="fa-solid fa-arrow-up-right-from-square"></i> التقارير</button></div></header><div class="panel-body"><div class="chart-wrap"><canvas id="cash-flow-chart"></canvas></div></div></article>
      <article class="panel"><header class="panel-header"><div class="panel-title"><span class="title-icon"><i class="fa-solid fa-bell"></i></span><div><h3>التنبيهات المهمة</h3><p>تحتاج إلى متابعة أو قرار</p></div></div><span class="status-badge under_review">${pendingCount + lowStock.length + duplicateCandidates.length} تنبيه</span></header><div class="panel-body"><div class="alert-list">
        ${lowStock.length ? `<div class="alert-item danger"><i class="fa-solid fa-box-open"></i><div class="alert-copy"><strong>مخزون منخفض</strong><span>${lowStock.map(x => x.name).slice(0, 3).join("، ")}</span></div><button data-nav="inventory">فتح</button></div>` : ""}
        ${pendingCount ? `<div class="alert-item warning"><i class="fa-solid fa-hourglass-half"></i><div class="alert-copy"><strong>عمليات تحت المراجعة</strong><span>${pendingCount} سند صرف ينتظر الاعتماد</span></div><button data-nav="cash-payments">فتح</button></div>` : ""}
        ${duplicateCandidates.length ? `<div class="alert-item info"><i class="fa-solid fa-clone"></i><div class="alert-copy"><strong>تشابه في المستفيدين</strong><span>${duplicateCandidates.length} ملف يحتاج فحص التكرار</span></div><button data-nav="beneficiaries">فتح</button></div>` : ""}
        <div class="alert-item info"><i class="fa-solid fa-cloud-arrow-up"></i><div class="alert-copy"><strong>حالة المزامنة</strong><span>${isOnline() ? "الاتصال متاح؛ راجع قائمة المزامنة" : "الجهاز غير متصل حالياً"}</span></div><button data-nav="sync">عرض</button></div>
      </div></div></article>
    </section>
    <section class="dashboard-grid equal">
      <article class="panel"><header class="panel-header"><div class="panel-title"><span class="title-icon"><i class="fa-solid fa-clock-rotate-left"></i></span><div><h3>آخر العمليات</h3><p>أحدث سندات القبض والصرف</p></div></div><button class="ghost-button" data-nav="audit">عرض السجل</button></header><div class="table-scroll"><table class="data-table" style="min-width:620px"><thead><tr><th>العملية</th><th>الطرف</th><th>الحملة</th><th>القيمة</th><th>الحالة</th></tr></thead><tbody>${recent.map(x => `<tr><td><div class="cell-title"><span class="cell-avatar"><i class="fa-solid ${x.icon}"></i></span><div><strong>${escapeHtml(x.kind)}</strong><small>${formatDate(x.receipt_date || x.payment_date)}</small></div></div></td><td>${escapeHtml(x.person || "-")}</td><td>${escapeHtml(x.campaign_name || "-")}</td><td><strong>${x.amountText}</strong></td><td>${statusBadge(x.status)}</td></tr>`).join("")}</tbody></table></div></article>
      <article class="panel"><header class="panel-header"><div class="panel-title"><span class="title-icon"><i class="fa-solid fa-bolt"></i></span><div><h3>إجراءات سريعة</h3><p>ابدأ أكثر العمليات استخداماً</p></div></div></header><div class="panel-body"><div class="quick-actions-grid">
        ${canQuickDeliver ? `<button class="quick-action-card" data-quick-delivery><i class="fa-solid fa-bolt"></i><span>تسليم سريع لمستفيد</span></button>` : ""}
        ${roleCanWrite("cash_payments", "create") ? `<button class="quick-action-card" data-quick-add="cash_payments"><i class="fa-solid fa-hand-holding-dollar"></i><span>سند صرف نقدي</span></button>` : ""}
        ${canAddInKindReceipt ? `<button class="quick-action-card" data-quick-add="in_kind_receipts"><i class="fa-solid fa-truck-ramp-box"></i><span>قبض عيني</span></button>` : ""}
        <button class="quick-action-card" data-quick-add="in_kind_payments"><i class="fa-solid fa-box-open"></i><span>صرف عيني</span></button>
      </div></div></article>
    </section>`;

  els.pageContent.querySelector("[data-cash-flow-currency]").addEventListener("change", event => {
    state.dashboardCurrency = event.target.value;
    const selected = buildCashFlowSummary(receipts.data, payments.data, state.dashboardCurrency);
    els.pageContent.querySelector('.metric-card[data-nav="cash-receipts"] .metric-value').textContent = formatCurrency(selected.receivedTotal, state.dashboardCurrency);
    els.pageContent.querySelector('.metric-card[data-nav="cash-payments"] .metric-value').textContent = formatCurrency(selected.spentTotal, state.dashboardCurrency);
    destroyCharts();
    createCashFlowChart(receipts.data, payments.data, state.dashboardCurrency);
  });
  requestAnimationFrame(() => createCashFlowChart(receipts.data, payments.data, state.dashboardCurrency));
}

function createCashFlowChart(receipts, payments, currency) {
  const canvas = document.getElementById("cash-flow-chart");
  if (!canvas || !window.Chart) return;
  const summary = buildCashFlowSummary(receipts, payments, currency);
  const fontSize = Math.max(11, Math.round(parseFloat(getComputedStyle(document.body).fontSize) * .75));
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: summary.months.map(month => new Intl.DateTimeFormat("ar", { month: "short", year: "2-digit" }).format(month.date)), datasets: [
      { label: "المقبوض", data: summary.received, borderColor: "#0f67d8", backgroundColor: "rgba(15,103,216,.09)", fill: true, tension: .42, pointRadius: 3 },
      { label: "المصروف", data: summary.spent, borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,.05)", fill: true, tension: .42, pointRadius: 3 }
    ]},
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { tooltip: { callbacks: { label: context => `${context.dataset.label}: ${formatCurrency(context.parsed.y, currency)}` } }, legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, font: { family: "Tajawal", size: fontSize } } } }, scales: { x: { grid: { display: false }, ticks: { font: { family: "Tajawal", size: fontSize } } }, y: { beginAtZero: true, ticks: { callback: value => Number(value).toLocaleString("ar"), font: { family: "Tajawal", size: fontSize } }, grid: { color: "rgba(148,163,184,.14)" } } } }
  });
  state.charts.push(chart);
}

async function renderClassifications() {
  const tabs = `<div class="toolbar-actions"><button class="${state.classificationTab === "beneficiary_categories" ? "primary-button" : "ghost-button"}" data-class-tab="beneficiary_categories"><i class="fa-solid fa-tags"></i> فئات المستفيدين</button><button class="${state.classificationTab === "health_conditions" ? "primary-button" : "ghost-button"}" data-class-tab="health_conditions"><i class="fa-solid fa-notes-medical"></i> الحالات الصحية</button></div>`;
  await renderDataScreen(screenConfigs[state.classificationTab], { prependToolbar: tabs });
}

function renderToolbar(cfg, prependToolbar = "") {
  const canAdd = roleCanWrite(cfg.table, "create");
  const canImport = cfg.importable && canAdd;
  return `<section class="page-toolbar"><div><div class="page-description">${escapeHtml(cfg.description || "")}</div>${prependToolbar ? `<div style="margin-top:12px">${prependToolbar}</div>` : ""}</div><div class="toolbar-actions">
    ${canImport ? `<button class="ghost-button" data-download-import-template="${escapeHtml(cfg.table)}"><i class="fa-solid fa-file-arrow-down"></i> نموذج Excel</button><button class="ghost-button" data-open-import="${escapeHtml(cfg.table)}"><i class="fa-solid fa-file-import"></i> استيراد</button>` : ""}
    <button class="ghost-button" data-export-current><i class="fa-solid fa-file-export"></i> تصدير</button>
    <button class="ghost-button" data-print-current><i class="fa-solid fa-print"></i> طباعة</button>
    ${cfg.primaryLabel && canAdd ? `<button class="primary-button" data-add-record><i class="fa-solid fa-plus"></i> ${escapeHtml(cfg.primaryLabel)}</button>` : ""}
  </div></section>`;
}

function genericFilters(cfg) {
  const statusColumn = cfg.columns.find(c => c.type === "status" || c.type === "boolean-status");
  const statusKey = statusColumn?.type === "boolean-status" ? (statusColumn.key || "is_active") : "status";
  const statusOptions = statusColumn?.type === "boolean-status"
    ? [["true", "نشط"], ["false", "موقوف"]]
    : ["active", "inactive", "draft", "under_review", "approved", "posted", "cancelled", "open", "closed", "completed", "reopened"].map(value => [value, statusLabels[value] || value]);
  return `<section class="filter-bar"><div class="search-input"><i class="fa-solid fa-magnifying-glass"></i><input id="table-search" value="${escapeHtml(state.table.search)}" placeholder="ابحث في ${escapeHtml(cfg.title)}..." /></div>
    ${statusColumn ? `<div class="filter-control"><select id="status-filter" data-filter-key="${statusKey}"><option value="">كل الحالات</option>${statusOptions.map(([value, label]) => `<option value="${value}" ${String(state.table.filters[statusKey] ?? "") === value ? "selected" : ""}>${escapeHtml(label)}</option>`).join("")}</select></div>` : `<div class="filter-control"><select disabled><option>كل الحالات</option></select></div>`}
    <div class="filter-control"><input id="date-from-filter" type="date" title="من تاريخ" value="${escapeHtml(state.table.dateFrom || "")}" /></div>
    <div class="filter-control"><input id="date-to-filter" type="date" title="إلى تاريخ" value="${escapeHtml(state.table.dateTo || "")}" /></div>
    <button class="secondary-button" data-refresh-table><i class="fa-solid fa-rotate"></i> تحديث</button></section>`;
}

async function renderDataScreen(cfg, options = {}) {
  if (!cfg) throw new Error("تعذر العثور على إعدادات الشاشة.");
  state.currentConfig = cfg;
  const result = await dataService.list(cfg.table, { ...state.table, dateKey: cfg.dateKey });
  state.currentRows = result.data;
  state.currentPrint = { title: cfg.title, columns: cfg.columns };
  const totalPages = Math.max(1, Math.ceil(result.total / state.table.pageSize));
  if (state.table.page > totalPages) state.table.page = totalPages;

  els.pageContent.innerHTML = `${renderToolbar(cfg, options.prependToolbar || "")}${genericFilters(cfg)}
    <section class="table-card"><header class="table-card-header"><div class="table-title-block"><span class="table-title-icon" aria-hidden="true">${renderMenuIcon(getScreenMeta(state.currentScreen).icon)}</span><div><h3>${escapeHtml(cfg.title)}</h3><p>${formatNumber(result.total)} سجل • الصفحة ${state.table.page} من ${totalPages}</p></div></div><span class="table-view-label"><i class="fa-solid fa-table-list" aria-hidden="true"></i> السجلات</span></header>
    ${renderTable(cfg, result.data)}
    <footer class="table-footer"><span>عرض ${result.data.length ? (state.table.page - 1) * state.table.pageSize + 1 : 0} - ${Math.min(state.table.page * state.table.pageSize, result.total)} من ${result.total}</span><div class="pagination">
      <button class="page-button" data-page="${Math.max(1, state.table.page - 1)}" ${state.table.page === 1 ? "disabled" : ""}><i class="fa-solid fa-chevron-right"></i></button>
      ${paginationButtons(state.table.page, totalPages)}
      <button class="page-button" data-page="${Math.min(totalPages, state.table.page + 1)}" ${state.table.page === totalPages ? "disabled" : ""}><i class="fa-solid fa-chevron-left"></i></button>
    </div></footer></section>`;
}

function paginationButtons(current, total) {
  const pages = new Set([1, total, current - 1, current, current + 1]);
  return [...pages].filter(x => x >= 1 && x <= total).sort((a, b) => a - b).map((page, idx, arr) => {
    const gap = idx > 0 && page - arr[idx - 1] > 1 ? `<span style="padding:6px">…</span>` : "";
    return `${gap}<button class="page-button ${page === current ? "active" : ""}" data-page="${page}">${page}</button>`;
  }).join("");
}

function renderTable(cfg, rows) {
  if (!rows.length) return `<div class="empty-state"><i class="${cfg.icon || "fa-solid fa-folder-open"}"></i><h3>لا توجد بيانات مطابقة</h3><p>غيّر البحث أو أضف أول ${escapeHtml(cfg.singular || "سجل")}.</p></div>`;
  return `<div class="table-scroll"><table class="data-table"><thead><tr>${cfg.columns.map(col => `<th>${escapeHtml(col.label)}</th>`).join("")}<th>الإجراءات</th></tr></thead><tbody>${rows.map(row => `<tr>${cfg.columns.map(col => `<td>${renderCell(row, col)}</td>`).join("")}<td>${renderRowActions(cfg, row)}</td></tr>`).join("")}</tbody></table></div>`;
}

function renderCell(row, col) {
  const value = row[col.key];
  if (col.sensitive) return `<span class="private-value"><i class="fa-solid fa-shield-halved" aria-hidden="true"></i>${escapeHtml(formatPrivateValue(value))}</span>`;
  switch (col.type) {
    case "name": return `<div class="cell-title"><span class="cell-avatar">${escapeHtml(initials(value || "س"))}</span><div><strong>${escapeHtml(value || "-")}</strong><small>${escapeHtml(row[col.subKey] || "")}</small></div></div>`;
    case "currency": return `<strong>${formatCurrency(value, row.currency || config.currency)}</strong>`;
    case "number": return formatNumber(value);
    case "date": return formatDate(value);
    case "datetime": return formatDate(value, true);
    case "status": return statusBadge(value);
    case "boolean-status": return statusBadge(Boolean(value));
    case "boolean": return value ? `<i class="fa-solid fa-check text-success"></i>` : `<i class="fa-solid fa-minus muted"></i>`;
    case "role": return roleBadge(value);
    case "priority": return priorityBadge(value);
    case "short-id": return `<code style="direction:ltr;font-size:9px">${escapeHtml(String(value || "-").slice(0, 12))}</code>`;
    default: return escapeHtml(value ?? "-");
  }
}

const actionMeta = {
  view: ["fa-regular fa-eye", "عرض"], edit: ["fa-regular fa-pen-to-square", "تعديل"], toggle: ["fa-solid fa-power-off", "تفعيل/إيقاف"],
  "reset-password": ["fa-solid fa-key", "إعادة كلمة المرور"], statement: ["fa-solid fa-file-invoice", "كشف حساب"], "aid-history": ["fa-solid fa-clock-rotate-left", "سجل المساعدات"],
  "duplicate-check": ["fa-solid fa-clone", "فحص التكرار"], approve: ["fa-solid fa-circle-check", "اعتماد"], report: ["fa-solid fa-chart-column", "تقرير"],
  "open-close": ["fa-solid fa-door-open", "فتح/إغلاق"], post: ["fa-solid fa-stamp", "ترحيل"], print: ["fa-solid fa-print", "طباعة"],
  cancel: ["fa-solid fa-ban", "إلغاء"], "confirm-receipt": ["fa-solid fa-signature", "تأكيد الاستلام"], movements: ["fa-solid fa-arrow-right-arrow-left", "حركة الصنف"],
  copy: ["fa-regular fa-copy", "نسخ"], settle: ["fa-solid fa-scale-balanced", "تسوية"], export: ["fa-solid fa-file-export", "تصدير"], "stock-check": ["fa-solid fa-warehouse", "فحص المخزون"], reopen: ["fa-solid fa-lock-open", "إعادة فتح"],
  activity: ["fa-solid fa-list-check", "سجل نشاط المستخدم"], "download-template": ["fa-solid fa-file-arrow-down", "تنزيل النموذج"], retry: ["fa-solid fa-rotate-right", "إعادة المحاولة"],
  attachments: ["fa-solid fa-paperclip", "عرض المرفقات"]
};

function availableActions(cfg, row) {
  const role = state.session?.profile?.role;
  return (cfg.actions || []).filter(action => {
    if (action === "copy" && !roleCanWrite(cfg.table, "create")) return false;
    if (mutatingRowActions.has(action) && !roleCanWrite(cfg.table, "update")) return false;
    if (action === "retry" && !["admin", "supervisor", "accountant"].includes(role)) return false;
    if (cfg.table === "authorized_devices" && row.license_kind === "pending_first_device" && action !== "view") return false;
    if (role === "distributor" && cfg.table === "beneficiaries" && ["edit", "approve", "toggle"].includes(action)) return false;
    if (action === "edit" && ["posted", "cancelled", "closed"].includes(row.status)) return false;
    if (action === "edit" && cfg.table === "campaign_distributors" && row.status === "settled") return false;
    if (action === "post" && !["approved", "under_review", "draft"].includes(row.status)) return false;
    if (action === "cancel" && row.status === "cancelled") return false;
    if (action === "approve" && row.status !== "under_review") return false;
    if (action === "toggle" && cfg.table === "beneficiaries" && !["approved", "suspended"].includes(row.status)) return false;
    if (action === "confirm-receipt" && (row.receipt_status === "received" || row.status !== "posted")) return false;
    if (action === "settle" && row.status !== "active") return false;
    if (action === "reopen" && cfg.table === "campaign_distributors" && (row.status !== "settled" || !row.settled_at)) return false;
    if (action === "toggle" && cfg.table === "campaign_distributors" && !["active", "suspended"].includes(row.status)) return false;
    if (action === "retry" && row.status !== "failed") return false;
    return true;
  });
}

function renderRowActions(cfg, row) {
  const actions = availableActions(cfg, row);
  const hasAttachment = (cfg.fields || []).some(field => field.type === "file" && row[field.key]);
  const attachmentButton = hasAttachment ? `<button class="row-action attachment-action" data-row-action="attachments" data-id="${row.id}" title="عرض المرفقات" aria-label="عرض المرفقات"><i class="fa-solid fa-paperclip"></i></button>` : "";
  return `<div class="row-actions">${attachmentButton}${actions.map(action => {
    let meta = actionMeta[action] || ["fa-solid fa-ellipsis", action];
    let stateClass = "";
    if (action === "toggle") {
      const active = cfg.table === "beneficiaries" ? row.status === "approved"
        : cfg.table === "campaign_distributors" ? row.status === "active"
        : cfg.table === "authorized_devices" ? row.status === "approved"
        : row.is_active === true;
      meta = [active ? "fa-solid fa-toggle-on" : "fa-solid fa-toggle-off", active ? "إيقاف" : "تفعيل"];
      stateClass = active ? "toggle-on" : "toggle-off";
    }
    return `<button class="row-action ${action === "cancel" ? "danger" : ""} ${stateClass}" data-row-action="${action}" data-id="${row.id}" title="${meta[1]}" aria-label="${meta[1]}"><i class="${meta[0]}"></i></button>`;
  }).join("")}</div>`;
}

async function loadRelationOptions(field) {
  if (!["relation", "autocompleteRelation"].includes(field.type)) return [];
  const result = await dataService.list(field.relation.table, { pageSize: 1000, filters: field.relation.filter || {} });
  return result.data.map(row => {
    const base = row[field.relation.label] || row.name || row.full_name || row.voucher_no || row.id;
    const label = field.relation.table === "cashboxes" ? `${base} — ${formatCurrency(row.current_balance, row.currency)} (${row.currency || config.currency})` : base;
    return { value: row.id, label, row };
  });
}

async function openRecordForm(cfg, record = null, copyMode = false) {
  const role = state.session?.profile?.role || "data_entry";
  const profile = state.session?.profile || {};
  const mode = record && !copyMode ? "update" : "create";
  if (!roleCanWrite(cfg.table, mode)) return toast("لا يملك دورك الحالي صلاحية حفظ هذا النوع من السجلات.", "error");
  if (!record && cfg.table === "beneficiaries" && role === "distributor" && profile.can_create_beneficiaries !== true) {
    return toast("لم يمنحك مدير النظام صلاحية إضافة مستفيدين جدد.", "error");
  }
  const activeFields = cfg.fields.filter(field => (!field.adminOnly || role === "admin") && !(cfg.table === "beneficiaries" && role === "distributor" && field.key === "status"));
  const relationFields = activeFields.filter(f => ["relation", "autocompleteRelation"].includes(f.type));
  const relationResults = await Promise.all(relationFields.map(loadRelationOptions));
  const relationMap = new Map(relationFields.map((f, i) => [f.key, relationResults[i]]));
  const hasFileFields = activeFields.some(field => field.type === "file");
  const attachmentSettings = hasFileFields ? (await dataService.list("system_settings", { pageSize: 1 })).data[0] || {} : {};
  const itemResult = activeFields.some(f => f.type === "lineItems") ? await dataService.list("items", { pageSize: 1000, filters: { is_active: true } }) : { data: [] };
  const currencyResult = cfg.table === "currency_exchanges" ? await dataService.list("currencies", { pageSize: 200, filters: { is_active: true } }) : { data: [] };
  let values = record ? { ...record } : {};
  if (cfg.table === "profiles") values.first_device_auto_approve = Boolean(values.first_device_auto_approve_until && new Date(values.first_device_auto_approve_until) > new Date());
  if (cfg.table === "in_kind_receipts" && !values.received_by_name) values.received_by_name = profile.full_name || "";
  if (role === "distributor" && activeFields.some(field => field.key === "delegate_id")) {
    values.delegate_id = profile.delegate_id || values.delegate_id;
  }
  if (copyMode) {
    values = { ...values, id: undefined, name: `${values.name || "نسخة"} - نسخة`, status: values.status === "posted" ? "draft" : values.status };
  }
  const paymentContext = cfg.table === "cash_payments" ? `<div id="payment-context" class="quick-delivery-context hidden"></div>` : "";
  const body = `${cfg.backdateRestricted ? `<div class="info-callout"><i class="fa-solid fa-calendar-check"></i><span>تاريخ السند الافتراضي هو اليوم. التاريخ السابق يتطلب مديراً أو مشرفاً ويُسجل في التدقيق.</span></div>` : ""}<form id="record-form" class="form-grid" novalidate autocomplete="off">${activeFields.map(field => renderFormField(field, values[field.key], relationMap.get(field.key), itemResult.data)).join("")}${paymentContext}</form>`;
  openModal({
    title: `${record && !copyMode ? "تعديل" : "إضافة"} ${cfg.singular}`,
    eyebrow: cfg.title,
    body,
    footer: `<button class="ghost-button" data-close-modal>إلغاء</button><button class="primary-button" id="save-record"><i class="fa-solid fa-floppy-disk"></i> حفظ البيانات</button>`,
    wide: activeFields.some(f => f.type === "lineItems")
  });

  document.querySelectorAll("[data-add-line-item]").forEach(btn => btn.addEventListener("click", () => addLineItemRow(btn.dataset.mode, itemResult.data)));
  document.querySelectorAll("[data-remove-line-item]").forEach(btn => btn.addEventListener("click", () => btn.closest(".line-item-row").remove()));
  bindSmartFormFields(cfg, relationMap, currencyResult.data, Boolean(record && !copyMode));
  bindAttachmentFields(activeFields, attachmentSettings);
  const saveButton = document.getElementById("save-record");
  saveButton.addEventListener("click", async () => {
    let recordPersisted = false;
    try {
      let payload = await collectFormData(activeFields);
      payload = await preparePayloadForSave(cfg, payload, relationMap);
      const missing = activeFields.filter(f => (f.required || (!record && f.requiredOnCreate)) && isEmptyValue(payload[f.key]));
      if (missing.length) throw new Error(`الحقول المطلوبة: ${missing.map(f => f.label).join("، ")}`);
      saveButton.disabled = true; saveButton.innerHTML = `<span class="spinner" style="width:20px;height:20px;border-width:2px"></span> جارٍ الحفظ`;
      const saved = record && !copyMode ? await dataService.update(cfg.table, record.id, payload) : await dataService.create(cfg.table, payload);
      recordPersisted = true;
      const uploadedAttachments = uploadedAttachmentsFromFields(activeFields);
      try {
        await dataService.finalizePendingAttachments(cfg.table, saved.id || record?.id, uploadedAttachments);
      } catch (metadataError) {
        closeModal();
        toast(`تم حفظ السجل، لكن تعذر تسجيل فهرس المرفق: ${metadataError.message}. الملف محفوظ وسيظهر في النسخة V4.`, "warning");
        await refreshCurrentScreen();
        return;
      }
      closeModal();
      toast(saved?._queued ? "تم حفظ العملية محلياً وستُزامن عند عودة الاتصال." : "تم حفظ البيانات بنجاح.", saved?._queued ? "warning" : "success");
      await refreshCurrentScreen();
    } catch (error) {
      if (!recordPersisted) {
        try { await cleanupUploadedAttachments(activeFields); } catch {                                            }
      }
      saveButton.disabled = false;
      saveButton.innerHTML = `<i class="fa-solid fa-floppy-disk"></i> حفظ البيانات`;
      toast(error.message || "تعذر الحفظ.", "error");
    }
  });
}

function isEmptyValue(value) {
  return value === undefined || value === null || value === "" || (Array.isArray(value) && !value.length);
}

function renderFormField(field, value, relationOptions = [], itemOptions = []) {
  const full = field.full || ["textarea", "lineItems"].includes(field.type) ? "full" : "";
  const label = `<label for="field-${field.key}">${escapeHtml(field.label)}${field.required || field.requiredOnCreate ? `<span class="required">*</span>` : ""}</label>`;
  if (field.type === "section") return `<div class="form-section"><strong>${escapeHtml(field.label)}</strong></div>`;
  if (field.type === "switch") return `<div class="form-field ${full}"><div class="switch-field"><div class="switch-copy"><strong>${escapeHtml(field.label)}</strong><small>${escapeHtml(field.help || "")}</small></div><label class="switch"><input id="field-${field.key}" name="${field.key}" type="checkbox" ${value ?? field.default ? "checked" : ""}><span class="switch-slider"></span></label></div></div>`;
  if (field.type === "lineItems") {
    const rows = Array.isArray(value) && value.length ? value : [{}];
    return `<div class="line-items" data-line-items="${field.key}" data-mode="${field.mode}"><div class="line-items-header"><strong>${escapeHtml(field.label)}</strong><button class="secondary-button" type="button" data-add-line-item data-mode="${field.mode}"><i class="fa-solid fa-plus"></i> إضافة صنف</button></div><div class="line-items-list">${rows.map(row => lineItemRow(field.mode, itemOptions, row)).join("")}</div></div>`;
  }
  let control = "";
  const role = state.session?.profile?.role || "data_entry";
  const locked = field.lockForAll || (field.lockForNonAdmin && role !== "admin")
    || ((field.lockForDistributor || field.key === "delegate_id") && role === "distributor");
  const common = `id="field-${field.key}" name="${field.key}" class="form-control" autocomplete="off" ${field.required ? "required" : ""} ${locked ? "disabled data-locked=\"true\"" : ""}`;
  const smartRelation = ["relation", "autocompleteRelation"].includes(field.type)
    && shouldUseSearchableSelect(relationOptions.length, field.type === "autocompleteRelation" ? 0 : (field.searchThreshold ?? 8));
  if (smartRelation) {
    const selected = relationOptions.find(option => String(option.value) === String(value ?? ""));
    control = `<div class="smart-select" data-smart-select="${field.key}" data-relation-autocomplete="${field.key}">
      <div class="smart-select-input"><i class="fa-solid fa-magnifying-glass"></i><input id="field-${field.key}-search" class="form-control" type="search" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off" placeholder="${escapeHtml(field.placeholder || "ابحث ثم اختر من القائمة")}" value="${escapeHtml(selected?.label || "")}" ${field.required ? "required" : ""} ${locked ? "disabled" : ""}><button type="button" class="smart-select-clear ${selected ? "" : "hidden"}" data-smart-clear aria-label="مسح الاختيار"><i class="fa-solid fa-xmark"></i></button></div>
      <input id="field-${field.key}" name="${field.key}" type="hidden" value="${escapeHtml(value || "")}">
      <div class="smart-select-menu hidden" role="listbox" data-relation-suggestions>${relationOptions.map(opt => `<button type="button" role="option" class="smart-select-option" data-smart-option data-relation-value="${escapeHtml(opt.value)}" data-relation-label="${escapeHtml(opt.label)}" data-delegate-id="${escapeHtml(opt.row?.delegate_id || "")}" data-name="${escapeHtml(opt.row?.full_name || opt.row?.name || "")}" data-phone="${escapeHtml(opt.row?.phone || "")}" data-currency="${escapeHtml(opt.row?.currency || "")}" data-file-no="${escapeHtml(opt.row?.file_no || "")}"><span class="smart-select-option-icon"><i class="fa-solid fa-check"></i></span><span><strong>${escapeHtml(opt.label)}</strong>${opt.row?.file_no ? `<small>${escapeHtml(opt.row.file_no)}</small>` : ""}</span></button>`).join("")}<div class="smart-select-empty hidden" data-smart-empty><i class="fa-regular fa-face-frown-open"></i><span>لا توجد نتيجة مطابقة</span></div></div>
    </div>`;
  } else if (field.type === "select" || field.type === "relation") {
    const options = field.type === "relation" ? relationOptions : (field.options || []);
    control = `<select ${common}><option value="">اختر...</option>${options.map(opt => `<option value="${escapeHtml(opt.value)}" ${opt.row ? `data-phone="${escapeHtml(opt.row.phone || "")}" data-name="${escapeHtml(opt.row.full_name || opt.row.name || "")}" data-currency="${escapeHtml(opt.row.currency || "")}"` : ""} ${String(value ?? resolveFieldDefault(field) ?? "") === String(opt.value) ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}</select>`;
  } else if (field.type === "file") {
    control = `<div class="attachment-field"><div class="file-upload"><input ${common} type="file" accept="${escapeHtml(field.accept || "image/*,application/pdf")}" data-existing-value="${escapeHtml(value || "")}" /><div class="file-upload-copy"><i class="fa-solid fa-cloud-arrow-up"></i><span><strong>اختر صورة بأي صيغة أو ملف PDF</strong><small>تُفحص وتُضغط قبل الرفع${value ? ` • يوجد مرفق محفوظ` : ""}</small></span></div></div><div class="attachment-preview ${value ? "has-existing" : "hidden"}" data-attachment-preview>${value ? `<i class="fa-solid fa-paperclip"></i><span>مرفق محفوظ؛ ارفع ملفاً فقط إذا أردت استبداله</span>` : ""}</div><div class="attachment-progress hidden" data-attachment-progress><div><span data-attachment-message>فحص الملف</span><strong data-attachment-percent>0%</strong></div><div class="progress"><span style="width:0%"></span></div></div></div>`;
  } else if (field.type === "textarea") {
    control = `<textarea ${common} placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(value ?? resolveFieldDefault(field) ?? "")}</textarea>`;
  } else {
    const type = field.type === "currency" ? "number" : (field.type || "text");
    control = `<input ${common} type="${type}" value="${escapeHtml(value ?? resolveFieldDefault(field) ?? "")}" placeholder="${escapeHtml(field.placeholder || "")}" ${field.min !== undefined ? `min="${field.min}"` : ""} ${field.max !== undefined ? `max="${field.max}"` : ""} ${["number", "currency"].includes(field.type) ? `step="${field.step ?? (field.type === "currency" ? "0.01" : "1")}"` : ""} />`;
  }
  return `<div class="form-field ${full}">${label}${control}${field.help ? `<span class="help-text">${escapeHtml(field.help)}</span>` : ""}</div>`;
}

function formatFileSize(bytes) {
  const value = Number(bytes || 0);
  if (value < 1024) return `${value} بايت`;
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} كيلوبايت`;
  return `${(value / 1024 / 1024).toFixed(1)} ميجابايت`;
}

function updateAttachmentProgress(input, event) {
  const field = input.closest(".attachment-field");
  const progress = field?.querySelector("[data-attachment-progress]");
  if (!progress) return;
  progress.classList.remove("hidden");
  progress.querySelector("[data-attachment-message]").textContent = event.message || "معالجة المرفق";
  progress.querySelector("[data-attachment-percent]").textContent = `${event.percent || 0}%`;
  progress.querySelector(".progress > span").style.width = `${Math.max(0, Math.min(100, event.percent || 0))}%`;
}

function bindAttachmentFields(fields, settings) {
  for (const field of fields.filter(item => item.type === "file")) {
    const input = document.getElementById(`field-${field.key}`);
    if (!input) continue;
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      const kind = /profile|avatar/i.test(field.folder || field.key) ? "profile" : "document";
      const policy = normalizeAttachmentPolicy(settings, kind);
      input._preparePromise = prepareAttachment(file, policy, event => updateAttachmentProgress(input, event))
        .then(prepared => {
          input._preparedAttachment = prepared;
          const preview = input.closest(".attachment-field")?.querySelector("[data-attachment-preview]");
          if (preview) {
            preview.classList.remove("hidden");
            const visual = prepared.mimeType.startsWith("image/") && prepared.previewUrl
              ? `<img src="${escapeHtml(prepared.previewUrl)}" alt="معاينة المرفق">`
              : `<i class="fa-solid fa-file-pdf"></i>`;
            preview.innerHTML = `${visual}<span><strong>${escapeHtml(prepared.originalName)}</strong><small>${formatFileSize(prepared.originalSize)} ← ${formatFileSize(prepared.storedSize)}${prepared.compressed ? " بعد الضغط" : " دون تغيير"}</small></span>`;
          }
          return prepared;
        })
        .catch(error => {
          input.value = "";
          input._preparedAttachment = null;
          updateAttachmentProgress(input, { percent: 0, message: error.message });
          toast(error.message || "تعذر تجهيز المرفق.", "error");
          return null;
        });
    });
  }
}

function uploadedAttachmentsFromFields(fields) {
  return fields.filter(field => field.type === "file")
    .map(field => document.getElementById(`field-${field.key}`)?._uploadedAttachment)
    .filter(Boolean);
}

async function cleanupUploadedAttachments(fields) {
  const paths = uploadedAttachmentsFromFields(fields).map(item => item.storagePath).filter(Boolean);
  if (paths.length) await dataService.deleteStorageFiles(paths);
}

function resolveFieldDefault(field) {
  if (field.default !== "today") return field.default;
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 10);
}

function bindSmartFormFields(cfg, relationMap = new Map(), currencyRows = [], editing = false) {
  const role = state.session?.profile?.role || "data_entry";
  document.querySelectorAll("[data-smart-select]").forEach(wrapper => {
    const search = wrapper.querySelector('input[type="search"]');
    const hidden = wrapper.querySelector('input[type="hidden"]');
    const suggestions = wrapper.querySelector("[data-relation-suggestions]");
    const optionNodes = [...suggestions.querySelectorAll("[data-smart-option]")];
    const clear = wrapper.querySelector("[data-smart-clear]");
    const empty = wrapper.querySelector("[data-smart-empty]");
    let activeIndex = -1;
    const showMatches = (clearSelection = true) => {
      if (clearSelection && search.value !== hidden.dataset.selectedLabel) {
        hidden.value = "";
        clear?.classList.add("hidden");
      }
      const source = optionNodes.map(node => ({ value: node.dataset.relationValue, label: node.dataset.relationLabel, row: { file_no: node.dataset.fileNo } }));
      const matches = new Set(filterSearchOptions(source, search.value, ["file_no"]).map(option => String(option.value)));
      let visible = 0;
      optionNodes.forEach(option => {
        const match = matches.has(String(option.dataset.relationValue));
        option.classList.toggle("hidden", !match || visible >= 20);
        option.classList.remove("active");
        if (match && visible < 20) visible += 1;
      });
      empty?.classList.toggle("hidden", visible > 0);
      suggestions.classList.remove("hidden");
      search.setAttribute("aria-expanded", "true");
      activeIndex = -1;
    };
    search.addEventListener("input", () => showMatches(true));
    search.addEventListener("focus", () => showMatches(false));
    search.addEventListener("blur", () => setTimeout(() => {
      suggestions.classList.add("hidden");
      search.setAttribute("aria-expanded", "false");
    }, 150));
    search.addEventListener("keydown", event => {
      const visible = optionNodes.filter(option => !option.classList.contains("hidden"));
      if (event.key === "Escape") { suggestions.classList.add("hidden"); search.setAttribute("aria-expanded", "false"); return; }
      if (!["ArrowDown", "ArrowUp", "Enter"].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Enter" && activeIndex >= 0) return visible[activeIndex]?.click();
      const step = event.key === "ArrowUp" ? -1 : 1;
      activeIndex = Math.max(0, Math.min(visible.length - 1, activeIndex + step));
      visible.forEach((option, index) => option.classList.toggle("active", index === activeIndex));
      visible[activeIndex]?.scrollIntoView({ block: "nearest" });
    });
    suggestions.addEventListener("click", event => {
      const option = event.target.closest("[data-relation-value]");
      if (!option) return;
      hidden.value = option.dataset.relationValue;
      search.value = option.dataset.relationLabel;
      hidden.dataset.selectedLabel = search.value;
      optionNodes.forEach(node => node.setAttribute("aria-selected", String(node === option)));
      clear?.classList.remove("hidden");
      suggestions.classList.add("hidden");
      search.setAttribute("aria-expanded", "false");
      hidden.dispatchEvent(new CustomEvent("relation:selected", { bubbles: true, detail: { id: hidden.value, delegateId: option.dataset.delegateId || null, name: option.dataset.name || "", phone: option.dataset.phone || "", currency: option.dataset.currency || "" } }));
    });
    clear?.addEventListener("click", () => {
      hidden.value = ""; search.value = ""; hidden.dataset.selectedLabel = "";
      clear.classList.add("hidden"); showMatches(false); search.focus();
      hidden.dispatchEvent(new CustomEvent("relation:selected", { bubbles: true, detail: { id: null } }));
    });
    hidden.dataset.selectedLabel = search.value;
    optionNodes.forEach(node => node.setAttribute("aria-selected", String(node.dataset.relationValue === hidden.value)));
  });
  const profileSelect = document.getElementById("field-profile_id");
  if (profileSelect && cfg.table === "delegates") {
    const fillDelegate = event => {
      const option = profileSelect.selectedOptions?.[0];
      const selected = event?.detail || { id: option?.value, name: option?.dataset.name, phone: option?.dataset.phone };
      if (!selected?.id) return;
      const name = document.getElementById("field-full_name");
      const phone = document.getElementById("field-phone");
      if (name) name.value = selected.name || name.value;
      if (phone) phone.value = selected.phone || phone.value;
    };
    profileSelect.addEventListener("change", fillDelegate);
    profileSelect.addEventListener("relation:selected", fillDelegate);
    fillDelegate();
  }
  ["cashbox_id", "from_cashbox_id"].forEach(key => {
    const select = document.getElementById(`field-${key}`);
    if (!select) return;
    const syncCurrency = event => {
      const currency = document.getElementById("field-currency");
      const option = select.selectedOptions?.[0];
      const currencyCode = event?.detail?.currency || option?.dataset.currency;
      if (currency && currencyCode) currency.value = currencyCode;
    };
    select.addEventListener("change", syncCurrency);
    select.addEventListener("relation:selected", syncCurrency);
    syncCurrency();
  });

  const beneficiary = document.getElementById("field-beneficiary_id");
  const delegate = document.getElementById("field-delegate_id");
  const campaign = document.getElementById("field-campaign_id");
  const cashbox = document.getElementById("field-cashbox_id");
  const currency = document.getElementById("field-currency");
  const contextBox = document.getElementById("payment-context");
  const setBeneficiaryDelegate = event => {
    if (delegate && event.detail?.delegateId) delegate.value = event.detail.delegateId;
  };
  beneficiary?.addEventListener("relation:selected", setBeneficiaryDelegate);
  if (cfg.table === "cash_payments") {
    const refreshContext = async () => {
      if (!beneficiary?.value || !campaign?.value || !delegate?.value) {
        contextBox?.classList.add("hidden");
        return;
      }
      if (contextBox) {
        contextBox.classList.remove("hidden");
        contextBox.innerHTML = `<div class="loading-inner"><span class="spinner"></span><span>جاري تحديد الموزع والصندوق والعملة والرصيد...</span></div>`;
      }
      try {
        const ctx = await dataService.getPaymentContext(beneficiary.value, campaign.value, delegate.value);
        delegate.value = ctx.delegate_id;
        cashbox.value = ctx.cashbox_id;
        currency.value = ctx.currency;
        if (contextBox) contextBox.innerHTML = `<div><span>الموزع</span><strong>${escapeHtml(ctx.delegate_name)}</strong></div><div><span>الحملة</span><strong>${escapeHtml(ctx.campaign_name)}</strong></div><div><span>الصندوق / العملة</span><strong>${escapeHtml(ctx.cashbox_name)} — ${escapeHtml(ctx.currency)}</strong></div><div><span>المتاح للصرف</span><strong>${formatCurrency(ctx.available_amount, ctx.currency)}</strong></div>`;
      } catch (error) {
        if (cashbox) cashbox.value = "";
        if (contextBox) contextBox.innerHTML = `<div class="import-errors">${escapeHtml(error.message || "تعذر تحديد سياق الصرف.")}</div>`;
      }
    };
    beneficiary?.addEventListener("relation:selected", refreshContext);
    campaign?.addEventListener("change", refreshContext);
    campaign?.addEventListener("relation:selected", refreshContext);
    if (role === "admin") {
      delegate?.addEventListener("change", refreshContext);
      delegate?.addEventListener("relation:selected", refreshContext);
    }
    if (beneficiary?.value && campaign?.value && delegate?.value) refreshContext();
  }
  if (cfg.table === "currency_exchanges") {
    const fromBoxInput = document.getElementById("field-from_cashbox_id");
    const toBoxInput = document.getElementById("field-to_cashbox_id");
    const fromAmountInput = document.getElementById("field-from_amount");
    const rateInput = document.getElementById("field-exchange_rate");
    const toAmountInput = document.getElementById("field-to_amount");
    const relationRow = (key, id) => (relationMap.get(key) || []).find(option => String(option.value) === String(id || ""))?.row;
    const currencyRow = code => currencyRows.find(row => String(row.code) === String(code));
    const updateTargetAmount = () => {
      const amount = Number(fromAmountInput?.value || 0);
      const rate = Number(rateInput?.value || 0);
      if (toAmountInput && amount > 0 && rate > 0) toAmountInput.value = String(Math.round((amount * rate + Number.EPSILON) * 100) / 100);
    };
    const applyDirectoryRate = () => {
      const fromBox = relationRow("from_cashbox_id", fromBoxInput?.value);
      const toBox = relationRow("to_cashbox_id", toBoxInput?.value);
      const fromCurrency = currencyRow(fromBox?.currency);
      const toCurrency = currencyRow(toBox?.currency);
      if (!rateInput || !fromCurrency || !toCurrency || fromBox?.currency === toBox?.currency) return;
      rateInput.value = String(deriveExchangeRate(fromCurrency.rate_to_base, toCurrency.rate_to_base));
      if (fromAmountInput && toAmountInput && Number(fromAmountInput.value) >= 0) {
        toAmountInput.value = String(convertCurrency(fromAmountInput.value, fromCurrency.rate_to_base, toCurrency.rate_to_base, toCurrency.decimal_places ?? 2));
      }
    };
    [fromBoxInput, toBoxInput].forEach(input => {
      input?.addEventListener("change", applyDirectoryRate);
      input?.addEventListener("relation:selected", applyDirectoryRate);
    });
    fromAmountInput?.addEventListener("input", updateTargetAmount);
    rateInput?.addEventListener("input", updateTargetAmount);
    if (!editing) applyDirectoryRate();
  }
}

async function preparePayloadForSave(cfg, payload, relationMap) {
  const today = resolveFieldDefault({ default: "today" });
  if (cfg.backdateRestricted && cfg.dateKey && payload[cfg.dateKey] && payload[cfg.dateKey] < today) {
    const role = state.session?.profile?.role;
    if (!["admin", "supervisor"].includes(role)) throw new Error("لا تملك صلاحية تسجيل سند بتاريخ سابق. راجع المدير أو المشرف.");
    const approved = await confirmDialog(`تاريخ السند ${payload[cfg.dateKey]} أقدم من اليوم وسيظهر في سجل التدقيق. هل تريد المتابعة؟`, "تنبيه تاريخ سابق", "متابعة");
    if (!approved) throw new Error("أُلغي الحفظ لتعديل تاريخ السند.");
  }
  if (cfg.table === "delegates" && !payload.profile_id && !payload.phone) throw new Error("أدخل رقم الهاتف أو اربط الموزع بحساب مستخدم.");
  if (cfg.table === "cashbox_users") {
    Object.assign(payload, validateCashboxUserAssignment(payload));
  }
  if (cfg.table === "beneficiaries" && state.session?.profile?.role === "distributor") {
    if (!state.session.profile.can_create_beneficiaries) throw new Error("لم يمنحك مدير النظام صلاحية إضافة مستفيدين جدد.");
    if (!state.session.profile.delegate_id) throw new Error("حسابك غير مربوط بسجل موزع نشط.");
    payload.delegate_id = state.session.profile.delegate_id;
    payload.status = "under_review";
    delete payload.approved_by;
    delete payload.approved_at;
  }
  const findRelation = (fieldKey, id) => (relationMap.get(fieldKey) || []).find(x => String(x.value) === String(id))?.row;
  if (cfg.table === "cash_transfers") {
    if (String(payload.from_cashbox_id) === String(payload.to_cashbox_id)) throw new Error("يجب اختيار صندوقين مختلفين.");
    const from = findRelation("from_cashbox_id", payload.from_cashbox_id);
    const to = findRelation("to_cashbox_id", payload.to_cashbox_id);
    if (!from || !to) throw new Error("تعذر قراءة بيانات أحد الصندوقين.");
    if (from.is_active === false || to.is_active === false) throw new Error("لا يمكن التحويل من أو إلى صندوق موقوف.");
    if (from.currency !== to.currency) throw new Error(`عملة الصندوق المصدر ${from.currency} تختلف عن عملة الصندوق الهدف ${to.currency}.`);
    if (Number(payload.amount) > Number(from.current_balance || 0)) throw new Error(`الرصيد غير كافٍ. المتاح في ${from.name}: ${formatCurrency(from.current_balance, from.currency)}.`);
    payload.currency = from.currency;
  }
  if (cfg.table === "currencies") {
    if (!(Number(payload.rate_to_base) > 0)) throw new Error("سعر تحويل العملة يجب أن يكون أكبر من صفر.");
    payload.code = String(payload.code || "").trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(payload.code)) throw new Error("رمز العملة يجب أن يتكون من ثلاثة أحرف إنجليزية، مثل YER.");
    if (payload.is_base) payload.rate_to_base = 1;
  }
  if (cfg.table === "currency_exchanges") {
    if (String(payload.from_cashbox_id) === String(payload.to_cashbox_id)) throw new Error("المصارفة تحتاج صندوقين مختلفين.");
    const from = findRelation("from_cashbox_id", payload.from_cashbox_id);
    const to = findRelation("to_cashbox_id", payload.to_cashbox_id);
    if (!from || !to || from.currency === to.currency) throw new Error("اختر صندوقين نشطين بعملتين مختلفتين.");
    const calculated = Number(payload.from_amount) * Number(payload.exchange_rate);
    if (!(calculated > 0) || Math.abs(calculated - Number(payload.to_amount)) > 0.011) {
      throw new Error(`المبلغ المستلم لا يطابق المبلغ المصدر × سعر العملية. المتوقع ${calculated.toFixed(2)}.`);
    }
  }
  if (cfg.table === "cash_payments") {
    const context = await dataService.getPaymentContext(payload.beneficiary_id, payload.campaign_id, payload.delegate_id);
    payload.delegate_id = context.delegate_id;
    payload.cashbox_id = context.cashbox_id;
    payload.currency = context.currency;
  }
  if (["cash_receipts", "cash_payments", "campaign_funding"].includes(cfg.table) && payload.cashbox_id) {
    const box = findRelation("cashbox_id", payload.cashbox_id);
    if (box?.currency) payload.currency = box.currency;
  }
  if (cfg.table === "in_kind_payments" && payload.distribution_type === "basket" && payload.basket_id && !(payload.details || []).length) {
    const basket = await dataService.get("baskets", payload.basket_id);
    payload.details = (basket?.details || []).map(x => ({ item_id: x.item_id, quantity: Number(x.quantity || 0) })).filter(x => x.item_id && x.quantity > 0);
    if (!payload.details.length) throw new Error("السلة المختارة لا تحتوي أصنافاً. أضف مكوناتها أولاً.");
  }
  return payload;
}

function lineItemRow(mode, items, values = {}) {
  const options = items.map(item => `<option value="${item.id}" ${String(values.item_id || "") === String(item.id) ? "selected" : ""}>${escapeHtml(item.name)} (${escapeHtml(item.unit_name || "")})</option>`).join("");
  if (mode === "receipt") {
    return `<div class="line-item-row receipt"><div class="form-field"><label>الصنف</label><select class="form-control line-item-product"><option value="">اختر الصنف</option>${options}</select></div><div class="form-field"><label>الكمية الكلية</label><input class="form-control line-item-qty" type="number" min="1" value="${values.quantity || ""}"></div><div class="form-field"><label>الصالحة</label><input class="form-control line-item-valid" type="number" min="0" value="${values.valid_qty ?? ""}"></div><div class="form-field"><label>التالفة</label><input class="form-control line-item-damaged" type="number" min="0" value="${values.damaged_qty ?? 0}"></div><div class="form-field"><label>التشغيلة / الصلاحية</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:5px"><input class="form-control line-item-lot" placeholder="رقم التشغيلة" value="${escapeHtml(values.lot_no || "")}"><input class="form-control line-item-expiry" type="date" value="${escapeHtml(values.expiry_date || "")}"></div></div><button class="line-item-remove" type="button" data-remove-line-item><i class="fa-solid fa-trash"></i></button></div>`;
  }
  if (mode === "funding") {
    return `<div class="line-item-row"><div class="form-field"><label>الصنف من المخزون</label><select class="form-control line-item-product"><option value="">اختر الصنف</option>${options}</select></div><div class="form-field"><label>الكمية المخصصة</label><input class="form-control line-item-qty" type="number" min="0.001" step="0.001" value="${values.quantity || 1}"></div><div></div><div></div><button class="line-item-remove" type="button" data-remove-line-item><i class="fa-solid fa-trash"></i></button></div>`;
  }
  if (mode === "basket") {
    return `<div class="line-item-row"><div class="form-field"><label>الصنف</label><select class="form-control line-item-product"><option value="">اختر الصنف</option>${options}</select></div><div class="form-field"><label>الكمية</label><input class="form-control line-item-qty" type="number" min="1" value="${values.quantity || 1}"></div><div class="form-field"><label>إلزامي؟</label><select class="form-control line-item-required"><option value="true" ${values.required !== false ? "selected" : ""}>نعم</option><option value="false" ${values.required === false ? "selected" : ""}>لا</option></select></div><div></div><button class="line-item-remove" type="button" data-remove-line-item><i class="fa-solid fa-trash"></i></button></div>`;
  }
  return `<div class="line-item-row"><div class="form-field"><label>الصنف</label><select class="form-control line-item-product"><option value="">اختر الصنف</option>${options}</select></div><div class="form-field"><label>الكمية</label><input class="form-control line-item-qty" type="number" min="1" value="${values.quantity || 1}"></div><div></div><div></div><button class="line-item-remove" type="button" data-remove-line-item><i class="fa-solid fa-trash"></i></button></div>`;
}

async function addLineItemRow(mode, items) {
  const container = document.querySelector(`[data-line-items][data-mode="${mode}"] .line-items-list`);
  if (!container) return;
  container.insertAdjacentHTML("beforeend", lineItemRow(mode, items, {}));
  container.lastElementChild.querySelector("[data-remove-line-item]").addEventListener("click", e => e.currentTarget.closest(".line-item-row").remove());
}

async function collectFormData(fields) {
  const form = document.getElementById("record-form");
  const result = {};
  for (const field of fields) {
    if (field.type === "lineItems") {
      const rows = [...form.querySelectorAll(`[data-line-items="${field.key}"] .line-item-row`)];
      result[field.key] = rows.map(row => {
        const base = { item_id: row.querySelector(".line-item-product")?.value, quantity: Number(row.querySelector(".line-item-qty")?.value || 0) };
        if (field.mode === "receipt") {
          const damaged = Number(row.querySelector(".line-item-damaged")?.value || 0);
          const validInput = row.querySelector(".line-item-valid")?.value;
          const valid = validInput === "" ? base.quantity - damaged : Number(validInput || 0);
          if (base.quantity <= 0 || valid <= 0 || damaged < 0 || Math.abs(valid + damaged - base.quantity) > 0.0005) {
            throw new Error("في القبض العيني يجب أن تساوي الكمية الكلية مجموع الصالح والتالف، وأن تكون الكمية الصالحة أكبر من صفر.");
          }
          Object.assign(base, {
            valid_qty: valid, damaged_qty: damaged,
            lot_no: row.querySelector(".line-item-lot")?.value || null,
            expiry_date: row.querySelector(".line-item-expiry")?.value || null
          });
        }
        if (field.mode === "basket") base.required = row.querySelector(".line-item-required")?.value !== "false";
        return base;
      }).filter(row => row.item_id && row.quantity > 0);
      const ids = result[field.key].map(x => x.item_id);
      if (new Set(ids).size !== ids.length) throw new Error("لا يمكن تكرار الصنف داخل القائمة.");
      continue;
    }
    const input = form.querySelector(`[name="${field.key}"]`);
    if (!input) continue;
    if (field.type === "switch") result[field.key] = input.checked;
    else if (field.type === "file") {
      const file = input.files?.[0];
      if (file) {
        const prepared = input._preparedAttachment || await input._preparePromise;
        if (!prepared) throw new Error(`تعذر تجهيز ${field.label}.`);
        const uploaded = await dataService.uploadPreparedAttachment(prepared, field.folder || field.key, event => updateAttachmentProgress(input, event));
        input._uploadedAttachment = uploaded;
        result[field.key] = uploaded.storagePath;
      } else result[field.key] = input.dataset.existingValue || null;
    } else if (["number", "currency"].includes(field.type)) result[field.key] = input.value === "" ? null : Number(input.value);
    else result[field.key] = input.value === "" ? null : input.value;
  }
  return result;
}

async function handleRowAction(action, id) {
  const cfg = state.currentConfig;
  if (!cfg) return;
  const preparedPrintWindow = action === "print" ? window.open("", "_blank", "width=920,height=980") : null;
  if (preparedPrintWindow) preparedPrintWindow.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>تجهيز الطباعة</title><body style="font-family:Arial;padding:40px">جاري تجهيز المستند...</body></html>');
  let record;
  try { record = await dataService.get(cfg.table, id); }
  catch (error) { if (preparedPrintWindow) preparedPrintWindow.close(); return toast(error.message || "تعذر تحميل السجل.", "error"); }
  if (!record) { if (preparedPrintWindow) preparedPrintWindow.close(); return toast("تعذر العثور على السجل.", "error"); }
  try {
    if (action === "view") return showRecordDetails(cfg, record);
    if (action === "attachments") return showRecordAttachments(cfg, record);
    if (action === "edit") return openRecordForm(cfg, record);
    if (action === "print") return printRecord(cfg, record, preparedPrintWindow);
    if (action === "toggle") {
      const statusToggle = ["beneficiaries", "campaign_distributors", "authorized_devices"].includes(cfg.table);
      const current = statusToggle ? record.status : record.is_active;
      const shouldDisable = cfg.table === "beneficiaries" ? current === "approved"
        : cfg.table === "campaign_distributors" ? current === "active"
        : cfg.table === "authorized_devices" ? current === "approved"
        : current === true;
      const ok = await confirmDialog(`هل تريد ${shouldDisable ? "إيقاف" : "تفعيل"} هذا ${cfg.singular}؟`, "تغيير الحالة", "تأكيد");
      if (!ok) return;
      await dataService.action(cfg.table, id, "toggle", { current });
    } else if (action === "approve") {
      const ok = await confirmDialog("سيظهر المستفيد بعد الاعتماد في قوائم الصرف. هل تريد المتابعة؟", "اعتماد الملف", "اعتماد");
      if (!ok) return;
      await dataService.action(cfg.table, id, "approve");
    } else if (action === "post") {
      const ok = await confirmDialog("الترحيل سيؤثر على الرصيد أو المخزون ولا يمكن حذف السند بعده. هل تريد المتابعة؟", "ترحيل السند", "ترحيل");
      if (!ok) return;
      await dataService.action(cfg.table, id, "post");
    } else if (action === "cancel") {
      return openCancelDialog(cfg, record);
    } else if (action === "confirm-receipt") {
      const ok = await confirmDialog("تأكيد أن المستفيد أو المستلم الفعلي استلم المساعدة؟", "تأكيد الاستلام", "تم الاستلام");
      if (!ok) return;
      await dataService.action(cfg.table, id, "confirm-receipt");
    } else if (action === "open-close") {
      const ok = await confirmDialog(`هل تريد ${record.status === "open" ? "إغلاق" : "فتح"} الحملة؟`, "حالة الحملة", "تأكيد");
      if (!ok) return;
      await dataService.action(cfg.table, id, "open-close", { current: record.status });
    } else if (action === "copy") {
      return openRecordForm(cfg, record, true);
    } else if (action === "duplicate-check") {
      return showDuplicateCheck(record);
    } else if (action === "aid-history") {
      return showAidHistory(record);
    } else if (action === "statement") {
      return showDonorStatement(record);
    } else if (action === "movements") {
      return showItemMovements(record);
    } else if (action === "stock-check") {
      return showStockCheck(record);
    } else if (action === "report") {
      return showRelatedReport(cfg.table, record);
    } else if (action === "reset-password") {
      return openResetPassword(record);
    } else if (action === "activity") {
      const activity = await dataService.list("audit_logs", { pageSize: 500, filters: { user_id: record.user_id || record.id } });
      return openDrawer(`نشاط ${record.user_name || record.full_name || "المستخدم"}`, activity.data.length ? renderSimpleRows(activity.data, ["created_at", "action", "table_name", "record_id", "result"]) : `<div class="empty-state"><i class="fa-solid fa-clock-rotate-left"></i><h3>لا توجد عمليات مسجلة</h3></div>`);
    } else if (action === "download-template") {
      const table = importDefinitions[record.target_table] ? record.target_table : "beneficiaries";
      return downloadImportTemplate(table);
    } else if (action === "settle") {
      const ok = await confirmDialog("هل تريد إقفال تخصيص هذا الموزع بعد التأكد من المصروف والمرتجع؟", "تسوية التخصيص", "تسوية");
      if (!ok) return;
      await dataService.action(cfg.table, id, "settle", { reason: "تسوية كاملة من واجهة النظام" });
    } else if (action === "export") {
      return exportRows([record], `${cfg.table}-${id}.csv`);
    } else if (action === "reopen") {
      const label = cfg.table === "campaign_distributors" ? "تخصيص الموزع" : "الحساب";
      const ok = await confirmDialog(`إعادة فتح ${label} تعيد فقط المرتجع الناتج تلقائياً عن آخر تسوية، وستسجل العملية في التدقيق.`, `إعادة فتح ${label}`, "إعادة فتح", true);
      if (!ok) return;
      await dataService.action(cfg.table, id, "reopen", { reason: "إعادة فتح من واجهة النظام" });
    } else if (action === "retry") {
      const ok = await confirmDialog("سيعاد السجل الفاشل إلى قائمة الانتظار دون تكرار أي عملية ناجحة. هل تريد المتابعة؟", "إعادة المحاولة", "إعادة إلى الانتظار");
      if (!ok) return;
      await dataService.action(cfg.table, id, "retry");
    } else {
      return toast(`الإجراء «${action}» غير مربوط بعد بهذه الشاشة.`, "warning");
    }
    toast("تم تنفيذ العملية بنجاح.");
    await refreshCurrentScreen();
  } catch (error) { toast(error.message || "تعذر تنفيذ العملية.", "error"); }
}

function fieldLabels(cfg) {
  const labels = {};
  cfg.columns.forEach(c => labels[c.key] = c.label);
  cfg.fields.forEach(f => labels[f.key] = f.label);
  return labels;
}

function showRecordDetails(cfg, record) {
  const details = Array.isArray(record.details) && record.details.length ? `<h3 style="margin:22px 0 10px;font-size:13px">التفاصيل</h3><div class="table-scroll"><table class="data-table" style="min-width:520px"><thead><tr><th>الصنف</th><th>الكمية</th><th>الصالحة</th><th>التالفة</th></tr></thead><tbody>${record.details.map(x => `<tr><td>${escapeHtml(x.item_name || x.item_id || "-")}</td><td>${formatNumber(x.quantity)}</td><td>${formatNumber(x.valid_qty)}</td><td>${formatNumber(x.damaged_qty)}</td></tr>`).join("")}</tbody></table></div>` : "";
  const timeline = `<div class="timeline"><div class="timeline-item"><span class="timeline-dot"><i class="fa-solid fa-plus"></i></span><div class="timeline-copy"><strong>إنشاء السجل</strong><small>${formatDate(record.created_at, true)}</small></div></div>${record.updated_at ? `<div class="timeline-item"><span class="timeline-dot"><i class="fa-solid fa-pen"></i></span><div class="timeline-copy"><strong>آخر تعديل</strong><small>${formatDate(record.updated_at, true)}</small></div></div>` : ""}${record.posted_at ? `<div class="timeline-item"><span class="timeline-dot"><i class="fa-solid fa-stamp"></i></span><div class="timeline-copy"><strong>ترحيل السند</strong><small>${formatDate(record.posted_at, true)}</small></div></div>` : ""}</div>`;
  openDrawer(`${cfg.singular}: ${record.name || record.full_name || record.voucher_no || record.file_no || record.closing_no || "التفاصيل"}`, objectDetails(record, fieldLabels(cfg)) + details + timeline);
}

async function showRecordAttachments(cfg, record) {
  const fallbackPaths = (cfg.fields || [])
    .filter(field => field.type === "file" && record[field.key])
    .map(field => ({ storage_path: record[field.key], file_name: field.label, mime_type: /image|photo|profile|identity/i.test(field.key) ? "image/*" : "" }));
  const attachments = await dataService.listEntityAttachments(cfg.table, record.id, fallbackPaths);
  if (!attachments.length) return toast("لا توجد مرفقات لهذا السجل.", "warning");
  const files = await Promise.all(attachments.map(async item => ({ ...item, url: await dataService.createAttachmentUrl(item.storage_path) })));
  const body = `<div class="attachment-viewer">${files.map(item => {
    const image = String(item.mime_type || "").startsWith("image/");
    return `<article class="attachment-viewer-card">${image ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(item.url)}" alt="${escapeHtml(item.file_name)}"></a>` : `<a class="attachment-document" href="${escapeHtml(item.url)}" target="_blank" rel="noopener"><i class="fa-solid fa-file-arrow-down"></i></a>`}<div><strong>${escapeHtml(item.file_name || "مرفق")}</strong><small>${item.size_bytes ? formatFileSize(item.size_bytes) : "ملف محفوظ"}</small></div><a class="secondary-button small-button" href="${escapeHtml(item.url)}" target="_blank" rel="noopener"><i class="fa-solid fa-up-right-from-square"></i> فتح مكبّر</a></article>`;
  }).join("")}</div>`;
  openDrawer(`مرفقات ${record.name || record.full_name || record.voucher_no || record.file_no || cfg.singular}`, body);
}

async function openCancelDialog(cfg, record) {
  openModal({ title: `إلغاء ${cfg.singular}`, eyebrow: "عملية حساسة", body: `<div class="form-field"><label>سبب الإلغاء <span class="required">*</span></label><textarea id="cancel-reason" class="form-control" placeholder="اكتب سبباً واضحاً للإلغاء..."></textarea><span class="help-text">سيحفظ السبب في سجل العمليات، وسيُعكس الأثر المالي أو المخزني عند الحاجة.</span></div>`, footer: `<button class="ghost-button" data-close-modal>تراجع</button><button class="danger-button" id="confirm-cancel"><i class="fa-solid fa-ban"></i> إلغاء السند</button>` });
  document.getElementById("confirm-cancel").addEventListener("click", async () => {
    const reason = document.getElementById("cancel-reason").value.trim();
    if (!reason) return toast("يجب كتابة سبب الإلغاء.", "warning");
    try {
      await dataService.action(cfg.table, record.id, "cancel", { reason });
      closeModal(); toast("تم إلغاء السند وعكس أثره حسب السياسة."); await refreshCurrentScreen();
    } catch (error) { toast(error.message, "error"); }
  });
}

function writePrintDocument(win, html) {
  if (!win) return toast("منع المتصفح نافذة الطباعة. اسمح بالنوافذ المنبثقة لهذا النظام.", "warning");
  win.document.open();
  win.document.write(html);
  win.document.close();
}

async function loadPrintSettings() {
  const result = await dataService.list("system_settings", { pageSize: 1 });
  return result.data[0] || { organization_name: config.appName, system_name: config.appName, logo_url: "assets/logo.svg" };
}

async function printRecord(cfg, record, preparedWindow = null) {
  const win = preparedWindow || window.open("", "_blank", "width=920,height=980");
  try {
    const settings = await loadPrintSettings();
    writePrintDocument(win, buildRecordPrintDocument({ table: cfg.table, record, settings, actor: state.session?.profile || {} }));
  } catch (error) {
    if (win) win.close();
    throw error;
  }
}

async function printCurrentView() {
  if (!state.currentRows.length) return toast("لا توجد بيانات للطباعة.", "warning");
  const win = window.open("", "_blank", "width=1050,height=980");
  if (win) win.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>تجهيز الطباعة</title><body style="font-family:Arial;padding:40px">جاري تجهيز الكشف...</body></html>');
  try {
    const settings = await loadPrintSettings();
    writePrintDocument(win, buildListPrintDocument({
      title: state.currentPrint.title || els.pageTitle.textContent || "كشف بيانات",
      columns: state.currentPrint.columns || [],
      rows: state.currentRows,
      settings,
      actor: state.session?.profile || {},
    }));
  } catch (error) {
    if (win) win.close();
    toast(error.message || "تعذر تجهيز الطباعة.", "error");
  }
}

async function printSettingsSample() {
  const win = window.open("", "_blank", "width=920,height=980");
  if (win) win.document.write('<!doctype html><html lang="ar" dir="rtl"><meta charset="utf-8"><title>تجهيز نموذج الطباعة</title><body style="font-family:Tahoma,Arial;padding:40px">جاري تجهيز نموذج الطباعة الآمن...</body></html>');
  try {
    const settings = await loadPrintSettings();
    const pendingFooter = document.querySelector('[name="print_footer"]')?.value;
    if (pendingFooter !== undefined) settings.print_footer = pendingFooter;
    writePrintDocument(win, buildRecordPrintDocument({
      table: "cash_receipts",
      record: {
        voucher_no: "نموذج طباعة",
        receipt_date: new Date().toISOString().slice(0, 10),
        donor_name: "فاعل خير",
        donor_is_anonymous: true,
        cashbox_name: "الصندوق الرئيسي",
        amount: 0,
        currency: settings.currency || config.currency || "YER",
        method: "cash",
        status: "draft",
      },
      settings,
      actor: state.session?.profile || {},
    }));
  } catch (error) {
    if (win) win.close();
    toast(error.message || "تعذر تجهيز نموذج الطباعة.", "error");
  }
}

async function showDuplicateCheck(record) {
  const all = await dataService.list("beneficiaries", { pageSize: 1000 });
  const normalize = s => String(s || "").replace(/\s+/g, "").toLowerCase();
  const similar = all.data.filter(x => x.id !== record.id && ((record.national_id && x.national_id === record.national_id) || (record.phone && x.phone === record.phone) || normalize(x.full_name).includes(normalize(record.full_name).slice(0, 5))));
  openDrawer("نتيجة فحص التكرار", similar.length ? `<div class="alert-item warning"><i class="fa-solid fa-clone"></i><div class="alert-copy"><strong>وجد النظام ${similar.length} ملفاً مشابهاً</strong><span>راجع البيانات قبل إنشاء أو اعتماد الملف.</span></div></div><div style="margin-top:14px">${similar.map(x => `<div class="detail-item" style="margin-bottom:8px"><span>${escapeHtml(x.file_no)}</span><strong>${escapeHtml(x.full_name)}</strong><small>${escapeHtml(x.phone || "بدون هاتف")} • ${escapeHtml(x.national_id || "بدون هوية")}</small></div>`).join("")}</div>` : `<div class="empty-state"><i class="fa-solid fa-circle-check"></i><h3>لم يجد النظام ملفاً مطابقاً</h3><p>يمكن متابعة المراجعة والاعتماد.</p></div>`);
}

async function showAidHistory(record) {
  const [cash, inkind] = await Promise.all([
    dataService.list("cash_payments", { filters: { beneficiary_id: record.id }, pageSize: 100 }),
    dataService.list("in_kind_payments", { filters: { beneficiary_id: record.id }, pageSize: 100 })
  ]);
  const rows = [...cash.data.map(x => ({ date: x.payment_date, type: "نقدي", campaign: x.campaign_name, value: formatCurrency(x.amount, x.currency), status: x.status })), ...inkind.data.map(x => ({ date: x.payment_date, type: "عيني", campaign: x.campaign_name, value: x.basket_name || `${x.items_count} أصناف`, status: x.status }))].sort((a,b) => String(b.date).localeCompare(String(a.date)));
  openDrawer(`سجل مساعدات ${record.full_name}`, rows.length ? `<div class="table-scroll"><table class="data-table" style="min-width:500px"><thead><tr><th>التاريخ</th><th>النوع</th><th>الحملة</th><th>المساعدة</th><th>الحالة</th></tr></thead><tbody>${rows.map(x => `<tr><td>${formatDate(x.date)}</td><td>${escapeHtml(x.type)}</td><td>${escapeHtml(x.campaign)}</td><td>${x.value}</td><td>${statusBadge(x.status)}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><i class="fa-solid fa-hand-holding-heart"></i><h3>لا توجد مساعدات سابقة</h3></div>`);
}

async function showDonorStatement(record) {
  const [cash, inkind] = await Promise.all([
    dataService.list("cash_receipts", { filters: { donor_id: record.id }, pageSize: 100 }),
    dataService.list("in_kind_receipts", { filters: { donor_id: record.id }, pageSize: 100 })
  ]);
  const total = cash.data.filter(x => x.status === "posted").reduce((a,x) => a + Number(x.amount || 0), 0);
  openDrawer(`كشف حساب المتبرع: ${record.name}`, `<div class="metric-card" style="min-height:auto"><span class="metric-label">إجمالي التبرعات النقدية المرحلة</span><strong class="metric-value">${formatCurrency(total)}</strong></div><h3 style="font-size:13px;margin-top:20px">التبرعات النقدية</h3>${renderSimpleRows(cash.data, ["voucher_no", "campaign_name", "amount", "status"])}<h3 style="font-size:13px;margin-top:20px">التبرعات العينية</h3>${renderSimpleRows(inkind.data, ["voucher_no", "campaign_name", "items_count", "status"])}`);
}

function renderSimpleRows(rows, keys) {
  if (!rows.length) return `<p class="muted" style="font-size:10px">لا توجد بيانات.</p>`;
  return `<div class="table-scroll"><table class="data-table" style="min-width:480px"><thead><tr>${keys.map(k => `<th>${escapeHtml(k)}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${keys.map(k => `<td>${k === "status" ? statusBadge(r[k]) : k === "amount" ? formatCurrency(r[k], r.currency) : escapeHtml(r[k] ?? "-")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

async function showItemMovements(record) {
  const lots = await dataService.list("inventory_lots", { filters: { item_id: record.id }, pageSize: 100 });
  openDrawer(`حركة الصنف: ${record.name}`, `<div class="metric-card" style="min-height:auto"><span class="metric-label">الرصيد المتاح</span><strong class="metric-value">${formatNumber(record.available_qty)} ${escapeHtml(record.unit || "")}</strong></div>${renderSimpleRows(lots.data, ["lot_no", "expiry_date", "quantity_received", "quantity_damaged", "quantity_available"])}`);
}

async function showStockCheck(record) {
  const items = await dataService.list("items", { pageSize: 1000 });
  let details = record.details || [];
  if (record.distribution_type === "basket" && record.basket_id) {
    const basket = await dataService.get("baskets", record.basket_id);
    details = basket?.details || [];
  }
  const checks = details.map(d => {
    const item = items.data.find(x => x.id === d.item_id) || {};
    const ok = Number(item.available_qty || 0) >= Number(d.quantity || 0);
    return { ...d, item_name: item.name, available: item.available_qty, ok };
  });
  openDrawer("فحص المخزون", `<div class="alert-item ${checks.every(x => x.ok) ? "info" : "danger"}"><i class="fa-solid fa-warehouse"></i><div class="alert-copy"><strong>${checks.every(x => x.ok) ? "المخزون كافٍ" : "توجد أصناف ناقصة"}</strong><span>${checks.every(x => x.ok) ? "يمكن متابعة الاعتماد والترحيل." : "يمنع الترحيل حتى توفير الأصناف أو تعديل السند."}</span></div></div><div style="margin-top:14px">${checks.map(x => `<div class="detail-item" style="margin-bottom:8px;border-color:${x.ok ? "#d1fae5" : "#fecaca"}"><span>${escapeHtml(x.item_name || x.item_id)}</span><strong>المطلوب ${formatNumber(x.quantity)} • المتاح ${formatNumber(x.available)}</strong><small class="${x.ok ? "text-success" : "text-danger"}">${x.ok ? "متوفر" : "غير كافٍ"}</small></div>`).join("")}</div>`);
}

async function showRelatedReport(table, record) {
  if (table === "campaigns") {
    const [funding, payments] = await Promise.all([dataService.list("campaign_funding", { filters: { campaign_id: record.id }, pageSize: 100 }), dataService.list("cash_payments", { filters: { campaign_id: record.id }, pageSize: 100 })]);
    openDrawer(`تقرير الحملة: ${record.name}`, `<div class="detail-grid"><div class="detail-item"><span>إجمالي التمويل المرحل</span><strong>${formatCurrency(record.received_total)}</strong></div><div class="detail-item"><span>إجمالي المصروف</span><strong>${formatCurrency(record.spent_total)}</strong></div><div class="detail-item full"><span>الرصيد</span><strong>${formatCurrency(record.balance)}</strong></div></div><h3>تمويلات الحملة</h3>${renderSimpleRows(funding.data, ["funding_no", "cashbox_name", "amount", "status"])}<h3>سندات الصرف</h3>${renderSimpleRows(payments.data, ["voucher_no", "beneficiary_name", "amount", "status"])}`);
  } else showRecordDetails(state.currentConfig, record);
}

function openResetPassword(record) {
  openModal({ title: "إعادة تعيين كلمة المرور", eyebrow: record.full_name, body: `<div class="form-field"><label>كلمة المرور الجديدة</label><input id="new-user-password" class="form-control" type="password" minlength="8" placeholder="8 أحرف على الأقل"><span class="help-text">سيطلب من المستخدم استخدام كلمة المرور الجديدة في المرة القادمة.</span></div>`, footer: `<button class="ghost-button" data-close-modal>إلغاء</button><button class="primary-button" id="save-new-password"><i class="fa-solid fa-key"></i> حفظ كلمة المرور</button>` });
  document.getElementById("save-new-password").addEventListener("click", async () => {
    const password = document.getElementById("new-user-password").value;
    if (password.length < 8) return toast("كلمة المرور يجب أن تكون 8 أحرف على الأقل.", "warning");
    try { await dataService.resetUserPassword(record.id, password); closeModal(); toast("تم تحديث كلمة المرور."); }
    catch (error) { toast(error.message, "error"); }
  });
}

async function renderReports() {
  const active = reportDefinitions.find(r => r.id === state.reportId) || reportDefinitions[0];
  const reportTable = active.table;
  const cfgKey = configKeyMap[reportTable];
  const cfg = screenConfigs[cfgKey];
  const data = await dataService.list(reportTable, { pageSize: 200 });
  state.currentRows = data.data;
  state.currentPrint = { title: active.title, columns: cfg?.columns || [] };
  els.pageContent.innerHTML = `<section class="page-toolbar"><div class="page-description">اختر التقرير ثم استخدم الفلاتر والطباعة أو التصدير.</div><div class="toolbar-actions"><button class="ghost-button" data-export-report><i class="fa-solid fa-file-excel"></i> تصدير Excel/CSV</button><button class="primary-button" data-print-current><i class="fa-solid fa-print"></i> طباعة التقرير</button></div></section>
    <section class="report-selector">${reportDefinitions.map(r => `<button class="report-card ${r.id === state.reportId ? "active" : ""}" data-report="${r.id}"><i class="${r.icon}"></i><strong>${escapeHtml(r.title)}</strong><span>${escapeHtml(r.description)}</span></button>`).join("")}</section>
    <section class="filter-bar"><div class="search-input"><i class="fa-solid fa-magnifying-glass"></i><input id="report-search" placeholder="بحث داخل التقرير..."></div><div class="filter-control"><input type="date" id="report-from"></div><div class="filter-control"><input type="date" id="report-to"></div><div class="filter-control"><select id="report-status"><option value="">كل الحالات</option><option value="posted">مرحّل</option><option value="under_review">تحت المراجعة</option><option value="cancelled">ملغي</option></select></div><button class="secondary-button" id="apply-report-filter"><i class="fa-solid fa-filter"></i> تطبيق</button></section>
    <section class="table-card"><header class="table-card-header"><div><h3>${escapeHtml(active.title)}</h3><p>${formatNumber(data.total)} نتيجة</p></div><span class="status-badge active">تقرير حي</span></header><div id="report-table-wrap">${cfg ? renderTable({ ...cfg, actions: [] }, data.data) : renderSimpleRows(data.data, Object.keys(data.data[0] || {}).slice(0, 7))}</div></section>`;
}

async function applyReportFilter() {
  const active = reportDefinitions.find(r => r.id === state.reportId) || reportDefinitions[0];
  const cfg = screenConfigs[configKeyMap[active.table]];
  const search = document.getElementById("report-search").value.trim().toLowerCase();
  const status = document.getElementById("report-status").value;
  const from = document.getElementById("report-from").value;
  const to = document.getElementById("report-to").value;
  let rows = (await dataService.list(active.table, { pageSize: 500 })).data;
  rows = rows.filter(row => {
    const raw = JSON.stringify(row).toLowerCase();
    const date = row.created_at || row.receipt_date || row.payment_date || row.start_date || "";
    return (!search || raw.includes(search)) && (!status || row.status === status) && (!from || date >= from) && (!to || date <= `${to}T23:59:59`);
  });
  state.currentRows = rows;
  document.getElementById("report-table-wrap").innerHTML = cfg ? renderTable({ ...cfg, actions: [] }, rows) : renderSimpleRows(rows, Object.keys(rows[0] || {}).slice(0, 7));
}

async function renderSync() {
  const queue = getOfflineQueue();
  const synced = queue.filter(x => x.status === "synced").length;
  const failed = queue.filter(x => x.status === "failed").length;
  const pending = queue.filter(x => ["queued", "syncing"].includes(x.status)).length;
  const last = queue.find(x => x.syncedAt)?.syncedAt;
  els.pageContent.innerHTML = `<section class="page-toolbar"><div class="page-description">مراقبة المسودات المحلية ومنع تكرار العملية عند إعادة الإرسال.</div><div class="toolbar-actions"><button class="ghost-button" data-clear-synced><i class="fa-solid fa-broom"></i> حذف المكتمل</button><button class="primary-button" data-sync-now><i class="fa-solid fa-arrows-rotate"></i> مزامنة الآن</button></div></section>
    <section class="sync-summary"><div class="sync-card"><i class="fa-solid fa-wifi"></i><div><strong>${isOnline() ? "متصل" : "غير متصل"}</strong><span>حالة الشبكة الحالية</span></div></div><div class="sync-card"><i class="fa-solid fa-hourglass-half"></i><div><strong>${pending}</strong><span>عمليات معلقة</span></div></div><div class="sync-card"><i class="fa-solid fa-circle-check"></i><div><strong>${synced}</strong><span>عمليات ناجحة</span></div></div><div class="sync-card"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${failed}</strong><span>عمليات فاشلة</span></div></div></section>
    <section class="panel" style="margin-bottom:16px"><div class="panel-body"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><strong style="font-size:12px">حالة المزامنة</strong><div class="muted" style="font-size:9px">آخر مزامنة: ${last ? formatDate(last, true) : "لم تتم بعد"}</div></div><span>${pending ? `${pending} متبقية` : "مكتملة"}</span></div><div class="progress"><span style="width:${queue.length ? Math.round((synced / queue.length) * 100) : 100}%"></span></div></div></section>
    <section class="table-card"><header class="table-card-header"><div><h3>طابور العمليات المحلية</h3><p>يتم حفظ المسودات فقط دون اتصال، ثم يعيد الخادم فحصها.</p></div></header>${queue.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>وقت الإنشاء</th><th>العملية</th><th>الجدول</th><th>المعرف المحلي</th><th>المحاولات</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${queue.map(x => `<tr><td>${formatDate(x.createdAt, true)}</td><td>${escapeHtml(x.operation)}</td><td>${escapeHtml(x.table)}</td><td><code>${escapeHtml(x.id.slice(0,12))}</code></td><td>${x.attempts}</td><td>${statusBadge(x.status)}</td><td><button class="row-action danger" data-remove-queue="${x.id}" title="حذف المسودة المحلية"><i class="fa-solid fa-trash"></i></button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><i class="fa-solid fa-cloud-circle-check"></i><h3>لا توجد عمليات معلقة</h3><p>كل البيانات متزامنة مع الخادم.</p></div>`}</section>`;
}

async function renderGuide() {
  const role = state.session?.profile?.role || "data_entry";
  const dailySteps = roleDailyGuides[role] || roleDailyGuides.data_entry;
  const sections = userGuideSections.filter(section => section.roles.includes("*") || section.roles.includes(role));
  const renderSteps = items => items.map((item, index) => `<li><span>${index + 1}</span><p>${escapeHtml(item)}</p></li>`).join("");
  els.pageContent.innerHTML = `<section class="page-toolbar guide-toolbar"><div><div class="page-description">دليل الاستخدام التفصيلي حسب صلاحيتك الحالية: ${escapeHtml(roleLabels[role] || role)}</div><div class="guide-search"><i class="fa-solid fa-magnifying-glass"></i><input id="guide-search-input" type="search" placeholder="ابحث عن الصرف، الجهاز، Excel، المخزون، الإقفال..."><button type="button" id="guide-clear-search" title="مسح البحث"><i class="fa-solid fa-xmark"></i></button></div></div><div class="toolbar-actions"><button class="primary-button" data-nav="dashboard"><i class="fa-solid fa-house"></i> لوحة التحكم</button></div></section>
    <section class="guide-daily"><div class="guide-daily-heading"><span><i class="fa-solid fa-list-check"></i></span><div><h3>قائمة العمل اليومية — ${escapeHtml(roleLabels[role] || role)}</h3><p>ابدأ بهذه الخطوات، ثم افتح القسم المطلوب من الفهرس.</p></div></div><ol>${renderSteps(dailySteps)}</ol></section>
    <nav class="guide-index" aria-label="فهرس دليل الاستخدام">${sections.map(section => `<button type="button" data-guide-target="guide-${escapeHtml(section.id)}"><i class="${escapeHtml(section.icon)}"></i>${escapeHtml(section.title)}</button>`).join("")}</nav>
    <div id="guide-no-results" class="empty-state hidden"><i class="fa-solid fa-magnifying-glass"></i><h3>لا توجد نتيجة في الدليل</h3><p>جرّب كلمة أقصر مثل: صرف، جهاز، مخزون أو إقفال.</p></div>
    <section class="guide-manual">${sections.map(section => {
      const searchable = [section.title, section.summary, ...(section.steps || []), ...(section.checks || [])].join(" ").toLowerCase();
      return `<article class="guide-manual-card" id="guide-${escapeHtml(section.id)}" data-guide-text="${escapeHtml(searchable)}"><header><span><i class="${escapeHtml(section.icon)}"></i></span><div><h3>${escapeHtml(section.title)}</h3><p>${escapeHtml(section.summary)}</p></div><a href="#page-content" title="العودة إلى أعلى الدليل"><i class="fa-solid fa-arrow-up"></i></a></header><div class="guide-manual-body"><h4>طريقة الاستخدام</h4><ol>${renderSteps(section.steps || [])}</ol>${section.checks?.length ? `<aside><strong><i class="fa-solid fa-circle-check"></i> قائمة تحقق قبل المتابعة</strong><ul>${section.checks.map(check => `<li>${escapeHtml(check)}</li>`).join("")}</ul></aside>` : ""}</div></article>`;
    }).join("")}</section>`;

  const searchInput = document.getElementById("guide-search-input");
  const noResults = document.getElementById("guide-no-results");
  const cards = [...document.querySelectorAll("[data-guide-text]")];
  const applyGuideSearch = () => {
    const term = searchInput.value.trim().toLowerCase();
    let visible = 0;
    cards.forEach(card => {
      const match = !term || card.dataset.guideText.includes(term);
      card.classList.toggle("hidden", !match);
      if (match) visible += 1;
    });
    noResults.classList.toggle("hidden", visible > 0);
  };
  searchInput.addEventListener("input", applyGuideSearch);
  document.getElementById("guide-clear-search").addEventListener("click", () => { searchInput.value = ""; applyGuideSearch(); searchInput.focus(); });
  document.querySelectorAll("[data-guide-target]").forEach(button => button.addEventListener("click", () => {
    searchInput.value = "";
    applyGuideSearch();
    document.getElementById(button.dataset.guideTarget)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }));
}

function backupPreflightMarkup() {
  const report = backupUiState.preflight;
  if (!report) return '<div class="backup-preflight empty"><i class="fa-solid fa-clipboard-check"></i><div><strong>لم تبدأ المعاينة بعد</strong><span>ارفع الملف على أجزاء ثم راجع النتيجة قبل ظهور زر التنفيذ.</span></div></div>';
  const issues = Array.isArray(report.issues) ? report.issues : [];
  const warnings = Array.isArray(report.warnings) ? report.warnings : [];
  const tableRows = Object.entries(report.tables || {}).map(([table, value]) => {
    return '<li><strong>' + escapeHtml(table) + '</strong><span>' +
      formatNumber(value.received_rows || 0) + ' / ' + formatNumber(value.expected_rows || 0) +
      ' صف — ' + formatNumber(value.received_parts || 0) + ' / ' + formatNumber(value.expected_parts || 0) + ' جزء</span></li>';
  }).join("");
  const issueRows = issues.map(issue => '<li><i class="fa-solid fa-triangle-exclamation"></i>' + escapeHtml(issue.message || "ملاحظة فحص") + '</li>').join("");
  const warningRows = warnings.map(warning => '<li><i class="fa-solid fa-circle-exclamation"></i>' + escapeHtml(warning.message || "تنبيه يحتاج المراجعة") + '</li>').join("");
  const canCommit = report.ok === true && backupUiState.restoreSession;
  return [
    '<section class="backup-preflight ' + (report.ok ? 'ok' : 'failed') + '">',
    '<header><div><span class="eyebrow">المعاينة قبل التنفيذ</span><h4>' + (report.ok ? 'الفحص ناجح ويمكنك التأكيد' : 'الفحص وجد ملاحظات ويمنع التنفيذ') + '</h4></div>',
    '<span class="status-badge ' + (report.ok ? 'active' : 'cancelled') + '">' + (report.ok ? 'جاهز للمراجعة' : 'غير جاهز') + '</span></header>',
    '<p>المعاينة لا تغيّر سجلات النظام. عند التنفيذ يعيد الخادم فحص الصلاحية والجهاز والعلاقات والتكامل المالي داخل معاملة واحدة.</p>',
    tableRows ? '<ul class="backup-table-summary">' + tableRows + '</ul>' : '',
    warningRows ? '<ul class="backup-warnings">' + warningRows + '</ul>' : '',
    issueRows ? '<ul class="backup-issues">' + issueRows + '</ul>' : '',
    canCommit ? '<div class="backup-confirm-row"><button class="' + (backupUiState.restoreMode === 'exact' ? 'danger-button' : 'primary-button') + '" data-backup-v3-commit><i class="fa-solid fa-shield-check"></i> ' + (backupUiState.restoreMode === 'exact' ? 'تأكيد المطابقة EXACT-RESTORE' : 'تأكيد الدمج الآمن') + '</button></div>' : '',
    '</section>'
  ].join("");
}

function renderBackupPanel() {
  const inspection = backupUiState.inspection;
  const restoreInfo = inspection
    ? '<div class="backup-file-summary"><i class="fa-solid fa-file-shield"></i><span>الملف المفحوص: ' + formatNumber(inspection.totalRows || 0) + ' صف و' + formatNumber(inspection.parts?.length || 0) + ' جزء و' + formatNumber(inspection.totalFiles || 0) + ' مرفق' + (inspection.legacy ? (inspection.manifest.legacy_source_format === 'zakat-backup-v2' ? ' — V2 محولة وستُطابق بصمتها على الخادم' : ' — V1 قديمة غير موقعة وستظهر كتحذير') : '') + '</span><button class="ghost-button small-button" data-backup-v3-clear aria-label="إزالة الملف المفحوص"><i class="fa-solid fa-xmark"></i></button></div>'
    : '<p class="muted">تُقبل نسخة ZIP V4 الكاملة، أو V3/JSON قديمة للتوافق. تفحص البصمات محلياً قبل الاستعادة.</p>';
  const resumeButton = backupUiState.restoreSession && !backupUiState.preflight?.ok
    ? '<button class="secondary-button" data-backup-v3-resume><i class="fa-solid fa-rotate"></i> متابعة من آخر جزء</button>'
    : '';
  return [
    '<section class="backup-v3-shell" data-backup-v3-shell>',
    '<header class="backup-v3-header"><div><span class="eyebrow">النسخ الاحتياطي V4</span><h3>البيانات وجميع المرفقات في حزمة متحققة</h3><p>تُفحص بصمة مستقلة لكل جزء ولكل ملف، وتُرفض الحزمة الناقصة، ويمكن متابعة رفع المرفقات بعد انقطاع الشبكة.</p></div><span class="status-badge active"><i class="fa-solid fa-shield-halved"></i> مدير وجهاز معتمد</span></header>',
    '<div id="backup-v3-status" class="backup-v3-status" aria-live="polite" role="status">' + escapeHtml(backupUiState.lastMessage) + '</div>',
    '<div class="backup-v3-grid">',
    '<article class="backup-step-card"><header><span class="backup-step-number">1</span><div><h4>إنشاء نسخة كاملة</h4><p>فحص الحسابات وقراءة أجزاء البيانات وجميع ملفات Storage ثم ZIP موثق.</p></div></header>',
    '<div class="form-field"><label>نطاق النسخة</label><select id="backup-v3-scope" class="form-control"><option value="business">بيانات الأعمال (موصى بها)</option><option value="administrative">نسخة إدارية كاملة</option></select></div>',
    '<label class="backup-check"><input id="backup-v3-consistent" type="checkbox"><span>نسخة متسقة مع إيقاف التعديل مؤقتاً</span><small>يمنع الكتابة فقط حتى تنتهي الجلسة أو تنتهي مهلة الحماية تلقائياً.</small></label>',
    '<button class="primary-button" data-backup-v3-create><i class="fa-solid fa-download"></i> إنشاء وتنزيل نسخة V4</button>',
    '</article>',
    '<article class="backup-step-card"><header><span class="backup-step-number">2</span><div><h4>فحص ورفع الاستعادة</h4><p>يُفحص الملف محلياً قبل الاتصال، ثم تُرفع أجزاؤه مع قابلية الاستئناف.</p></div></header>',
    '<div class="form-field"><label for="backup-v3-file">ملف النسخة</label><input id="backup-v3-file" class="form-control" type="file" accept=".zip,.json,application/zip,application/json"></div>',
    '<div class="form-field"><label for="backup-v3-mode">طريقة الاستعادة</label><select id="backup-v3-mode" class="form-control"><option value="merge">الدمج الآمن (افتراضي)</option><option value="exact">المطابقة EXACT-RESTORE (يحذف زيادات البيانات المُدارة)</option></select></div>',
    restoreInfo,
    '<div class="backup-action-row"><button class="secondary-button" data-backup-v3-restore><i class="fa-solid fa-file-circle-check"></i> فحص الملف ورفع الأجزاء</button>' + resumeButton + '</div>',
    '</article>',
    '</div>',
    backupPreflightMarkup(),
    '<aside class="backup-scope-note"><i class="fa-solid fa-circle-info"></i><div><strong>محتوى نسخة V4</strong><p>تشمل بيانات التطبيق وجميع المرفقات في المخزن الخاص. لا تُصدّر كلمات مرور Auth ولا أسرار Gemini وEdge Functions؛ أعد ضبطها من لوحة Supabase عند نقل المشروع.</p></div></aside>',
    '</section>'
  ].join("");
}

function setBackupStatus(message, tone = "info") {
  backupUiState.lastMessage = String(message || "");
  const status = document.getElementById("backup-v3-status");
  if (status) {
    status.textContent = backupUiState.lastMessage;
    status.dataset.tone = tone;
  }
}

function backupProgressMessage(progress) {
  if (!progress) return "جاري تجهيز العملية...";
  if (progress.phase === "export") return "قراءة " + progress.table + " — الجزء " + progress.partNo + " — " + formatNumber(progress.rows || 0) + " صف.";
  if (progress.phase === "storage" || progress.phase === "restore-storage" || progress.phase === "cleanup-storage") return progress.message;
  if (progress.phase === "compress") return "تمت قراءة " + formatNumber(progress.rows || 0) + " صف. " + progress.message;
  return progress.message || "جاري المعالجة...";
}

async function runBackupV3Wizard() {
  if (backupUiState.busy) return;
  const scope = document.getElementById("backup-v3-scope")?.value || "business";
  const consistent = Boolean(document.getElementById("backup-v3-consistent")?.checked);
  backupUiState.busy = true;
  setBackupStatus("يتم فحص الصلاحية والتكامل المالي قبل بدء القراءة...", "info");
  const button = document.querySelector("[data-backup-v3-create]");
  if (button) button.disabled = true;
  try {
    const result = await createV4Archive(dataService, {
      scope,
      consistent,
      onProgress: progress => setBackupStatus(backupProgressMessage(progress), "info")
    });
    downloadV4Archive(result);
    setBackupStatus("اكتملت النسخة: " + formatNumber(result.totalRows) + " صف و" + formatNumber(result.totalFiles) + " مرفق. بدأ تنزيل ZIP بعد تحقق جميع البصمات.", "success");
    toast("اكتملت النسخة الاحتياطية V4 بالبيانات والمرفقات.");
  } catch (error) {
    const failure = formatOperationError(error, "backup");
    setBackupStatus(failure.message, "error");
    toast(failure.message, "error");
  } finally {
    backupUiState.busy = false;
    if (button) button.disabled = false;
  }
}

async function inspectBackupInput(file) {
  if (!file) throw new Error("اختر ملف نسخة ZIP أو JSON أولاً.");
  let inspection;
  if (file.name.toLowerCase().endsWith(".zip")) {
    try { inspection = await inspectV4Archive(file); }
    catch (v4Error) {
      try { inspection = await inspectV3Archive(file); }
      catch { throw v4Error; }
    }
  } else {
    let legacy;
    try { legacy = JSON.parse(await file.text()); } catch { throw new Error("ملف JSON لا يمكن قراءته."); }
    inspection = await normalizeLegacyBackup(legacy);
  }
  backupUiState.inspection = inspection;
  backupUiState.restoreSession = null;
  backupUiState.stagedParts = new Set();
  backupUiState.preflight = null;
  backupUiState.lastMessage = "تم فحص الملف محلياً بنجاح: " + formatNumber(inspection.totalRows || 0) + " صف.";
  return inspection;
}

async function runRestoreV3Wizard() {
  if (backupUiState.busy) return;
  const input = document.getElementById("backup-v3-file");
  const mode = document.getElementById("backup-v3-mode")?.value || "merge";
  backupUiState.busy = true;
  try {
    let inspection = backupUiState.inspection;
    if (!inspection && input?.files?.[0]) {
      setBackupStatus("يتم فحص manifest وبصمات جميع الأجزاء محلياً...", "info");
      inspection = await inspectBackupInput(input.files[0]);
    }
    if (!inspection) throw new Error("اختر ملف النسخة أولاً.");
    if (backupUiState.restoreSession && backupUiState.restoreMode !== mode) {
      backupUiState.restoreSession = null;
      backupUiState.stagedParts = new Set();
      backupUiState.preflight = null;
    }
    backupUiState.restoreMode = mode;
    if (inspection.manifest?.format === "zakat-backup-v4") {
      setBackupStatus("تتم استعادة المرفقات والتحقق منها قبل اعتماد البيانات...", "info");
      await restoreV4Files(dataService, inspection, { onProgress: progress => setBackupStatus(progress.message, "info") });
    }
    if (!backupUiState.restoreSession) {
      setBackupStatus("يتم إنشاء جلسة استعادة محمية على الخادم...", "info");
      backupUiState.restoreSession = await dataService.startRestoreV3(inspection.tableManifest || inspection.manifest, mode);
    }
    const sessionId = backupUiState.restoreSession.session_id;
    const parts = [...inspection.parts].sort((left, right) => left.table.localeCompare(right.table) || left.partNo - right.partNo);
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      const key = part.table + ":" + part.partNo;
      if (backupUiState.stagedParts.has(key)) continue;
      setBackupStatus("رفع " + part.table + " — الجزء " + part.partNo + " من " + parts.length + "...", "info");
      await dataService.stageRestoreV3Part(sessionId, part.table, part.partNo, part.rowsText, part.checksum);
      backupUiState.stagedParts.add(key);
    }
    setBackupStatus("اكتمل رفع الأجزاء. يجري الخادم الآن المعاينة دون تغيير البيانات...", "info");
    backupUiState.preflight = await dataService.preflightRestoreV3(sessionId);
    await renderSettings("backup");
    setBackupStatus(backupUiState.preflight.ok ? "المعاينة ناجحة. راجع الملخص ثم أكد العملية." : "المعاينة اكتملت مع ملاحظات؛ لن يسمح النظام بالتنفيذ حتى تُحل.", backupUiState.preflight.ok ? "success" : "error");
  } catch (error) {
    const failure = formatOperationError(error, "restore");
    setBackupStatus(failure.message, "error");
    toast(failure.message, "error");
  } finally {
    backupUiState.busy = false;
  }
}

async function commitRestoreV3Wizard() {
  if (backupUiState.busy || !backupUiState.restoreSession || !backupUiState.preflight?.ok) return;
  const exact = backupUiState.restoreMode === "exact";
  const approved = await confirmDialog(
    exact
      ? "الاستعادة المطابقة ستزيل الزيادات من جداول الأعمال، ثم تنظف ملفات Storage غير الموجودة في النسخة بعد نجاح البيانات فقط. لا تُحذف حسابات Auth ويحمي النظام جهازك الحالي. هل تريد المتابعة؟"
      : "سيُدمج النظام البيانات الجديدة ويحدّث السجلات المطابقة فقط. يعيد الخادم التحقق مرة أخيرة قبل اعتماد أي تغيير. هل تريد المتابعة؟",
    exact ? "تأكيد استعادة مطابقة" : "تأكيد دمج آمن",
    exact ? "متابعة إلى عبارة التأكيد" : "تنفيذ الدمج",
    exact
  );
  if (!approved) return;
  let confirmation = "MERGE-RESTORE";
  if (exact) {
    confirmation = window.prompt("اكتب EXACT-RESTORE بالحروف الإنجليزية لتأكيد الاستعادة المطابقة:", "") || "";
    if (confirmation !== "EXACT-RESTORE") return toast("لم تُكتب عبارة التأكيد الصحيحة؛ لم يتغير أي سجل.", "warning");
  }
  backupUiState.busy = true;
  setBackupStatus("يتم تنفيذ الاستعادة داخل معاملة واحدة. لا تغلق الصفحة حتى تظهر النتيجة.", "info");
  try {
    const result = await dataService.commitRestoreV3(backupUiState.restoreSession.session_id, confirmation);
    let removedFiles = 0;
    if (exact && backupUiState.inspection?.manifest?.format === "zakat-backup-v4") {
      const cleanup = await cleanupExactV4Files(dataService, backupUiState.inspection, progress => setBackupStatus(progress.message, "info"));
      removedFiles = cleanup.removed;
    } else {
      clearV4Resume(backupUiState.inspection);
    }
    backupUiState.lastMessage = "نجحت الاستعادة: " + formatNumber(result.restored_rows || 0) + " صف" + (exact ? "، ونُظف " + formatNumber(removedFiles) + " ملف زائد" : "") + ". تم تسجيل تقرير العملية في التدقيق.";
    backupUiState.inspection = null;
    backupUiState.restoreSession = null;
    backupUiState.stagedParts = new Set();
    backupUiState.preflight = null;
    await renderSettings("backup");
    toast("تمت الاستعادة بنجاح وفُحص التكامل المالي.");
  } catch (error) {
    const failure = formatOperationError(error, "restore");
    const message = failure.message + " ابدأ جلسة استعادة جديدة من الملف المفحوص.";
    backupUiState.restoreSession = null;
    backupUiState.stagedParts = new Set();
    backupUiState.preflight = null;
    backupUiState.lastMessage = message;
    await renderSettings("backup");
    setBackupStatus(message, "error");
    toast(message, "error");
  } finally {
    backupUiState.busy = false;
  }
}

function applyFontScale(value) {
  const percent = Math.max(80, Math.min(140, Number(value) || 100));
  document.documentElement.style.setProperty("--font-scale", String(percent / 100));
  try { localStorage.setItem("zakat_font_scale_percent", String(percent)); } catch {                                                      }
}

function storageMeter(label, used, limit) {
  const safeUsed = healthMetric({ used }, "used");
  const safeLimit = Math.max(1, Number(limit) || 1);
  if (safeUsed === null) return `<article class="system-meter is-unavailable"><header><span>${escapeHtml(label)}</span><i class="fa-solid fa-circle-question" aria-hidden="true"></i></header><strong>القياس غير متاح</strong><p>يظهر الاستخدام والمتبقي بعد نجاح الاتصال والفحص.</p><small>الحد المدخل: ${formatFileSize(safeLimit)}</small></article>`;
  const remaining = Math.max(0, safeLimit - safeUsed);
  const percent = Math.min(100, Math.round((safeUsed / safeLimit) * 100));
  return `<article class="system-meter"><header><span>${escapeHtml(label)}</span><strong>${percent}%</strong></header><div class="progress"><span style="width:${percent}%"></span></div><div><small>المستخدم: ${formatFileSize(safeUsed)}</small><small>المتبقي: ${formatFileSize(remaining)}</small><small>الحد المدخل: ${formatFileSize(safeLimit)}</small></div></article>`;
}

function systemHealthMarkup(settings, health) {
  const databaseLimit = Number(settings.supabase_database_limit_mb || 500) * 1024 * 1024;
  const storageLimit = Number(settings.supabase_storage_limit_mb || 1024) * 1024 * 1024;
  const missingFiles = healthMetric(health, "missing_attachment_files");
  const integrityOk = missingFiles === 0;
  const queueCount = getOfflineQueue().filter(item => ["queued", "failed"].includes(item.status)).length;
  const connection = getConnectionState();
  const lastActivity = health.last_application_activity_at || connection.lastSuccessAt || null;
  const lastActivityTime = lastActivity ? new Date(lastActivity).getTime() : NaN;
  const idleDays = Number.isFinite(lastActivityTime) ? Math.max(0, Math.floor((Date.now() - lastActivityTime) / 86400000)) : null;
  const pauseTone = idleDays !== null && idleDays >= 5 ? "text-warning" : "text-success";
  const financialFailures = healthMetric(health, "financial_integrity_failures");
  const financialLabel = financialFailures === null ? "لم يكتمل الفحص" : financialFailures === 0 ? "كل الفحوص متوازنة" : formatNumber(financialFailures) + " فحصًا يحتاج مراجعة";
  const financialTone = financialFailures === null ? "text-warning" : financialFailures === 0 ? "text-success" : "text-danger";
  const countLabel = key => healthMetric(health, key) === null ? "غير متاح" : formatNumber(healthMetric(health, key));
  const errors = [...(Array.isArray(health.diagnostic_errors) ? health.diagnostic_errors : [])];
  if (health.diagnostic_error) errors.unshift({ message: health.diagnostic_error, code: health.diagnostic_code });
  const errorMarkup = errors.map(error => {
    const issue = describeHealthError(error);
    return `<div class="health-issue" role="status"><i class="fa-solid fa-circle-exclamation" aria-hidden="true"></i><div><strong>لم يكتمل أحد الفحوص</strong><p>${escapeHtml(issue.action)}</p><details><summary>عرض سبب الخطأ</summary><p dir="auto">${escapeHtml(issue.detail)}</p>${issue.code ? `<code>${escapeHtml(issue.code)}</code>` : ""}</details></div></div>`;
  }).join("");
  const schemaMissing = healthMetric(health, "schema_missing_objects");
  return [
    `<header class="health-heading"><div><span class="eyebrow blue"><i class="fa-solid fa-heart-pulse" aria-hidden="true"></i> متابعة التشغيل</span><h3>حالة النظام</h3><p>المساحة، الحسابات، المرفقات، وآخر نشاط مسجل.</p></div><button class="secondary-button" data-settings-tab="system"><i class="fa-solid fa-arrows-rotate" aria-hidden="true"></i> تحديث الحالة</button></header>`,
    '<p>حدود المساحة مرجعية تُدخل من الإعدادات؛ استهلاك نقل البيانات والفوترة يعرضان في لوحة مشروع Supabase.</p>',
    health.demo ? '<div class="info-callout"><i class="fa-solid fa-flask"></i><span>وضع العرض: هذه معلومات محلية، ولا تمثل قياسات مشروع Supabase.</span></div>' : '',
    health.offline ? '<div class="info-callout"><i class="fa-solid fa-wifi"></i><span>أنت تعمل دون اتصال. ستظهر القياسات الحية عند عودة الاتصال ونجاح الفحص.</span></div>' : '',
    errorMarkup,
    '<div class="system-health-grid">',
    storageMeter('مساحة قاعدة البيانات', health.database_bytes, databaseLimit),
    storageMeter('مساحة المرفقات', health.storage_bytes, storageLimit),
    '</div>',
    '<div class="detail-grid system-details">',
    `<div class="detail-item"><span>الإصدار</span><strong>${escapeHtml(config.version || "12.5.0")} — ${escapeHtml(config.releaseName || "")}</strong></div>`,
    `<div class="detail-item"><span>اتصال Supabase</span><strong>${dataService.demoMode ? "عرض محلي" : health.offline ? "غير متصل" : health.live_unavailable ? "تعذر إكمال الطلب" : "تم جلب الحالة"}</strong></div>`,
    `<div class="detail-item"><span>الجهاز الحالي</span><strong>${escapeHtml(getDeviceName())} — ${state.session ? (dataService.demoMode ? "محلي" : "معتمد للجلسة") : "دون جلسة"}</strong></div>`,
    `<div class="detail-item"><span>ملفات Storage</span><strong>${countLabel("storage_objects")}</strong></div>`,
    `<div class="detail-item"><span>سجلات المرفقات</span><strong>${countLabel("attachment_records")}</strong></div>`,
    `<div class="detail-item"><span>سلامة المرفقات</span><strong class="${missingFiles === null ? "text-warning" : integrityOk ? "text-success" : "text-danger"}">${missingFiles === null ? "لم يكتمل الفحص" : integrityOk ? "لا توجد ملفات مفقودة" : formatNumber(missingFiles) + " سجلًا بلا ملف"}</strong></div>`,
    `<div class="detail-item"><span>سلامة الحسابات</span><strong class="${financialTone}">${financialLabel}</strong></div>`,
    `<div class="detail-item"><span>اكتمال قاعدة البيانات</span><strong class="${schemaMissing === null ? "text-warning" : schemaMissing === 0 ? "text-success" : "text-danger"}">${schemaMissing === null ? "لم يكتمل الفحص" : schemaMissing === 0 ? "الجداول والعروض المطلوبة موجودة" : formatNumber(schemaMissing) + " عنصرًا يحتاج إصلاحًا"}</strong></div>`,
    `<div class="detail-item"><span>ملفات غير مرتبطة</span><strong>${countLabel("orphan_storage_files")}</strong></div>`,
    `<div class="detail-item"><span>البيانات المحلية المجلوبة</span><strong>${formatFileSize(health.cache_bytes || 0)}</strong></div>`,
    `<div class="detail-item"><span>مساحة الجهاز المستخدمة للتطبيق</span><strong>${formatFileSize(health.device_storage_used_bytes || 0)}</strong></div>`,
    `<div class="detail-item"><span>مساحة الجهاز المتاحة تقديريًا</span><strong>${health.device_storage_quota_bytes ? formatFileSize(Math.max(0, health.device_storage_quota_bytes - (health.device_storage_used_bytes || 0))) : "غير متاحة من المتصفح"}</strong></div>`,
    `<div class="detail-item"><span>عمليات تنتظر المزامنة</span><strong>${formatNumber(queueCount)}</strong></div>`,
    `<div class="detail-item"><span>المساعد الذكي</span><strong>${config.edgeFunctions?.geminiAssistant ? "مهيأ عبر دالة آمنة" : "غير مهيأ"}</strong></div>`,
    `<div class="detail-item"><span>آخر نسخة احتياطية</span><strong>${health.last_backup_at ? formatDate(health.last_backup_at) : Object.hasOwn(health,"last_backup_at") ? "لا يوجد سجل" : "غير متاح"}</strong></div>`,
    `<div class="detail-item"><span>آخر استعادة</span><strong>${health.last_restore_at ? formatDate(health.last_restore_at) : Object.hasOwn(health,"last_restore_at") ? "لا يوجد سجل" : "غير متاح"}</strong></div>`,
    `<div class="detail-item"><span>وقت الفحص</span><strong>${health.measured_at ? formatDate(health.measured_at,true) : "غير متاح"}</strong></div>`,
    `<div class="detail-item"><span>آخر نشاط حقيقي مسجل</span><strong class="${pauseTone}">${lastActivity ? formatDate(lastActivity) + (idleDays !== null ? ` — منذ ${formatNumber(idleDays)} يوم` : "") : "لا يوجد سجل بعد"}</strong></div>`,
    '</div>'
  ].join("");
}

function releaseNotesMarkup() {
  return [
    `<header class="release-notes-header"><div><h3>سجل الإصدارات</h3><p>ما أضيف وما تغير في كل نسخة، لتسهيل التحقق والدعم.</p></div><span class="status-badge active">الإصدار الحالي ${escapeHtml(config.version || "12.5.0")}</span></header>`,
    '<div class="release-timeline">',
    ...RELEASE_NOTES.map(release => `<article class="release-card"><header><div><span class="release-version">${escapeHtml(release.version)}</span><h4>${escapeHtml(release.name)}</h4></div><div><span class="status-badge ${release.status === "الحالي" ? "active" : "draft"}">${escapeHtml(release.status)}</span><small>${escapeHtml(release.date)}</small></div></header>${release.groups.map(group => `<section><h5>${escapeHtml(group.title)}</h5><ul>${group.items.map(item => `<li>${escapeHtml(item)}</li>`).join("")}</ul></section>`).join("")}</article>`),
    '</div>'
  ].join("");
}

let settingsRenderRevision = 0;
async function renderSettings(tab = "general") {
  const revision = ++settingsRenderRevision;
  const nav = [
    ["general", "fa-solid fa-sliders", "الإعدادات العامة"], ["policies", "fa-solid fa-shield-halved", "سياسات العمل"],
    ["printing", "fa-solid fa-print", "الطباعة"], ["backup", "fa-solid fa-database", "النسخ الاحتياطي"], ["system", "fa-solid fa-circle-info", "حالة النظام"],
    ["releases", "fa-solid fa-clock-rotate-left", "الإصدارات"]
  ];
  const shell = panel => `<section class="page-toolbar"><div class="page-description">إدارة الخيارات العامة والنسخ الاحتياطي وفق صلاحية مدير النظام.</div></section><section class="settings-layout"><nav class="settings-nav">${nav.map(x => `<button class="${tab === x[0] ? "active" : ""}" data-settings-tab="${x[0]}"><i class="${x[1]}"></i>${x[2]}</button>`).join("")}</nav><article class="settings-panel">${panel}</article></section>`;
  els.pageContent.innerHTML = shell('<div class="empty-state" role="status"><i class="fa-solid fa-circle-notch fa-spin" aria-hidden="true"></i><h3>جارٍ تحميل المعلومات</h3></div>');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 7000);
  const [settingsRead, healthRead] = await Promise.allSettled([
    dataService.list("system_settings", { pageSize: 1, signal: controller.signal }),
    tab === "system" ? dataService.getSystemHealth() : Promise.resolve(null),
  ]);
  clearTimeout(timer);
  if (revision !== settingsRenderRevision || state.currentScreen !== "settings") return;
  const s = settingsRead.status === "fulfilled" ? settingsRead.value.data?.[0] || {} : {};
  const settingsUnavailable = !s.id;
  let savedScale = 110;
  try { savedScale = localStorage.getItem("zakat_font_scale_percent") || 110; } catch {                                   }
  applyFontScale(s.font_scale_percent || savedScale);
  const health = healthRead.status === "fulfilled" ? healthRead.value : { live_unavailable: true, diagnostic_error: healthRead.reason?.message || "تعذر جلب الحالة" };
  const settingsIssue = settingsUnavailable ? describeHealthError(settingsRead.reason || { message: "لم يتم تحميل سجل الإعدادات. تحقق من الاتصال واكتمال تثبيت قاعدة البيانات." }) : null;
  const settingsNotice = settingsIssue ? `<div class="health-issue" role="status"><i class="fa-solid fa-circle-exclamation"></i><div><strong>تعذر تحميل الإعدادات المحفوظة</strong><p>${escapeHtml(settingsIssue.action)}</p><details><summary>عرض السبب</summary><p dir="auto">${escapeHtml(settingsIssue.detail)}</p></details><button class="text-button" data-settings-tab="${escapeHtml(tab)}">إعادة المحاولة</button></div></div>` : "";
  let panel = "";
  if (tab === "general") panel = `<h3>الإعدادات العامة</h3><p>هوية النظام، ضغط المرفقات، حجم الخط، وحدود مساحة مشروع Supabase.</p><form id="settings-form" class="form-grid"><div class="form-field"><label>اسم الجهة</label><input class="form-control" name="organization_name" value="${escapeHtml(s.organization_name || "")}"></div><div class="form-field"><label>اسم النظام</label><input class="form-control" name="system_name" value="${escapeHtml(s.system_name || "")}"></div><div class="form-field"><label>العملة الافتراضية</label><select class="form-control" name="currency"><option value="YER" ${s.currency === "YER" ? "selected" : ""}>ريال يمني</option><option value="SAR" ${s.currency === "SAR" ? "selected" : ""}>ريال سعودي</option><option value="USD" ${s.currency === "USD" ? "selected" : ""}>دولار أمريكي</option></select></div><div class="form-field"><label>سنوات الاحتفاظ بالبيانات</label><input class="form-control" type="number" min="1" max="100" name="retention_years" value="${s.retention_years || 10}"></div><div class="form-field"><label>حجم الصورة الشخصية بعد الضغط (KB)</label><input class="form-control" type="number" min="40" max="2048" name="profile_image_max_kb" value="${s.profile_image_max_kb || 120}"><span class="help-text">الموصى به 120KB.</span></div><div class="form-field"><label>حجم صورة الوثيقة بعد الضغط (KB)</label><input class="form-control" type="number" min="40" max="4096" name="document_image_max_kb" value="${s.document_image_max_kb || 350}"><span class="help-text">الموصى به 350KB لوضوح النص.</span></div><div class="form-field"><label>أقصى حجم أصلي للمرفق (MB)</label><input class="form-control" type="number" min="1" max="50" name="attachment_original_max_mb" value="${s.attachment_original_max_mb || 8}"></div><div class="form-field"><label>حجم خط الواجهة (%)</label><input class="form-control" type="number" min="80" max="140" step="5" name="font_scale_percent" value="${s.font_scale_percent || 110}"></div><div class="form-field"><label>حد قاعدة بيانات Supabase (MB)</label><input class="form-control" type="number" min="100" name="supabase_database_limit_mb" value="${s.supabase_database_limit_mb || 500}"></div><div class="form-field"><label>حد Storage في Supabase (MB)</label><input class="form-control" type="number" min="100" name="supabase_storage_limit_mb" value="${s.supabase_storage_limit_mb || 1024}"></div></form><div style="display:flex;justify-content:flex-end;margin-top:18px"><button class="primary-button" data-save-settings><i class="fa-solid fa-floppy-disk"></i> حفظ الإعدادات</button></div>`;
  else if (tab === "policies") panel = `<h3>سياسات العمل والتحقق</h3><p>يمكن تغيير هذه الخيارات دون تعديل الكود.</p><form id="settings-form" class="form-grid"><div class="form-field full"><div class="switch-field"><div class="switch-copy"><strong>الصرف يحتاج اعتماداً</strong><small>تُحفظ سندات الموزعين تحت المراجعة قبل الترحيل.</small></div><label class="switch"><input name="require_payment_approval" type="checkbox" ${s.require_payment_approval ? "checked" : ""}><span class="switch-slider"></span></label></div></div><div class="form-field full"><div class="switch-field"><div class="switch-copy"><strong>الترحيل التلقائي لكل العمليات</strong><small>بعد الحفظ يتم الترحيل عند وجود اتصال وبعد فحص الرصيد والصلاحيات؛ المسودة غير المتصلة تُزامن أولاً ثم تنتظر الترحيل الآمن.</small></div><label class="switch"><input name="auto_post_all_operations" type="checkbox" ${s.auto_post_all_operations ? "checked" : ""}><span class="switch-slider"></span></label></div></div><div class="form-field full"><div class="switch-field"><div class="switch-copy"><strong>السماح بالمسودات دون اتصال</strong><small>يحفظ النظام المسودة محلياً ويرسلها عند عودة الشبكة.</small></div><label class="switch"><input name="allow_offline_drafts" type="checkbox" ${s.allow_offline_drafts ? "checked" : ""}><span class="switch-slider"></span></label></div></div><div class="form-field full"><div class="switch-field"><div class="switch-copy"><strong>الترحيل النهائي دون اتصال</strong><small>غير متاح أمنياً؛ يجب أن يعيد الخادم فحص الرصيد والتكرار لحظة الترحيل.</small></div><label class="switch"><input name="allow_final_offline" type="checkbox" disabled><span class="switch-slider"></span></label></div></div><div class="form-field"><label>طريقة الترحيل والمزامنة</label><select class="form-control" name="sync_mode"><option value="automatic" ${s.sync_mode !== "manual" ? "selected" : ""}>تلقائية عند عودة الإنترنت</option><option value="manual" ${s.sync_mode === "manual" ? "selected" : ""}>يدوية من شاشة المزامنة</option></select></div><div class="form-field"><label>عدد محاولات الدخول</label><input class="form-control" name="max_login_attempts" type="number" min="1" max="20" value="${s.max_login_attempts || 5}"></div><div class="form-field"><label>مدة الإيقاف المؤقت بالدقائق</label><input class="form-control" name="lockout_minutes" type="number" min="1" max="1440" value="${s.lockout_minutes || 15}"></div><div class="form-field"><label>تنبيه الصلاحية قبل</label><input class="form-control" name="stock_alert_days" type="number" value="${s.stock_alert_days || 30}"></div></form><div style="display:flex;justify-content:flex-end;margin-top:18px"><button class="primary-button" data-save-settings><i class="fa-solid fa-floppy-disk"></i> حفظ السياسات</button></div>`;
  else if (tab === "printing") panel = `<h3>إعدادات الطباعة</h3><p>تخصيص النصوص التي تظهر في السندات والتقارير.</p><form id="settings-form" class="form-grid"><div class="form-field full"><label>تذييل الطباعة</label><textarea class="form-control" name="print_footer">${escapeHtml(s.print_footer || "")}</textarea></div></form><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="ghost-button" data-test-print><i class="fa-solid fa-print"></i> اختبار الطباعة</button><button class="primary-button" data-save-settings>حفظ</button></div>`;
  else if (tab === "backup") panel = renderBackupPanel();
  else if (tab === "releases") panel = releaseNotesMarkup();
  else panel = systemHealthMarkup(s, health || {});
  els.pageContent.innerHTML = shell(settingsNotice + panel);
  if (settingsUnavailable) els.pageContent.querySelectorAll("#settings-form input,#settings-form select,#settings-form textarea,[data-save-settings]").forEach(control => { control.disabled = true; });
}

async function saveSettings() {
  const form = document.getElementById("settings-form");
  if (!form) return;
  const current = (await dataService.list("system_settings", { pageSize: 1 })).data[0];
  const payload = {};
  [...form.elements].forEach(el => {
    if (!el.name) return;
    payload[el.name] = el.type === "checkbox" ? el.checked : el.type === "number" ? Number(el.value) : el.value;
  });
  await dataService.update("system_settings", current.id, payload);
  if (payload.sync_mode) localStorage.setItem("zakat_sync_mode", payload.sync_mode);
  if (payload.font_scale_percent) applyFontScale(payload.font_scale_percent);
  scheduleNotificationRefresh();
  toast("تم حفظ الإعدادات.");
}

function exportRows(rows, filename = "report.csv") {
  if (!rows.length) return toast("لا توجد بيانات للتصدير.", "warning");
  const keys = Object.keys(rows[0]).filter(k => !["old_data", "new_data", "session_info", "details"].includes(k));
  const csv = "\uFEFF" + [keys.join(","), ...rows.map(row => keys.map(k => `"${String(row[k] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
  downloadText(filename, csv, "text/csv;charset=utf-8");
  toast("تم تجهيز ملف التصدير.");
}

async function resolveImportRelations(parsed) {
  const relationFields = parsed.definition.fields.filter(x => x.relation);
  const maps = new Map();
  for (const spec of relationFields) {
    if (!maps.has(spec.relation.table)) {
      const result = await dataService.list(spec.relation.table, { pageSize: 2000 });
      maps.set(spec.relation.table, result.data);
    }
  }
  const valid = [];
  const errors = [...parsed.errors];
  for (const row of parsed.rows) {
    try {
      for (const spec of relationFields) {
        const enteredName = row.payload[spec.key];
        if (!enteredName) continue;
        const match = maps.get(spec.relation.table).find(item => String(item[spec.relation.label] || "").trim().toLowerCase() === String(enteredName).trim().toLowerCase());
        if (!match) throw new Error(`${spec.header}: لم يُعثر على «${enteredName}» في دليل النظام`);
        row.payload[spec.key] = match.id;
      }
      valid.push(row);
    } catch (error) {
      errors.push({ rowNumber: row.rowNumber, message: error.message });
    }
  }
  return { ...parsed, rows: valid, errors };
}

async function openImportDialog(targetTable = "") {
  const choices = Object.entries(importDefinitions).map(([value, def]) => `<option value="${value}" ${value === targetTable ? "selected" : ""}>${escapeHtml(def.label)}</option>`).join("");
  openModal({
    title: "الاستيراد من Excel",
    eyebrow: "نموذج عربي + معاينة قبل الحفظ",
    body: `<div class="info-callout"><i class="fa-solid fa-circle-info"></i><span>نزّل النموذج الخاص بالنافذة، لا تغيّر أسماء الأعمدة، ثم اختر الملف. لن تُحفظ أي صفوف قبل ظهور المعاينة.</span></div><form id="import-form" class="form-grid"><div class="form-field"><label>نافذة الإدخال</label><select id="import-target" class="form-control" required><option value="">اختر...</option>${choices}</select></div><div class="form-field"><label>ملف Excel أو CSV</label><input id="import-file" class="form-control" type="file" accept=".xlsx,.xls,.csv" required></div><div class="form-field full"><button class="ghost-button" id="modal-download-template" type="button"><i class="fa-solid fa-file-arrow-down"></i> تنزيل نموذج النافذة المختارة</button></div></form><div id="import-preview" class="import-preview"><div class="empty-state" style="padding:24px"><i class="fa-solid fa-table"></i><p>اختر الملف لعرض المعاينة والأخطاء.</p></div></div>`,
    footer: `<button class="ghost-button" data-close-modal>إلغاء</button><button class="primary-button" id="execute-import" disabled><i class="fa-solid fa-file-import"></i> تنفيذ الاستيراد</button>`,
    wide: true
  });
  let prepared = null;
  const target = document.getElementById("import-target");
  const fileInput = document.getElementById("import-file");
  const execute = document.getElementById("execute-import");
  document.getElementById("modal-download-template").addEventListener("click", () => {
    if (!target.value) return toast("اختر نافذة الإدخال أولاً.", "warning");
    try { downloadImportTemplate(target.value); } catch (error) { toast(error.message, "error"); }
  });
  target.addEventListener("change", () => { prepared = null; execute.disabled = true; fileInput.value = ""; });
  fileInput.addEventListener("change", async () => {
    const file = fileInput.files?.[0];
    if (!target.value || !file) return toast("اختر النافذة والملف.", "warning");
    try {
      prepared = await resolveImportRelations(await parseImportFile(file, target.value));
      const previewRows = prepared.rows.slice(0, 8);
      const columns = prepared.definition.fields.slice(0, 6);
      document.getElementById("import-preview").innerHTML = `<div class="import-summary"><span class="status-badge active">${prepared.rows.length} صالحة</span><span class="status-badge ${prepared.errors.length ? "cancelled" : "active"}">${prepared.errors.length} أخطاء</span><strong>إجمالي ${prepared.total} صف</strong></div>${previewRows.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>الصف</th>${columns.map(x => `<th>${escapeHtml(x.header)}</th>`).join("")}</tr></thead><tbody>${previewRows.map(row => `<tr><td>${row.rowNumber}</td>${columns.map(x => `<td>${escapeHtml(row.payload[x.key] ?? "-")}</td>`).join("")}</tr>`).join("")}</tbody></table></div>` : ""}${prepared.errors.length ? `<div class="import-errors"><strong>الأخطاء</strong>${prepared.errors.slice(0, 20).map(x => `<div>الصف ${x.rowNumber}: ${escapeHtml(x.message)}</div>`).join("")}</div>` : ""}`;
      execute.disabled = !prepared.rows.length;
    } catch (error) {
      prepared = null; execute.disabled = true; toast(error.message || "تعذر قراءة الملف.", "error");
    }
  });
  execute.addEventListener("click", async () => {
    if (!prepared?.rows.length) return;
    execute.disabled = true; execute.innerHTML = `<span class="spinner" style="width:18px;height:18px;border-width:2px"></span> جارٍ الاستيراد`;
    try {
      const result = await dataService.bulkImport(target.value, prepared.rows.map(x => x.payload), fileInput.files[0].name);
      closeModal();
      toast(`اكتمل الاستيراد: ${result.success} ناجحة، ${result.failed} فاشلة.`, result.failed ? "warning" : "success");
      await refreshCurrentScreen();
    } catch (error) {
      toast(error.message || "تعذر تنفيذ الاستيراد.", "error");
      execute.disabled = false; execute.innerHTML = `<i class="fa-solid fa-file-import"></i> تنفيذ الاستيراد`;
    }
  });
}

async function openQuickDelivery() {
  if (!roleCanWrite("distribution_assignments", "create")) return toast("لا يملك دورك الحالي صلاحية تنفيذ التسليم السريع.", "error");
  const role = state.session?.profile?.role || "";
  const profileId = state.session?.profile?.id || null;
  const [beneficiaryResult, delegateResult] = await Promise.all([
    dataService.list("beneficiaries", { pageSize: 1000 }),
    dataService.list("delegates", { pageSize: 1000 })
  ]);

  let beneficiaries = (beneficiaryResult.data || []).filter(x => x.status === "approved");
  const activeDelegates = (delegateResult.data || []).filter(x => x.is_active !== false);
  if (role === "distributor") {
    const linkedDelegate = (delegateResult.data || []).find(d => d.profile_id === profileId || d.id === state.session?.profile?.delegate_id);
    if (!linkedDelegate) return toast("لا يوجد موزع مرتبط بالحساب الحالي.", "error");
    beneficiaries = beneficiaries.filter(b => b.delegate_id === linkedDelegate.id);
  }

  openModal({
    title: "تسليم سريع لمستفيد",
    eyebrow: "اختيار مستفيد مسجل وترحيل تلقائي",
    body: `<form id="quick-delivery-form" class="form-grid">
      <div class="form-field full quick-beneficiary-field">
        <label>اسم المستفيد المسجل <span class="required">*</span></label>
        <input id="quick-beneficiary-name" class="form-control" autocomplete="off" required placeholder="ابدأ بكتابة اسم مسجل في دليل المستفيدين">
        <input id="quick-beneficiary-id" type="hidden">
        <div id="quick-beneficiary-suggestions" class="quick-suggestions hidden"></div>
        <span class="help-text">${role === "distributor" ? "تظهر فقط الأسماء المعتمدة والمرتبطة بك." : "يمكن للمدير والمشرف البحث في جميع المستفيدين المعتمدين."}</span>
      </div>
      ${role === "admin" ? `<div class="form-field full"><label>الموزع</label><select id="quick-delegate-id" class="form-control" disabled><option value="">يُحدد تلقائياً من ملف المستفيد</option>${activeDelegates.map(d => `<option value="${escapeHtml(d.id)}">${escapeHtml(d.full_name)}</option>`).join("")}</select><span class="help-text">مدير النظام فقط يستطيع تغيير الموزع، بشرط وجود تخصيص نشط له في الحملة.</span></div>` : ""}
      <div class="form-field full"><label>المبلغ <span class="required">*</span></label><input id="quick-beneficiary-amount" class="form-control" type="number" min="1" step="0.01" required disabled placeholder="اختر المستفيد أولاً"></div>
      <div id="quick-delivery-context" class="quick-delivery-context hidden"></div>
      <div class="form-field full"><span class="help-text">لا يمكن إنشاء مستفيد جديد من هذه الشاشة. يجب تسجيله واعتماده مسبقاً في دليل المستفيدين.</span></div>
    </form>`,
    footer: `<button class="ghost-button" data-close-modal>إلغاء</button><button class="primary-button" id="confirm-quick-delivery" disabled><i class="fa-solid fa-bolt"></i> تسليم وترحيل الآن</button>`
  });

  const nameInput = document.getElementById("quick-beneficiary-name");
  const idInput = document.getElementById("quick-beneficiary-id");
  const amountInput = document.getElementById("quick-beneficiary-amount");
  const delegateSelect = document.getElementById("quick-delegate-id");
  const confirmButton = document.getElementById("confirm-quick-delivery");
  const suggestions = document.getElementById("quick-beneficiary-suggestions");
  const contextBox = document.getElementById("quick-delivery-context");
  let deliveryContext = null;

  const resetSelection = () => {
    idInput.value = "";
    amountInput.value = "";
    amountInput.disabled = true;
    amountInput.placeholder = "اختر المستفيد أولاً";
    if (delegateSelect) { delegateSelect.value = ""; delegateSelect.disabled = true; }
    confirmButton.disabled = true;
    deliveryContext = null;
    contextBox.classList.add("hidden");
    contextBox.innerHTML = "";
  };

  const showSuggestions = () => {
    const term = nameInput.value.trim().toLowerCase();
    resetSelection();
    const matches = beneficiaries.filter(b => !term || String(b.full_name || "").toLowerCase().includes(term)).slice(0, 12);
    suggestions.innerHTML = matches.length
      ? matches.map(b => `<button type="button" class="quick-suggestion-item" data-beneficiary-id="${escapeHtml(b.id)}" data-beneficiary-name="${escapeHtml(b.full_name)}"><strong>${escapeHtml(b.full_name)}</strong><span>${escapeHtml(b.file_no || b.phone || "")}</span></button>`).join("")
      : `<div class="quick-suggestion-empty">لا يوجد مستفيد مسجل ومعتمد بهذا الاسم</div>`;
    suggestions.classList.remove("hidden");
  };

  nameInput.addEventListener("input", showSuggestions);
  nameInput.addEventListener("focus", showSuggestions);
  const loadDeliveryContext = async (beneficiaryId, requestedDelegateId = null) => {
    contextBox.classList.remove("hidden");
    contextBox.innerHTML = `<div class="loading-inner"><span class="spinner"></span><span>جاري التحقق من التخصيص والرصيد...</span></div>`;
    amountInput.disabled = true;
    confirmButton.disabled = true;
    try {
      deliveryContext = await dataService.getQuickDeliveryContext(beneficiaryId, requestedDelegateId);
      if (delegateSelect) { delegateSelect.value = deliveryContext.delegate_id; delegateSelect.disabled = false; }
      contextBox.innerHTML = `<div><span>الموزع</span><strong>${escapeHtml(deliveryContext.delegate_name)}</strong></div><div><span>الحملة</span><strong>${escapeHtml(deliveryContext.campaign_name)}</strong></div><div><span>الصندوق / العملة</span><strong>${escapeHtml(deliveryContext.cashbox_name)} — ${escapeHtml(deliveryContext.currency)}</strong></div><div><span>المتاح للتسليم</span><strong>${formatCurrency(deliveryContext.available_amount, deliveryContext.currency)}</strong></div>`;
      amountInput.disabled = false;
      amountInput.max = String(deliveryContext.available_amount);
      amountInput.placeholder = "أدخل المبلغ";
      confirmButton.disabled = false;
      amountInput.focus();
    } catch (error) {
      deliveryContext = null;
      contextBox.innerHTML = `<div class="import-errors">${escapeHtml(error.message || "لا يوجد تخصيص صالح لهذا المستفيد.")}</div>`;
    }
  };

  suggestions.addEventListener("click", async e => {
    const item = e.target.closest("[data-beneficiary-id]");
    if (!item) return;
    idInput.value = item.dataset.beneficiaryId;
    nameInput.value = item.dataset.beneficiaryName;
    suggestions.classList.add("hidden");
    const selectedBeneficiary = beneficiaries.find(b => String(b.id) === String(item.dataset.beneficiaryId));
    await loadDeliveryContext(item.dataset.beneficiaryId, selectedBeneficiary?.delegate_id || null);
  });

  delegateSelect?.addEventListener("change", () => {
    if (idInput.value && delegateSelect.value) loadDeliveryContext(idInput.value, delegateSelect.value);
  });

  confirmButton.addEventListener("click", async () => {
    const beneficiaryId = idInput.value || null;
    const selected = beneficiaries.find(b => String(b.id) === String(beneficiaryId));
    const amount = Number(amountInput.value);
    if (!selected) return toast("يجب اختيار مستفيد مسجل من القائمة الظاهرة.", "error");
    if (!(amount > 0)) return toast("أدخل مبلغاً صحيحاً أكبر من صفر.", "error");
    if (!deliveryContext) return toast("تعذر تحديد الحملة والصندوق لهذا المستفيد.", "error");
    if (amount > Number(deliveryContext.available_amount)) return toast(`المبلغ يتجاوز المتاح ${formatCurrency(deliveryContext.available_amount, deliveryContext.currency)}.`, "error");
    confirmButton.disabled = true;
    try {
      await dataService.quickDelivery({ beneficiary_name: selected.full_name, beneficiary_id: selected.id, amount, campaign_id: deliveryContext.campaign_id, delegate_id: deliveryContext.delegate_id, cashbox_id: deliveryContext.cashbox_id, currency: deliveryContext.currency });
      closeModal();
      toast("تم التسليم والترحيل بنجاح.");
      await refreshCurrentScreen();
    } catch (error) {
      toast(error.message || "تعذر التسليم السريع.", "error");
      confirmButton.disabled = false;
    }
  });
}
function csvEscape(value) { return `"${String(value ?? "").replaceAll('"','""')}"`; }
async function downloadAllTablesZip() {
  if (!window.JSZip) throw new Error("مكتبة ZIP غير متاحة.");
  const backup = await dataService.createApplicationBackup();
  const all = backup.tables || {};
  const zip = new JSZip();
  Object.entries(all).forEach(([table, rows]) => {
    const safeRows = Array.isArray(rows) ? rows : [];
    const keys = [...new Set(safeRows.flatMap(r => Object.keys(r || {})))];
    const csv = "\uFEFF" + (keys.length ? [keys.map(csvEscape).join(","), ...safeRows.map(r => keys.map(k => csvEscape(typeof r[k] === "object" && r[k] !== null ? JSON.stringify(r[k]) : r[k])).join(","))].join("\n") : "");
    zip.file(`${table}.csv`, csv);
  });
  zip.file("backup.json", JSON.stringify(backup, null, 2));
  zip.file("backup_metadata.json", JSON.stringify({ format: backup.format, version: backup.version, exported_at: backup.exported_at, checksum: backup.checksum, counts: backup.counts }, null, 2));
  const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href=url; a.download=`zakat-full-backup-${new Date().toISOString().slice(0,10)}.zip`; a.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}

async function restoreBackupFile(file) {
  let backup;
  if (file.name.toLowerCase().endsWith(".zip")) {
    if (!window.JSZip) throw new Error("مكتبة ZIP غير متاحة.");
    const zip = await JSZip.loadAsync(file);
    const entry = zip.file("backup.json");
    if (!entry) throw new Error("ملف ZIP لا يحتوي backup.json صالحاً.");
    backup = JSON.parse(await entry.async("text"));
  } else backup = JSON.parse(await file.text());
  if (!["zakat-backup-v1", "zakat-backup-v2"].includes(backup?.format) || !backup.tables) throw new Error("صيغة النسخة الاحتياطية غير معروفة.");
  const legacyWarning = backup.format === "zakat-backup-v1" ? " هذه نسخة قديمة غير موقعة؛ سيُسجل ذلك في التدقيق." : "";
  const ok = await confirmDialog(`ستُفحص البصمة والحسابات ثم تُدمج بيانات النسخة ذرّياً داخل Supabase. عند فشل أي فحص يُلغى كل شيء تلقائياً.${legacyWarning} هل تريد المتابعة؟`, "استعادة نسخة احتياطية", "استعادة", true);
  if (!ok) return false;
  await dataService.restoreBackup(backup);
  return true;
}

async function refreshCurrentScreen() {
  await navigate(state.currentScreen, false);
  scheduleNotificationRefresh();
}

function updateConnectionStatus() {
  const chip = document.getElementById("connection-chip");
  const banner = document.getElementById("offline-banner");
  const online = isOnline();
  if (chip) {
    chip.classList.toggle("offline", !online);
    const label = chip.querySelector("span:last-child");
    if (label) label.textContent = online ? "متصل" : "غير متصل";
  }
  if (banner) banner.classList.toggle("hidden", online);
  document.body.classList.toggle("is-offline", !online);
  document.documentElement.dataset.connection = online ? "online" : "offline";
}

function updateQueueBadge() {
  const count = getOfflineQueue().filter(x => ["queued", "failed"].includes(x.status)).length;
  const badge = document.getElementById("sync-badge");
  if (!badge) return;
  badge.textContent = count;
  badge.classList.toggle("hidden", !count);
}

function updateNotificationBadge() {
  const badge = document.getElementById("notifications-badge");
  if (!badge) return;
  const count = notificationCount(state.notifications);
  badge.textContent = count > 99 ? "99+" : String(count);
  badge.classList.toggle("hidden", count === 0);
  badge.setAttribute("aria-label", count ? `${count} تنبيه` : "لا توجد تنبيهات");
}

function notificationQuerySpecs() {
  const specs = [];
  const add = (key, table, options = {}) => specs.push({ key, promise: dataService.list(table, options) });
  if (canAccess("inventory") || canAccess("stock-balances")) {
    add("items", "items", { pageSize: 1000 });
    add("inventoryLots", "inventory_lots", { pageSize: 1000 });
  }
  if (canAccess("beneficiaries")) add("beneficiaries", "beneficiaries", { pageSize: 1000 });
  if (state.session?.profile?.role === "admin") add("devices", "authorized_devices", { filters: { status: "pending" }, pageSize: 250 });
  if (canAccess("settings")) add("settings", "system_settings", { pageSize: 1 });
  [
    ["cash-receipts", "cash_receipts"],
    ["cash-payments", "cash_payments"],
    ["in-kind-receipts", "in_kind_receipts"],
    ["in-kind-payments", "in_kind_payments"]
  ].forEach(([screen, table]) => {
    if (canAccess(screen)) add(`pending:${table}`, table, { filters: { status: "under_review" }, pageSize: 250 });
  });
  return specs;
}

async function loadNotificationSnapshot() {
  const specs = notificationQuerySpecs();
  const settled = await Promise.allSettled(specs.map(spec => spec.promise));
  const loaded = {};
  const pendingDocuments = [];
  settled.forEach((result, index) => {
    const key = specs[index].key;
    if (result.status === "rejected") {
      console.warn(`تعذر تحديث مصدر التنبيهات ${key}`, result.reason);
      return;
    }
    const rows = result.value?.data || [];
    if (key.startsWith("pending:")) pendingDocuments.push(...rows);
    else loaded[key] = rows;
  });
  return {
    online: isOnline(),
    alertDays: loaded.settings?.[0]?.stock_alert_days || 30,
    items: loaded.items || [],
    inventoryLots: loaded.inventoryLots || [],
    pendingDocuments,
    beneficiaries: loaded.beneficiaries || [],
    devices: loaded.devices || [],
    queue: getOfflineQueue()
  };
}

function renderNotificationDrawer() {
  const body = document.getElementById("drawer-body");
  if (!body) return;
  body.innerHTML = state.notificationLoading && !state.notificationsLoaded
    ? `<div class="notification-loading"><span class="spinner"></span><p>جاري فحص التنبيهات المسموحة لك...</p></div>`
    : renderNotificationList(state.notifications, escapeHtml);
}

let notificationRefreshPromise = null;
async function refreshNotifications({ updateDrawer = false } = {}) {
  if (!state.session) return;
  if (notificationRefreshPromise) {
    await notificationRefreshPromise;
    if (updateDrawer) renderNotificationDrawer();
    return;
  }
  const profileId = String(state.session.profile?.id || state.session.user?.id || "");
  state.notificationLoading = true;
  document.getElementById("notifications-button")?.classList.add("is-loading");
  if (updateDrawer) renderNotificationDrawer();
  try {
    notificationRefreshPromise = loadNotificationSnapshot();
    const snapshot = await notificationRefreshPromise;
    const currentProfileId = String(state.session?.profile?.id || state.session?.user?.id || "");
    if (currentProfileId && currentProfileId === profileId) {
      state.notifications = buildNotifications(snapshot);
      state.notificationsLoaded = true;
      updateNotificationBadge();
    }
  } finally {
    notificationRefreshPromise = null;
    state.notificationLoading = false;
    document.getElementById("notifications-button")?.classList.remove("is-loading");
    if (updateDrawer) renderNotificationDrawer();
  }
}

let notificationRefreshTimer;
function scheduleNotificationRefresh() {
  clearTimeout(notificationRefreshTimer);
  notificationRefreshTimer = setTimeout(() => {
    refreshNotifications().catch(error => console.warn("تعذر تحديث مركز التنبيهات", error));
  }, 240);
}

async function openNotifications() {
  openDrawer("مركز التنبيهات", state.notificationsLoaded
    ? renderNotificationList(state.notifications, escapeHtml)
    : `<div class="notification-loading"><span class="spinner"></span><p>جاري فحص التنبيهات المسموحة لك...</p></div>`);
  await refreshNotifications({ updateDrawer: true }).catch(error => {
    console.warn("تعذر فتح مركز التنبيهات", error);
    const body = document.getElementById("drawer-body");
    if (body && !state.notificationsLoaded) body.innerHTML = `<div class="notification-empty error"><span><i class="fa-solid fa-triangle-exclamation"></i></span><h3>تعذر تحديث التنبيهات</h3><p>تحقق من الاتصال ثم حاول مرة أخرى.</p></div>`;
  });
}

function openCommandPalette() {
  const root = document.getElementById("command-palette");
  root.classList.remove("hidden"); root.setAttribute("aria-hidden", "false");
  renderCommandResults("");
  setTimeout(() => document.getElementById("command-search-input").focus(), 20);
}

function closeCommandPalette() {
  const root = document.getElementById("command-palette");
  root.classList.add("hidden"); root.setAttribute("aria-hidden", "true");
}

function renderCommandResults(query) {
  const q = query.trim().toLowerCase();
  const items = menuSections.flatMap(s => s.items).filter(i => canAccess(i.id) && (!q || i.label.toLowerCase().includes(q)));
  document.getElementById("command-results").innerHTML = items.map(i => `<button class="command-result" data-command-nav="${i.id}"><i class="${i.icon}"></i><span>${escapeHtml(i.label)}</span><kbd>فتح</kbd></button>`).join("") || `<div class="empty-state" style="padding:25px"><p>لا توجد نتائج.</p></div>`;
}

async function handleGlobalClick(event) {
  if (state.currentScreen === "ai-assistant" && await handleAssistantInteraction(event, els.pageContent, dataService, state.session)) return;
  const notificationNav = event.target.closest("[data-notification-nav]");
  if (notificationNav) { closeDrawer(); return navigate(notificationNav.dataset.notificationNav); }
  const nav = event.target.closest("[data-nav]");
  if (nav) return navigate(nav.dataset.nav);
  const commandNav = event.target.closest("[data-command-nav]");
  if (commandNav) { closeCommandPalette(); return navigate(commandNav.dataset.commandNav); }
  if (event.target.closest("[data-close-modal]")) return closeModal();
  if (event.target.closest("[data-close-drawer]")) return closeDrawer();
  if (event.target.closest("[data-close-command]")) return closeCommandPalette();
  if (event.target.closest("[data-retry]")) return refreshCurrentScreen();
  if (event.target.closest("[data-add-record]")) {
    if (state.currentConfig?.table === "distribution_assignments") return openQuickDelivery();
    if (state.currentConfig?.table === "import_jobs") return openImportDialog();
    return openRecordForm(state.currentConfig);
  }
  const importButton = event.target.closest("[data-open-import]");
  if (importButton) return openImportDialog(importButton.dataset.openImport);
  const templateButton = event.target.closest("[data-download-import-template]");
  if (templateButton) {
    try { return downloadImportTemplate(templateButton.dataset.downloadImportTemplate); }
    catch (error) { return toast(error.message, "error"); }
  }
  const quick = event.target.closest("[data-quick-add]");
  if (quick) return openRecordForm(screenConfigs[configKeyMap[quick.dataset.quickAdd]]);
  if (event.target.closest("[data-quick-delivery]")) return openQuickDelivery();
  const rowAction = event.target.closest("[data-row-action]");
  if (rowAction) return handleRowAction(rowAction.dataset.rowAction, rowAction.dataset.id);
  const page = event.target.closest("[data-page]");
  if (page && !page.disabled) { state.table.page = Number(page.dataset.page); return renderDataScreen(state.currentConfig); }
  const classTab = event.target.closest("[data-class-tab]");
  if (classTab) { state.classificationTab = classTab.dataset.classTab; state.table = { page: 1, pageSize: config.pageSize || 10, search: "", filters: {}, dateFrom: "", dateTo: "" }; return renderClassifications(); }
  const report = event.target.closest("[data-report]");
  if (report) { state.reportId = report.dataset.report; return renderReports(); }
  if (event.target.closest("[data-refresh-table]")) return refreshCurrentScreen();
  if (event.target.closest("[data-print-current]")) return printCurrentView();
  if (event.target.closest("[data-export-current]")) return exportRows(state.currentRows, `${state.currentConfig?.table || "data"}.csv`);
  if (event.target.closest("[data-export-report]")) return exportRows(state.currentRows, `${state.reportId}.csv`);
  if (event.target.closest("#apply-report-filter")) return applyReportFilter();
  if (event.target.closest("[data-sync-now]")) {
    const btn = event.target.closest("[data-sync-now]"); btn.disabled = true;
    try { const result = await dataService.syncQueue(); toast(`نجحت ${result.synced} عملية، وفشلت ${result.failed}.`, result.failed ? "warning" : "success"); }
    catch (error) { toast(error.message, "error"); }
    finally { updateQueueBadge(); scheduleNotificationRefresh(); renderSync(); }
    return;
  }
  const removeQueue = event.target.closest("[data-remove-queue]");
  if (removeQueue) { removeQueueItem(removeQueue.dataset.removeQueue); updateQueueBadge(); return renderSync(); }
  if (event.target.closest("[data-clear-synced]")) { clearCompletedQueue(); updateQueueBadge(); return renderSync(); }
  const settingsTab = event.target.closest("[data-settings-tab]");
  if (settingsTab) return renderSettings(settingsTab.dataset.settingsTab);
  if (event.target.closest("[data-test-print]")) { await printSettingsSample(); return; }
  if (event.target.closest("[data-save-settings]")) { try { await saveSettings(); } catch (error) { toast(error.message, "error"); } return; }
  if (event.target.closest("[data-backup-v3-create]")) { await runBackupV3Wizard(); return; }
  if (event.target.closest("[data-backup-v3-restore]") || event.target.closest("[data-backup-v3-resume]")) { await runRestoreV3Wizard(); return; }
  if (event.target.closest("[data-backup-v3-commit]")) { await commitRestoreV3Wizard(); return; }
  if (event.target.closest("[data-backup-v3-clear]")) {
    backupUiState.inspection = null;
    backupUiState.restoreSession = null;
    backupUiState.stagedParts = new Set();
    backupUiState.preflight = null;
    backupUiState.lastMessage = "تمت إزالة الملف من المعالج دون تغيير أي بيانات.";
    return renderSettings("backup");
  }
  if (event.target.closest("[data-download-backup]")) { try { await downloadAllTablesZip(); toast("تم تنزيل نسخة ZIP لجميع الجداول."); } catch (error) { toast(error.message || "تعذر إنشاء النسخة.", "error"); } return; }
  if (event.target.closest("[data-restore-backup]")) {
    const file = document.getElementById("restore-backup-file")?.files?.[0];
    if (!file) return toast("اختر ملف ZIP أو JSON أولاً.", "warning");
    try { if (await restoreBackupFile(file)) { toast("تمت استعادة النسخة بنجاح."); await renderSettings("backup"); } }
    catch (error) { toast(error.message || "تعذرت الاستعادة.", "error"); }
    return;
  }
  if (event.target.closest("[data-reset-demo]")) {
    const ok = await confirmDialog("سيتم حذف تعديلات العرض التجريبي وإعادة البيانات الأصلية.", "إعادة ضبط البيانات", "إعادة الضبط", true);
    if (ok) { await dataService.resetDemo(); toast("تمت إعادة البيانات التجريبية."); renderSettings("backup"); }
  }
}

function bindEvents() {
  document.addEventListener("click", handleGlobalClick);
  window.addEventListener("popstate", () => navigate(location.hash.replace("#", "") || "dashboard", false));
  subscribeConnection(({ online }) => {
    const wasOffline = document.body.classList.contains("is-offline");
    const connectionChanged = wasOffline !== !online;
    updateConnectionStatus();
    updateQueueBadge();
    if (connectionChanged) scheduleNotificationRefresh();
    if (wasOffline && online) toast("عاد الاتصال الفعلي بالخادم.", "info");
  });
  window.addEventListener("zakat:queue-change", () => { updateQueueBadge(); scheduleNotificationRefresh(); });
  window.addEventListener("zakat:data-change", scheduleNotificationRefresh);
  window.addEventListener("zakat:charts-ready", () => { if (state.currentScreen === "dashboard" && state.session) renderDashboard(); });
  window.addEventListener("zakat:assistant-ui-command", event => {
    const command = event.detail || {};
    if (command.type === "navigate" && typeof command.screen_id === "string") {
      navigate(command.screen_id);
    }
  });
  document.getElementById("menu-toggle").addEventListener("click", () => els.sidebar.classList.add("open"));
  document.getElementById("sidebar-close").addEventListener("click", () => els.sidebar.classList.remove("open"));
  document.getElementById("quick-search").addEventListener("click", openCommandPalette);
  document.getElementById("command-search-input").addEventListener("input", e => renderCommandResults(e.target.value));
  document.getElementById("sync-button").addEventListener("click", () => navigate("sync"));
  document.getElementById("notifications-button").addEventListener("click", openNotifications);
  document.getElementById("user-button").addEventListener("click", () => openProfileMenu());
  document.getElementById("profile-menu-button").addEventListener("click", () => openProfileMenu());
  document.addEventListener("keydown", e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); openCommandPalette(); }
    if (e.key === "Escape") { closeModal(); closeDrawer(); closeCommandPalette(); }
  });
  document.addEventListener("input", debounce(async e => {
    if (e.target.id === "table-search") {
      const value = e.target.value;
      state.table.search = value;
      state.table.page = 1;
      await renderDataScreen(state.currentConfig);
      const input = document.getElementById("table-search");
      if (input) { input.focus(); input.setSelectionRange(value.length, value.length); }
    }
  }, 420));
  document.addEventListener("change", async e => {
    if (e.target.id === "status-filter") {
      const key = e.target.dataset.filterKey || "status";
      delete state.table.filters.status;
      delete state.table.filters.is_active;
      if (e.target.value !== "") state.table.filters[key] = e.target.value === "true" ? true : e.target.value === "false" ? false : e.target.value;
      state.table.page = 1;
      await renderDataScreen(state.currentConfig);
    }
    if (["date-from-filter", "date-to-filter"].includes(e.target.id)) {
      state.table.dateFrom = document.getElementById("date-from-filter")?.value || "";
      state.table.dateTo = document.getElementById("date-to-filter")?.value || "";
      state.table.page = 1;
      await renderDataScreen(state.currentConfig);
    }
  });

  document.querySelector(".password-toggle").addEventListener("click", e => {
    const input = document.getElementById("login-password");
    input.type = input.type === "password" ? "text" : "password";
    e.currentTarget.innerHTML = `<i class="fa-regular ${input.type === "password" ? "fa-eye" : "fa-eye-slash"}"></i>`;
  });
  document.getElementById("forgot-password").addEventListener("click", () => toast("راجع مدير النظام لإعادة تعيين كلمة المرور.", "info"));
  document.getElementById("login-form").addEventListener("submit", handleLogin);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

async function handleLogin(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const identifier = document.getElementById("login-phone").value.trim();
  const password = document.getElementById("login-password").value;
  const remember = document.getElementById("remember-device").checked;
  button.disabled = true; button.innerHTML = `<span>جاري التحقق...</span><span class="spinner" style="width:20px;height:20px;border-width:2px;border-top-color:white"></span>`;
  try { state.session = await dataService.signIn(identifier, password, remember); showApp(); toast("تم تسجيل الدخول بنجاح."); }
  catch (error) { toast(error.message || "تعذر تسجيل الدخول.", "error"); }
  finally { button.disabled = false; button.innerHTML = `<span>دخول إلى النظام</span><i class="fa-solid fa-arrow-left-long"></i>`; }
}

function openProfileMenu() {
  const profile = state.session.profile || {};
  openModal({ title: profile.full_name || "حسابي", eyebrow: roleLabels[profile.role] || "مستخدم", body: `<div class="detail-grid"><div class="detail-item"><span>اسم المستخدم</span><strong>${escapeHtml(profile.username || "-")}</strong></div><div class="detail-item"><span>الهاتف</span><strong>${escapeHtml(profile.phone || state.session.user?.phone || "-")}</strong></div><div class="detail-item"><span>الدور</span><strong>${escapeHtml(roleLabels[profile.role] || profile.role || "-")}</strong></div><div class="detail-item"><span>الحالة</span><strong>${profile.is_active !== false ? "نشط" : "موقوف"}</strong></div></div>`, footer: `<button class="danger-button" id="logout-button"><i class="fa-solid fa-right-from-bracket"></i> تسجيل الخروج</button><button class="ghost-button" data-close-modal>إغلاق</button>` });
  document.getElementById("logout-button").addEventListener("click", async () => { await dataService.signOut(); state.session = null; closeModal(); showLogin(); toast("تم تسجيل الخروج.", "info"); });
}

async function init() {
  document.getElementById("current-year").textContent = new Date().getFullYear();
  applyFontScale(localStorage.getItem("zakat_font_scale_percent") || 110);
  if (!dataService.demoMode) document.getElementById("demo-login-note").classList.add("hidden");
  bindEvents();
  await dataService.initialize();
  state.session = await dataService.getSession();
  if (state.session) showApp(); else showLogin();
  checkConnectivity({ timeout: 2500, silent: true }).catch(() => null);
}

init().catch(error => {
  console.error(error);
  toast(error.message || "تعذر تشغيل النظام.", "error");
});
