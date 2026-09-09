import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertAssistantMutationSupported } from "../supabase/functions/gemini-assistant/mutation-policy.js";

const root = new URL("..", import.meta.url);
const read = path => readFile(new URL(path, root), "utf8");

test("assistant rejects permanent deletion of currencies with safe Arabic alternatives", () => {
  assert.throws(
    () => assertAssistantMutationSupported("currency", "delete"),
    error => /إيقاف العملة/.test(error.message) && !/is_active/.test(error.message),
  );
  assert.throws(
    () => assertAssistantMutationSupported("currency_exchange", "delete"),
    error => /إلغاء المصارفة المرحلة/.test(error.message) && !/cancel_currency_exchange/.test(error.message),
  );
  assert.doesNotThrow(() => assertAssistantMutationSupported("currency", "deactivate"));
  assert.doesNotThrow(() => assertAssistantMutationSupported("donor", "delete"));
});

test("assistant applies the permanent-delete guard at proposal and execution", async () => {
  const edge = await read("supabase/functions/gemini-assistant/index.ts");
  assert.match(edge, /import \{ assertAssistantMutationSupported, DELETE_TABLES \} from "\.\/mutation-policy\.js"/);
  assert.equal((edge.match(/assertAssistantMutationSupported\(entity, operation\)/g) || []).length, 2);
});


