function finiteNumber(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${label} غير صالح.`);
  return number;
}

function positiveRate(value, label) {
  const rate = finiteNumber(value, label);
  if (rate <= 0) throw new RangeError(`${label} يجب أن يكون أكبر من صفر.`);
  return rate;
}

export function deriveExchangeRate(sourceRate, targetRate) {
  return positiveRate(sourceRate, "سعر العملة المصدر") / positiveRate(targetRate, "سعر العملة الهدف");
}

export function convertCurrency(amount, sourceRate, targetRate, precision = 2) {
  const numericAmount = finiteNumber(amount, "المبلغ");
  if (numericAmount < 0) throw new RangeError("المبلغ يجب أن يكون أكبر من أو يساوي صفر.");
  if (!Number.isInteger(precision) || precision < 0 || precision > 8) throw new RangeError("الدقة يجب أن تكون بين صفر و8.");
  const converted = numericAmount * deriveExchangeRate(sourceRate, targetRate);
  const factor = 10 ** precision;
  return Math.round((converted + Number.EPSILON) * factor) / factor;
}

export function buildCashFlowSummary(receipts, payments, currency, now = new Date()) {
  const selectedCurrency = String(currency).toUpperCase();
  const posted = rows => rows.filter(row => row.status === "posted" && String(row.currency).toUpperCase() === selectedCurrency);
  const receivedRows = posted(receipts);
  const spentRows = posted(payments);
  const sum = rows => rows.reduce((total, row) => total + finiteNumber(row.amount, "مبلغ السند"), 0);
  const months = Array.from({ length: 6 }, (_, index) => {
    const date = new Date(now.getFullYear(), now.getMonth() - 5 + index, 1);
    return { date, key: `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` };
  });
  const monthly = (rows, dateKey) => months.map(month => sum(rows.filter(row => String(row[dateKey] || "").startsWith(month.key))));
  return {
    months,
    receivedTotal: sum(receivedRows),
    spentTotal: sum(spentRows),
    received: monthly(receivedRows, "receipt_date"),
    spent: monthly(spentRows, "payment_date"),
  };
}
