import test from "node:test";
import assert from "node:assert/strict";

import {
  buildNotifications,
  notificationCount,
  renderNotificationList
} from "../js/notification-center.js";

const NOW = "2026-09-04T12:00:00.000Z";

test("builds grouped actionable notifications in severity order", () => {
  const rows = buildNotifications({
    now: NOW,
    alertDays: 30,
    online: true,
    items: [
      { id: "i1", name: "أرز", available_qty: 2, min_stock: 5, is_active: true },
      { id: "i2", name: "سكر", available_qty: 10, min_stock: 5, is_active: true }
    ],
    inventoryLots: [
      { id: "l1", quantity_available: 4, expiry_date: "2026-09-18" },
      { id: "l2", quantity_available: 0, expiry_date: "2026-09-10" }
    ],
    pendingDocuments: [{ id: "p1" }, { id: "p2" }],
    beneficiaries: [
      { id: "b1", phone: "777 111 222", full_name: "اسم خاص أول" },
      { id: "b2", phone: "+967777111222", full_name: "اسم خاص ثان" }
    ],
    devices: [{ id: "d1", status: "pending", device_name: "جهاز خاص" }],
    queue: [{ id: "q1", status: "failed" }, { id: "q2", status: "queued" }]
  });

  assert.deepEqual(rows.map(row => row.key), [
    "failed-sync",
    "low-stock",
    "expiring-lots",
    "pending-documents",
    "duplicate-beneficiaries",
    "pending-devices",
    "queued-sync"
  ]);
  assert.equal(rows.find(row => row.key === "low-stock").count, 1);
  assert.equal(rows.find(row => row.key === "expiring-lots").count, 1);
  assert.equal(notificationCount(rows), 8);
});

test("keeps private names, phones and device labels out of notifications", () => {
  const secretName = "متبرع سري جداً";
  const secretPhone = "777123456";
  const notifications = buildNotifications({
    now: NOW,
    online: false,
    beneficiaries: [
      { id: "b1", phone: secretPhone, full_name: secretName },
      { id: "b2", phone: secretPhone, full_name: "شخص آخر" }
    ],
    devices: [{ id: "d1", status: "pending", device_name: secretName }]
  });
  const serialized = JSON.stringify(notifications);

  assert.equal(serialized.includes(secretName), false);
  assert.equal(serialized.includes(secretPhone), false);
  assert.equal(notifications[0].key, "offline");
});

test("ignores inactive stock, expired empty lots and non-actionable queue entries", () => {
  const notifications = buildNotifications({
    now: NOW,
    items: [{ id: "i1", available_qty: 0, min_stock: 10, is_active: false }],
    inventoryLots: [{ id: "l1", quantity_available: 0, expiry_date: "2026-09-05" }],
    queue: [{ id: "q1", status: "synced" }]
  });

  assert.deepEqual(notifications, []);
});

test("renders an accessible action list and a helpful empty state", () => {
  const escape = value => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
  const html = renderNotificationList([
    { key: "notice", severity: "warning", icon: "fa-solid fa-bell", title: "تنبيه <مهم>", detail: "سطر آمن", count: 2, screen: "dashboard" }
  ], escape);

  assert.match(html, /data-notification-nav="dashboard"/);
  assert.match(html, /تنبيه &lt;مهم&gt;/);
  assert.match(html, /notification-item warning/);
  assert.match(renderNotificationList([], escape), /لا توجد تنبيهات تحتاج إلى إجراء/);
});
