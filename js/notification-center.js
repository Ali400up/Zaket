const severityRank = Object.freeze({ danger: 0, warning: 1, info: 2, success: 3 });

function positiveCount(value) {
  const count = Number(value);
  return Number.isFinite(count) && count > 0 ? count : 0;
}

function normalizePhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00967")) digits = digits.slice(5);
  else if (digits.startsWith("967") && digits.length > 9) digits = digits.slice(3);
  return digits;
}

function expiresWithin(expiryDate, now, alertDays) {
  if (!expiryDate) return false;
  const expiry = new Date(`${String(expiryDate).slice(0, 10)}T23:59:59.999Z`);
  if (Number.isNaN(expiry.getTime())) return false;
  const milliseconds = expiry.getTime() - now.getTime();
  return milliseconds <= alertDays * 86_400_000;
}

function notice(key, severity, icon, title, detail, count, screen) {
  return { key, severity, icon, title, detail, count, screen };
}

export function buildNotifications(snapshot = {}) {
  const rows = [];
  const now = new Date(snapshot.now || Date.now());
  const alertDays = Math.max(1, Number(snapshot.alertDays) || 30);
  const queue = Array.isArray(snapshot.queue) ? snapshot.queue : [];

  if (snapshot.online === false) {
    rows.push(notice(
      "offline", "danger", "fa-solid fa-wifi",
      "التطبيق يعمل دون اتصال",
      "تُحفظ العمليات المسموحة محلياً وستُزامن بعد عودة الاتصال.",
      1, "sync"
    ));
  }

  const failed = queue.filter(row => row?.status === "failed").length;
  if (failed) {
    rows.push(notice(
      "failed-sync", "danger", "fa-solid fa-triangle-exclamation",
      "عمليات فشلت مزامنتها",
      `${failed} عملية تحتاج إلى مراجعة سبب الخطأ وإعادة المحاولة.`,
      failed, "sync"
    ));
  }

  const lowStock = (snapshot.items || []).filter(row =>
    row?.is_active !== false && Number(row?.available_qty || 0) <= Number(row?.min_stock || 0)
  ).length;
  if (lowStock) {
    rows.push(notice(
      "low-stock", "warning", "fa-solid fa-box-open",
      "أصناف وصلت إلى حد التنبيه",
      `${lowStock} صنف يحتاج إلى مراجعة الرصيد المتاح.`,
      lowStock, "inventory"
    ));
  }

  const expiringLots = (snapshot.inventoryLots || []).filter(row =>
    positiveCount(row?.quantity_available) > 0 && expiresWithin(row?.expiry_date, now, alertDays)
  ).length;
  if (expiringLots) {
    rows.push(notice(
      "expiring-lots", "warning", "fa-solid fa-calendar-xmark",
      "تشغيلات قاربت على انتهاء الصلاحية",
      `${expiringLots} تشغيلة متاحة تنتهي خلال ${alertDays} يوماً أو انتهت بالفعل.`,
      expiringLots, "stock-balances"
    ));
  }

  const pendingDocuments = (snapshot.pendingDocuments || []).length;
  if (pendingDocuments) {
    rows.push(notice(
      "pending-documents", "warning", "fa-solid fa-hourglass-half",
      "سندات تحت المراجعة",
      `${pendingDocuments} سند يحتاج إلى اعتماد أو قرار.`,
      pendingDocuments, "dashboard"
    ));
  }

  const phoneGroups = new Map();
  for (const row of snapshot.beneficiaries || []) {
    const phone = normalizePhone(row?.phone);
    if (phone.length < 7) continue;
    phoneGroups.set(phone, (phoneGroups.get(phone) || 0) + 1);
  }
  const duplicateGroups = [...phoneGroups.values()].filter(count => count > 1).length;
  if (duplicateGroups) {
    rows.push(notice(
      "duplicate-beneficiaries", "warning", "fa-solid fa-user-group",
      "ملفات مستفيدين محتملة التكرار",
      `${duplicateGroups} مجموعة تحتاج إلى تدقيق قبل الدمج.`,
      duplicateGroups, "beneficiaries"
    ));
  }

  const pendingDevices = (snapshot.devices || []).filter(row => row?.status === "pending").length;
  if (pendingDevices) {
    rows.push(notice(
      "pending-devices", "info", "fa-solid fa-laptop-file",
      "أجهزة بانتظار الاعتماد",
      `${pendingDevices} جهاز يحتاج إلى قرار من مدير النظام.`,
      pendingDevices, "devices"
    ));
  }

  const queued = queue.filter(row => ["queued", "syncing"].includes(row?.status)).length;
  if (queued) {
    rows.push(notice(
      "queued-sync", "info", "fa-solid fa-arrows-rotate",
      "عمليات بانتظار المزامنة",
      `${queued} عملية محفوظة في طابور المزامنة.`,
      queued, "sync"
    ));
  }

  return rows.sort((a, b) =>
    (severityRank[a.severity] ?? 99) - (severityRank[b.severity] ?? 99)
  );
}

export function notificationCount(rows = []) {
  return rows.reduce((total, row) => total + Math.max(1, positiveCount(row?.count)), 0);
}

export function renderNotificationList(rows = [], escape = value => String(value ?? "")) {
  if (!rows.length) {
    return `<div class="notification-empty"><span><i class="fa-regular fa-circle-check"></i></span><h3>كل شيء هادئ</h3><p>لا توجد تنبيهات تحتاج إلى إجراء الآن.</p></div>`;
  }

  return `<div class="notification-summary"><strong>${notificationCount(rows)}</strong><span>إجراء يحتاج إلى انتباهك</span></div>
    <div class="notification-list">${rows.map(row => `
      <button class="notification-item ${escape(row.severity)}" type="button" data-notification-nav="${escape(row.screen || "dashboard")}">
        <span class="notification-icon"><i class="${escape(row.icon || "fa-regular fa-bell")}"></i></span>
        <span class="notification-copy"><strong>${escape(row.title)}</strong><small>${escape(row.detail)}</small></span>
        <span class="notification-count">${Math.max(1, positiveCount(row.count))}</span>
        <i class="fa-solid fa-chevron-left notification-arrow" aria-hidden="true"></i>
      </button>`).join("")}</div>`;
}
