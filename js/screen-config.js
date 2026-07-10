export const roleLabels = {
  admin: "مدير النظام",
  supervisor: "مشرف",
  accountant: "محاسب",
  distributor: "موزع",
  data_entry: "إدخال بيانات",
  warehouse: "أمين مخزون",
  auditor: "مراجع"
};

export const statusLabels = {
  active: "نشط",
  inactive: "موقوف",
  suspended: "موقوف",
  draft: "مسودة",
  under_review: "تحت المراجعة",
  approved: "معتمد",
  posted: "مرحّل",
  cancelled: "ملغي",
  rejected: "مرفوض",
  setup: "تجهيز",
  open: "مفتوحة",
  closed: "مغلقة",
  pending: "بانتظار الاستلام",
  received: "تم الاستلام",
  cash: "نقدية",
  in_kind: "عينية",
  mixed: "مشتركة",
  both: "نقدي وعيني",
  individual: "فرد",
  organization: "جهة",
  manual: "أصناف يدوية",
  basket: "سلة غذائية",
  queued: "معلقة",
  syncing: "قيد المزامنة",
  synced: "ناجحة",
  failed: "فاشلة",
  review: "تحتاج مراجعة",
  partial: "جزئي",
  full: "كامل",
  reopened: "أعيد فتحه"
};

export const menuSections = [
  {
    label: "الرئيسية",
    items: [
      { id: "dashboard", label: "لوحة التحكم", icon: "fa-solid fa-grid-2" }
    ]
  },
  {
    label: "إدارة الأطراف",
    items: [
      { id: "users", label: "المستخدمون والصلاحيات", icon: "fa-solid fa-user-shield" },
      { id: "delegates", label: "دليل الموزعين", icon: "fa-solid fa-people-carry-box" },
      { id: "donors", label: "دليل المتبرعين", icon: "fa-solid fa-hand-holding-heart" },
      { id: "classifications", label: "الفئات والحالات الصحية", icon: "fa-solid fa-tags" },
      { id: "beneficiaries", label: "دليل المستفيدين", icon: "fa-solid fa-people-roof" }
    ]
  },
  {
    label: "الحملات والعمليات",
    items: [
      { id: "campaigns", label: "الحملات الخيرية", icon: "fa-solid fa-bullseye" },
      { id: "cash-receipts", label: "سندات القبض النقدي", icon: "fa-solid fa-money-bill-transfer" },
      { id: "cash-payments", label: "سندات الصرف النقدي", icon: "fa-solid fa-hand-holding-dollar" }
    ]
  },
  {
    label: "المخزون والعيني",
    items: [
      { id: "inventory", label: "الأصناف والمخزون", icon: "fa-solid fa-boxes-stacked" },
      { id: "in-kind-receipts", label: "سندات القبض العيني", icon: "fa-solid fa-truck-ramp-box" },
      { id: "baskets", label: "السلال الغذائية", icon: "fa-solid fa-basket-shopping" },
      { id: "in-kind-payments", label: "سندات الصرف العيني", icon: "fa-solid fa-box-open" }
    ]
  },
  {
    label: "الرقابة والتقارير",
    items: [
      { id: "closings", label: "إقفال الحسابات", icon: "fa-solid fa-file-circle-check" },
      { id: "reports", label: "التقارير", icon: "fa-solid fa-chart-column" },
      { id: "audit", label: "سجل العمليات", icon: "fa-solid fa-clock-rotate-left" },
      { id: "sync", label: "الاتصال والمزامنة", icon: "fa-solid fa-arrows-rotate" },
      { id: "settings", label: "الإعدادات والنسخ الاحتياطي", icon: "fa-solid fa-gear" }
    ]
  }
];

const yesNo = [
  { value: true, label: "نعم" },
  { value: false, label: "لا" }
];

