// Matching keys are used only for review. They never rewrite beneficiary data,
// validate a government identity, merge files, or authorize a payment.
const REASONS = [
  { type: "national_id", label: "رقم هوية متطابق", confidence: "high" },
  { type: "phone", label: "رقم هاتف مشترك (قد يخص أسرة)", confidence: "possible" },
  { type: "full_name", label: "اسم كامل متطابق (قد يتشابه الاسم)", confidence: "possible" }
];

function normalizedText(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/ـ/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

const MISSING_VALUES = new Set([
  "", "null", "undefined", "none", "nil", "unknown", "n/a", "na",
  "not available", "not provided", "لا يوجد", "لايوجد", "بدون",
  "غير متوفر", "غير متاح", "غير معروف", "غير محدد", "مجهول",
  "بدون هاتف", "لا يوجد هاتف", "بدون رقم", "بدون هوية", "بدون هويه",
  "لا يوجد هوية", "لا يوجد هويه", "اسم المستفيد", "مستفيد جديد"
].map(normalizedText));

function normalizedDigits(value) {
  return String(value ?? "").normalize("NFKC")
    .replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g, "")
    .replace(/[\u0660-\u0669]/g, digit => String(digit.charCodeAt(0) - 0x0660))
    .replace(/[\u06F0-\u06F9]/g, digit => String(digit.charCodeAt(0) - 0x06F0))
    .trim();
}

function defaultNumber(value) {
  return /^(\d)\1+$/.test(value)
    || ["123456789", "1234567890", "0123456789"].includes(value);
}

/** Exact full-name key; word boundaries and other letters remain significant. */
export function normalizeDuplicateName(value) {
  const name = normalizedText(value);
  if (MISSING_VALUES.has(name)) return "";
  return name.split(" ").filter(word => /\p{L}/u.test(word)).length >= 2 ? name : "";
}

/** Conservative numeric/alphanumeric identity key, retaining leading zeroes. */
export function normalizeDuplicateNationalId(value) {
  if (MISSING_VALUES.has(normalizedText(value))) return "";
  const identity = normalizedDigits(value).replace(/[\s.\-/_]/g, "").toUpperCase();
  if (!/^[A-Z0-9]{6,24}$/.test(identity) || (identity.match(/\d/g) || []).length < 4) return "";
  if (defaultNumber(identity)) return "";
  return identity;
}

/** Shared phones are possible matches, including local Yemen mobile formats. */
export function normalizeDuplicatePhone(value) {
  if (MISSING_VALUES.has(normalizedText(value))) return "";
  const formatted = normalizedDigits(value).replace(/[\s().\-]/g, "");
  if (!/^\+?\d+$/.test(formatted)) return "";
  const international = formatted.startsWith("+") || formatted.startsWith("00");
  let phone = formatted.replace(/^\+/, "").replace(/^00/, "");
  const localPart = phone.startsWith("967") ? phone.slice(3).replace(/^0/, "") : "";
  if (localPart && defaultNumber(localPart)) return "";
  const yemeni = phone.match(/^9670?(7\d{8})$/);
  if (yemeni) {
    if (defaultNumber(yemeni[1])) return "";
    phone = `967${yemeni[1]}`;
  } else if (!international && /^0?7\d{8}$/.test(phone)) {
    const local = phone.replace(/^0/, "");
    if (defaultNumber(local)) return "";
    phone = `967${local}`;
  }
  if (!/^\d{7,15}$/.test(phone) || defaultNumber(phone)) return "";
  return phone;
}

const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const rowId = row => String(row?.id ?? "").trim();
function revision(row) {
  return Math.max(0, ...[row.updated_at, row.created_at].map(value => Date.parse(value)).filter(Number.isFinite));
}
function signature(row) {
  return JSON.stringify(Object.fromEntries(Object.keys(row).filter(key => key !== "id").sort().map(key => [key, row[key]])));
}
function uniqueBeneficiaries(records) {
  const rows = new Map();
  for (const original of records || []) {
    const id = rowId(original);
    if (!id) continue;
    const row = { ...original, id }, prior = rows.get(id);
    if (!prior || revision(row) > revision(prior) || revision(row) === revision(prior) && compare(signature(row), signature(prior)) > 0) rows.set(id, row);
  }
  return [...rows.values()].sort((a, b) => compare(a.id, b.id));
}

