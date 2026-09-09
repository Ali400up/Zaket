import test from "node:test";
import assert from "node:assert/strict";

globalThis.window = { ZAKAT_CONFIG: { locale: "ar-YE", currency: "YER" } };
globalThis.document = { addEventListener() {} };
const { renderAssistantScreen, handleAssistantInteraction } = await import("../js/ai-assistant.js");

// The view's output boundary is HTML; only network history/data and the input are stubbed.
const input = { value: "", focus() {} };
const root = { innerHTML: "", querySelector: selector => selector === "#ai-message-input" ? input : null };
const service = {
  async assistantRequest(action) {
    assert.equal(action, "history", "local conversion must not request an AI response");
    return { conversation_id: null, messages: [], actions: [] };
  },
  async list(table, options) {
    assert.equal(table, "currencies");
    assert.equal(options.filters.is_active, true);
    return { total: 3, data: [
      { code: "YER", name: "ريال يمني", rate_to_base: 1 },
      { code: "SAR", name: "ريال سعودي", rate_to_base: 140 },
      { code: "USD", name: "دولار أمريكي", rate_to_base: 550 }
    ] };
  }
};

test("assistant hides the currency counter while keeping conversion available on request", async () => {
  await renderAssistantScreen(root, service, { profile: { role: "admin" } }, { currentScreen: "dashboard" });
  const hero = root.innerHTML.match(/<header class="ai-hero">[\s\S]*?<\/header>/)?.[0] || "";
  assert.ok(hero.includes("لوحة التحكم"));
  assert.doesNotMatch(hero, /عملات|fa-coins/, "currency count must not be displayed in the assistant header");
  input.value = "حول 2 دولار إلى يمني";
  await handleAssistantInteraction({
    preventDefault() {},
    target: { closest: selector => selector === "#ai-composer button[type=submit]" ? {} : null }
  }, root, service);
  assert.match(root.innerHTML, /1[٬,]?100|١[٬,]?١٠٠/);
  assert.match(root.innerHTML, /role="log"/);
});
