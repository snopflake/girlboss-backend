BEGIN;

DO $preflight$
DECLARE
  existing_policies text;
BEGIN
  SELECT pg_catalog.string_agg(
      policy_row.tablename || '.' || policy_row.policyname,
      ', '
    )
    INTO existing_policies
  FROM pg_catalog.pg_policies AS policy_row
  WHERE policy_row.schemaname = 'public'
    AND policy_row.tablename IN (
      'roles',
      'users',
      'applicant_profiles',
      'companies'
    )
    AND policy_row.policyname NOT IN (
      'girlboss_roles_authenticated_select',
      'girlboss_users_owner_select',
      'girlboss_applicant_profiles_owner_select',
      'girlboss_companies_owner_select'
    );

  IF existing_policies IS NOT NULL THEN
    RAISE EXCEPTION
      'Found existing policies on authentication tables (%). Review them before applying the GirlBoss policies.',
      existing_policies;
  END IF;
END
$preflight$;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.applicant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.companies ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.roles, public.users,
  public.applicant_profiles, public.companies
  FROM PUBLIC, anon, authenticated;

GRANT USAGE ON SCHEMA public TO authenticated;
GRANT SELECT ON TABLE public.roles, public.users,
  public.applicant_profiles, public.companies
  TO authenticated;

DROP POLICY IF EXISTS girlboss_roles_authenticated_select ON public.roles;
CREATE POLICY girlboss_roles_authenticated_select
  ON public.roles
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS girlboss_users_owner_select ON public.users;
CREATE POLICY girlboss_users_owner_select
  ON public.users
  FOR SELECT
  TO authenticated
  USING (id = (SELECT auth.uid()));

DROP POLICY IF EXISTS girlboss_applicant_profiles_owner_select
  ON public.applicant_profiles;
CREATE POLICY girlboss_applicant_profiles_owner_select
  ON public.applicant_profiles
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.users AS owner_user
      JOIN public.roles AS owner_role ON owner_role.id = owner_user.role_id
      WHERE owner_user.id = (SELECT auth.uid())
        AND owner_role.role_name = 'APPLICANT'
    )
  );

DROP POLICY IF EXISTS girlboss_companies_owner_select ON public.companies;
CREATE POLICY girlboss_companies_owner_select
  ON public.companies
  FOR SELECT
  TO authenticated
  USING (
    user_id = (SELECT auth.uid())
    AND EXISTS (
      SELECT 1
      FROM public.users AS owner_user
      JOIN public.roles AS owner_role ON owner_role.id = owner_user.role_id
      WHERE owner_user.id = (SELECT auth.uid())
        AND owner_role.role_name = 'COMPANY'
    )
  );

COMMIT;
