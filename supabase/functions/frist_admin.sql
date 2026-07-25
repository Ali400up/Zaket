UPDATE public.profiles
SET
    phone = '779512515',
    role = 'admin'::public.app_role,
    status = 'active',
    is_active = true,
    expires_at = NULL
WHERE email = 'u779512515@zakat.local';