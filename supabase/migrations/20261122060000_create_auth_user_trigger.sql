BEGIN;

CREATE SCHEMA IF NOT EXISTS private;

REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

DO $preflight$
DECLARE
  existing_triggers text;
BEGIN
  SELECT pg_catalog.string_agg(trigger_row.tgname, ', ')
    INTO existing_triggers
  FROM pg_catalog.pg_trigger AS trigger_row
  WHERE trigger_row.tgrelid = 'auth.users'::pg_catalog.regclass
    AND NOT trigger_row.tgisinternal;

  IF existing_triggers IS NOT NULL THEN
    RAISE EXCEPTION
      'Found existing auth.users triggers (%). Review them before installing the GirlBoss user trigger.',
      existing_triggers;
  END IF;
END
$preflight$;

CREATE OR REPLACE FUNCTION private.handle_girlboss_auth_user_created()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  account_type text;
  full_name text;
  company_name text;
  selected_role_id uuid;
BEGIN
  account_type := NEW.raw_user_meta_data ->> 'account_type';
  full_name := pg_catalog.btrim(
    COALESCE(NEW.raw_user_meta_data ->> 'full_name', '')
  );
  company_name := pg_catalog.btrim(
    COALESCE(NEW.raw_user_meta_data ->> 'company_name', '')
  );

  IF account_type IS NULL OR account_type NOT IN ('APPLICANT', 'COMPANY') THEN
    RAISE EXCEPTION 'Unsupported public account type';
  END IF;

  IF full_name = '' THEN
    RAISE EXCEPTION 'Full name is required';
  END IF;

  IF account_type = 'COMPANY' AND company_name = '' THEN
    RAISE EXCEPTION 'Company name is required';
  END IF;

  SELECT role_row.id
    INTO selected_role_id
  FROM public.roles AS role_row
  WHERE role_row.role_name = account_type;

  IF selected_role_id IS NULL THEN
    RAISE EXCEPTION 'Configured application role is missing';
  END IF;

  INSERT INTO public.users (id, role_id, full_name)
  VALUES (NEW.id, selected_role_id, full_name);

  IF account_type = 'APPLICANT' THEN
    INSERT INTO public.applicant_profiles (user_id)
    VALUES (NEW.id);
  ELSE
    INSERT INTO public.companies (user_id, company_name)
    VALUES (NEW.id, company_name);
  END IF;

  RETURN NEW;
END
$function$;

REVOKE ALL ON FUNCTION private.handle_girlboss_auth_user_created()
  FROM PUBLIC, anon, authenticated;

CREATE TRIGGER girlboss_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION private.handle_girlboss_auth_user_created();

COMMIT;
