import { dataService } from "./data-service.js";
import { menuSections, screenConfigs, reportDefinitions, roleLabels, statusLabels } from "./screen-config.js";
import { getOfflineQueue, removeQueueItem, clearCompletedQueue } from "./offline.js";
import {
  escapeHtml, formatCurrency, formatDate, formatNumber, statusBadge, roleBadge, priorityBadge,
  initials, toast, openModal, closeModal, openDrawer, closeDrawer, confirmDialog, downloadText, objectDetails
} from "./ui.js";

const config = window.ZAKAT_CONFIG || {};

const routeMap = {
  dashboard: null,
  users: "profiles",
  delegates: "delegates",
  donors: "donors",
  classifications: null,
  beneficiaries: "beneficiaries",
  campaigns: "campaigns",
  "cash-receipts": "cash_receipts",
  "cash-payments": "cash_payments",
  inventory: "items",
  "in-kind-receipts": "in_kind_receipts",
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
  delegates: "delegates",
  donors: "donors",
  beneficiary_categories: "beneficiary_categories",
  health_conditions: "health_conditions",
  beneficiaries: "beneficiaries",
  campaigns: "campaigns",
  cash_receipts: "cash_receipts",
  cash_payments: "cash_payments",
  items: "items",
  in_kind_receipts: "in_kind_receipts",
  baskets: "baskets",
  in_kind_payments: "in_kind_payments",
  account_closings: "closings",
  audit_logs: "audit_logs"
};

const roleAccess = {
  admin: "*",
  supervisor: ["dashboard", "delegates", "donors", "classifications", "beneficiaries", "campaigns", "cash-receipts", "cash-payments", "inventory", "in-kind-receipts", "baskets", "in-kind-payments", "closings", "reports", "audit", "sync"],
  accountant: ["dashboard", "delegates", "donors", "beneficiaries", "campaigns", "cash-receipts", "cash-payments", "closings", "reports"],
  distributor: ["dashboard", "beneficiaries", "cash-payments", "in-kind-payments", "sync"],
  data_entry: ["dashboard", "donors", "beneficiaries", "sync"],
  warehouse: ["dashboard", "inventory", "in-kind-receipts", "baskets", "in-kind-payments", "sync"],
  auditor: ["dashboard", "reports", "audit"]
};

const state = {
  session: null,
  currentScreen: "dashboard",
  classificationTab: "beneficiary_categories",
  reportId: "cash-donors",
  table: { page: 1, pageSize: config.pageSize || 10, search: "", filters: {} },
  charts: [],
  currentRows: [],
  currentConfig: null
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
  state.charts.forEach(chart => { try { chart.destroy(); } catch { /* noop */ } });
  state.charts = [];
}

function showLogin() {
  destroyCharts();
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
  buildNavigation();
  updateConnectionStatus();
  updateQueueBadge();
  navigate(location.hash.replace("#", "") || "dashboard", false);
}

