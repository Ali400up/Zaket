const iso = days => new Date(Date.now() + days * 86400000).toISOString();
const dateOnly = days => iso(days).slice(0, 10);

export const demoData = {
  profiles: [
    { id: "u-admin", full_name: "محمد العريقي", username: "admin", email: "admin@example.com", phone: "777000111", role: "admin", is_active: true, expires_at: null, notes: "مدير النظام", created_at: iso(-180) },
    { id: "u-supervisor", full_name: "سارة القحطاني", username: "sara", email: "sara@example.com", phone: "777000222", role: "supervisor", is_active: true, expires_at: null, notes: "مشرفة العمليات", created_at: iso(-165) },
    { id: "u-accountant", full_name: "خالد الحكيمي", username: "khaled", email: "khaled@example.com", phone: "777000333", role: "accountant", is_active: true, expires_at: dateOnly(160), notes: "المحاسب الرئيسي", created_at: iso(-150) },
    { id: "u-distributor", full_name: "عبدالله الصبري", username: "abdullah", email: "abdullah@example.com", phone: "777000444", role: "distributor", is_active: true, expires_at: null, notes: "موزع ميداني", created_at: iso(-120) },
    { id: "u-warehouse", full_name: "علي الآنسي", username: "ali.store", email: "store@example.com", phone: "777000555", role: "warehouse", is_active: true, expires_at: null, notes: "أمين المخزون", created_at: iso(-100) },
    { id: "u-old", full_name: "سمير أحمد", username: "sameer", email: "sameer@example.com", phone: "777000666", role: "data_entry", is_active: false, expires_at: dateOnly(-10), notes: "حساب موقوف", created_at: iso(-90) }
  ],
  delegates: [
    { id: "d-1", profile_id: "u-distributor", full_name: "عبدالله الصبري", phone: "777000444", national_id: "0102030405", delegate_type: "both", is_active: true, notes: "منطقة صنعاء", created_at: iso(-120) },
    { id: "d-2", profile_id: null, full_name: "أحمد الشامي", phone: "777111222", national_id: "0203040506", delegate_type: "cash", is_active: true, notes: "منطقة الأمانة", created_at: iso(-90) },
    { id: "d-3", profile_id: null, full_name: "فاطمة الحضرمي", phone: "777222333", national_id: null, delegate_type: "in_kind", is_active: true, notes: "التوزيع النسائي", created_at: iso(-70) },
    { id: "d-4", profile_id: null, full_name: "ياسر الوصابي", phone: "777333444", national_id: "0304050607", delegate_type: "cash", is_active: false, notes: "موقوف مؤقتاً", created_at: iso(-60) }
  ],
  donors: [
    { id: "don-1", name: "أحمد عبدالله", donor_type: "individual", phone: "733100100", identity_no: "1002003004", email: "ahmed@example.com", is_anonymous: false, is_active: true, notes: "متبرع دائم", created_at: iso(-140) },
    { id: "don-2", name: "شركة الخير للتجارة", donor_type: "organization", phone: "01444111", identity_no: "CR-22441", email: "csr@alkhair.example", is_anonymous: false, is_active: true, notes: "دعم موسمي", created_at: iso(-130) },
    { id: "don-3", name: "فاعل خير", donor_type: "individual", phone: null, identity_no: null, email: null, is_anonymous: true, is_active: true, notes: "يفضل عدم إظهار اسمه", created_at: iso(-80) },
    { id: "don-4", name: "مؤسسة الرحمة", donor_type: "organization", phone: "01555999", identity_no: "CR-88771", email: "info@rahma.example", is_anonymous: false, is_active: true, notes: "تبرعات عينية", created_at: iso(-55) }
  ],
  beneficiary_categories: [
    { id: "cat-1", name: "أسرة فقيرة", description: "دخل الأسرة دون حد الكفاية", priority: 4, is_active: true, created_at: iso(-200) },
    { id: "cat-2", name: "أرملة", description: "أسرة تعولها أرملة", priority: 5, is_active: true, created_at: iso(-200) },
    { id: "cat-3", name: "يتيم", description: "حالة يتيم أو أسرة أيتام", priority: 5, is_active: true, created_at: iso(-195) },
    { id: "cat-4", name: "نازح", description: "أسرة نازحة", priority: 4, is_active: true, created_at: iso(-180) },
    { id: "cat-5", name: "طالب علم", description: "دعم تعليمي", priority: 2, is_active: false, created_at: iso(-170) }
  ],
  health_conditions: [
    { id: "hc-1", name: "لا توجد", description: "لا توجد حالة صحية خاصة", priority: 1, is_active: true, created_at: iso(-200) },
    { id: "hc-2", name: "مرض مزمن", description: "سكري أو ضغط أو أمراض مستمرة", priority: 4, is_active: true, created_at: iso(-200) },
    { id: "hc-3", name: "إعاقة حركية", description: "حاجة إلى دعم حركي", priority: 5, is_active: true, created_at: iso(-190) },
    { id: "hc-4", name: "حالة طارئة", description: "تحتاج تدخلاً عاجلاً", priority: 5, is_active: true, created_at: iso(-170) }
  ],
  beneficiaries: [
    { id: "b-1", file_no: "BEN-00001", full_name: "محمد صالح علي", national_id: "1100220033", phone: "771100200", gender: "male", age: 47, marital_status: "married", family_size: 7, category_id: "cat-1", health_condition_id: "hc-2", delegate_id: "d-1", priority: "high", status: "approved", source: "زيارة ميدانية", notes: "يحتاج علاجاً شهرياً", created_at: iso(-95) },
    { id: "b-2", file_no: "BEN-00002", full_name: "أمينة أحمد حسن", national_id: "2200330044", phone: "771100300", gender: "female", age: 39, marital_status: "widowed", family_size: 5, category_id: "cat-2", health_condition_id: "hc-1", delegate_id: "d-3", priority: "critical", status: "approved", source: "ترشيح جمعية", notes: "أرملة تعول خمسة أفراد", created_at: iso(-88) },
    { id: "b-3", file_no: "BEN-00003", full_name: "عبدالرحمن يحيى", national_id: null, phone: "771100400", gender: "male", age: 15, marital_status: "single", family_size: 4, category_id: "cat-3", health_condition_id: "hc-1", delegate_id: "d-1", priority: "high", status: "approved", source: "مكتب الأيتام", notes: "يتيم الأب", created_at: iso(-70) },
    { id: "b-4", file_no: "BEN-00004", full_name: "سعاد محمد علي", national_id: "3300440055", phone: "771100500", gender: "female", age: 52, marital_status: "married", family_size: 6, category_id: "cat-4", health_condition_id: "hc-3", delegate_id: "d-3", priority: "critical", status: "under_review", source: "تسجيل ميداني", notes: "بانتظار اعتماد المشرف", created_at: iso(-5) },
    { id: "b-5", file_no: "BEN-00005", full_name: "محمد صالح أحمد", national_id: null, phone: "771100200", gender: "male", age: 46, marital_status: "married", family_size: 6, category_id: "cat-1", health_condition_id: "hc-1", delegate_id: "d-2", priority: "medium", status: "under_review", source: "إدخال مباشر", notes: "تشابه محتمل مع ملف BEN-00001", created_at: iso(-2) },
    { id: "b-6", file_no: "BEN-00006", full_name: "خديجة عبدالله", national_id: "4400550066", phone: "771100600", gender: "female", age: 61, marital_status: "widowed", family_size: 2, category_id: "cat-2", health_condition_id: "hc-2", delegate_id: "d-3", priority: "high", status: "suspended", source: "زيارة ميدانية", notes: "موقوف لحين تحديث البيانات", created_at: iso(-50) }
  ],
  campaigns: [
    { id: "c-1", name: "حملة رمضان 1448هـ", description: "مساعدات نقدية وسلال غذائية للأسر الأشد حاجة", campaign_type: "mixed", start_date: dateOnly(-40), end_date: dateOnly(25), planned_budget: 8000000, ceiling: 10000000, currency: "YER", responsible_id: "u-supervisor", status: "open", created_at: iso(-50) },
    { id: "c-2", name: "دفء الشتاء", description: "بطانيات وملابس شتوية", campaign_type: "in_kind", start_date: dateOnly(-110), end_date: dateOnly(-45), planned_budget: 0, ceiling: 0, currency: "YER", responsible_id: "u-supervisor", status: "closed", created_at: iso(-120) },
    { id: "c-3", name: "كفالة الأيتام", description: "دعم نقدي شهري للأيتام", campaign_type: "cash", start_date: dateOnly(-15), end_date: dateOnly(350), planned_budget: 12000000, ceiling: 15000000, currency: "YER", responsible_id: "u-accountant", status: "open", created_at: iso(-20) },
    { id: "c-4", name: "الحقيبة المدرسية", description: "حقائب وقرطاسية للطلاب", campaign_type: "in_kind", start_date: dateOnly(45), end_date: dateOnly(90), planned_budget: 0, ceiling: 0, currency: "YER", responsible_id: "u-supervisor", status: "setup", created_at: iso(-3) }
  ],
  cash_receipts: [
    { id: "cr-1", voucher_no: "CR-2026-0001", receipt_date: dateOnly(-35), donor_id: "don-1", campaign_id: "c-1", delegate_id: "d-1", amount: 500000, currency: "YER", method: "cash", reference_no: null, notes: "تبرع رمضان", status: "posted", posted_at: iso(-35), created_by: "u-accountant", created_at: iso(-35) },
    { id: "cr-2", voucher_no: "CR-2026-0002", receipt_date: dateOnly(-28), donor_id: "don-2", campaign_id: "c-1", delegate_id: "d-1", amount: 2200000, currency: "YER", method: "bank", reference_no: "BNK-88210", notes: "دفعة أولى", status: "posted", posted_at: iso(-28), created_by: "u-accountant", created_at: iso(-28) },
    { id: "cr-3", voucher_no: "CR-2026-0003", receipt_date: dateOnly(-10), donor_id: "don-3", campaign_id: "c-3", delegate_id: "d-2", amount: 750000, currency: "YER", method: "exchange", reference_no: "EX-77192", notes: "فاعل خير", status: "posted", posted_at: iso(-10), created_by: "u-accountant", created_at: iso(-10) },
    { id: "cr-4", voucher_no: "CR-2026-0004", receipt_date: dateOnly(-2), donor_id: "don-1", campaign_id: "c-1", delegate_id: "d-1", amount: 300000, currency: "YER", method: "cash", reference_no: null, notes: "بانتظار المراجعة", status: "under_review", posted_at: null, created_by: "u-accountant", created_at: iso(-2) },
    { id: "cr-5", voucher_no: "CR-2026-0005", receipt_date: dateOnly(0), donor_id: "don-2", campaign_id: "c-3", delegate_id: "d-2", amount: 1000000, currency: "YER", method: "bank", reference_no: "BNK-99440", notes: "مسودة", status: "draft", posted_at: null, created_by: "u-accountant", created_at: iso(0) }
  ],
  cash_payments: [
    { id: "cp-1", voucher_no: "CP-2026-0001", payment_date: dateOnly(-30), delegate_id: "d-1", beneficiary_id: "b-1", campaign_id: "c-1", cash_receipt_id: "cr-1", amount: 120000, currency: "YER", delivery_method: "cash", receipt_status: "received", actual_recipient: "محمد صالح علي", transfer_no: null, status: "posted", posted_at: iso(-30), notes: "مساعدة علاجية", created_by: "u-distributor", created_at: iso(-30) },
    { id: "cp-2", voucher_no: "CP-2026-0002", payment_date: dateOnly(-24), delegate_id: "d-1", beneficiary_id: "b-2", campaign_id: "c-1", cash_receipt_id: "cr-2", amount: 180000, currency: "YER", delivery_method: "transfer", receipt_status: "received", actual_recipient: "أمينة أحمد حسن", transfer_no: "TR-10022", status: "posted", posted_at: iso(-24), notes: "دعم أسرة", created_by: "u-distributor", created_at: iso(-24) },
    { id: "cp-3", voucher_no: "CP-2026-0003", payment_date: dateOnly(-7), delegate_id: "d-2", beneficiary_id: "b-3", campaign_id: "c-3", cash_receipt_id: "cr-3", amount: 90000, currency: "YER", delivery_method: "cash", receipt_status: "pending", actual_recipient: "ولي الأمر", transfer_no: null, status: "posted", posted_at: iso(-7), notes: "دفعة كفالة", created_by: "u-accountant", created_at: iso(-7) },
    { id: "cp-4", voucher_no: "CP-2026-0004", payment_date: dateOnly(-1), delegate_id: "d-1", beneficiary_id: "b-3", campaign_id: "c-1", cash_receipt_id: "cr-2", amount: 100000, currency: "YER", delivery_method: "cash", receipt_status: "pending", actual_recipient: null, transfer_no: null, status: "under_review", posted_at: null, notes: "تحت المراجعة", created_by: "u-distributor", created_at: iso(-1) }
  ],
  items: [
    { id: "i-1", name: "أرز بسمتي", category: "مواد غذائية", unit: "كيس", weight_volume: "10 كجم", min_stock: 30, is_active: true, notes: "الصنف الأساسي", created_at: iso(-180) },
    { id: "i-2", name: "دقيق أبيض", category: "مواد غذائية", unit: "كيس", weight_volume: "10 كجم", min_stock: 25, is_active: true, notes: null, created_at: iso(-180) },
    { id: "i-3", name: "زيت طبخ", category: "مواد غذائية", unit: "كرتون", weight_volume: "12 لتر", min_stock: 20, is_active: true, notes: "تنبيه قرب النفاد", created_at: iso(-180) },
    { id: "i-4", name: "سكر", category: "مواد غذائية", unit: "كيس", weight_volume: "5 كجم", min_stock: 25, is_active: true, notes: null, created_at: iso(-175) },
    { id: "i-5", name: "بطانية شتوية", category: "كسوة", unit: "قطعة", weight_volume: null, min_stock: 15, is_active: true, notes: null, created_at: iso(-120) },
    { id: "i-6", name: "حقيبة مدرسية", category: "تعليم", unit: "قطعة", weight_volume: null, min_stock: 50, is_active: true, notes: null, created_at: iso(-20) }
  ],
  inventory_lots: [
    { id: "lot-1", item_id: "i-1", campaign_id: "c-1", delegate_id: "d-1", lot_no: "RICE-01", expiry_date: dateOnly(220), quantity_received: 160, quantity_damaged: 5, quantity_available: 125, created_at: iso(-32) },
    { id: "lot-2", item_id: "i-2", campaign_id: "c-1", delegate_id: "d-1", lot_no: "FLOUR-01", expiry_date: dateOnly(150), quantity_received: 150, quantity_damaged: 2, quantity_available: 118, created_at: iso(-32) },
    { id: "lot-3", item_id: "i-3", campaign_id: "c-1", delegate_id: "d-1", lot_no: "OIL-01", expiry_date: dateOnly(300), quantity_received: 80, quantity_damaged: 0, quantity_available: 17, created_at: iso(-25) },
    { id: "lot-4", item_id: "i-4", campaign_id: "c-1", delegate_id: "d-1", lot_no: "SUGAR-01", expiry_date: dateOnly(270), quantity_received: 110, quantity_damaged: 3, quantity_available: 87, created_at: iso(-25) },
    { id: "lot-5", item_id: "i-5", campaign_id: "c-2", delegate_id: "d-3", lot_no: "BLANKET-01", expiry_date: null, quantity_received: 200, quantity_damaged: 4, quantity_available: 6, created_at: iso(-100) }
  ],
  in_kind_receipts: [
    { id: "ikr-1", voucher_no: "IKR-2026-0001", receipt_date: dateOnly(-32), donor_id: "don-4", campaign_id: "c-1", delegate_id: "d-1", status: "posted", notes: "مواد سلة رمضان", posted_at: iso(-32), created_by: "u-warehouse", created_at: iso(-32), details: [
      { item_id: "i-1", quantity: 160, valid_qty: 155, damaged_qty: 5, lot_no: "RICE-01", expiry_date: dateOnly(220) },
      { item_id: "i-2", quantity: 150, valid_qty: 148, damaged_qty: 2, lot_no: "FLOUR-01", expiry_date: dateOnly(150) }
    ]},
    { id: "ikr-2", voucher_no: "IKR-2026-0002", receipt_date: dateOnly(-25), donor_id: "don-2", campaign_id: "c-1", delegate_id: "d-1", status: "posted", notes: "زيت وسكر", posted_at: iso(-25), created_by: "u-warehouse", created_at: iso(-25), details: [
      { item_id: "i-3", quantity: 80, valid_qty: 80, damaged_qty: 0, lot_no: "OIL-01", expiry_date: dateOnly(300) },
      { item_id: "i-4", quantity: 110, valid_qty: 107, damaged_qty: 3, lot_no: "SUGAR-01", expiry_date: dateOnly(270) }
    ]},
    { id: "ikr-3", voucher_no: "IKR-2026-0003", receipt_date: dateOnly(0), donor_id: "don-4", campaign_id: "c-1", delegate_id: "d-3", status: "draft", notes: "مسودة مواد جديدة", posted_at: null, created_by: "u-warehouse", created_at: iso(0), details: [
      { item_id: "i-1", quantity: 30, valid_qty: 30, damaged_qty: 0, lot_no: "RICE-02", expiry_date: dateOnly(250) }
    ]}
  ],
  baskets: [
    { id: "bs-1", name: "سلة رمضان الأساسية", campaign_id: "c-1", description: "سلة غذائية لأسرة متوسطة", is_active: true, created_at: iso(-28), updated_at: iso(-5), details: [
      { item_id: "i-1", quantity: 1, required: true },
      { item_id: "i-2", quantity: 1, required: true },
      { item_id: "i-3", quantity: 1, required: true },
      { item_id: "i-4", quantity: 1, required: true }
    ]},
    { id: "bs-2", name: "سلة أسرة كبيرة", campaign_id: "c-1", description: "كميات مضاعفة للأسر الكبيرة", is_active: true, created_at: iso(-20), updated_at: iso(-4), details: [
      { item_id: "i-1", quantity: 2, required: true },
      { item_id: "i-2", quantity: 2, required: true },
      { item_id: "i-3", quantity: 1, required: true },
      { item_id: "i-4", quantity: 2, required: true }
    ]},
    { id: "bs-3", name: "سلة تجريبية", campaign_id: "c-1", description: "سلة متوقفة", is_active: false, created_at: iso(-10), updated_at: iso(-9), details: [
      { item_id: "i-1", quantity: 1, required: true }
    ]}
  ],
  in_kind_payments: [
    { id: "ikp-1", voucher_no: "IKP-2026-0001", payment_date: dateOnly(-18), beneficiary_id: "b-1", campaign_id: "c-1", delegate_id: "d-1", distribution_type: "basket", basket_id: "bs-1", receipt_status: "received", actual_recipient: "محمد صالح علي", status: "posted", posted_at: iso(-18), notes: "سلة رمضان", created_by: "u-distributor", created_at: iso(-18), details: [
      { item_id: "i-1", quantity: 1 }, { item_id: "i-2", quantity: 1 }, { item_id: "i-3", quantity: 1 }, { item_id: "i-4", quantity: 1 }
    ]},
    { id: "ikp-2", voucher_no: "IKP-2026-0002", payment_date: dateOnly(-12), beneficiary_id: "b-2", campaign_id: "c-1", delegate_id: "d-3", distribution_type: "basket", basket_id: "bs-2", receipt_status: "received", actual_recipient: "أمينة أحمد حسن", status: "posted", posted_at: iso(-12), notes: "أسرة كبيرة", created_by: "u-supervisor", created_at: iso(-12), details: [
      { item_id: "i-1", quantity: 2 }, { item_id: "i-2", quantity: 2 }, { item_id: "i-3", quantity: 1 }, { item_id: "i-4", quantity: 2 }
    ]},
    { id: "ikp-3", voucher_no: "IKP-2026-0003", payment_date: dateOnly(-1), beneficiary_id: "b-3", campaign_id: "c-1", delegate_id: "d-1", distribution_type: "basket", basket_id: "bs-1", receipt_status: "pending", actual_recipient: null, status: "under_review", posted_at: null, notes: "المخزون يحتاج مراجعة", created_by: "u-distributor", created_at: iso(-1), details: [] }
  ],
  account_closings: [
    { id: "cl-1", closing_no: "CLS-2026-0001", campaign_id: "c-2", donor_id: null, cash_receipt_id: null, total_received: 0, total_spent: 0, balance: 0, difference: 0, closing_type: "full", notes: "تم إقفال حملة الشتاء", closed_by: "u-accountant", closed_at: iso(-44), status: "closed", created_at: iso(-44) }
  ],
  audit_logs: [
    { id: "a-1", user_id: "u-accountant", action: "ترحيل سند قبض نقدي", table_name: "cash_receipts", record_id: "cr-2", old_data: { status: "approved" }, new_data: { status: "posted", amount: 2200000 }, session_info: { device: "Chrome / Windows" }, result: "success", created_at: iso(-28) },
    { id: "a-2", user_id: "u-distributor", action: "ترحيل سند صرف نقدي", table_name: "cash_payments", record_id: "cp-1", old_data: { status: "approved" }, new_data: { status: "posted", amount: 120000 }, session_info: { device: "Android" }, result: "success", created_at: iso(-30) },
    { id: "a-3", user_id: "u-supervisor", action: "اعتماد مستفيد", table_name: "beneficiaries", record_id: "b-3", old_data: { status: "under_review" }, new_data: { status: "approved" }, session_info: { device: "Chrome / Android" }, result: "success", created_at: iso(-15) },
    { id: "a-4", user_id: "u-admin", action: "تعديل صلاحيات مستخدم", table_name: "profiles", record_id: "u-accountant", old_data: { role: "data_entry" }, new_data: { role: "accountant" }, session_info: { device: "Chrome / Windows" }, result: "success", created_at: iso(-100) },
    { id: "a-5", user_id: "u-distributor", action: "محاولة صرف فوق الرصيد", table_name: "cash_payments", record_id: null, old_data: null, new_data: { amount: 5000000 }, session_info: { device: "Android" }, result: "failed", created_at: iso(-3) }
  ],
  system_settings: [
    { id: 1, organization_name: "مؤسسة الخير للزكاة والتنمية", system_name: "نظام إدارة الزكاة والتبرعات", logo_url: "assets/logo.svg", voucher_prefixes: { cash_receipt: "CR", cash_payment: "CP", in_kind_receipt: "IKR", in_kind_payment: "IKP" }, duplicate_policy: { national_id: "block", phone: "warn", name: "warn" }, require_payment_approval: true, allow_offline_drafts: true, allow_final_offline: false, stock_alert_days: 30, currency: "YER", print_footer: "جزاكم الله خيراً", retention_years: 10, updated_at: iso(-3) }
  ]
};