function keys(row) {
  return {
    national_id: [normalizeDuplicateNationalId(row.national_id)].filter(Boolean),
    phone: [...new Set([normalizeDuplicatePhone(row.phone), normalizeDuplicatePhone(row.phone_secondary)].filter(Boolean))],
    full_name: [normalizeDuplicateName(row.full_name)].filter(Boolean)
  };
}

function duplicateRow(row, groups) {
  const matches = [...new Set(groups.flatMap(group => group.member_ids))].filter(id => id !== row.id).sort(compare);
  const strong = groups.some(group => group.confidence === "high");
  const reasons = groups.map(group => ({
    type: group.type, label: group.label, confidence: group.confidence,
    group_id: group.id, matched_ids: group.member_ids.filter(id => id !== row.id)
  }));
  return {
    ...row,
    duplicate_reason: [...new Set(reasons.map(reason => reason.label))].join("؛ "),
    duplicate_reasons: reasons,
    duplicate_confidence: strong ? "high" : "possible",
    duplicate_confidence_label: strong ? "هوية متطابقة تحتاج مراجعة" : "تشابه محتمل يحتاج مراجعة",
    duplicate_group: groups.map(group => group.id).join(", "),
    duplicate_group_ids: groups.map(group => group.id),
    duplicate_match_ids: matches,
    duplicate_match_count: matches.length
  };
}

/**
 * Build groups from a complete, already-authorized set of rows.
 * Each group shares one exact key. Overlapping groups are never merged by a
 * transitive link, and repeated snapshots of an ID are never separate files.
 */
export function buildBeneficiaryDuplicateReport(records = []) {
  const rows = uniqueBeneficiaries(records);
  const buckets = Object.fromEntries(REASONS.map(reason => [reason.type, new Map()]));
  for (const row of rows) {
    const values = keys(row);
    for (const reason of REASONS) for (const value of values[reason.type]) {
      const bucket = buckets[reason.type];
      if (!bucket.has(value)) bucket.set(value, []);
      bucket.get(value).push(row.id);
    }
  }
  const groups = [];
  const rowGroups = new Map();
  for (const reason of REASONS) {
    const candidates = [...buckets[reason.type]].filter(([, members]) => members.length >= 2).sort(([a], [b]) => compare(a, b));
    for (const [value, member_ids] of candidates) {
      const group = { id: `G${groups.length + 1}`, ...reason, normalized_value: value, member_ids, count: member_ids.length };
      groups.push(group);
      for (const id of member_ids) {
        if (!rowGroups.has(id)) rowGroups.set(id, []);
        rowGroups.get(id).push(group);
      }
    }
  }
  const data = rows.filter(row => rowGroups.has(row.id)).map(row => duplicateRow(row, rowGroups.get(row.id)));
  const strongCount = data.filter(row => row.duplicate_confidence === "high").length;
  return {
    data, total: data.length, groups, groupCount: groups.length,
    strongCount, possibleCount: data.length - strongCount, scannedCount: rows.length
  };
}

/** Check one identified file, using only evidence it directly shares. */
export function findBeneficiaryDuplicateCandidates(record, records = []) {
  const id = rowId(record);
  if (!id) return [];
  const report = buildBeneficiaryDuplicateReport([
    ...records.filter(row => rowId(row) !== id), { ...record, id }
  ]);
  const groups = report.groups.filter(group => group.member_ids.includes(id));
  const candidates = new Set(groups.flatMap(group => group.member_ids).filter(value => value !== id));
  return report.data.filter(row => candidates.has(row.id)).map(row => duplicateRow(row, groups.filter(group => group.member_ids.includes(row.id))));
}