export const screenConfigs = {
  users: {
    title: "إدارة المستخدمين والصلاحيات",
    description: "إنشاء حسابات النظام وتحديد الدور والحالة وتاريخ انتهاء الحساب.",
    table: "profiles",
    icon: "fa-solid fa-user-shield",
    singular: "مستخدم",
    primaryLabel: "إضافة مستخدم",
    columns: [
      { key: "full_name", label: "المستخدم", type: "name", subKey: "email" },
      { key: "username", label: "اسم المستخدم" },
      { key: "phone", label: "الهاتف" },
      { key: "role", label: "الدور", type: "role" },
      { key: "is_active", label: "الحالة", type: "boolean-status" },
      { key: "expires_at", label: "انتهاء الحساب", type: "date" }
    ],
    fields: [
      { key: "full_name", label: "الاسم الكامل", type: "text", required: true },
      { key: "username", label: "اسم المستخدم", type: "text", required: true },
      { key: "email", label: "البريد الإلكتروني", type: "email", required: true },
      { key: "phone", label: "رقم الهاتف", type: "tel" },
      { key: "role", label: "الدور الوظيفي", type: "select", required: true, options: Object.entries(roleLabels).map(([value, label]) => ({ value, label })) },
      { key: "is_active", label: "الحساب نشط", type: "switch", default: true, full: true },
      { key: "expires_at", label: "تاريخ انتهاء الحساب", type: "date" },
      { key: "password", label: "كلمة المرور المؤقتة", type: "password", requiredOnCreate: true, help: "ثمانية أحرف على الأقل. تُستخدم عند إنشاء حساب Supabase." },
      { key: "notes", label: "ملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "toggle", "reset-password"]
  },
  delegates: {
    title: "دليل الموزعين",
    description: "إدارة الأشخاص المسؤولين عن استلام التبرعات وتوزيعها وربطهم بحسابات الدخول.",
    table: "delegates",
    icon: "fa-solid fa-people-carry-box",
    singular: "موزع",
    primaryLabel: "إضافة موزع",
    columns: [
      { key: "full_name", label: "الموزع", type: "name", subKey: "phone" },
      { key: "national_id", label: "رقم الهوية" },
      { key: "delegate_type", label: "النوع", type: "status" },
      { key: "cash_balance", label: "الرصيد النقدي", type: "currency" },
      { key: "inventory_count", label: "العهدة العينية", type: "number" },
      { key: "is_active", label: "الحالة", type: "boolean-status" }
    ],
    fields: [
      { key: "full_name", label: "الاسم الكامل", type: "text", required: true },
      { key: "phone", label: "رقم الهاتف", type: "tel", required: true },
      { key: "national_id", label: "رقم الهوية", type: "text" },
      { key: "profile_id", label: "حساب المستخدم المرتبط", type: "relation", relation: { table: "profiles", label: "full_name" } },
      { key: "delegate_type", label: "نوع الموزع", type: "select", required: true, options: [
        { value: "cash", label: "نقدي" }, { value: "in_kind", label: "عيني" }, { value: "both", label: "نقدي وعيني" }
      ]},
      { key: "is_active", label: "الموزع نشط", type: "switch", default: true },
      { key: "notes", label: "ملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "toggle"]
  },
  donors: {
    title: "دليل المتبرعين",
    description: "حفظ بيانات الأفراد والجهات وربط جميع التبرعات النقدية والعينية بملف موحد.",
    table: "donors",
    icon: "fa-solid fa-hand-holding-heart",
    singular: "متبرع",
    primaryLabel: "إضافة متبرع",
    columns: [
      { key: "name", label: "المتبرع", type: "name", subKey: "phone" },
      { key: "donor_type", label: "النوع", type: "status" },
      { key: "identity_no", label: "الهوية / السجل" },
      { key: "cash_total", label: "إجمالي النقدي", type: "currency" },
      { key: "in_kind_total", label: "التبرعات العينية" },
      { key: "is_anonymous", label: "إخفاء الاسم", type: "boolean" },
      { key: "is_active", label: "الحالة", type: "boolean-status" }
    ],
    fields: [
      { key: "name", label: "اسم المتبرع", type: "text", required: true },
      { key: "donor_type", label: "نوع المتبرع", type: "select", required: true, options: [
        { value: "individual", label: "فرد" }, { value: "organization", label: "جهة" }
      ]},
      { key: "phone", label: "رقم الهاتف", type: "tel" },
      { key: "identity_no", label: "رقم الهوية أو السجل التجاري", type: "text" },
      { key: "email", label: "البريد الإلكتروني", type: "email" },
      { key: "is_anonymous", label: "إظهار الاسم في التقارير باسم فاعل خير", type: "switch", default: false, full: true },
      { key: "is_active", label: "المتبرع نشط", type: "switch", default: true },
      { key: "notes", label: "ملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "toggle", "statement"]
  },
  beneficiary_categories: {
    title: "فئات المستفيدين",
    description: "قيم موحدة لتصنيف المستفيدين وترتيب الأولوية.",
    table: "beneficiary_categories",
    icon: "fa-solid fa-tags",
    singular: "فئة",
    primaryLabel: "إضافة فئة",
    columns: [
      { key: "name", label: "اسم الفئة", type: "name", subKey: "description" },
      { key: "priority", label: "الأولوية", type: "number" },
      { key: "is_active", label: "الحالة", type: "boolean-status" },
      { key: "created_at", label: "تاريخ الإنشاء", type: "date" }
    ],
    fields: [
      { key: "name", label: "اسم الفئة", type: "text", required: true },
      { key: "priority", label: "درجة الأولوية", type: "number", default: 3, min: 1, max: 5 },
      { key: "is_active", label: "الفئة نشطة", type: "switch", default: true },
      { key: "description", label: "الوصف", type: "textarea", full: true }
    ],
    actions: ["edit", "toggle"]
  },
  health_conditions: {
    title: "الحالات الصحية",
    description: "قائمة صحية موحدة تستخدم داخل ملف المستفيد.",
    table: "health_conditions",
    icon: "fa-solid fa-notes-medical",
    singular: "حالة صحية",
    primaryLabel: "إضافة حالة صحية",
    columns: [
      { key: "name", label: "الحالة", type: "name", subKey: "description" },
      { key: "priority", label: "الأولوية", type: "number" },
      { key: "is_active", label: "الحالة", type: "boolean-status" },
      { key: "created_at", label: "تاريخ الإنشاء", type: "date" }
    ],
    fields: [
      { key: "name", label: "اسم الحالة الصحية", type: "text", required: true },
      { key: "priority", label: "درجة الأولوية", type: "number", default: 3, min: 1, max: 5 },
      { key: "is_active", label: "الحالة نشطة", type: "switch", default: true },
      { key: "description", label: "الوصف", type: "textarea", full: true }
    ],
    actions: ["edit", "toggle"]
  },
  beneficiaries: {
    title: "دليل المستفيدين",
    description: "ملف موحد لكل مستفيد أو أسرة مع فحص التكرار والاعتماد وسجل المساعدات.",
    table: "beneficiaries",
    icon: "fa-solid fa-people-roof",
    singular: "مستفيد",
    primaryLabel: "إضافة مستفيد",
    columns: [
      { key: "full_name", label: "المستفيد", type: "name", subKey: "file_no" },
      { key: "national_id", label: "رقم الهوية" },
      { key: "phone", label: "الهاتف" },
      { key: "category_name", label: "الفئة" },
      { key: "family_size", label: "أفراد الأسرة", type: "number" },
      { key: "priority", label: "الأولوية", type: "priority" },
      { key: "status", label: "حالة الملف", type: "status" }
    ],
    fields: [
      { key: "full_name", label: "الاسم الكامل", type: "text", required: true },
      { key: "national_id", label: "رقم الهوية", type: "text", help: "اختياري، ويجب أن يكون فريداً عند إدخاله." },
      { key: "phone", label: "رقم الهاتف", type: "tel" },
      { key: "gender", label: "الجنس", type: "select", options: [{ value: "male", label: "ذكر" }, { value: "female", label: "أنثى" }] },
      { key: "age", label: "العمر", type: "number", min: 0, max: 120 },
      { key: "marital_status", label: "الحالة الاجتماعية", type: "select", options: [
        { value: "single", label: "أعزب" }, { value: "married", label: "متزوج" }, { value: "widowed", label: "أرمل" }, { value: "divorced", label: "مطلق" }
      ]},
      { key: "family_size", label: "عدد أفراد الأسرة", type: "number", required: true, min: 1, default: 1 },
      { key: "category_id", label: "فئة المستفيد", type: "relation", relation: { table: "beneficiary_categories", label: "name" }, required: true },
      { key: "health_condition_id", label: "الحالة الصحية", type: "relation", relation: { table: "health_conditions", label: "name" } },
      { key: "delegate_id", label: "الموزع المسؤول", type: "relation", relation: { table: "delegates", label: "full_name" } },
      { key: "priority", label: "الأولوية", type: "select", default: "medium", options: [
        { value: "critical", label: "عاجلة جداً" }, { value: "high", label: "عالية" }, { value: "medium", label: "متوسطة" }, { value: "low", label: "منخفضة" }
      ]},
      { key: "status", label: "حالة الملف", type: "select", default: "under_review", options: [
        { value: "draft", label: "مسودة" }, { value: "under_review", label: "تحت المراجعة" }, { value: "approved", label: "معتمد" }, { value: "rejected", label: "مرفوض" }, { value: "suspended", label: "موقوف" }
      ]},
      { key: "source", label: "مصدر التسجيل", type: "text", default: "إدخال مباشر" },
      { key: "notes", label: "الملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "duplicate-check", "approve", "toggle", "aid-history"]
  },
  campaigns: {
    title: "إدارة الحملات الخيرية",
    description: "إنشاء إطار مستقل لكل حملة وربط المقبوضات والمصروفات النقدية والعينية بها.",
    table: "campaigns",
    icon: "fa-solid fa-bullseye",
    singular: "حملة",
    primaryLabel: "إنشاء حملة",
    columns: [
      { key: "name", label: "الحملة", type: "name", subKey: "description" },
      { key: "campaign_type", label: "النوع", type: "status" },
      { key: "start_date", label: "البداية", type: "date" },
      { key: "end_date", label: "النهاية", type: "date" },
      { key: "received_total", label: "المقبوض", type: "currency" },
      { key: "spent_total", label: "المصروف", type: "currency" },
      { key: "balance", label: "الرصيد", type: "currency" },
      { key: "status", label: "الحالة", type: "status" }
    ],
    fields: [
      { key: "name", label: "اسم الحملة", type: "text", required: true },
      { key: "campaign_type", label: "نوع الحملة", type: "select", required: true, options: [
        { value: "cash", label: "نقدية" }, { value: "in_kind", label: "عينية" }, { value: "mixed", label: "مشتركة" }
      ]},
      { key: "start_date", label: "تاريخ البداية", type: "date", required: true },
      { key: "end_date", label: "تاريخ النهاية", type: "date", required: true },
      { key: "planned_budget", label: "الميزانية التخطيطية", type: "currency" },
      { key: "ceiling", label: "السقف المالي", type: "currency" },
      { key: "currency", label: "العملة", type: "select", default: "YER", options: [
        { value: "YER", label: "ريال يمني" }, { value: "SAR", label: "ريال سعودي" }, { value: "USD", label: "دولار أمريكي" }
      ]},
      { key: "responsible_id", label: "المسؤول", type: "relation", relation: { table: "profiles", label: "full_name" } },
      { key: "status", label: "حالة الحملة", type: "select", default: "setup", options: [
        { value: "setup", label: "تجهيز" }, { value: "open", label: "مفتوحة" }, { value: "closed", label: "مغلقة" }
      ]},
      { key: "description", label: "الوصف", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "open-close", "report"]
  },
  cash_receipts: {
    title: "سندات القبض النقدي",
    description: "تسجيل المبالغ النقدية وربطها بالمتبرع والحملة والموزع المستلم.",
    table: "cash_receipts",
    icon: "fa-solid fa-money-bill-transfer",
    singular: "سند قبض",
    primaryLabel: "سند قبض جديد",
    columns: [
      { key: "voucher_no", label: "رقم السند", type: "name", subKey: "receipt_date" },
      { key: "donor_name", label: "المتبرع" },
      { key: "campaign_name", label: "الحملة" },
      { key: "delegate_name", label: "الموزع" },
      { key: "amount", label: "المبلغ", type: "currency" },
      { key: "method", label: "طريقة القبض" },
      { key: "status", label: "الحالة", type: "status" }
    ],
    fields: [
      { key: "receipt_date", label: "التاريخ", type: "date", required: true },
      { key: "donor_id", label: "المتبرع", type: "relation", relation: { table: "donors", label: "name" }, required: true },
      { key: "campaign_id", label: "الحملة", type: "relation", relation: { table: "campaigns", label: "name", filter: { status: "open" } }, required: true },
      { key: "delegate_id", label: "الموزع المستلم", type: "relation", relation: { table: "delegates", label: "full_name" }, required: true },
      { key: "amount", label: "المبلغ", type: "currency", required: true, min: 1 },
      { key: "currency", label: "العملة", type: "select", default: "YER", options: [
        { value: "YER", label: "ريال يمني" }, { value: "SAR", label: "ريال سعودي" }, { value: "USD", label: "دولار أمريكي" }
      ]},
      { key: "method", label: "طريقة القبض", type: "select", required: true, options: [
        { value: "cash", label: "نقداً" }, { value: "bank", label: "تحويل بنكي" }, { value: "exchange", label: "حوالة صرافة" }, { value: "online", label: "دفع إلكتروني" }
      ]},
      { key: "reference_no", label: "رقم المرجع أو الحوالة", type: "text" },
      { key: "attachment_url", label: "مرفق سند القبض", type: "file", folder: "cash-receipts", full: true },
      { key: "status", label: "حالة السند", type: "select", default: "draft", options: [
        { value: "draft", label: "مسودة" }, { value: "under_review", label: "تحت المراجعة" }, { value: "approved", label: "معتمد" }
      ]},
      { key: "notes", label: "الملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "post", "print", "cancel"]
  },
  cash_payments: {
    title: "سندات الصرف النقدي",
    description: "تسجيل المبلغ المسلم للمستفيد مع فحص الرصيد والتكرار وإثبات الاستلام.",
    table: "cash_payments",
    icon: "fa-solid fa-hand-holding-dollar",
    singular: "سند صرف",
    primaryLabel: "سند صرف جديد",
    columns: [
      { key: "voucher_no", label: "رقم السند", type: "name", subKey: "payment_date" },
      { key: "beneficiary_name", label: "المستفيد" },
      { key: "campaign_name", label: "الحملة" },
      { key: "delegate_name", label: "الموزع" },
      { key: "amount", label: "المبلغ", type: "currency" },
      { key: "receipt_status", label: "الاستلام", type: "status" },
      { key: "status", label: "الحالة", type: "status" }
    ],
    fields: [
      { key: "payment_date", label: "التاريخ", type: "date", required: true },
      { key: "delegate_id", label: "الموزع", type: "relation", relation: { table: "delegates", label: "full_name" }, required: true },
      { key: "beneficiary_id", label: "المستفيد المعتمد", type: "relation", relation: { table: "beneficiaries", label: "full_name", filter: { status: "approved" } }, required: true },
      { key: "campaign_id", label: "الحملة", type: "relation", relation: { table: "campaigns", label: "name", filter: { status: "open" } }, required: true },
      { key: "cash_receipt_id", label: "سند القبض الممول", type: "relation", relation: { table: "cash_receipts", label: "voucher_no", filter: { status: "posted" } }, required: true },
      { key: "amount", label: "المبلغ", type: "currency", required: true, min: 1 },
      { key: "currency", label: "العملة", type: "select", default: "YER", options: [
        { value: "YER", label: "ريال يمني" }, { value: "SAR", label: "ريال سعودي" }, { value: "USD", label: "دولار أمريكي" }
      ]},
      { key: "delivery_method", label: "طريقة التسليم", type: "select", required: true, options: [
        { value: "cash", label: "نقداً" }, { value: "transfer", label: "حوالة" }, { value: "bank", label: "تحويل بنكي" }
      ]},
      { key: "receipt_status", label: "حالة الاستلام", type: "select", default: "pending", options: [
        { value: "pending", label: "بانتظار الاستلام" }, { value: "received", label: "تم الاستلام" }, { value: "rejected", label: "رفض الاستلام" }
      ]},
      { key: "actual_recipient", label: "المستلم الفعلي", type: "text" },
      { key: "transfer_no", label: "رقم الحوالة", type: "text" },
      { key: "proof_url", label: "إثبات الاستلام أو الحوالة", type: "file", folder: "cash-payments", full: true },
      { key: "status", label: "حالة السند", type: "select", default: "draft", options: [
        { value: "draft", label: "مسودة" }, { value: "under_review", label: "تحت المراجعة" }, { value: "approved", label: "معتمد" }
      ]},
      { key: "override_reason", label: "سبب الاستثناء من منع التكرار", type: "textarea", full: true, help: "يترك فارغاً إلا عند وجود موافقة استثنائية." },
      { key: "notes", label: "الملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "post", "confirm-receipt", "print", "cancel"]
  },
  items: {
    title: "دليل الأصناف والمخزون",
    description: "تعريف المواد العينية ومتابعة الرصيد المتوفر والتالف والقريب من الانتهاء.",
    table: "items",
    icon: "fa-solid fa-boxes-stacked",
    singular: "صنف",
    primaryLabel: "إضافة صنف",
    columns: [
      { key: "name", label: "الصنف", type: "name", subKey: "category" },
      { key: "unit", label: "الوحدة" },
      { key: "available_qty", label: "المتاح", type: "number" },
      { key: "damaged_qty", label: "التالف", type: "number" },
      { key: "min_stock", label: "حد التنبيه", type: "number" },
      { key: "expiry_alert", label: "الصلاحية" },
      { key: "is_active", label: "الحالة", type: "boolean-status" }
    ],
    fields: [
      { key: "name", label: "اسم الصنف", type: "text", required: true },
      { key: "category", label: "التصنيف", type: "text", required: true },
      { key: "unit", label: "وحدة القياس", type: "text", required: true, placeholder: "كيس، كرتون، لتر..." },
      { key: "weight_volume", label: "الوزن أو الحجم", type: "text" },
      { key: "min_stock", label: "الحد الأدنى للتنبيه", type: "number", default: 0, min: 0 },
      { key: "is_active", label: "الصنف نشط", type: "switch", default: true },
      { key: "notes", label: "ملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "toggle", "movements"]
  },
  in_kind_receipts: {
    title: "سندات القبض العيني",
    description: "تسجيل المواد المستلمة من متبرع وزيادة المخزون الصالح بعد الترحيل.",
    table: "in_kind_receipts",
    icon: "fa-solid fa-truck-ramp-box",
    singular: "سند قبض عيني",
    primaryLabel: "سند قبض عيني جديد",
    columns: [
      { key: "voucher_no", label: "رقم السند", type: "name", subKey: "receipt_date" },
      { key: "donor_name", label: "المتبرع" },
      { key: "campaign_name", label: "الحملة" },
      { key: "delegate_name", label: "الموزع" },
      { key: "items_count", label: "عدد الأصناف", type: "number" },
      { key: "valid_total", label: "الكمية الصالحة", type: "number" },
      { key: "status", label: "الحالة", type: "status" }
    ],
    fields: [
      { key: "receipt_date", label: "التاريخ", type: "date", required: true },
      { key: "donor_id", label: "المتبرع", type: "relation", relation: { table: "donors", label: "name" }, required: true },
      { key: "campaign_id", label: "الحملة", type: "relation", relation: { table: "campaigns", label: "name", filter: { status: "open" } }, required: true },
      { key: "delegate_id", label: "الموزع المستلم", type: "relation", relation: { table: "delegates", label: "full_name" }, required: true },
      { key: "status", label: "حالة السند", type: "select", default: "draft", options: [
        { value: "draft", label: "مسودة" }, { value: "under_review", label: "تحت المراجعة" }, { value: "approved", label: "معتمد" }
      ]},
      { key: "details", label: "الأصناف والكميات", type: "lineItems", mode: "receipt", full: true, required: true },
      { key: "notes", label: "الملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "post", "print", "cancel"]
  },
  baskets: {
    title: "تعريف السلال الغذائية",
    description: "إنشاء سلال ثابتة المحتوى مرتبطة بالحملات لتسريع الصرف العيني.",
    table: "baskets",
    icon: "fa-solid fa-basket-shopping",
    singular: "سلة",
    primaryLabel: "إنشاء سلة",
    columns: [
      { key: "name", label: "السلة", type: "name", subKey: "description" },
      { key: "campaign_name", label: "الحملة" },
      { key: "items_count", label: "عدد الأصناف", type: "number" },
      { key: "available_sets", label: "السلال المتاحة", type: "number" },
      { key: "is_active", label: "الحالة", type: "boolean-status" },
      { key: "updated_at", label: "آخر تحديث", type: "date" }
    ],
    fields: [
      { key: "name", label: "اسم السلة", type: "text", required: true },
      { key: "campaign_id", label: "الحملة", type: "relation", relation: { table: "campaigns", label: "name" }, required: true },
      { key: "is_active", label: "السلة نشطة", type: "switch", default: true },
      { key: "description", label: "الوصف", type: "textarea", full: true },
      { key: "details", label: "مكونات السلة", type: "lineItems", mode: "basket", full: true, required: true }
    ],
    actions: ["view", "edit", "copy", "toggle"]
  },
  in_kind_payments: {
    title: "سندات الصرف العيني",
    description: "تسليم أصناف أو سلة غذائية للمستفيد مع فحص المخزون ومنع التكرار.",
    table: "in_kind_payments",
    icon: "fa-solid fa-box-open",
    singular: "سند صرف عيني",
    primaryLabel: "سند صرف عيني جديد",
    columns: [
      { key: "voucher_no", label: "رقم السند", type: "name", subKey: "payment_date" },
      { key: "beneficiary_name", label: "المستفيد" },
      { key: "campaign_name", label: "الحملة" },
      { key: "distribution_type", label: "نوع الصرف", type: "status" },
      { key: "basket_name", label: "السلة" },
      { key: "items_count", label: "الأصناف", type: "number" },
      { key: "status", label: "الحالة", type: "status" }
    ],
    fields: [
      { key: "payment_date", label: "التاريخ", type: "date", required: true },
      { key: "beneficiary_id", label: "المستفيد المعتمد", type: "relation", relation: { table: "beneficiaries", label: "full_name", filter: { status: "approved" } }, required: true },
      { key: "campaign_id", label: "الحملة", type: "relation", relation: { table: "campaigns", label: "name", filter: { status: "open" } }, required: true },
      { key: "delegate_id", label: "الموزع", type: "relation", relation: { table: "delegates", label: "full_name" }, required: true },
      { key: "distribution_type", label: "نوع الصرف", type: "select", default: "basket", options: [
        { value: "basket", label: "سلة غذائية" }, { value: "manual", label: "أصناف يدوية" }
      ]},
      { key: "basket_id", label: "السلة", type: "relation", relation: { table: "baskets", label: "name", filter: { is_active: true } } },
      { key: "receipt_status", label: "حالة الاستلام", type: "select", default: "pending", options: [
        { value: "pending", label: "بانتظار الاستلام" }, { value: "received", label: "تم الاستلام" }, { value: "rejected", label: "رفض الاستلام" }
      ]},
      { key: "actual_recipient", label: "المستلم الفعلي", type: "text" },
      { key: "proof_url", label: "إثبات الاستلام", type: "file", folder: "in-kind-payments", full: true },
      { key: "status", label: "حالة السند", type: "select", default: "draft", options: [
        { value: "draft", label: "مسودة" }, { value: "under_review", label: "تحت المراجعة" }, { value: "approved", label: "معتمد" }
      ]},
      { key: "details", label: "الأصناف اليدوية", type: "lineItems", mode: "payment", full: true },
      { key: "override_reason", label: "سبب الاستثناء من منع التكرار", type: "textarea", full: true },
      { key: "notes", label: "الملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "stock-check", "post", "confirm-receipt", "print", "cancel"]
  },
  closings: {
    title: "إقفال الحسابات",
    description: "مراجعة المقبوضات والمصروفات والفروقات وتثبيت نتائج الحملة.",
    table: "account_closings",
    icon: "fa-solid fa-file-circle-check",
    singular: "إقفال",
    primaryLabel: "إقفال جديد",
    columns: [
      { key: "closing_no", label: "رقم الإقفال", type: "name", subKey: "closed_at" },
      { key: "campaign_name", label: "الحملة" },
      { key: "total_received", label: "المقبوض", type: "currency" },
      { key: "total_spent", label: "المصروف", type: "currency" },
      { key: "balance", label: "المتبقي", type: "currency" },
      { key: "difference", label: "الفروقات", type: "currency" },
      { key: "closing_type", label: "النوع", type: "status" },
      { key: "status", label: "الحالة", type: "status" }
    ],
    fields: [
      { key: "campaign_id", label: "الحملة", type: "relation", relation: { table: "campaigns", label: "name", filter: { status: "open" } }, required: true },
      { key: "donor_id", label: "المتبرع - اختياري", type: "relation", relation: { table: "donors", label: "name" } },
      { key: "cash_receipt_id", label: "سند القبض - اختياري", type: "relation", relation: { table: "cash_receipts", label: "voucher_no", filter: { status: "posted" } } },
      { key: "closing_type", label: "نوع الإقفال", type: "select", default: "full", options: [
        { value: "partial", label: "جزئي" }, { value: "full", label: "كامل" }
      ]},
      { key: "difference", label: "فرق مسجل", type: "currency", default: 0 },
      { key: "notes", label: "الملاحظات وسبب الفرق", type: "textarea", full: true }
    ],
    actions: ["view", "report", "reopen"]
  },
  audit_logs: {
    title: "سجل العمليات",
    description: "أثر تدقيقي غير قابل للتعديل لكل عملية حساسة داخل النظام.",
    table: "audit_logs",
    icon: "fa-solid fa-clock-rotate-left",
    singular: "عملية",
    primaryLabel: null,
    columns: [
      { key: "created_at", label: "التاريخ والوقت", type: "datetime" },
      { key: "user_name", label: "المستخدم", type: "name", subKey: "user_role" },
      { key: "action", label: "العملية" },
      { key: "table_name", label: "الشاشة / الجدول" },
      { key: "record_id", label: "رقم السجل", type: "short-id" },
      { key: "result", label: "النتيجة", type: "status" }
    ],
    fields: [],
    actions: ["view"]
  }
};

export const reportDefinitions = [
  { id: "cash-donors", title: "تقرير المتبرعين النقدي", description: "المبالغ المقبوضة حسب المتبرع والحملة.", icon: "fa-solid fa-hand-holding-heart", table: "cash_receipts" },
  { id: "cash-beneficiaries", title: "تقرير المستفيدين النقدي", description: "المبالغ المصروفة للمستفيدين.", icon: "fa-solid fa-hand-holding-dollar", table: "cash_payments" },
  { id: "inkind-donors", title: "تقرير المتبرعين العيني", description: "الأصناف والكميات الواردة.", icon: "fa-solid fa-truck-ramp-box", table: "in_kind_receipts" },
  { id: "inkind-beneficiaries", title: "تقرير المستفيدين العيني", description: "السلال والأصناف المصروفة.", icon: "fa-solid fa-box-open", table: "in_kind_payments" },
  { id: "campaign-balances", title: "الحملات والأرصدة", description: "المقبوض والمصروف والمتبقي لكل حملة.", icon: "fa-solid fa-bullseye", table: "campaigns" },
  { id: "inventory-balances", title: "رصيد الأصناف", description: "المتاح والتالف والتنبيهات.", icon: "fa-solid fa-boxes-stacked", table: "items" },
  { id: "delegate-balances", title: "أرصدة الموزعين", description: "الرصيد النقدي والعهدة العينية.", icon: "fa-solid fa-people-carry-box", table: "delegates" },
  { id: "duplicates", title: "المستفيدون المكررون", description: "حالات التشابه والهوية والهاتف.", icon: "fa-solid fa-clone", table: "beneficiaries" },
  { id: "closings", title: "تقرير الإقفال", description: "الفروقات والإقفالات الكاملة والجزئية.", icon: "fa-solid fa-file-circle-check", table: "account_closings" },
  { id: "audit-sync", title: "التدقيق والمزامنة", description: "العمليات الحساسة وحالة المزامنة.", icon: "fa-solid fa-clock-rotate-left", table: "audit_logs" }
];
