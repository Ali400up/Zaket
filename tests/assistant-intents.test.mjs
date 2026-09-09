import test from "node:test";
import assert from "node:assert/strict";

import { routeLocalAssistantIntent } from "../js/assistant-intents.js";

const context = {
  currentScreen: "dashboard",
  currencies: [
    { code: "YER", name: "ريال يمني", rate_to_base: 1, decimal_places: 2 },
    { code: "SAR", name: "ريال سعودي", rate_to_base: 140, decimal_places: 2 },
    { code: "USD", name: "دولار أمريكي", rate_to_base: 550, decimal_places: 2 }
  ]
};

test("routes common navigation locally without an external model roundtrip", () => {
  assert.deepEqual(routeLocalAssistantIntent("افتح دليل العملات", context), {
    type: "navigate", screenId: "currencies", message: "تم فتح دليل العملات."
  });
});

test("answers deterministic currency conversion locally", () => {
  const result = routeLocalAssistantIntent("حول 2 سعودي إلى يمني", context);
  assert.equal(result.type, "currency");
  assert.equal(result.amount, 280);
  assert.match(result.message, /٢٨٠|280/);
  assert.match(result.message, /YER/);
});

test("leaves data questions and mutations to permission-aware server tools", () => {
  assert.equal(routeLocalAssistantIntent("احذف المستفيد رقم 10", context).type, "remote");
  assert.equal(routeLocalAssistantIntent("اعرض رصيد الحملة", context).type, "remote");
});
