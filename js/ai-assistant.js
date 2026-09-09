import { escapeHtml, toast, confirmDialog } from "./ui.js";
import { routeLocalAssistantIntent } from "./assistant-intents.js";
import { menuSections, roleLabels } from "./screen-config.js";

const assistantState = {
  conversationId: null,
  messages: [],
  actions: [],
  reports: [],
  suggestions: [],
  loading: false,
  loaded: false,
  requestToken: 0,
  currentScreen: "dashboard",
  currencies: []
};

const quickPrompts = [
  "أعطني ملخص الوضع المالي الحالي",
  "اعرض الحملات المفتوحة وأرصدة كل حملة",
  "أعطني كشف حساب هذا الشهر",
  "ما العمليات التي تحتاج مراجعة؟"
];

const screenLabels = new Map(menuSections.flatMap(section => section.items).map(item => [item.id, item.label]));

function messageMarkup(message) {
  const role = message.role === "user" ? "user" : "assistant";
  const label = role === "user" ? "أنت" : "المساعد الذكي";
  return `<article class="ai-message ${role}"><div class="ai-message-avatar"><i class="${role === "user" ? "fa-solid fa-user" : "fa-solid fa-wand-magic-sparkles"}"></i></div><div class="ai-message-body"><strong>${label}</strong><div class="ai-message-text">${escapeHtml(message.content || "")}</div><small>${message.created_at ? new Date(message.created_at).toLocaleString("ar-YE") : "الآن"}</small></div></article>`;
}

function actionMarkup(action) {
  const pending = action.status === "pending";
  const statusText = { pending: "بانتظار التأكيد", executing: "قيد التنفيذ", completed: "تم التنفيذ", failed: "فشل", cancelled: "أُلغي" }[action.status] || action.status;
  return `<article class="ai-action-card ${escapeHtml(action.status || "pending")}"><header><span><i class="fa-solid fa-shield-halved"></i> إجراء مقترح</span><span class="status-badge ${pending ? "under_review" : action.status === "completed" ? "active" : "suspended"}">${escapeHtml(statusText)}</span></header><strong>${escapeHtml(action.summary || action.action_type || "إجراء إداري")}</strong>${action.error ? `<p class="import-errors">${escapeHtml(action.error)}</p>` : ""}${pending ? `<div class="ai-action-buttons"><button class="danger-button" data-ai-cancel-action="${escapeHtml(action.id)}"><i class="fa-solid fa-xmark"></i> إلغاء</button><button class="primary-button" data-ai-confirm-action="${escapeHtml(action.id)}"><i class="fa-solid fa-check"></i> تأكيد التنفيذ</button></div>` : ""}</article>`;
}

function reportRows(report) {
  if (Array.isArray(report?.rows)) return report.rows;
  if (Array.isArray(report?.cash) || Array.isArray(report?.in_kind)) return [
    ...(report.cash || []).map(row => ({ النوع: "نقدي", ...row })),
    ...(report.in_kind || []).map(row => ({ النوع: "عيني", ...row }))
  ];
  if (Array.isArray(report?.checks)) return report.checks;
  return [];
}

function formatReportPreview(report) {
  const rows = reportRows(report).slice(0, 6);
  if (!rows.length) return "لا توجد سجلات ضمن صلاحياتك الحالية.";
  return rows.map((row, index) => {
    const values = Object.entries(row || {}).filter(([key]) => key !== "id").slice(0, 5)
      .map(([key, value]) => key + ": " + (typeof value === "object" ? JSON.stringify(value) : value)).join(" • ");
    return String(index + 1) + ". " + values;
  }).join("\n");
}

function emitUiCommands(commands) {
  for (const command of commands || []) {
    if (!command || typeof command !== "object") continue;
    window.dispatchEvent(new CustomEvent("zakat:assistant-ui-command", { detail: command }));
  }
}

function downloadAssistantReport(index) {
  const report = assistantState.reports[index];
  if (!report) return;
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "zakat-assistant-" + (report.report || "report") + ".json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  toast("تم تنزيل بيانات التقرير المعروضة.");
}

