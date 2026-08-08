const field = (header, key, options = {}) => ({ header, key, ...options });

export const importDefinitions = {
  beneficiaries: {
    label: "المستفيدون",
    fields: [
      field("رقم الملف", "file_no"), field("الاسم الكامل", "full_name", { required: true }), field("رقم الهوية", "national_id"),
      field("الهاتف", "phone"), field("الهاتف الإضافي", "phone_secondary"), field("تاريخ الميلاد", "birth_date", { type: "date" }),
      field("العمر", "age", { type: "number" }), field("الجنس", "gender"), field("الحالة الاجتماعية", "marital_status"), field("عدد أفراد الأسرة", "family_size", { required: true, type: "number", default: 1 }),
      field("المحافظة", "governorate"), field("المديرية", "district"), field("القرية", "village"), field("العنوان", "address"),
      field("ولي الأمر", "guardian_name"), field("حالة السكن", "housing_status"), field("الدخل الشهري", "monthly_income", { type: "number" }),
      field("الفئة", "category_id", { relation: { table: "beneficiary_categories", label: "name" }, required: true }),
      field("الحالة الصحية", "health_condition_id", { relation: { table: "health_conditions", label: "name" } }),
      field("الموزع", "delegate_id", { relation: { table: "delegates", label: "full_name" } }),
      field("الأولوية", "priority", { default: "medium" }), field("الحالة", "status", { default: "under_review" }),
      field("مصدر التسجيل", "source", { default: "استيراد Excel" }), field("رابط صورة المستفيد", "profile_image_url"),
      field("رابط صورة الهوية", "identity_image_url"), field("ملاحظات", "notes")
    ],
    sample: ["", "أحمد محمد علي", "123456", "777123456", "733123456", "1990-01-01", 36, "male", "married", 5, "صنعاء", "السبعين", "بيت بوس", "جوار المسجد", "محمد علي", "إيجار", 25000, "أسر فقيرة", "مرض مزمن", "الموزع الرئيسي", "high", "under_review", "استيراد Excel", "", "", "مثال يُحذف قبل الاستيراد"]
  },
  delegates: {
    label: "الموزعون",
    fields: [field("الاسم الكامل", "full_name", { required: true }), field("الهاتف", "phone"), field("الهاتف الإضافي", "phone_secondary"), field("رقم الهوية", "national_id"), field("العنوان", "address"), field("رابط صورة الموزع", "profile_image_url"), field("رابط صورة الهوية", "identity_image_url"), field("نوع الموزع", "delegate_type", { default: "both" }), field("نشط", "is_active", { type: "boolean", default: true }), field("ملاحظات", "notes")],
    sample: ["الموزع الجديد", "777000222", "", "", "صنعاء", "", "", "both", "نعم", ""]
  },
  donors: {
    label: "المتبرعون",
    fields: [field("اسم المتبرع", "name", { required: true }), field("النوع", "donor_type", { default: "individual" }), field("الهاتف", "phone"), field("الهاتف الإضافي", "phone_secondary"), field("الهوية أو السجل", "identity_no"), field("العنوان", "address"), field("اسم ممثل الجهة", "representative_name"), field("هاتف ممثل الجهة", "representative_phone"), field("البريد", "email"), field("فاعل خير", "is_anonymous", { type: "boolean", default: false }), field("نشط", "is_active", { type: "boolean", default: true }), field("ملاحظات", "notes")],
    sample: ["فاعل خير", "individual", "", "", "", "", "", "", "", "نعم", "نعم", ""]
  },
  beneficiary_categories: {
    label: "فئات المستفيدين",
    fields: [field("اسم الفئة", "name", { required: true }), field("الأولوية", "priority", { type: "number", default: 3 }), field("الوصف", "description"), field("نشطة", "is_active", { type: "boolean", default: true })],
    sample: ["أسر فقيرة", 5, "تصنيف اجتماعي", "نعم"]
  },
  health_conditions: {
    label: "الحالات الصحية",
    fields: [field("اسم الحالة", "name", { required: true }), field("الأولوية", "priority", { type: "number", default: 3 }), field("الوصف", "description"), field("نشطة", "is_active", { type: "boolean", default: true })],
    sample: ["مرض مزمن", 4, "تصنيف صحي مستقل", "نعم"]
  },
  items: {
    label: "الأصناف",
    fields: [field("اسم الصنف", "name", { required: true }), field("التصنيف", "category", { required: true }), field("الوحدة", "unit", { required: true }), field("الوزن أو الحجم", "weight_volume"), field("حد التنبيه", "min_stock", { type: "number", default: 0 }), field("نشط", "is_active", { type: "boolean", default: true }), field("ملاحظات", "notes")],
    sample: ["أرز", "مواد غذائية", "كيس", "25 كجم", 10, "نعم", ""]
  },
  units: {
    label: "الوحدات",
    fields: [field("اسم الوحدة", "name", { required: true }), field("الاختصار", "symbol"), field("نشطة", "is_active", { type: "boolean", default: true })],
    sample: ["كيس", "كيس", "نعم"]
  },
  branches: {
    label: "الفروع",
    fields: [field("اسم الفرع", "name", { required: true }), field("الرمز", "code"), field("المحافظة", "governorate", { required: true }), field("المديرية", "district"), field("العنوان", "address"), field("المدير", "manager_name"), field("الهاتف", "phone"), field("نشط", "is_active", { type: "boolean", default: true })],
    sample: ["فرع صنعاء", "", "صنعاء", "السبعين", "", "", "", "نعم"]
  },
  cashboxes: {
    label: "الصناديق",
    fields: [field("اسم الصندوق", "name", { required: true }), field("الرمز", "code"), field("الفرع", "branch_id", { relation: { table: "branches", label: "name" }, required: true }), field("العملة", "currency", { default: "YER" }), field("الرصيد الافتتاحي", "opening_balance", { type: "number", default: 0 }), field("المسؤول", "responsible_name"), field("نشط", "is_active", { type: "boolean", default: true }), field("ملاحظات", "notes")],
    sample: ["الصندوق الرئيسي", "", "فرع صنعاء", "YER", 0, "", "نعم", ""]
  },
  warehouses: {
    label: "المخازن",
    fields: [field("اسم المخزن", "name", { required: true }), field("الرمز", "code"), field("الفرع", "branch_id", { relation: { table: "branches", label: "name" }, required: true }), field("العنوان", "address", { required: true }), field("المسؤول", "manager_name", { required: true }), field("الهاتف", "phone"), field("نشط", "is_active", { type: "boolean", default: true })],
    sample: ["المخزن العام", "", "فرع صنعاء", "صنعاء", "أمين المخزن", "", "نعم"]
  }
};

