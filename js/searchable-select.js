export function normalizeSearchText(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u064B-\u065F\u0670\u06D6-\u06ED]/g, "")
    .replace(/ـ/g, "")
    .replace(/[إأآٱ]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/ة/g, "ه")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

export function filterSearchOptions(options, query, fields = []) {
  const term = normalizeSearchText(query);
  if (!term) return [...(options || [])];
  return (options || []).filter(option => {
    const values = [option?.label, ...fields.map(field => option?.row?.[field])];
    return values.some(value => normalizeSearchText(value).includes(term));
  });
}

export function shouldUseSearchableSelect(optionCount, threshold = 8) {
  const count = Math.max(0, Number(optionCount) || 0);
  const limit = Math.max(0, Number(threshold) || 0);
  return count > limit;
}