function renderAssistantExtras(root) {
  const log = root.querySelector("#ai-chat-log");
  (assistantState.reports || []).forEach((report, index) => {
    const card = document.createElement("article");
    card.className = "ai-report-card";
    card.innerHTML = '<header><span><i class="fa-solid fa-chart-column"></i> تقرير جاهز</span><button class="ghost-button" type="button"><i class="fa-solid fa-download"></i> تنزيل البيانات</button></header><strong></strong><pre></pre>';
    card.querySelector("button")?.setAttribute("data-ai-download-report", String(index));
    card.querySelector("strong").textContent = String(report.report || "تقرير النظام").replaceAll("_", " ");
    card.querySelector("pre").textContent = formatReportPreview(report);
    log?.appendChild(card);
  });
}

function renderContent(root) {
  const roleCode = assistantState.profile?.role || "user";
  const role = roleLabels[roleCode] || "مستخدم";
  const currentScreenLabel = screenLabels.get(assistantState.currentScreen) || "لوحة التحكم";
  const visiblePrompts = (assistantState.suggestions.length ? assistantState.suggestions : quickPrompts).slice(0, 4);
  root.innerHTML = `<section class="ai-shell">
    <header class="ai-hero"><div class="ai-hero-icon" aria-hidden="true"><i class="fa-solid fa-wand-magic-sparkles"></i></div><div class="ai-hero-copy"><span class="eyebrow">مساعدك في العمل</span><h2>كيف أساعدك اليوم؟</h2><p>اسأل عن الأرصدة والتقارير، أو اطلب فتح شاشة أو تجهيز إجراء للمراجعة.</p><div class="ai-context-badges"><span><i class="fa-solid fa-location-dot" aria-hidden="true"></i> الشاشة: ${escapeHtml(currentScreenLabel)}</span><span><i class="fa-solid fa-user-shield" aria-hidden="true"></i> الصلاحية: ${escapeHtml(role)}</span></div></div><button class="ghost-button" data-ai-new-chat type="button"><i class="fa-solid fa-plus"></i> محادثة جديدة</button></header>
    <div class="ai-safety-note"><i class="fa-solid fa-lock"></i><span>لا ينفذ المساعد التغيير دون تأكيد مستقل منك، والحذف النهائي يحتاج تأكيداً أقوى.</span></div>
    <div class="ai-quick-prompts" role="group" aria-label="اقتراحات لبدء المحادثة">${visiblePrompts.map((prompt, index) => `<button type="button" class="ai-suggestion" data-ai-suggestion="${escapeHtml(prompt)}"><i class="fa-solid ${assistantState.suggestions.length ? "fa-wand-magic-sparkles" : ["fa-chart-pie", "fa-bullseye", "fa-file-invoice", "fa-list-check"][index]}" aria-hidden="true"></i><span>${escapeHtml(prompt)}</span><i class="fa-solid fa-arrow-left" aria-hidden="true"></i></button>`).join("")}</div>
    <section class="ai-chat" id="ai-chat-log" role="log" aria-live="polite" aria-relevant="additions text">
      ${assistantState.messages.length ? assistantState.messages.map(messageMarkup).join("") : `<div class="ai-welcome"><i class="fa-solid fa-comments" aria-hidden="true"></i><h3>بماذا نبدأ؟</h3><p>اختر اقتراحاً من الأعلى أو اكتب طلبك هنا.<br>سأعرض أي تغيير عليك لتأكيده قبل التنفيذ.</p></div>`}
      ${assistantState.actions.map(actionMarkup).join("")}
      ${assistantState.loading ? `<article class="ai-message assistant"><div class="ai-message-avatar"><i class="fa-solid fa-wand-magic-sparkles"></i></div><div class="ai-message-body"><strong>المساعد الذكي</strong><div class="loading-inner"><span class="spinner"></span><span>أراجع البيانات والصلاحيات...</span></div></div></article>` : ""}
    </section>
    <form class="ai-composer" id="ai-composer"><textarea id="ai-message-input" maxlength="4000" rows="2" aria-label="اكتب رسالتك للمساعد" aria-controls="ai-chat-log" placeholder="اكتب سؤالك أو طلبك..." ${assistantState.loading ? "disabled" : ""}></textarea><div class="ai-composer-actions">${assistantState.loading ? `<button class="ghost-button ai-stop" type="button" data-ai-stop><i class="fa-solid fa-stop"></i><span>إيقاف الانتظار</span></button>` : ""}<button class="primary-button" type="submit" ${assistantState.loading ? "disabled" : ""}><i class="fa-solid fa-paper-plane"></i><span>إرسال</span></button></div></form>
    <small class="ai-disclaimer">قد تتأثر الإجابة بخدمة Gemini الخارجية؛ العمليات المالية النهائية تبقى محكومة بفحوص قاعدة البيانات الذرية.</small>
  </section>`;
  renderAssistantExtras(root);
  const log = root.querySelector("#ai-chat-log");
  if (log) log.scrollTop = log.scrollHeight;
}

