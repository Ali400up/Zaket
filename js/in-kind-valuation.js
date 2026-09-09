function indexById(rows = []) {
  return new Map(rows.map(row => [String(row.id), row]));
}

function positiveNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function enrichInKindDetails(details = [], options = {}) {
  const itemMap = indexById(options.items);
  const unitMap = indexById(options.units);
  const currencyMap = indexById(options.currencies);
  const forceSnapshot = options.forceSnapshot === true;

  return details.map(detail => {
    const item = itemMap.get(String(detail.item_id)) || null;
    if (!item) throw new Error("تعذر العثور على الصنف لتثبيت قيمة القبض العيني.");

    const itemCost = positiveNumber(item.purchase_price);
    const storedCost = positiveNumber(detail.unit_cost);
    const unitCost = forceSnapshot ? itemCost : (storedCost || itemCost);
    if (!unitCost) throw new Error(`يجب تحديد سعر شراء موجب للصنف ${item.name || detail.item_id}.`);

    const unit = unitMap.get(String(item.unit_id)) || null;
    const currency = currencyMap.get(String(item.purchase_currency_id)) || null;
    const costCurrency = forceSnapshot
      ? (item.purchase_currency_code || currency?.code)
      : (detail.cost_currency || item.purchase_currency_code || currency?.code);
    if (!costCurrency) throw new Error(`يجب تحديد عملة شراء للصنف ${item.name || detail.item_id}.`);

    const quantity = Number(detail.quantity ?? detail.valid_qty ?? 0);
    return {
      ...detail,
      item_name: detail.item_name || item.name,
      unit_name: detail.unit_name || item.unit_name || unit?.name || unit?.symbol || "-",
      unit_cost: unitCost,
      cost_currency: costCurrency,
      total_cost: quantity * unitCost,
    };
  });
}

export function summarizeInKindValue(details = []) {
  const totals = new Map();
  for (const detail of details) {
    const currency = String(detail.cost_currency || "غير محدد");
    const amount = Number(detail.total_cost ?? (Number(detail.quantity ?? detail.valid_qty ?? 0) * Number(detail.unit_cost || 0)));
    if (!Number.isFinite(amount)) continue;
    totals.set(currency, (totals.get(currency) || 0) + amount);
  }
  return [...totals.entries()]
    .sort(([a], [b]) => a.localeCompare(b, "en"))
    .map(([currency, amount]) => ({ currency, amount }));
}
