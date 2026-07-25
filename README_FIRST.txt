نظام إدارة الزكاة والتبرعات V8.3

للتثبيت على مشروع Supabase جديد:
1) شغّل supabase/database_complete.sql كاملاً مرة واحدة.
2) أنشئ المستخدم في Authentication ببريد وهمي مثل 779512515@zakat.local.
3) أضف/حدّث profile واجعله admin وactive.
4) نفّذ: SELECT * FROM public.rls_contract_check();
   يجب أن تكون القيم الثلاث true لكل جدول.

إذا كانت قاعدة V8.2 مثبتة بالفعل:
- شغّل فقط supabase/rls_complete_hotfix.sql.
- ثم سجّل خروجاً من التطبيق وادخل من جديد.
- امسح Cache/بيانات الموقع أو نفّذ تحديثاً قوياً كي لا تبقى نسخة Service Worker القديمة.