export async function renderAssistantScreen(root, dataService, session, context = {}) {
  assistantState.profile = session?.profile || {};
  assistantState.currentScreen = context.currentScreen || "dashboard";
  if (!assistantState.loaded) {
    assistantState.loaded = true;
    const [historyResult, currenciesResult] = await Promise.allSettled([
      dataService.assistantRequest("history", {}),
      dataService.list("currencies", { pageSize: 200, filters: { is_active: true } })
    ]);
    if (historyResult.status === "fulfilled") {
      const history = historyResult.value;
      assistantState.conversationId = history?.conversation_id || null;
      assistantState.messages = Array.isArray(history?.messages) ? history.messages : [];
      assistantState.actions = Array.isArray(history?.actions) ? history.actions : [];
    } else {
      assistantState.messages = [{ role: "assistant", content: `تعذر تحميل سجل المحادثة: ${historyResult.reason?.message || "خطأ اتصال"}` }];
    }
    if (currenciesResult.status === "fulfilled") assistantState.currencies = currenciesResult.value.data || [];
  } else {
    try {
      const currenciesResult = await dataService.list("currencies", { pageSize: 200, filters: { is_active: true } });
      assistantState.currencies = currenciesResult.data || assistantState.currencies;
    } catch {                                                   }
  }
  renderContent(root);
}

async function sendMessage(root, dataService) {
  const input = root.querySelector("#ai-message-input");
  const content = String(input?.value || "").trim();
  if (!content || assistantState.loading) return;
  assistantState.messages.push({ role: "user", content, created_at: new Date().toISOString() });
  const local = routeLocalAssistantIntent(content, {
    currentScreen: assistantState.currentScreen,
    currencies: assistantState.currencies
  });
  if (local.type === "navigate" || local.type === "currency") {
    assistantState.messages.push({ role: "assistant", content: local.message, created_at: new Date().toISOString() });
    if (local.type === "navigate") emitUiCommands([{ type: "navigate", screen_id: local.screenId }]);
    renderContent(root);
    return;
  }
  assistantState.loading = true;
  const requestToken = ++assistantState.requestToken;
  renderContent(root);
  try {
    const result = await dataService.assistantRequest("chat", {
      conversation_id: assistantState.conversationId,
      message: content,
      current_screen: assistantState.currentScreen
    });
    if (requestToken !== assistantState.requestToken) return;
    assistantState.conversationId = result.conversation_id || assistantState.conversationId;
    assistantState.messages.push({ role: "assistant", content: result.message || "تمت معالجة الطلب.", created_at: new Date().toISOString() });
    if (result.action_request) assistantState.actions.push(result.action_request);
    if (result.report) assistantState.reports.unshift(result.report);
    if (Array.isArray(result.suggestions) && result.suggestions.length) assistantState.suggestions = result.suggestions.slice(0, 4);
    emitUiCommands(result.ui_commands);
  } catch (error) {
    if (requestToken !== assistantState.requestToken) return;
    assistantState.messages.push({ role: "assistant", content: `تعذر إكمال الطلب بأمان: ${error.message}. يمكنك إعادة المحاولة دون تكرار أي إجراء؛ فالمساعد يستخدم مفاتيح منع التكرار.`, created_at: new Date().toISOString() });
  } finally {
    if (requestToken === assistantState.requestToken) {
      assistantState.loading = false;
      renderContent(root);
    }
  }
}

