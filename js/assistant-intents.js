import { convertCurrency } from "./currency-service.js";
import { normalizeSearchText } from "./searchable-select.js";

const screens = [
  { id: "dashboard", labels: ["لوحه التحكم", "الرئيسيه"] },
  { id: "currencies", labels: ["دليل العملات", "العملات"] },
  { id: "currency-exchanges", labels: ["مصارفة العملات", "المصارفة", "الصرافه"] },
  { id: "cash-payments", labels: ["سندات الصرف النقدي", "الصرف النقدي"] },
  { id: "in-kind-payments", labels: ["سندات الصرف العيني", "الصرف العيني"] },
  { id: "cash-receipts", labels: ["سندات القبض النقدي", "القبض النقدي"] },
  { id: "in-kind-receipts", labels: ["سندات القبض العيني", "القبض العيني"] },
  { id: "beneficiaries", labels: ["دليل المستفيدين", "المستفيدين"] },
  { id: "donors", labels: ["دليل المتبرعين", "المتبرعين"] },
  { id: "inventory", labels: ["دليل الاصناف", "الاصناف"] },
  { id: "devices", labels: ["الاجهزه والتراخيص", "التراخيص", "الاجهزه"] },
  { id: "login-attempts", labels: ["محاولات تسجيل الدخول", "محاولات الدخول"] },
  { id: "reports", labels: ["التقارير"] },
  { id: "settings", labels: ["الاعدادات", "النسخ الاحتياطي"] }
];

function digitsToLatin(value) {
  return String(value).replace(/[٠-٩]/g, digit => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
}

function findCurrency(fragment, currencies) {
  const wanted = normalizeSearchText(fragment);
  const aliases = { YER: ["يمني", "ريال يمني", "yer"], SAR: ["سعودي", "ريال سعودي", "sar"], USD: ["دولار", "دولار امريكي", "usd"] };
  return (currencies || []).find(currency => {
    const values = [currency.code, currency.name, currency.symbol, ...(aliases[currency.code] || [])];
    return values.some(value => {
      const normalized = normalizeSearchText(value);
      return normalized && (wanted.includes(normalized) || normalized.includes(wanted));
    });
  });
}

export function routeLocalAssistantIntent(message, context = {}) {
  const raw = digitsToLatin(message).trim();
  const text = normalizeSearchText(raw);
  if (!text) return { type: "empty" };
  if (/^(افتح|اذهب|انتقل|وديني)(?:\s|$)/.test(text)) {
    const screen = screens.find(item => item.labels.some(label => text.includes(normalizeSearchText(label))));
    if (screen) return { type: "navigate", screenId: screen.id, message: `تم فتح ${screen.labels[0]}.` };
  }
  const conversion = raw.match(/(?:حول|حوّل|تحويل)?\s*([0-9]+(?:[.,][0-9]+)?)\s+(.+?)\s+(?:إلى|الى)\s+(.+)$/i);
  if (conversion) {
    const amount = Number(conversion[1].replace(",", "."));
    const source = findCurrency(conversion[2], context.currencies);
    const target = findCurrency(conversion[3], context.currencies);
    if (source && target && Number(source.rate_to_base) > 0 && Number(target.rate_to_base) > 0) {
      const converted = convertCurrency(amount, source.rate_to_base, target.rate_to_base, target.decimal_places ?? 2);
      return {
        type: "currency", sourceCode: source.code, targetCode: target.code, sourceAmount: amount, amount: converted,
        message: `${amount.toLocaleString("ar-YE")} ${source.code} = ${converted.toLocaleString("ar-YE")} ${target.code} حسب آخر سعر محفوظ في دليل العملات.`
      };
    }
  }
  return { type: "remote" };
}
