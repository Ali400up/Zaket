V11 RC2 - Database compatibility fix

Fixed PostgreSQL error 42P13:
cannot change return type of existing function post_cash_receipt(uuid)

The unified installer now drops public.post_cash_receipt(uuid) before the first definition.
Run only:
supabase/database_complete.sql

Important: The installer is intended to update an existing database as well as install a fresh one.