async function actOnProposal(root, dataService, id, action) {
  const proposal = assistantState.actions.find(item => item.id === id);
  if (!proposal) return true;
  let confirmation = "CONFIRM";
  if (action === "confirm") {
    const approved = await confirmDialog(`سيتم تنفيذ الإجراء التالي وفق صلاحياتك الحالية:\n${proposal.summary}`, "تأكيد إجراء المساعد", "تنفيذ الآن", true);
    if (!approved) return true;
    if (/حذف نهائي/i.test(proposal.summary || "")) {
      confirmation = window.prompt("هذا حذف نهائي. اكتب DELETE-RECORD للتأكيد:", "") || "";
      if (confirmation !== "DELETE-RECORD") {
        toast("لم تُكتب عبارة الحذف الصحيحة؛ لم يتغير أي سجل.", "warning");
        return true;
      }
    }
  }
  assistantState.loading = true;
  renderContent(root);
  try {
    const result = await dataService.assistantRequest(action === "confirm" ? "confirm_action" : "cancel_action", { action_id: id, confirmation });
    Object.assign(proposal, result.action_request || { status: action === "confirm" ? "completed" : "cancelled" });
    assistantState.messages.push({ role: "assistant", content: result.message || (action === "confirm" ? "تم تنفيذ الإجراء وتسجيله في سجل العمليات." : "تم إلغاء الإجراء."), created_at: new Date().toISOString() });
    toast(action === "confirm" ? "تم تنفيذ الإجراء بنجاح." : "تم إلغاء الإجراء.");
  } catch (error) {
    proposal.status = "failed";
    proposal.error = error.message;
    toast(error.message, "error");
  } finally {
    assistantState.loading = false;
    renderContent(root);
  }
  return true;
}

export async function handleAssistantInteraction(event, root, dataService) {
  if (event.target.closest("[data-ai-stop]")) {
    assistantState.requestToken += 1;
    assistantState.loading = false;
    assistantState.messages.push({ role: "assistant", content: "تم إيقاف انتظار الرد في هذه الشاشة. لم يُنفذ أي إجراء دون تأكيدك.", created_at: new Date().toISOString() });
    renderContent(root);
    return true;
  }
  const suggestion = event.target.closest("[data-ai-suggestion]");
  if (suggestion) {
    const input = root.querySelector("#ai-message-input");
    if (input) { input.value = suggestion.getAttribute("data-ai-suggestion") || ""; input.focus(); }
    return true;
  }
  const download = event.target.closest("[data-ai-download-report]");
  if (download) {
    downloadAssistantReport(Number(download.getAttribute("data-ai-download-report")));
    return true;
  }
  if (event.target.closest("[data-ai-new-chat]")) {
    assistantState.conversationId = null;
    assistantState.messages = [];
    assistantState.actions = [];
    assistantState.reports = [];
    assistantState.suggestions = [];
    renderContent(root);
    root.querySelector("#ai-message-input")?.focus();
    return true;
  }
  const confirm = event.target.closest("[data-ai-confirm-action]");
  if (confirm) return actOnProposal(root, dataService, confirm.dataset.aiConfirmAction, "confirm");
  const cancel = event.target.closest("[data-ai-cancel-action]");
  if (cancel) return actOnProposal(root, dataService, cancel.dataset.aiCancelAction, "cancel");
  const submit = event.target.closest("#ai-composer button[type=submit]");
  if (submit) {
    event.preventDefault();
    await sendMessage(root, dataService);
    return true;
  }
  return false;
}

document.addEventListener("submit", event => {
  if (event.target?.id !== "ai-composer") return;
  event.preventDefault();
  event.target.querySelector("button[type=submit]")?.click();
});