function buildNavigation() {
  els.mainNav.innerHTML = menuSections.map(section => {
    const items = section.items.filter(item => canAccess(item.id));
    if (!items.length) return "";
    return `<span class="nav-section-label">${escapeHtml(section.label)}</span>${items.map(item => `
      <button class="nav-link ${state.currentScreen === item.id ? "active" : ""}" data-nav="${item.id}">
        <i class="${item.icon}"></i><span>${escapeHtml(item.label)}</span>
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
  state.currentScreen = screenId;
  state.table = { page: 1, pageSize: config.pageSize || 10, search: "", filters: {} };
  if (updateHash) history.pushState(null, "", `#${screenId}`);
  const meta = getScreenMeta(screenId);
  els.pageTitle.textContent = meta.label;
  els.breadcrumb.textContent = meta.label;
  document.title = `${meta.label} | ${config.appName || "نظام الزكاة"}`;
  buildNavigation();
  els.sidebar.classList.remove("open");
  setLoading();

  try {
    if (screenId === "dashboard") await renderDashboard();
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
  return `<button class="metric-card" data-nav="${screen}" style="text-align:right;border-style:solid">
    <div class="metric-top"><span class="metric-icon ${color}"><i class="${iconClass}"></i></span><span class="metric-trend"><i class="fa-solid fa-arrow-trend-up"></i> مباشر</span></div>
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

  const postedReceipts = receipts.data.filter(x => x.status === "posted");
  const postedPayments = payments.data.filter(x => x.status === "posted");
  const receivedTotal = postedReceipts.reduce((a, x) => a + Number(x.amount || 0), 0);
  const spentTotal = postedPayments.reduce((a, x) => a + Number(x.amount || 0), 0);
  const stockTotal = items.data.reduce((a, x) => a + Number(x.available_qty || 0), 0);
  const activeBeneficiaries = beneficiaries.data.filter(x => x.status === "approved").length;
  const openCampaigns = campaigns.data.filter(x => x.status === "open").length;
  const profile = state.session.profile || {};
  const firstName = profile.full_name?.split(" ")[0] || "بك";

  const recent = [...receipts.data.map(x => ({ ...x, kind: "قبض نقدي", amountText: formatCurrency(x.amount, x.currency), person: x.donor_name, icon: "fa-arrow-down", color: "green" })),
    ...payments.data.map(x => ({ ...x, kind: "صرف نقدي", amountText: formatCurrency(x.amount, x.currency), person: x.beneficiary_name, icon: "fa-arrow-up", color: "blue" }))]
    .sort((a, b) => String(b.created_at || b.receipt_date || b.payment_date).localeCompare(String(a.created_at || a.receipt_date || a.payment_date))).slice(0, 6);

  const lowStock = items.data.filter(x => Number(x.available_qty || 0) <= Number(x.min_stock || 0));
  const duplicateCandidates = beneficiaries.data.filter((row, idx, arr) => row.phone && arr.findIndex(x => x.phone === row.phone) !== idx);
  const pendingCount = pendingCash.total + pendingInKind.total;

  els.pageContent.innerHTML = `
    <section class="welcome-banner">
      <div class="welcome-copy"><span>لوحة المتابعة اليومية</span><h2>مرحباً ${escapeHtml(firstName)}، العمل يسير بصورة جيدة.</h2><p>آخر تحديث: ${formatDate(new Date().toISOString(), true)} • ${dataService.demoMode ? "بيانات تجريبية محلية" : "متصل بقاعدة Supabase"}</p></div>
      <div class="welcome-actions"><button class="white-action primary" data-quick-add="cash_receipts"><i class="fa-solid fa-plus"></i> سند قبض</button><button class="white-action" data-quick-add="beneficiaries"><i class="fa-solid fa-user-plus"></i> مستفيد جديد</button></div>
    </section>
    <section class="metrics-grid">
      ${dashboardMetric("fa-solid fa-people-roof", "blue", "المستفيدون المعتمدون", formatNumber(activeBeneficiaries), `${beneficiaries.total} ملف مسجل`, "beneficiaries")}
      ${dashboardMetric("fa-solid fa-bullseye", "purple", "الحملات المفتوحة", formatNumber(openCampaigns), `${campaigns.total} حملة إجمالاً`, "campaigns")}
      ${dashboardMetric("fa-solid fa-arrow-trend-down", "green", "إجمالي المقبوض", formatCurrency(receivedTotal), "السندات المرحلة فقط", "cash-receipts")}
      ${dashboardMetric("fa-solid fa-arrow-trend-up", "amber", "إجمالي المصروف", formatCurrency(spentTotal), "السندات المرحلة فقط", "cash-payments")}
      ${dashboardMetric("fa-solid fa-boxes-stacked", "red", "المخزون المتاح", formatNumber(stockTotal), `${lowStock.length} أصناف تحت الحد`, "inventory")}
    </section>
    <section class="dashboard-grid">
      <article class="panel"><header class="panel-header"><div class="panel-title"><span class="title-icon"><i class="fa-solid fa-chart-line"></i></span><div><h3>حركة القبض والصرف</h3><p>مقارنة العمليات النقدية خلال الأشهر الأخيرة</p></div></div><div class="panel-actions"><button class="secondary-button" data-nav="reports"><i class="fa-solid fa-arrow-up-right-from-square"></i> التقارير</button></div></header><div class="panel-body"><div class="chart-wrap"><canvas id="cash-flow-chart"></canvas></div></div></article>
      <article class="panel"><header class="panel-header"><div class="panel-title"><span class="title-icon"><i class="fa-solid fa-bell"></i></span><div><h3>التنبيهات المهمة</h3><p>تحتاج إلى متابعة أو قرار</p></div></div><span class="status-badge under_review">${pendingCount + lowStock.length + duplicateCandidates.length} تنبيه</span></header><div class="panel-body"><div class="alert-list">
        ${lowStock.length ? `<div class="alert-item danger"><i class="fa-solid fa-box-open"></i><div class="alert-copy"><strong>مخزون منخفض</strong><span>${lowStock.map(x => x.name).slice(0, 3).join("، ")}</span></div><button data-nav="inventory">فتح</button></div>` : ""}
        ${pendingCount ? `<div class="alert-item warning"><i class="fa-solid fa-hourglass-half"></i><div class="alert-copy"><strong>عمليات تحت المراجعة</strong><span>${pendingCount} سند صرف ينتظر الاعتماد</span></div><button data-nav="cash-payments">فتح</button></div>` : ""}
        ${duplicateCandidates.length ? `<div class="alert-item info"><i class="fa-solid fa-clone"></i><div class="alert-copy"><strong>تشابه في المستفيدين</strong><span>${duplicateCandidates.length} ملف يحتاج فحص التكرار</span></div><button data-nav="beneficiaries">فتح</button></div>` : ""}
        <div class="alert-item info"><i class="fa-solid fa-cloud-arrow-up"></i><div class="alert-copy"><strong>حالة المزامنة</strong><span>${navigator.onLine ? "كل الخدمات متصلة" : "الجهاز غير متصل حالياً"}</span></div><button data-nav="sync">عرض</button></div>
      </div></div></article>
    </section>
    <section class="dashboard-grid equal">
      <article class="panel"><header class="panel-header"><div class="panel-title"><span class="title-icon"><i class="fa-solid fa-clock-rotate-left"></i></span><div><h3>آخر العمليات</h3><p>أحدث سندات القبض والصرف</p></div></div><button class="ghost-button" data-nav="audit">عرض السجل</button></header><div class="table-scroll"><table class="data-table" style="min-width:620px"><thead><tr><th>العملية</th><th>الطرف</th><th>الحملة</th><th>القيمة</th><th>الحالة</th></tr></thead><tbody>${recent.map(x => `<tr><td><div class="cell-title"><span class="cell-avatar"><i class="fa-solid ${x.icon}"></i></span><div><strong>${escapeHtml(x.kind)}</strong><small>${formatDate(x.receipt_date || x.payment_date)}</small></div></div></td><td>${escapeHtml(x.person || "-")}</td><td>${escapeHtml(x.campaign_name || "-")}</td><td><strong>${x.amountText}</strong></td><td>${statusBadge(x.status)}</td></tr>`).join("")}</tbody></table></div></article>
      <article class="panel"><header class="panel-header"><div class="panel-title"><span class="title-icon"><i class="fa-solid fa-bolt"></i></span><div><h3>إجراءات سريعة</h3><p>ابدأ أكثر العمليات استخداماً</p></div></div></header><div class="panel-body"><div class="quick-actions-grid">
        <button class="quick-action-card" data-quick-add="cash_receipts"><i class="fa-solid fa-money-bill-transfer"></i><span>سند قبض نقدي</span></button>
        <button class="quick-action-card" data-quick-add="cash_payments"><i class="fa-solid fa-hand-holding-dollar"></i><span>سند صرف نقدي</span></button>
        <button class="quick-action-card" data-quick-add="in_kind_receipts"><i class="fa-solid fa-truck-ramp-box"></i><span>قبض عيني</span></button>
        <button class="quick-action-card" data-quick-add="in_kind_payments"><i class="fa-solid fa-box-open"></i><span>صرف عيني</span></button>
      </div></div></article>
    </section>`;

  requestAnimationFrame(() => createCashFlowChart(receipts.data, payments.data));
}

function createCashFlowChart(receipts, payments) {
  const canvas = document.getElementById("cash-flow-chart");
  if (!canvas || !window.Chart) return;
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(); d.setMonth(d.getMonth() - i);
    months.push({ key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: new Intl.DateTimeFormat("ar", { month: "short" }).format(d) });
  }
  const monthly = (rows, dateKey) => months.map(m => rows.filter(x => x.status === "posted" && String(x[dateKey] || "").startsWith(m.key)).reduce((a, x) => a + Number(x.amount || 0), 0));
  const chart = new Chart(canvas, {
    type: "line",
    data: { labels: months.map(m => m.label), datasets: [
      { label: "المقبوض", data: monthly(receipts, "receipt_date"), borderColor: "#0f67d8", backgroundColor: "rgba(15,103,216,.09)", fill: true, tension: .42, pointRadius: 3 },
      { label: "المصروف", data: monthly(payments, "payment_date"), borderColor: "#f59e0b", backgroundColor: "rgba(245,158,11,.05)", fill: true, tension: .42, pointRadius: 3 }
    ]},
    options: { responsive: true, maintainAspectRatio: false, interaction: { mode: "index", intersect: false }, plugins: { legend: { position: "bottom", labels: { usePointStyle: true, boxWidth: 7, font: { family: "Cairo", size: 10 } } } }, scales: { x: { grid: { display: false }, ticks: { font: { family: "Cairo", size: 9 } } }, y: { beginAtZero: true, ticks: { callback: value => Number(value).toLocaleString("ar"), font: { family: "Cairo", size: 9 } }, grid: { color: "rgba(148,163,184,.14)" } } } }
  });
  state.charts.push(chart);
}

async function renderClassifications() {
  const tabs = `<div class="toolbar-actions"><button class="${state.classificationTab === "beneficiary_categories" ? "primary-button" : "ghost-button"}" data-class-tab="beneficiary_categories"><i class="fa-solid fa-tags"></i> فئات المستفيدين</button><button class="${state.classificationTab === "health_conditions" ? "primary-button" : "ghost-button"}" data-class-tab="health_conditions"><i class="fa-solid fa-notes-medical"></i> الحالات الصحية</button></div>`;
  await renderDataScreen(screenConfigs[state.classificationTab], { prependToolbar: tabs });
}

function renderToolbar(cfg, prependToolbar = "") {
  return `<section class="page-toolbar"><div><div class="page-description">${escapeHtml(cfg.description || "")}</div>${prependToolbar ? `<div style="margin-top:12px">${prependToolbar}</div>` : ""}</div><div class="toolbar-actions">
    <button class="ghost-button" data-export-current><i class="fa-solid fa-file-export"></i> تصدير</button>
    <button class="ghost-button" data-print-current><i class="fa-solid fa-print"></i> طباعة</button>
    ${cfg.primaryLabel ? `<button class="primary-button" data-add-record><i class="fa-solid fa-plus"></i> ${escapeHtml(cfg.primaryLabel)}</button>` : ""}
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
    <div class="filter-control"><input id="date-from-filter" type="date" title="من تاريخ" /></div>
    <div class="filter-control"><input id="date-to-filter" type="date" title="إلى تاريخ" /></div>
    <button class="secondary-button" data-refresh-table><i class="fa-solid fa-rotate"></i> تحديث</button></section>`;
}

async function renderDataScreen(cfg, options = {}) {
  if (!cfg) throw new Error("تعذر العثور على إعدادات الشاشة.");
  state.currentConfig = cfg;
  const result = await dataService.list(cfg.table, state.table);
  state.currentRows = result.data;
  const totalPages = Math.max(1, Math.ceil(result.total / state.table.pageSize));
  if (state.table.page > totalPages) state.table.page = totalPages;

  els.pageContent.innerHTML = `${renderToolbar(cfg, options.prependToolbar || "")}${genericFilters(cfg)}
    <section class="table-card"><header class="table-card-header"><div><h3>${escapeHtml(cfg.title)}</h3><p>${formatNumber(result.total)} سجل • الصفحة ${state.table.page} من ${totalPages}</p></div><span class="status-badge active">محدث الآن</span></header>
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
  copy: ["fa-regular fa-copy", "نسخ"], "stock-check": ["fa-solid fa-warehouse", "فحص المخزون"], reopen: ["fa-solid fa-lock-open", "إعادة فتح"]
};

function availableActions(cfg, row) {
  return (cfg.actions || []).filter(action => {
    if (action === "edit" && ["posted", "cancelled", "closed"].includes(row.status)) return false;
    if (action === "post" && !["approved", "under_review", "draft"].includes(row.status)) return false;
    if (action === "cancel" && row.status === "cancelled") return false;
    if (action === "approve" && row.status !== "under_review") return false;
    if (action === "confirm-receipt" && row.receipt_status === "received") return false;
    return true;
  });
}

function renderRowActions(cfg, row) {
  const actions = availableActions(cfg, row);
  return `<div class="row-actions">${actions.map(action => {
    const meta = actionMeta[action] || ["fa-solid fa-ellipsis", action];
    return `<button class="row-action ${action === "cancel" ? "danger" : ""}" data-row-action="${action}" data-id="${row.id}" title="${meta[1]}"><i class="${meta[0]}"></i></button>`;
  }).join("")}</div>`;
}

async function loadRelationOptions(field) {
  if (field.type !== "relation") return [];
  const result = await dataService.list(field.relation.table, { pageSize: 1000, filters: field.relation.filter || {} });
  return result.data.map(row => ({ value: row.id, label: row[field.relation.label] || row.name || row.full_name || row.voucher_no || row.id }));
}

async function openRecordForm(cfg, record = null, copyMode = false) {
  const relationFields = cfg.fields.filter(f => f.type === "relation");
  const relationResults = await Promise.all(relationFields.map(loadRelationOptions));
  const relationMap = new Map(relationFields.map((f, i) => [f.key, relationResults[i]]));
  const itemResult = cfg.fields.some(f => f.type === "lineItems") ? await dataService.list("items", { pageSize: 1000, filters: { is_active: true } }) : { data: [] };
  let values = record ? { ...record } : {};
  if (copyMode) {
    values = { ...values, id: undefined, name: `${values.name || "نسخة"} - نسخة`, status: values.status === "posted" ? "draft" : values.status };
  }
  const body = `<form id="record-form" class="form-grid" novalidate>${cfg.fields.map(field => renderFormField(field, values[field.key], relationMap.get(field.key), itemResult.data)).join("")}</form>`;
  openModal({
    title: `${record && !copyMode ? "تعديل" : "إضافة"} ${cfg.singular}`,
    eyebrow: cfg.title,
    body,
    footer: `<button class="ghost-button" data-close-modal>إلغاء</button><button class="primary-button" id="save-record"><i class="fa-solid fa-floppy-disk"></i> حفظ البيانات</button>`,
    wide: cfg.fields.some(f => f.type === "lineItems")
  });

  document.querySelectorAll("[data-add-line-item]").forEach(btn => btn.addEventListener("click", () => addLineItemRow(btn.dataset.mode, itemResult.data)));
  document.querySelectorAll("[data-remove-line-item]").forEach(btn => btn.addEventListener("click", () => btn.closest(".line-item-row").remove()));
  document.getElementById("save-record").addEventListener("click", async () => {
    try {
      const payload = await collectFormData(cfg.fields);
      const missing = cfg.fields.filter(f => (f.required || (!record && f.requiredOnCreate)) && isEmptyValue(payload[f.key]));
      if (missing.length) throw new Error(`الحقول المطلوبة: ${missing.map(f => f.label).join("، ")}`);
      const button = document.getElementById("save-record");
      button.disabled = true; button.innerHTML = `<span class="spinner" style="width:20px;height:20px;border-width:2px"></span> جارٍ الحفظ`;
      const saved = record && !copyMode ? await dataService.update(cfg.table, record.id, payload) : await dataService.create(cfg.table, payload);
      closeModal();
      toast(saved?._queued ? "تم حفظ العملية محلياً وستُزامن عند عودة الاتصال." : "تم حفظ البيانات بنجاح.", saved?._queued ? "warning" : "success");
      await refreshCurrentScreen();
    } catch (error) { toast(error.message || "تعذر الحفظ.", "error"); }
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
  const common = `id="field-${field.key}" name="${field.key}" class="form-control" ${field.required ? "required" : ""}`;
  if (field.type === "select" || field.type === "relation") {
    const options = field.type === "relation" ? relationOptions : (field.options || []);
    control = `<select ${common}><option value="">اختر...</option>${options.map(opt => `<option value="${escapeHtml(opt.value)}" ${String(value ?? field.default ?? "") === String(opt.value) ? "selected" : ""}>${escapeHtml(opt.label)}</option>`).join("")}</select>`;
  } else if (field.type === "file") {
    control = `<div class="file-upload"><input ${common} type="file" accept="${escapeHtml(field.accept || "image/jpeg,image/png,image/webp,application/pdf")}" data-existing-value="${escapeHtml(value || "")}" /><div class="file-upload-copy"><i class="fa-solid fa-cloud-arrow-up"></i><span><strong>اختر صورة أو ملف PDF</strong><small>الحد الأقصى 5 ميجابايت${value ? ` • يوجد مرفق محفوظ` : ""}</small></span></div></div>`;
  } else if (field.type === "textarea") {
    control = `<textarea ${common} placeholder="${escapeHtml(field.placeholder || "")}">${escapeHtml(value ?? field.default ?? "")}</textarea>`;
  } else {
    const type = field.type === "currency" ? "number" : (field.type || "text");
    control = `<input ${common} type="${type}" value="${escapeHtml(value ?? field.default ?? "")}" placeholder="${escapeHtml(field.placeholder || "")}" ${field.min !== undefined ? `min="${field.min}"` : ""} ${field.max !== undefined ? `max="${field.max}"` : ""} ${["number", "currency"].includes(field.type) ? `step="${field.type === "currency" ? "0.01" : "1"}"` : ""} />`;
  }
  return `<div class="form-field ${full}">${label}${control}${field.help ? `<span class="help-text">${escapeHtml(field.help)}</span>` : ""}</div>`;
}

function lineItemRow(mode, items, values = {}) {
  const options = items.map(item => `<option value="${item.id}" ${String(values.item_id || "") === String(item.id) ? "selected" : ""}>${escapeHtml(item.name)} (${escapeHtml(item.unit || "")})</option>`).join("");
  if (mode === "receipt") {
    return `<div class="line-item-row receipt"><div class="form-field"><label>الصنف</label><select class="form-control line-item-product"><option value="">اختر الصنف</option>${options}</select></div><div class="form-field"><label>الكمية الكلية</label><input class="form-control line-item-qty" type="number" min="1" value="${values.quantity || ""}"></div><div class="form-field"><label>الصالحة</label><input class="form-control line-item-valid" type="number" min="0" value="${values.valid_qty ?? ""}"></div><div class="form-field"><label>التالفة</label><input class="form-control line-item-damaged" type="number" min="0" value="${values.damaged_qty ?? 0}"></div><div class="form-field"><label>التشغيلة / الصلاحية</label><div style="display:grid;grid-template-columns:1fr 1fr;gap:5px"><input class="form-control line-item-lot" placeholder="رقم التشغيلة" value="${escapeHtml(values.lot_no || "")}"><input class="form-control line-item-expiry" type="date" value="${escapeHtml(values.expiry_date || "")}"></div></div><button class="line-item-remove" type="button" data-remove-line-item><i class="fa-solid fa-trash"></i></button></div>`;
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
        if (field.mode === "receipt") Object.assign(base, {
          valid_qty: Number(row.querySelector(".line-item-valid")?.value || 0),
          damaged_qty: Number(row.querySelector(".line-item-damaged")?.value || 0),
          lot_no: row.querySelector(".line-item-lot")?.value || null,
          expiry_date: row.querySelector(".line-item-expiry")?.value || null
        });
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
      result[field.key] = file ? await dataService.uploadFile(file, field.folder || field.key) : (input.dataset.existingValue || null);
    } else if (["number", "currency"].includes(field.type)) result[field.key] = input.value === "" ? null : Number(input.value);
    else result[field.key] = input.value === "" ? null : input.value;
  }
  return result;
}

async function handleRowAction(action, id) {
  const cfg = state.currentConfig;
  if (!cfg) return;
  const record = await dataService.get(cfg.table, id);
  if (!record) return toast("تعذر العثور على السجل.", "error");
  try {
    if (action === "view") return showRecordDetails(cfg, record);
    if (action === "edit") return openRecordForm(cfg, record);
    if (action === "print") return printRecord(cfg, record);
    if (action === "toggle") {
      const ok = await confirmDialog(`هل تريد ${record.is_active ? "إيقاف" : "تفعيل"} هذا ${cfg.singular}؟`, "تغيير الحالة", "تأكيد");
      if (!ok) return;
      await dataService.action(cfg.table, id, "toggle", { current: record.is_active });
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
    } else if (action === "reopen") {
      const ok = await confirmDialog("إعادة فتح الإقفال عملية حساسة وستسجل في سجل التدقيق.", "إعادة فتح الحساب", "إعادة فتح", true);
      if (!ok) return;
      await dataService.action(cfg.table, id, "reopen");
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

function printRecord(cfg, record) {
  const html = `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><title>${escapeHtml(cfg.singular)}</title><style>body{font-family:Arial,sans-serif;padding:40px;color:#172b45}h1{color:#0f67d8;border-bottom:2px solid #0f67d8;padding-bottom:14px}table{width:100%;border-collapse:collapse}td{border:1px solid #d7e0ea;padding:10px}td:first-child{font-weight:bold;background:#f5f9fd;width:30%}.foot{margin-top:50px;display:flex;justify-content:space-between}</style></head><body><h1>${escapeHtml(config.appName || "نظام الزكاة")} - ${escapeHtml(cfg.singular)}</h1><table>${Object.entries(record).filter(([,v]) => typeof v !== "object").map(([k,v]) => `<tr><td>${escapeHtml(fieldLabels(cfg)[k] || k)}</td><td>${escapeHtml(v ?? "-")}</td></tr>`).join("")}</table><div class="foot"><span>توقيع المستلم: __________</span><span>توقيع المسؤول: __________</span></div><script>window.print();</script></body></html>`;
  const win = window.open("", "_blank", "width=850,height=950");
  win.document.write(html); win.document.close();
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
    const [receipts, payments] = await Promise.all([dataService.list("cash_receipts", { filters: { campaign_id: record.id }, pageSize: 100 }), dataService.list("cash_payments", { filters: { campaign_id: record.id }, pageSize: 100 })]);
    openDrawer(`تقرير الحملة: ${record.name}`, `<div class="detail-grid"><div class="detail-item"><span>إجمالي المقبوض</span><strong>${formatCurrency(record.received_total)}</strong></div><div class="detail-item"><span>إجمالي المصروف</span><strong>${formatCurrency(record.spent_total)}</strong></div><div class="detail-item full"><span>الرصيد</span><strong>${formatCurrency(record.balance)}</strong></div></div><h3>سندات القبض</h3>${renderSimpleRows(receipts.data, ["voucher_no", "donor_name", "amount", "status"])}<h3>سندات الصرف</h3>${renderSimpleRows(payments.data, ["voucher_no", "beneficiary_name", "amount", "status"])}`);
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
    <section class="sync-summary"><div class="sync-card"><i class="fa-solid fa-wifi"></i><div><strong>${navigator.onLine ? "متصل" : "غير متصل"}</strong><span>حالة الشبكة الحالية</span></div></div><div class="sync-card"><i class="fa-solid fa-hourglass-half"></i><div><strong>${pending}</strong><span>عمليات معلقة</span></div></div><div class="sync-card"><i class="fa-solid fa-circle-check"></i><div><strong>${synced}</strong><span>عمليات ناجحة</span></div></div><div class="sync-card"><i class="fa-solid fa-triangle-exclamation"></i><div><strong>${failed}</strong><span>عمليات فاشلة</span></div></div></section>
    <section class="panel" style="margin-bottom:16px"><div class="panel-body"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px"><div><strong style="font-size:12px">حالة المزامنة</strong><div class="muted" style="font-size:9px">آخر مزامنة: ${last ? formatDate(last, true) : "لم تتم بعد"}</div></div><span>${pending ? `${pending} متبقية` : "مكتملة"}</span></div><div class="progress"><span style="width:${queue.length ? Math.round((synced / queue.length) * 100) : 100}%"></span></div></div></section>
    <section class="table-card"><header class="table-card-header"><div><h3>طابور العمليات المحلية</h3><p>يتم حفظ المسودات فقط دون اتصال، ثم يعيد الخادم فحصها.</p></div></header>${queue.length ? `<div class="table-scroll"><table class="data-table"><thead><tr><th>وقت الإنشاء</th><th>العملية</th><th>الجدول</th><th>المعرف المحلي</th><th>المحاولات</th><th>الحالة</th><th>الإجراء</th></tr></thead><tbody>${queue.map(x => `<tr><td>${formatDate(x.createdAt, true)}</td><td>${escapeHtml(x.operation)}</td><td>${escapeHtml(x.table)}</td><td><code>${escapeHtml(x.id.slice(0,12))}</code></td><td>${x.attempts}</td><td>${statusBadge(x.status)}</td><td><button class="row-action danger" data-remove-queue="${x.id}" title="حذف المسودة المحلية"><i class="fa-solid fa-trash"></i></button></td></tr>`).join("")}</tbody></table></div>` : `<div class="empty-state"><i class="fa-solid fa-cloud-circle-check"></i><h3>لا توجد عمليات معلقة</h3><p>كل البيانات متزامنة مع الخادم.</p></div>`}</section>`;
}

async function renderSettings(tab = "general") {
  const settingsResult = await dataService.list("system_settings", { pageSize: 1 });
  const s = settingsResult.data[0] || {};
  const nav = [
    ["general", "fa-solid fa-sliders", "الإعدادات العامة"], ["policies", "fa-solid fa-shield-halved", "سياسات العمل"],
    ["printing", "fa-solid fa-print", "الطباعة"], ["backup", "fa-solid fa-database", "النسخ الاحتياطي"], ["system", "fa-solid fa-circle-info", "حالة النظام"]
  ];
  let panel = "";
  if (tab === "general") panel = `<h3>الإعدادات العامة</h3><p>هوية النظام والعملات وصيغة أرقام السندات.</p><form id="settings-form" class="form-grid"><div class="form-field"><label>اسم الجهة</label><input class="form-control" name="organization_name" value="${escapeHtml(s.organization_name || "")}"></div><div class="form-field"><label>اسم النظام</label><input class="form-control" name="system_name" value="${escapeHtml(s.system_name || "")}"></div><div class="form-field"><label>العملة الافتراضية</label><select class="form-control" name="currency"><option value="YER" ${s.currency === "YER" ? "selected" : ""}>ريال يمني</option><option value="SAR" ${s.currency === "SAR" ? "selected" : ""}>ريال سعودي</option><option value="USD" ${s.currency === "USD" ? "selected" : ""}>دولار أمريكي</option></select></div><div class="form-field"><label>سنوات الاحتفاظ بالبيانات</label><input class="form-control" type="number" name="retention_years" value="${s.retention_years || 10}"></div></form><div style="display:flex;justify-content:flex-end;margin-top:18px"><button class="primary-button" data-save-settings><i class="fa-solid fa-floppy-disk"></i> حفظ الإعدادات</button></div>`;
  else if (tab === "policies") panel = `<h3>سياسات العمل والتحقق</h3><p>يمكن تغيير هذه الخيارات دون تعديل الكود.</p><form id="settings-form" class="form-grid"><div class="form-field full"><div class="switch-field"><div class="switch-copy"><strong>الصرف يحتاج اعتماداً</strong><small>تُحفظ سندات الموزعين تحت المراجعة قبل الترحيل.</small></div><label class="switch"><input name="require_payment_approval" type="checkbox" ${s.require_payment_approval ? "checked" : ""}><span class="switch-slider"></span></label></div></div><div class="form-field full"><div class="switch-field"><div class="switch-copy"><strong>السماح بالمسودات دون اتصال</strong><small>يحفظ النظام المسودة محلياً ويرسلها عند عودة الشبكة.</small></div><label class="switch"><input name="allow_offline_drafts" type="checkbox" ${s.allow_offline_drafts ? "checked" : ""}><span class="switch-slider"></span></label></div></div><div class="form-field full"><div class="switch-field"><div class="switch-copy"><strong>السماح بالترحيل النهائي دون اتصال</strong><small>غير موصى به لأن الرصيد يجب أن يعاد فحصه في الخادم.</small></div><label class="switch"><input name="allow_final_offline" type="checkbox" ${s.allow_final_offline ? "checked" : ""}><span class="switch-slider"></span></label></div></div><div class="form-field"><label>تنبيه الصلاحية قبل</label><input class="form-control" name="stock_alert_days" type="number" value="${s.stock_alert_days || 30}"></div></form><div style="display:flex;justify-content:flex-end;margin-top:18px"><button class="primary-button" data-save-settings><i class="fa-solid fa-floppy-disk"></i> حفظ السياسات</button></div>`;
  else if (tab === "printing") panel = `<h3>إعدادات الطباعة</h3><p>تخصيص النصوص التي تظهر في السندات والتقارير.</p><form id="settings-form" class="form-grid"><div class="form-field full"><label>تذييل الطباعة</label><textarea class="form-control" name="print_footer">${escapeHtml(s.print_footer || "")}</textarea></div></form><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button class="ghost-button" onclick="window.print()"><i class="fa-solid fa-print"></i> اختبار الطباعة</button><button class="primary-button" data-save-settings>حفظ</button></div>`;
  else if (tab === "backup") panel = `<h3>النسخ الاحتياطي والاستعادة</h3><p>في وضع Supabase تتم النسخ الاحتياطية من لوحة المشروع. في العرض التجريبي يمكنك تنزيل نسخة JSON.</p><div class="detail-grid"><div class="detail-item full"><span>إنشاء نسخة</span><strong>تنزيل جميع البيانات المحلية بصيغة JSON</strong><button class="secondary-button" data-download-backup style="margin-top:10px"><i class="fa-solid fa-download"></i> تنزيل النسخة</button></div><div class="detail-item full"><span>استعادة بيانات العرض</span><strong>إعادة البيانات التجريبية إلى حالتها الأصلية</strong><button class="danger-button" data-reset-demo style="margin-top:10px"><i class="fa-solid fa-rotate-left"></i> إعادة الضبط</button></div></div>`;
  else panel = `<h3>حالة النظام</h3><p>معلومات الاتصال والواجهة الحالية.</p><div class="detail-grid"><div class="detail-item"><span>وضع التشغيل</span><strong>${dataService.demoMode ? "عرض تجريبي محلي" : "Supabase متصل"}</strong></div><div class="detail-item"><span>حالة الشبكة</span><strong>${navigator.onLine ? "متصل" : "غير متصل"}</strong></div><div class="detail-item"><span>الواجهة</span><strong>HTML + CSS + JavaScript</strong></div><div class="detail-item"><span>النشر</span><strong>جاهز لـ Vercel</strong></div><div class="detail-item full"><span>ملاحظة أمنية</span><strong>لا تضع service_role key في ملفات الواجهة. استخدم anon/publishable key مع RLS ووظائف Supabase الإدارية.</strong></div></div>`;
  els.pageContent.innerHTML = `<section class="page-toolbar"><div class="page-description">إدارة الخيارات العامة والنسخ الاحتياطي وفق صلاحية مدير النظام.</div></section><section class="settings-layout"><nav class="settings-nav">${nav.map(x => `<button class="${tab === x[0] ? "active" : ""}" data-settings-tab="${x[0]}"><i class="${x[1]}"></i>${x[2]}</button>`).join("")}</nav><article class="settings-panel">${panel}</article></section>`;
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
  toast("تم حفظ الإعدادات.");
}

function exportRows(rows, filename = "report.csv") {
  if (!rows.length) return toast("لا توجد بيانات للتصدير.", "warning");
  const keys = Object.keys(rows[0]).filter(k => !["old_data", "new_data", "session_info", "details"].includes(k));
  const csv = "\uFEFF" + [keys.join(","), ...rows.map(row => keys.map(k => `"${String(row[k] ?? "").replaceAll('"', '""')}"`).join(","))].join("\n");
  downloadText(filename, csv, "text/csv;charset=utf-8");
  toast("تم تجهيز ملف التصدير.");
}

async function refreshCurrentScreen() {
  await navigate(state.currentScreen, false);
}

function updateConnectionStatus() {
  const chip = document.getElementById("connection-chip");
  if (!chip) return;
  chip.classList.toggle("offline", !navigator.onLine);
  chip.querySelector("span:last-child").textContent = navigator.onLine ? "متصل" : "غير متصل";
}

function updateQueueBadge() {
  const count = getOfflineQueue().filter(x => ["queued", "failed"].includes(x.status)).length;
  const badge = document.getElementById("sync-badge");
  badge.textContent = count;
  badge.classList.toggle("hidden", !count);
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
  const nav = event.target.closest("[data-nav]");
  if (nav) return navigate(nav.dataset.nav);
  const commandNav = event.target.closest("[data-command-nav]");
  if (commandNav) { closeCommandPalette(); return navigate(commandNav.dataset.commandNav); }
  if (event.target.closest("[data-close-modal]")) return closeModal();
  if (event.target.closest("[data-close-drawer]")) return closeDrawer();
  if (event.target.closest("[data-close-command]")) return closeCommandPalette();
  if (event.target.closest("[data-retry]")) return refreshCurrentScreen();
  if (event.target.closest("[data-add-record]")) return openRecordForm(state.currentConfig);
  const quick = event.target.closest("[data-quick-add]");
  if (quick) return openRecordForm(screenConfigs[configKeyMap[quick.dataset.quickAdd]]);
  const rowAction = event.target.closest("[data-row-action]");
  if (rowAction) return handleRowAction(rowAction.dataset.rowAction, rowAction.dataset.id);
  const page = event.target.closest("[data-page]");
  if (page && !page.disabled) { state.table.page = Number(page.dataset.page); return renderDataScreen(state.currentConfig); }
  const classTab = event.target.closest("[data-class-tab]");
  if (classTab) { state.classificationTab = classTab.dataset.classTab; state.table = { page: 1, pageSize: config.pageSize || 10, search: "", filters: {} }; return renderClassifications(); }
  const report = event.target.closest("[data-report]");
  if (report) { state.reportId = report.dataset.report; return renderReports(); }
  if (event.target.closest("[data-refresh-table]")) return refreshCurrentScreen();
  if (event.target.closest("[data-print-current]")) return window.print();
  if (event.target.closest("[data-export-current]")) return exportRows(state.currentRows, `${state.currentConfig?.table || "data"}.csv`);
  if (event.target.closest("[data-export-report]")) return exportRows(state.currentRows, `${state.reportId}.csv`);
  if (event.target.closest("#apply-report-filter")) return applyReportFilter();
  if (event.target.closest("[data-sync-now]")) {
    const btn = event.target.closest("[data-sync-now]"); btn.disabled = true;
    try { const result = await dataService.syncQueue(); toast(`نجحت ${result.synced} عملية، وفشلت ${result.failed}.`, result.failed ? "warning" : "success"); }
    catch (error) { toast(error.message, "error"); }
    finally { updateQueueBadge(); renderSync(); }
    return;
  }
  const removeQueue = event.target.closest("[data-remove-queue]");
  if (removeQueue) { removeQueueItem(removeQueue.dataset.removeQueue); updateQueueBadge(); return renderSync(); }
  if (event.target.closest("[data-clear-synced]")) { clearCompletedQueue(); updateQueueBadge(); return renderSync(); }
  const settingsTab = event.target.closest("[data-settings-tab]");
  if (settingsTab) return renderSettings(settingsTab.dataset.settingsTab);
  if (event.target.closest("[data-save-settings]")) { try { await saveSettings(); } catch (error) { toast(error.message, "error"); } return; }
  if (event.target.closest("[data-download-backup]")) { downloadText(`zakat-backup-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify(dataService.exportDemoData(), null, 2), "application/json"); return toast("تم تنزيل النسخة الاحتياطية."); }
  if (event.target.closest("[data-reset-demo]")) {
    const ok = await confirmDialog("سيتم حذف تعديلات العرض التجريبي وإعادة البيانات الأصلية.", "إعادة ضبط البيانات", "إعادة الضبط", true);
    if (ok) { await dataService.resetDemo(); toast("تمت إعادة البيانات التجريبية."); renderSettings("backup"); }
  }
}

function bindEvents() {
  document.addEventListener("click", handleGlobalClick);
  window.addEventListener("popstate", () => navigate(location.hash.replace("#", "") || "dashboard", false));
  window.addEventListener("online", () => { updateConnectionStatus(); updateQueueBadge(); toast("عاد الاتصال بالشبكة.", "info"); });
  window.addEventListener("offline", () => { updateConnectionStatus(); toast("انقطع الاتصال. يمكن متابعة حفظ المسودات محلياً.", "warning"); });
  window.addEventListener("zakat:queue-change", updateQueueBadge);
  document.getElementById("menu-toggle").addEventListener("click", () => els.sidebar.classList.add("open"));
  document.getElementById("sidebar-close").addEventListener("click", () => els.sidebar.classList.remove("open"));
  document.getElementById("quick-search").addEventListener("click", openCommandPalette);
  document.getElementById("command-search-input").addEventListener("input", e => renderCommandResults(e.target.value));
  document.getElementById("sync-button").addEventListener("click", () => navigate("sync"));
  document.getElementById("notifications-button").addEventListener("click", () => toast("لديك تنبيهات مخزون وعمليات معلقة في لوحة التحكم.", "info"));
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
  });

  document.querySelector(".password-toggle").addEventListener("click", e => {
    const input = document.getElementById("login-password");
    input.type = input.type === "password" ? "text" : "password";
    e.currentTarget.innerHTML = `<i class="fa-regular ${input.type === "password" ? "fa-eye" : "fa-eye-slash"}"></i>`;
  });
  document.getElementById("forgot-password").addEventListener("click", () => toast("استخدم استعادة كلمة المرور من بريدك أو راجع مدير النظام.", "info"));
  document.getElementById("login-form").addEventListener("submit", handleLogin);
}

function debounce(fn, delay) {
  let timer;
  return (...args) => { clearTimeout(timer); timer = setTimeout(() => fn(...args), delay); };
}

async function handleLogin(event) {
  event.preventDefault();
  const button = event.currentTarget.querySelector("button[type=submit]");
  const identifier = document.getElementById("login-email").value.trim();
  const password = document.getElementById("login-password").value;
  const remember = document.getElementById("remember-device").checked;
  button.disabled = true; button.innerHTML = `<span>جاري التحقق...</span><span class="spinner" style="width:20px;height:20px;border-width:2px;border-top-color:white"></span>`;
  try { state.session = await dataService.signIn(identifier, password, remember); showApp(); toast("تم تسجيل الدخول بنجاح."); }
  catch (error) { toast(error.message || "تعذر تسجيل الدخول.", "error"); }
  finally { button.disabled = false; button.innerHTML = `<span>دخول إلى النظام</span><i class="fa-solid fa-arrow-left-long"></i>`; }
}

function openProfileMenu() {
  const profile = state.session.profile || {};
  openModal({ title: profile.full_name || "حسابي", eyebrow: roleLabels[profile.role] || "مستخدم", body: `<div class="detail-grid"><div class="detail-item"><span>اسم المستخدم</span><strong>${escapeHtml(profile.username || "-")}</strong></div><div class="detail-item"><span>البريد</span><strong>${escapeHtml(profile.email || state.session.user?.email || "-")}</strong></div><div class="detail-item"><span>الدور</span><strong>${escapeHtml(roleLabels[profile.role] || profile.role || "-")}</strong></div><div class="detail-item"><span>الحالة</span><strong>${profile.is_active !== false ? "نشط" : "موقوف"}</strong></div></div>`, footer: `<button class="danger-button" id="logout-button"><i class="fa-solid fa-right-from-bracket"></i> تسجيل الخروج</button><button class="ghost-button" data-close-modal>إغلاق</button>` });
  document.getElementById("logout-button").addEventListener("click", async () => { await dataService.signOut(); state.session = null; closeModal(); showLogin(); toast("تم تسجيل الخروج.", "info"); });
}

async function init() {
  document.getElementById("current-year").textContent = new Date().getFullYear();
  if (!dataService.demoMode) document.getElementById("demo-login-note").classList.add("hidden");
  bindEvents();
  await dataService.initialize();
  state.session = await dataService.getSession();
  if (state.session) showApp(); else showLogin();
}

init().catch(error => {
  console.error(error);
  toast(error.message || "تعذر تشغيل النظام.", "error");
});
