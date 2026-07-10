import { roleLabels, statusLabels } from "./screen-config.js";

const config = window.ZAKAT_CONFIG || {};

export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function formatCurrency(value, currency = config.currency || "YER") {
  const amount = Number(value || 0);
  try {
    return new Intl.NumberFormat(config.locale || "ar-YE", {
      style: "currency",
      currency,
      maximumFractionDigits: currency === "YER" ? 0 : 2
    }).format(amount);
  } catch {
    return `${amount.toLocaleString("ar")} ${currency}`;
  }
}

export function formatNumber(value) {
  return Number(value || 0).toLocaleString("ar-YE");
}

export function formatDate(value, includeTime = false) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return escapeHtml(value);
  return new Intl.DateTimeFormat("ar-YE", includeTime
    ? { dateStyle: "medium", timeStyle: "short" }
    : { year: "numeric", month: "short", day: "numeric" }).format(date);
}

export function statusBadge(value) {
  if (value === true) value = "active";
  if (value === false) value = "inactive";
  const normalized = String(value ?? "draft");
  return `<span class="status-badge ${escapeHtml(normalized)}">${escapeHtml(statusLabels[normalized] || normalized)}</span>`;
}

export function roleBadge(value) {
  return `<span class="status-badge ${value === "admin" ? "posted" : "draft"}">${escapeHtml(roleLabels[value] || value || "-")}</span>`;
}

export function priorityBadge(value) {
  const labels = { critical: "عاجلة جداً", high: "عالية", medium: "متوسطة", low: "منخفضة" };
  const classes = { critical: "cancelled", high: "under_review", medium: "approved", low: "draft" };
  return `<span class="status-badge ${classes[value] || "draft"}">${labels[value] || value || "-"}</span>`;
}

export function initials(name = "م") {
  const parts = String(name).trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] || "م") + (parts[1]?.[0] || "");
}

export function toast(message, type = "success", title = null, duration = 3800) {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const icons = { success: "fa-circle-check", error: "fa-circle-exclamation", warning: "fa-triangle-exclamation", info: "fa-circle-info" };
  const titles = { success: "تمت العملية", error: "تعذر التنفيذ", warning: "تنبيه", info: "معلومة" };
  const node = document.createElement("div");
  node.className = `toast ${type}`;
  node.innerHTML = `<i class="fa-solid ${icons[type] || icons.info}"></i><div class="toast-copy"><strong>${escapeHtml(title || titles[type] || titles.info)}</strong><span>${escapeHtml(message)}</span></div>`;
  container.appendChild(node);
  setTimeout(() => node.remove(), duration);
}

export function openModal({ title, eyebrow = "إدارة السجل", body = "", footer = "", wide = false }) {
  const root = document.getElementById("modal-root");
  const modal = root.querySelector(".modal");
  document.getElementById("modal-title").textContent = title;
  document.getElementById("modal-eyebrow").textContent = eyebrow;
  document.getElementById("modal-body").innerHTML = body;
  document.getElementById("modal-footer").innerHTML = footer;
  modal.style.width = wide ? "min(1120px, calc(100vw - 32px))" : "";
  root.classList.remove("hidden");
  root.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  setTimeout(() => root.querySelector("input, select, textarea, button")?.focus(), 30);
}

export function closeModal() {
  const root = document.getElementById("modal-root");
  root.classList.add("hidden");
  root.setAttribute("aria-hidden", "true");
  document.getElementById("modal-body").innerHTML = "";
  document.getElementById("modal-footer").innerHTML = "";
  document.body.style.overflow = "";
}

export function openDrawer(title, body) {
  const root = document.getElementById("drawer-root");
  document.getElementById("drawer-title").textContent = title;
  document.getElementById("drawer-body").innerHTML = body;
  root.classList.remove("hidden");
  root.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
}

export function closeDrawer() {
  const root = document.getElementById("drawer-root");
  root.classList.add("hidden");
  root.setAttribute("aria-hidden", "true");
  document.getElementById("drawer-body").innerHTML = "";
  document.body.style.overflow = "";
}

export function confirmDialog(message, title = "تأكيد العملية", confirmText = "تأكيد", danger = false) {
  return new Promise(resolve => {
    openModal({
      title,
      eyebrow: "تأكيد",
      body: `<div style="padding:10px 2px 18px"><div style="width:58px;height:58px;border-radius:18px;display:grid;place-items:center;background:${danger ? "#fff1f2" : "#eff8ff"};color:${danger ? "#dc2626" : "#0f67d8"};font-size:22px;margin-bottom:16px"><i class="fa-solid ${danger ? "fa-triangle-exclamation" : "fa-circle-question"}"></i></div><p style="margin:0;color:var(--ink-700);font-size:12px">${escapeHtml(message)}</p></div>`,
      footer: `<button class="ghost-button" data-confirm-no>إلغاء</button><button class="${danger ? "danger-button" : "primary-button"}" data-confirm-yes>${escapeHtml(confirmText)}</button>`
    });
    const yes = document.querySelector("[data-confirm-yes]");
    const no = document.querySelector("[data-confirm-no]");
    const finish = value => { closeModal(); resolve(value); };
    yes.addEventListener("click", () => finish(true), { once: true });
    no.addEventListener("click", () => finish(false), { once: true });
  });
}

export function downloadText(filename, content, type = "text/plain;charset=utf-8") {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function objectDetails(row, labels = {}) {
  return `<div class="detail-grid">${Object.entries(row || {})
    .filter(([key]) => !["old_data", "new_data", "session_info", "details"].includes(key))
    .map(([key, value]) => `<div class="detail-item ${String(value).length > 70 ? "full" : ""}"><span>${escapeHtml(labels[key] || key)}</span><strong>${formatDetailValue(value)}</strong></div>`).join("")}</div>`;
}

function formatDetailValue(value) {
  if (value === null || value === undefined || value === "") return "-";
  if (typeof value === "boolean") return value ? "نعم" : "لا";
  if (typeof value === "object") return `<pre style="white-space:pre-wrap;direction:ltr;text-align:left;margin:0;font-size:9px">${escapeHtml(JSON.stringify(value, null, 2))}</pre>`;
  return escapeHtml(value);
}
