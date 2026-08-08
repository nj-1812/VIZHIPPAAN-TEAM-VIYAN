DROP POLICY IF EXISTS user_roles_admin_manage ON public.user_roles;
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role);