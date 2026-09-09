const DEFINITIONS = {
  NETWORK: {
    test: /failed to fetch|network|offline|انقطع|الشبكة|timeout|timed out|abort/i,
    cause: "تعذر الوصول إلى Supabase أو انقطع الاتصال أثناء العملية.",
    action: "تحقق من الإنترنت ثم أعد المحاولة؛ الاستعادة V4 تتابع من آخر ملف مكتمل.",
  },
  PERMISSION: {
    test: /unauthor|forbidden|permission|jwt|rls|401|403|غير مصرح|الصلاحية|الجلسة/i,
    cause: "الجلسة منتهية أو أن المستخدم أو الجهاز لا يملك صلاحية العملية.",
    action: "سجل الدخول من جديد بحساب مدير وتأكد من اعتماد الجهاز وصلاحيات RLS.",
  },
  INTEGRITY: {
    test: /checksum|digest|hash|signature|mismatch|corrupt|بصمة|تالف|ناقصة|ناقص/i,
    cause: "فشل فحص سلامة ملف أو جزء من النسخة الاحتياطية.",
    action: "لا تعتمد الملف؛ أنشئ نسخة V4 جديدة كاملة أو استخدم نسخة سليمة أخرى.",
  },
  STORAGE: {
    test: /storage|quota|payload too large|413|object|bucket|مساحة|المرفق|الرفع/i,
    cause: "تعذر قراءة أو رفع مرفق، أو أن حد المساحة/الحجم لا يسمح بالعملية.",
    action: "راجع حالة Storage وحدود الضغط والمساحة، ثم أعد العملية.",
  },
  DUPLICATE: {
    test: /duplicate|unique|already exists|23505|مكرر|موجود مسبق/i,
    cause: "يوجد سجل أو ملف بنفس المفتاح الفريد.",
    action: "استخدم الدمج الآمن أو راجع الرقم المرجعي للسجل المتعارض.",
  },
  GENERAL: {
    test: /.*/,
    cause: "لم تكتمل العملية، ولم يعتمد النظام نتيجة جزئية.",
    action: "راجع تفاصيل الخطأ وسجل التدقيق ثم أعد المحاولة.",
  },
};

export function formatOperationError(error, context = "operation") {
  const original = String(error?.message || error || "خطأ غير معروف").trim();
  const code = Object.keys(DEFINITIONS).find(key => DEFINITIONS[key].test.test(original)) || "GENERAL";
  const definition = DEFINITIONS[code];
  const prefix = context === "restore" ? "RST" : context === "backup" ? "BKP" : "OPS";
  const reference = `${prefix}-${code}`;
  return {
    code,
    reference,
    detail: original,
    message: `السبب: ${definition.cause} الحل: ${definition.action} المرجع: ${reference}. التفاصيل: ${original}`,
  };
}
