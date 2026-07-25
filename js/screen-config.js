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
  { label: "الرئيسية", items: [
    { id: "dashboard", label: "لوحة التحكم", icon: "fa-solid fa-grid-2" },
    { id: "global-search", label: "البحث العام", icon: "fa-solid fa-magnifying-glass" }
  ]},
  { label: "إدارة النظام", items: [
    { id: "users", label: "المستخدمون والصلاحيات", icon: "fa-solid fa-user-shield" },
    { id: "branches", label: "الفروع والمناطق", icon: "fa-solid fa-sitemap" },
    { id: "devices", label: "الأجهزة المرخصة", icon: "fa-solid fa-laptop-file" },
    { id: "login-attempts", label: "محاولات تسجيل الدخول", icon: "fa-solid fa-shield-halved" },
    { id: "user-tracking", label: "متابعة المستخدم", icon: "fa-solid fa-user-clock" },
    { id: "user-archives", label: "محفوظات المستخدم", icon: "fa-solid fa-box-archive" }
  ]},
  { label: "إدارة الأطراف", items: [
    { id: "delegates", label: "دليل الموزعين", icon: "fa-solid fa-people-carry-box" },
    { id: "donors", label: "دليل المتبرعين", icon: "fa-solid fa-hand-holding-heart" },
    { id: "classifications", label: "الفئات والحالات الصحية", icon: "fa-solid fa-tags" },
    { id: "beneficiaries", label: "دليل المستفيدين", icon: "fa-solid fa-people-roof" }
  ]},
  { label: "الحملات والنقدية", items: [
    { id: "campaigns", label: "الحملات الخيرية", icon: "fa-solid fa-bullseye" },
    { id: "campaign-funding", label: "تمويل الحملات", icon: "fa-solid fa-sack-dollar" },
    { id: "campaign-distributors", label: "موزعو الحملات", icon: "fa-solid fa-people-group" },
    { id: "cashboxes", label: "الصناديق", icon: "fa-solid fa-vault" },
    { id: "cashbox-users", label: "صلاحيات الصناديق", icon: "fa-solid fa-key" },
    { id: "cash-receipts", label: "سندات القبض النقدي", icon: "fa-solid fa-money-bill-transfer" },
    { id: "cash-payments", label: "سندات الصرف النقدي", icon: "fa-solid fa-hand-holding-dollar" },
    { id: "cash-transfers", label: "التحويل بين الصناديق", icon: "fa-solid fa-right-left" },
    { id: "delegate-advances", label: "عهد الموزعين النقدية", icon: "fa-solid fa-wallet" },
    { id: "quick-delivery", label: "التسليم السريع للموزع", icon: "fa-solid fa-list-check" }
  ]},
  { label: "المخزون والعيني", items: [
    { id: "units", label: "دليل الوحدات", icon: "fa-solid fa-ruler-combined" },
    { id: "inventory", label: "دليل الأصناف", icon: "fa-solid fa-boxes-stacked" },
    { id: "warehouses", label: "دليل المخازن", icon: "fa-solid fa-warehouse" },
    { id: "stock-balances", label: "أرصدة المخازن", icon: "fa-solid fa-layer-group" },
    { id: "in-kind-receipts", label: "سندات القبض العيني", icon: "fa-solid fa-truck-ramp-box" },
    { id: "campaign-in-kind-funding", label: "تمويل الحملات العيني", icon: "fa-solid fa-boxes-packing" },
    { id: "baskets", label: "السلال الغذائية", icon: "fa-solid fa-basket-shopping" },
    { id: "in-kind-payments", label: "سندات الصرف العيني", icon: "fa-solid fa-box-open" }
  ]},
  { label: "الخدمات والبيانات", items: [
    { id: "imports", label: "الاستيراد من Excel", icon: "fa-solid fa-file-import" },
    { id: "sync", label: "الاتصال والمزامنة", icon: "fa-solid fa-arrows-rotate" }
  ]},
  { label: "الرقابة والتقارير", items: [
    { id: "reports", label: "التقارير", icon: "fa-solid fa-chart-column" },
    { id: "audit", label: "سجل العمليات", icon: "fa-solid fa-clock-rotate-left" },
    { id: "closings", label: "إقفال الحسابات", icon: "fa-solid fa-file-circle-check" },
    { id: "settings", label: "الإعدادات والنسخ الاحتياطي", icon: "fa-solid fa-gear" }
  ]}
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
      { key: "full_name", label: "المستخدم", type: "name", subKey: "phone" },
      { key: "username", label: "اسم المستخدم" },
      { key: "phone", label: "الهاتف" },
      { key: "role", label: "الدور", type: "role" },
      { key: "is_active", label: "الحالة", type: "boolean-status" },
      { key: "expires_at", label: "انتهاء الحساب", type: "date" }
    ],
    fields: [
      { key: "full_name", label: "الاسم الكامل", type: "text", required: true },
      { key: "username", label: "اسم المستخدم", type: "text", required: true },
      { key: "phone", label: "رقم الهاتف", type: "tel", required: true, help: "9 أرقام، مثل 777123456. لا يحتاج إلى SMS أو رمز تحقق." },
      { key: "role", label: "الدور الوظيفي", type: "select", required: true, options: Object.entries(roleLabels).map(([value, label]) => ({ value, label })) },
      { key: "is_active", label: "الحساب نشط", type: "switch", default: true, full: true },
      { key: "expires_at", label: "تاريخ انتهاء الحساب", type: "date" },
      { key: "password", label: "كلمة المرور المؤقتة", type: "password", requiredOnCreate: true, help: "ثمانية أحرف على الأقل. لا يتم إرسال أي رمز تحقق." },
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
  campaign_funding: {
    title: "تمويل الحملات من الصناديق",
    description: "سحب مبلغ من صندوق محدد وإضافته إلى رصيد الحملة مع منع تجاوز رصيد الصندوق.",
    table: "campaign_funding",
    icon: "fa-solid fa-sack-dollar",
    singular: "تمويل حملة",
    primaryLabel: "إضافة تمويل",
    columns: [
      { key: "funding_no", label: "رقم التمويل", type: "name", subKey: "funding_date" },
      { key: "campaign_name", label: "الحملة" },
      { key: "cashbox_name", label: "الصندوق" },
      { key: "amount", label: "المبلغ", type: "currency" },
      { key: "status", label: "الحالة", type: "status" },
      { key: "created_by_name", label: "المستخدم" }
    ],
    fields: [
      { key: "funding_date", label: "التاريخ", type: "date", required: true },
      { key: "campaign_id", label: "الحملة", type: "relation", relation: { table: "campaigns", label: "name", filter: { status: "open" } }, required: true },
      { key: "cashbox_id", label: "الصندوق الممول", type: "relation", relation: { table: "cashboxes", label: "name", filter: { is_active: true } }, required: true },
      { key: "amount", label: "مبلغ التمويل", type: "currency", required: true, min: 1 },
      { key: "status", label: "الحالة", type: "select", default: "draft", options: [{ value: "draft", label: "مسودة - يتم الترحيل من زر الختم" }] },
      { key: "notes", label: "البيان والملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "post", "print", "cancel"]
  },
  campaign_distributors: {
    title: "موزعو الحملات",
    description: "ربط أكثر من موزع بالحملة وتحديد العهدة والمنطقة ومتابعة المصروف والمتبقي والمرتجع.",
    table: "campaign_distributors",
    icon: "fa-solid fa-people-group",
    singular: "موزع حملة",
    primaryLabel: "ربط موزع",
    columns: [
      { key: "campaign_name", label: "الحملة", type: "name", subKey: "delegate_name" },
      { key: "area_name", label: "المنطقة" },
      { key: "allocated_amount", label: "العهدة", type: "currency" },
      { key: "spent_amount", label: "المصروف", type: "currency" },
      { key: "returned_amount", label: "المرتجع", type: "currency" },
      { key: "remaining_amount", label: "المتبقي", type: "currency" },
      { key: "status", label: "الحالة", type: "status" }
    ],
    fields: [
      { key: "campaign_id", label: "الحملة", type: "relation", relation: { table: "campaigns", label: "name", filter: { status: "open" } }, required: true },
      { key: "delegate_id", label: "الموزع", type: "relation", relation: { table: "delegates", label: "full_name", filter: { is_active: true } }, required: true },
      { key: "cashbox_id", label: "الصندوق المرتبط", type: "relation", relation: { table: "cashboxes", label: "name", filter: { is_active: true } } },
      { key: "area_name", label: "المنطقة أو الحارة", type: "text", required: true },
      { key: "allocated_amount", label: "مبلغ العهدة", type: "currency", default: 0, min: 0 },
      { key: "status", label: "الحالة", type: "select", default: "active", options: [{ value: "active", label: "نشط" }, { value: "settled", label: "تمت التسوية" }, { value: "suspended", label: "موقوف" }] },
      { key: "notes", label: "ملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "statement", "settle", "toggle"]
  },
  cash_receipts: {
    title: "سندات القبض النقدي",
    description: "تسجيل المبالغ النقدية وربطها بالمتبرع والصندوق فقط.",
    table: "cash_receipts",
    icon: "fa-solid fa-money-bill-transfer",
    singular: "سند قبض",
    primaryLabel: "سند قبض جديد",
    columns: [
      { key: "voucher_no", label: "رقم السند", type: "name", subKey: "receipt_date" },
      { key: "donor_name", label: "المتبرع" },
      { key: "cashbox_name", label: "الصندوق" },
      { key: "amount", label: "المبلغ", type: "currency" },
      { key: "method", label: "طريقة القبض" },
      { key: "status", label: "الحالة", type: "status" }
    ],
    fields: [
      { key: "receipt_date", label: "التاريخ", type: "date", required: true },
      { key: "cashbox_id", label: "الصندوق المستلم", type: "relation", relation: { table: "cashboxes", label: "name" }, required: true },
      { key: "donor_id", label: "المتبرع", type: "relation", relation: { table: "donors", label: "name" }, required: true },
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
      { key: "cashbox_name", label: "الصندوق" },
      { key: "amount", label: "المبلغ", type: "currency" },
      { key: "receipt_status", label: "الاستلام", type: "status" },
      { key: "status", label: "الحالة", type: "status" }
    ],
    fields: [
      { key: "payment_date", label: "التاريخ", type: "date", required: true },
      { key: "cashbox_id", label: "الصندوق المصروف منه", type: "relation", relation: { table: "cashboxes", label: "name" }, required: true },
      { key: "delegate_id", label: "الموزع", type: "relation", relation: { table: "delegates", label: "full_name" }, required: true },
      { key: "beneficiary_id", label: "المستفيد المعتمد", type: "relation", relation: { table: "beneficiaries", label: "full_name", filter: { status: "approved" } }, required: true },
      { key: "campaign_id", label: "الحملة", type: "relation", relation: { table: "campaigns", label: "name", filter: { status: "open" } }, required: true },
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
      { key: "items_count", label: "عدد الأصناف", type: "number" },
      { key: "valid_total", label: "الكمية الصالحة", type: "number" },
      { key: "status", label: "الحالة", type: "status" }
    ],
    fields: [
      { key: "receipt_date", label: "التاريخ", type: "date", required: true },
      { key: "donor_id", label: "المتبرع", type: "relation", relation: { table: "donors", label: "name" }, required: true },
      { key: "warehouse_id", label: "المخزن المستلم", type: "relation", relation: { table: "warehouses", label: "name", filter: { is_active: true } }, required: true },
      { key: "status", label: "حالة السند", type: "select", default: "draft", options: [
        { value: "draft", label: "مسودة" }, { value: "under_review", label: "تحت المراجعة" }, { value: "approved", label: "معتمد" }
      ]},
      { key: "details", label: "الأصناف والكميات", type: "lineItems", mode: "receipt", full: true, required: true },
      { key: "notes", label: "الملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "post", "print", "cancel"]
  },
  campaign_in_kind_funding: {
    title: "تمويل الحملات العيني",
    description: "اختيار الأصناف والكميات من رصيد المخزن وتخصيصها لحملة عينية أو مختلطة.",
    table: "campaign_in_kind_funding",
    icon: "fa-solid fa-boxes-packing",
    singular: "تمويل حملة عيني",
    primaryLabel: "تمويل عيني جديد",
    columns: [
      { key: "funding_no", label: "رقم التمويل", type: "name", subKey: "funding_date" },
      { key: "campaign_name", label: "الحملة" },
      { key: "warehouse_name", label: "المخزن" },
      { key: "items_count", label: "عدد الأصناف", type: "number" },
      { key: "total_quantity", label: "إجمالي الكمية", type: "number" },
      { key: "status", label: "الحالة", type: "status" }
    ],
    fields: [
      { key: "funding_date", label: "التاريخ", type: "date", required: true },
      { key: "campaign_id", label: "الحملة العينية/المختلطة", type: "relation", relation: { table: "campaigns", label: "name", filter: { status: "open" } }, required: true },
      { key: "warehouse_id", label: "المخزن المصدر", type: "relation", relation: { table: "warehouses", label: "name", filter: { is_active: true } }, required: true },
      { key: "status", label: "حالة التمويل", type: "select", default: "draft", options: [
        { value: "draft", label: "مسودة" }, { value: "under_review", label: "تحت المراجعة" }, { value: "approved", label: "معتمد" }
      ]},
      { key: "details", label: "الأصناف المخصصة للحملة", type: "lineItems", mode: "funding", full: true, required: true },
      { key: "notes", label: "ملاحظات", type: "textarea", full: true }
    ],
    actions: ["view", "edit", "post", "print"]
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
  branches: {
    title: "الفروع والمناطق", description: "إدارة الفروع والنطاق الجغرافي والمحافظات والمديريات والعزل والقرى.", table: "branches", icon: "fa-solid fa-sitemap", singular: "فرع", primaryLabel: "إضافة فرع",
    columns: [{key:"name",label:"الفرع",type:"name",subKey:"code"},{key:"governorate",label:"المحافظة"},{key:"district",label:"المديرية"},{key:"manager_name",label:"المدير"},{key:"is_active",label:"الحالة",type:"boolean-status"}],
    fields: [{key:"name",label:"اسم الفرع",type:"text",required:true},{key:"code",label:"رمز الفرع",type:"text",required:true},{key:"governorate",label:"المحافظة",type:"text",required:true},{key:"district",label:"المديرية",type:"text"},{key:"address",label:"العنوان التفصيلي",type:"textarea",full:true},{key:"manager_name",label:"مدير الفرع",type:"text"},{key:"phone",label:"الهاتف",type:"tel"},{key:"is_active",label:"نشط",type:"switch",default:true}], actions:["view","edit","toggle"]
  },
  devices: {
    title:"الأجهزة المرخصة",description:"منع الدخول من الأجهزة غير المعتمدة وإدارة طلبات الترخيص.",table:"authorized_devices",icon:"fa-solid fa-laptop-file",singular:"جهاز",primaryLabel:"ترخيص جهاز",
    columns:[{key:"device_name",label:"الجهاز",type:"name",subKey:"fingerprint"},{key:"user_name",label:"المستخدم"},{key:"platform",label:"النظام"},{key:"last_seen_at",label:"آخر ظهور",type:"datetime"},{key:"status",label:"الحالة",type:"status"}],
    fields:[{key:"device_name",label:"اسم الجهاز",type:"text",required:true},{key:"user_id",label:"المستخدم",type:"relation",relation:{table:"profiles",label:"full_name"},required:true},{key:"fingerprint",label:"بصمة الجهاز",type:"text",required:true},{key:"platform",label:"النظام والمتصفح",type:"text"},{key:"status",label:"الحالة",type:"select",default:"approved",options:[{value:"pending",label:"بانتظار الموافقة"},{value:"approved",label:"مرخص"},{value:"blocked",label:"محظور"}]},{key:"notes",label:"ملاحظات",type:"textarea",full:true}], actions:["view","edit","toggle"]
  },
  login_attempts: {
    title:"محاولات تسجيل الدخول",description:"متابعة المحاولات الفاشلة والإيقاف المؤقت والتنبيهات الأمنية.",table:"login_attempts",icon:"fa-solid fa-shield-halved",singular:"محاولة",primaryLabel:null,
    columns:[{key:"attempted_at",label:"التاريخ والوقت",type:"datetime"},{key:"phone",label:"رقم الهاتف"},{key:"device_name",label:"الجهاز"},{key:"ip_address",label:"عنوان الشبكة"},{key:"result",label:"النتيجة",type:"status"},{key:"lockout_until",label:"الإيقاف حتى",type:"datetime"}],fields:[],actions:["view"]
  },
  user_tracking: {
    title:"متابعة المستخدم",description:"عرض جلسات المستخدم وآخر نشاط والجهاز والفرع.",table:"user_sessions",icon:"fa-solid fa-user-clock",singular:"جلسة",primaryLabel:null,
    columns:[{key:"user_name",label:"المستخدم",type:"name",subKey:"role_name"},{key:"device_name",label:"الجهاز"},{key:"branch_name",label:"الفرع"},{key:"login_at",label:"وقت الدخول",type:"datetime"},{key:"last_activity_at",label:"آخر نشاط",type:"datetime"},{key:"status",label:"الحالة",type:"status"}],fields:[],actions:["view"]
  },
  user_archives: {
    title:"محفوظات المستخدم",description:"أرشيف التعديلات والملفات والتقارير التي أنشأها المستخدم.",table:"user_archives",icon:"fa-solid fa-box-archive",singular:"محفوظ",primaryLabel:null,
    columns:[{key:"created_at",label:"التاريخ",type:"datetime"},{key:"user_name",label:"المستخدم"},{key:"archive_type",label:"النوع"},{key:"title",label:"العنوان",type:"name",subKey:"description"},{key:"reference_no",label:"المرجع"}],fields:[],actions:["view"]
  },
  cashboxes: {
    title:"دليل الصناديق",description:"تعريف الصناديق النقدية ومتابعة أرصدتها وربطها بالفروع والعملات.",table:"cashboxes",icon:"fa-solid fa-vault",singular:"صندوق",primaryLabel:"إضافة صندوق",
    columns:[{key:"name",label:"الصندوق",type:"name",subKey:"code"},{key:"branch_name",label:"الفرع"},{key:"currency",label:"العملة"},{key:"opening_balance",label:"الرصيد الافتتاحي",type:"currency"},{key:"current_balance",label:"الرصيد الحالي",type:"currency"},{key:"is_active",label:"الحالة",type:"boolean-status"}],
    fields:[{key:"name",label:"اسم الصندوق",type:"text",required:true},{key:"code",label:"رمز الصندوق",type:"text",required:true},{key:"branch_id",label:"الفرع",type:"relation",relation:{table:"branches",label:"name"},required:true},{key:"currency",label:"العملة",type:"select",default:"YER",options:[{value:"YER",label:"ريال يمني"},{value:"SAR",label:"ريال سعودي"},{value:"USD",label:"دولار"}]},{key:"opening_balance",label:"الرصيد الافتتاحي",type:"currency",default:0},{key:"responsible_name",label:"المسؤول",type:"text"},{key:"is_active",label:"الصندوق نشط",type:"switch",default:true},{key:"notes",label:"ملاحظات",type:"textarea",full:true}],actions:["view","edit","toggle","statement"]
  },
  cashbox_users: {
    title:"صلاحيات الصناديق",description:"تحديد المستخدمين والموزعين المسموح لهم بالقبض أو الصرف من كل صندوق.",table:"cashbox_users",icon:"fa-solid fa-key",singular:"صلاحية صندوق",primaryLabel:"إضافة صلاحية",
    columns:[{key:"cashbox_name",label:"الصندوق",type:"name",subKey:"branch_name"},{key:"user_name",label:"المستخدم"},{key:"delegate_name",label:"الموزع"},{key:"can_receive",label:"قبض",type:"boolean"},{key:"can_pay",label:"صرف",type:"boolean"},{key:"daily_limit",label:"الحد اليومي",type:"currency"}],
    fields:[{key:"cashbox_id",label:"الصندوق",type:"relation",relation:{table:"cashboxes",label:"name"},required:true},{key:"user_id",label:"المستخدم",type:"relation",relation:{table:"profiles",label:"full_name"}},{key:"delegate_id",label:"الموزع",type:"relation",relation:{table:"delegates",label:"full_name"}},{key:"can_receive",label:"يسمح بالقبض",type:"switch",default:false},{key:"can_pay",label:"يسمح بالصرف",type:"switch",default:false},{key:"daily_limit",label:"حد الصرف اليومي",type:"currency",default:0},{key:"is_active",label:"نشط",type:"switch",default:true}],actions:["edit","toggle"]
  },
  cash_transfers: {
    title:"التحويل بين الصناديق",description:"تحويل مبالغ بين الصناديق مع أثر تدقيقي ورقم مرجعي.",table:"cash_transfers",icon:"fa-solid fa-right-left",singular:"تحويل",primaryLabel:"تحويل جديد",
    columns:[{key:"transfer_no",label:"رقم التحويل",type:"name",subKey:"transfer_date"},{key:"from_cashbox_name",label:"من صندوق"},{key:"to_cashbox_name",label:"إلى صندوق"},{key:"amount",label:"المبلغ",type:"currency"},{key:"status",label:"الحالة",type:"status"}],
    fields:[{key:"transfer_date",label:"التاريخ",type:"date",required:true},{key:"from_cashbox_id",label:"من صندوق",type:"relation",relation:{table:"cashboxes",label:"name"},required:true},{key:"to_cashbox_id",label:"إلى صندوق",type:"relation",relation:{table:"cashboxes",label:"name"},required:true},{key:"amount",label:"المبلغ",type:"currency",required:true},{key:"status",label:"الحالة",type:"select",default:"draft",options:[{value:"draft",label:"مسودة"},{value:"posted",label:"مرحّل"},{value:"cancelled",label:"ملغي"}]},{key:"notes",label:"البيان",type:"textarea",full:true}],actions:["view","edit","post","print","cancel"]
  },
  delegate_advances: {
    title:"عهد الموزعين النقدية",description:"تسليم مبالغ للموزعين ومراجعة ما تم صرفه والمتبقي والتسويات.",table:"delegate_advances",icon:"fa-solid fa-wallet",singular:"عهدة",primaryLabel:"تسليم عهدة",
    columns:[{key:"advance_no",label:"رقم العهدة",type:"name",subKey:"advance_date"},{key:"delegate_name",label:"الموزع"},{key:"cashbox_name",label:"الصندوق"},{key:"amount",label:"المبلغ",type:"currency"},{key:"spent_amount",label:"المصروف",type:"currency"},{key:"remaining_amount",label:"المتبقي",type:"currency"},{key:"status",label:"الحالة",type:"status"}],
    fields:[{key:"advance_date",label:"التاريخ",type:"date",required:true},{key:"delegate_id",label:"الموزع",type:"relation",relation:{table:"delegates",label:"full_name"},required:true},{key:"cashbox_id",label:"الصندوق",type:"relation",relation:{table:"cashboxes",label:"name"},required:true},{key:"amount",label:"مبلغ العهدة",type:"currency",required:true},{key:"notes",label:"البيان",type:"textarea",full:true}],actions:["view","edit","statement","post"]
  },
  quick_delivery: {
    title:"التسليم السريع للمستفيد",description:"اكتب اسم المستفيد والمبلغ فقط؛ يختار النظام الموزع تلقائياً ويرحّل العملية فوراً بعد فحص الرصيد.",table:"distribution_assignments",icon:"fa-solid fa-bolt",singular:"تسليم سريع",primaryLabel:"تسليم سريع",
    columns:[{key:"beneficiary_name",label:"المستفيد",type:"name",subKey:"phone"},{key:"delegate_name",label:"الموزع"},{key:"amount",label:"المبلغ",type:"currency"},{key:"delivery_status",label:"التسليم",type:"status"},{key:"delivered_at",label:"وقت التسليم",type:"datetime"}],fields:[{key:"beneficiary_name",label:"اسم المستفيد",type:"text",required:true},{key:"amount",label:"المبلغ",type:"currency",required:true,min:1}],actions:["view"]
  },
  wallet_providers: {
    title:"المحافظ وشركات الحوالات",description:"تعريف مزودي المحافظ والحوالات ومتطلبات ملفات الصرف الجماعي.",table:"wallet_providers",icon:"fa-solid fa-mobile-screen-button",singular:"مزود",primaryLabel:"إضافة مزود",
    columns:[{key:"name",label:"المزود",type:"name",subKey:"provider_type"},{key:"account_format",label:"صيغة رقم الحساب"},{key:"export_format",label:"صيغة الملف"},{key:"is_active",label:"الحالة",type:"boolean-status"}],
    fields:[{key:"name",label:"اسم المزود",type:"text",required:true},{key:"provider_type",label:"النوع",type:"select",options:[{value:"wallet",label:"محفظة إلكترونية"},{value:"remittance",label:"شركة حوالات"}],required:true},{key:"account_format",label:"صيغة رقم المحفظة",type:"text"},{key:"export_format",label:"صيغة التصدير",type:"select",options:[{value:"xlsx",label:"Excel"},{value:"csv",label:"CSV"}]},{key:"is_active",label:"نشط",type:"switch",default:true},{key:"notes",label:"ملاحظات الأعمدة",type:"textarea",full:true}],actions:["view","edit","toggle"]
  },
  bulk_disbursements: {
    title:"دفعات الصرف الجماعي",description:"إنشاء دفعة للمستفيدين وتصدير ملف للمحفظة أو شركة الحوالات.",table:"bulk_disbursements",icon:"fa-solid fa-file-export",singular:"دفعة",primaryLabel:"إنشاء دفعة",
    columns:[{key:"batch_no",label:"رقم الدفعة",type:"name",subKey:"batch_date"},{key:"provider_name",label:"المزود"},{key:"beneficiaries_count",label:"المستفيدون",type:"number"},{key:"total_amount",label:"الإجمالي",type:"currency"},{key:"success_count",label:"ناجحة",type:"number"},{key:"failed_count",label:"فاشلة",type:"number"},{key:"status",label:"الحالة",type:"status"}],
    fields:[{key:"batch_date",label:"تاريخ الدفعة",type:"date",required:true},{key:"provider_id",label:"المحفظة أو شركة الحوالات",type:"relation",relation:{table:"wallet_providers",label:"name"},required:true},{key:"campaign_id",label:"الحملة",type:"relation",relation:{table:"campaigns",label:"name"}},{key:"cashbox_id",label:"الصندوق",type:"relation",relation:{table:"cashboxes",label:"name"},required:true},{key:"notes",label:"ملاحظات",type:"textarea",full:true}],actions:["view","edit","export","post","cancel"]
  },
  disbursement_results: {
    title:"نتائج ومطابقة الصرف",description:"رفع نتيجة المزود ومطابقة الناجح والفاشل وإعادة المحاولة.",table:"disbursement_results",icon:"fa-solid fa-list-check",singular:"نتيجة",primaryLabel:"رفع نتيجة",
    columns:[{key:"batch_no",label:"الدفعة",type:"name",subKey:"beneficiary_name"},{key:"wallet_no",label:"رقم المحفظة"},{key:"amount",label:"المبلغ",type:"currency"},{key:"provider_reference",label:"مرجع المزود"},{key:"result",label:"النتيجة",type:"status"},{key:"processed_at",label:"وقت المعالجة",type:"datetime"}],
    fields:[{key:"batch_id",label:"دفعة الصرف",type:"relation",relation:{table:"bulk_disbursements",label:"batch_no"},required:true},{key:"result_file",label:"ملف النتائج",type:"file",folder:"disbursement-results",full:true,required:true}],actions:["view","retry"]
  },
  units: {
    title:"دليل الوحدات",description:"وحدات جاهزة مثل كيس وكرتون وقطعة وكيلو ولتر مع إمكانية الإضافة.",table:"units",icon:"fa-solid fa-ruler-combined",singular:"وحدة",primaryLabel:"إضافة وحدة",
    columns:[{key:"name",label:"الوحدة",type:"name",subKey:"symbol"},{key:"unit_type",label:"النوع"},{key:"is_default",label:"افتراضية",type:"boolean"},{key:"is_active",label:"الحالة",type:"boolean-status"}],fields:[{key:"name",label:"اسم الوحدة",type:"text",required:true},{key:"symbol",label:"الرمز",type:"text"},{key:"unit_type",label:"نوع الوحدة",type:"select",options:[{value:"count",label:"عدد"},{value:"weight",label:"وزن"},{value:"volume",label:"حجم"}]},{key:"is_default",label:"وحدة جاهزة",type:"switch",default:false},{key:"is_active",label:"نشطة",type:"switch",default:true}],actions:["edit","toggle"]
  },
  warehouses: {
    title:"دليل المخازن",description:"تعريف المخزن وعنوانه والمسؤول عنه وربطه بالفرع.",table:"warehouses",icon:"fa-solid fa-warehouse",singular:"مخزن",primaryLabel:"إضافة مخزن",
    columns:[{key:"name",label:"المخزن",type:"name",subKey:"code"},{key:"branch_name",label:"الفرع"},{key:"address",label:"العنوان"},{key:"manager_name",label:"المسؤول"},{key:"is_active",label:"الحالة",type:"boolean-status"}],fields:[{key:"name",label:"اسم المخزن",type:"text",required:true},{key:"code",label:"الرمز",type:"text",required:true},{key:"branch_id",label:"الفرع",type:"relation",relation:{table:"branches",label:"name"},required:true},{key:"address",label:"العنوان",type:"textarea",full:true,required:true},{key:"manager_name",label:"المسؤول الأول",type:"text",required:true},{key:"phone",label:"الهاتف",type:"tel"},{key:"is_active",label:"نشط",type:"switch",default:true}],actions:["view","edit","toggle"]
  },
  stock_balances: {
    title:"أرصدة المخازن",description:"الرصيد الفعلي والمتاح والمحجوز والتالف لكل صنف ومخزن.",table:"stock_balances",icon:"fa-solid fa-layer-group",singular:"رصيد",primaryLabel:null,
    columns:[{key:"warehouse_name",label:"المخزن",type:"name",subKey:"item_name"},{key:"unit_name",label:"الوحدة"},{key:"available_qty",label:"المتاح",type:"number"},{key:"reserved_qty",label:"المحجوز",type:"number"},{key:"damaged_qty",label:"التالف",type:"number"},{key:"min_stock",label:"الحد الأدنى",type:"number"},{key:"status",label:"الحالة",type:"status"}],fields:[],actions:["view"]
  },
  messages: {
    title:"الرسائل وواتساب",description:"سجل الرسائل الصادرة للمستفيدين والمتبرعين والموزعين وحالات التسليم.",table:"messages",icon:"fa-solid fa-message",singular:"رسالة",primaryLabel:"إرسال رسالة",
    columns:[{key:"sent_at",label:"التاريخ",type:"datetime"},{key:"recipient_name",label:"المستلم",type:"name",subKey:"phone"},{key:"channel",label:"القناة"},{key:"subject",label:"الغرض"},{key:"status",label:"الحالة",type:"status"}],fields:[{key:"recipient_type",label:"نوع المستلم",type:"select",options:[{value:"beneficiary",label:"مستفيد"},{value:"donor",label:"متبرع"},{value:"delegate",label:"موزع"}]},{key:"phone",label:"رقم الهاتف",type:"tel",required:true},{key:"channel",label:"القناة",type:"select",options:[{value:"sms",label:"رسالة نصية"},{value:"whatsapp",label:"واتساب"}]},{key:"message",label:"نص الرسالة",type:"textarea",full:true,required:true}],actions:["view","retry"]
  },
  message_templates: {
    title:"قوالب الرسائل",description:"تعديل النصوص الصادرة من النظام وإضافة رقم الشكاوى والمتغيرات.",table:"message_templates",icon:"fa-solid fa-file-lines",singular:"قالب",primaryLabel:"إضافة قالب",
    columns:[{key:"name",label:"القالب",type:"name",subKey:"event_key"},{key:"channel",label:"القناة"},{key:"is_active",label:"الحالة",type:"boolean-status"},{key:"updated_at",label:"آخر تعديل",type:"datetime"}],fields:[{key:"name",label:"اسم القالب",type:"text",required:true},{key:"event_key",label:"مفتاح الحدث",type:"text",required:true},{key:"channel",label:"القناة",type:"select",options:[{value:"sms",label:"SMS"},{value:"whatsapp",label:"WhatsApp"}]},{key:"body",label:"نص القالب",type:"textarea",full:true,required:true},{key:"is_active",label:"نشط",type:"switch",default:true}],actions:["view","edit","toggle"]
  },
  imports: {
    title:"الاستيراد من Excel",description:"استيراد بيانات أي نافذة مع نموذج أعمدة ومعاينة وفحص تكرار قبل الحفظ.",table:"import_jobs",icon:"fa-solid fa-file-import",singular:"عملية استيراد",primaryLabel:"استيراد ملف",
    columns:[{key:"created_at",label:"التاريخ",type:"datetime"},{key:"target_name",label:"النافذة",type:"name",subKey:"file_name"},{key:"total_rows",label:"الصفوف",type:"number"},{key:"success_rows",label:"ناجحة",type:"number"},{key:"error_rows",label:"أخطاء",type:"number"},{key:"status",label:"الحالة",type:"status"}],fields:[{key:"target_table",label:"نافذة الإدخال",type:"select",required:true,options:[{value:"beneficiaries",label:"المستفيدون"},{value:"delegates",label:"الموزعون"},{value:"donors",label:"المتبرعون"},{value:"items",label:"الأصناف"},{value:"warehouses",label:"المخازن"}]},{key:"file",label:"ملف Excel أو CSV",type:"file",folder:"imports",full:true,required:true}],actions:["view","download-template"]
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
  { id: "cashbox-balances", title: "أرصدة الصناديق", description: "الرصيد الافتتاحي والحركة والرصيد الحالي لكل صندوق.", icon: "fa-solid fa-vault", table: "cashboxes" },
  { id: "warehouse-balances", title: "أرصدة المخازن", description: "المتاح والمحجوز والتالف والحد الأدنى.", icon: "fa-solid fa-warehouse", table: "stock_balances" },
  { id: "delegate-advances", title: "عهد الموزعين", description: "العهد والمصروف والمتبقي والتسويات.", icon: "fa-solid fa-wallet", table: "delegate_advances" },
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