function ensureXlsx() {
  if (!window.XLSX) throw new Error("مكتبة Excel غير متاحة. تحقق من الاتصال ثم أعد المحاولة.");
  return window.XLSX;
}

export function downloadImportTemplate(table) {
  const def = importDefinitions[table];
  if (!def) throw new Error("لا يوجد نموذج استيراد لهذه النافذة.");
  const XLSX = ensureXlsx();
  const workbook = XLSX.utils.book_new();
  const instructions = [
    ["تعليمات الاستيراد", def.label],
    ["1", "لا تغيّر أسماء الأعمدة في الصف الأول."],
    ["2", "احذف صف المثال قبل استيراد بياناتك الفعلية."],
    ["3", "القيم المرجعية مثل الفئة أو الفرع يجب أن تطابق الاسم المسجل في النظام."],
    ["4", "التواريخ بصيغة YYYY-MM-DD، والقيم المنطقية نعم أو لا."],
    ["5", "راجع المعاينة والأخطاء قبل الضغط على تنفيذ الاستيراد."]
  ];
  const guideSheet = XLSX.utils.aoa_to_sheet(instructions);
  guideSheet["!cols"] = [{ wch: 18 }, { wch: 72 }];
  const dataSheet = XLSX.utils.aoa_to_sheet([def.fields.map(x => x.header), def.sample]);
  dataSheet["!cols"] = def.fields.map(x => ({ wch: Math.max(14, x.header.length + 4) }));
  dataSheet["!autofilter"] = { ref: `A1:${XLSX.utils.encode_col(def.fields.length - 1)}1` };
  XLSX.utils.book_append_sheet(workbook, guideSheet, "تعليمات");
  XLSX.utils.book_append_sheet(workbook, dataSheet, def.label.slice(0, 31));
  XLSX.writeFile(workbook, `نموذج_استيراد_${def.label}.xlsx`);
}

function convertValue(value, spec) {
  if (value === undefined || value === null || String(value).trim() === "") return spec.default ?? null;
  if (spec.type === "number") {
    const number = Number(value);
    if (!Number.isFinite(number)) throw new Error(`${spec.header}: يجب إدخال رقم صحيح`);
    return number;
  }
  if (spec.type === "boolean") return ["نعم", "yes", "true", "1", "نشط"].includes(String(value).trim().toLowerCase());
  if (spec.type === "date" && value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).trim();
}

export async function parseImportFile(file, table) {
  const def = importDefinitions[table];
  if (!def) throw new Error("اختر نافذة استيراد مدعومة.");
  const XLSX = ensureXlsx();
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: true });
  const expectedName = def.label.slice(0, 31);
  const sheetName = workbook.SheetNames.find(name => name === expectedName) || workbook.SheetNames.find(name => name !== "تعليمات") || workbook.SheetNames[0];
  if (!sheetName) throw new Error("الملف لا يحتوي ورقة بيانات.");
  const rawRows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: null, raw: true });
  const rows = [];
  const errors = [];
  rawRows.forEach((raw, index) => {
    try {
      const payload = {};
      def.fields.forEach(spec => {
        const value = convertValue(raw[spec.header], spec);
        if (spec.required && (value === null || value === "")) throw new Error(`${spec.header}: حقل مطلوب`);
        if (value !== null || spec.required || spec.default !== undefined) payload[spec.key] = value;
      });
      rows.push({ rowNumber: index + 2, payload });
    } catch (error) {
      errors.push({ rowNumber: index + 2, message: error.message });
    }
  });
  return { definition: def, rows, errors, total: rawRows.length, sheetName };
}
