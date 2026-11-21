-- Replace both values with IDs of existing test accounts before running.
-- Run only after applying both auth migrations, then roll back this test transaction.
BEGIN;

SELECT pg_catalog.set_config(
  'girlboss.test.applicant_id',
  'REPLACE_WITH_APPLICANT_USER_UUID',
  true
);
SELECT pg_catalog.set_config(
  'girlboss.test.company_id',
  'REPLACE_WITH_COMPANY_USER_UUID',
  true
);

SET LOCAL ROLE authenticated;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  pg_catalog.current_setting('girlboss.test.applicant_id'),
  true
);

DO $applicant_checks$
DECLARE
  own_users integer;
  other_users integer;
  visible_applicant_profiles integer;
  own_applicant_profiles integer;
  visible_companies integer;
  visible_roles integer;
BEGIN
  SELECT pg_catalog.count(*) INTO own_users
  FROM public.users
  WHERE id = auth.uid();

  SELECT pg_catalog.count(*) INTO other_users
  FROM public.users
  WHERE id <> auth.uid();

  SELECT pg_catalog.count(*) INTO visible_applicant_profiles
  FROM public.applicant_profiles;

  SELECT pg_catalog.count(*) INTO own_applicant_profiles
  FROM public.applicant_profiles
  WHERE user_id = auth.uid();

  SELECT pg_catalog.count(*) INTO visible_companies
  FROM public.companies;

  SELECT pg_catalog.count(*) INTO visible_roles
  FROM public.roles;

  IF own_users <> 1 OR other_users <> 0 OR visible_applicant_profiles <> 1
    OR own_applicant_profiles <> 1
    OR visible_companies <> 0 OR visible_roles < 3 THEN
    RAISE EXCEPTION 'Applicant SELECT policy checks failed';
  END IF;

  BEGIN
    UPDATE public.users SET role_id = role_id WHERE id = auth.uid();
    RAISE EXCEPTION 'Authenticated applicant unexpectedly updated public.users';
  EXCEPTION
    WHEN insufficient_privilege THEN NULL;
  END;
END
$applicant_checks$;

SELECT pg_catalog.set_config(
  'request.jwt.claim.sub',
  pg_catalog.current_setting('girlboss.test.company_id'),
  true
);

DO $company_checks$
DECLARE
  own_users integer;
  other_users integer;
  visible_companies integer;
  own_companies integer;
  visible_applicant_profiles integer;
BEGIN
  SELECT pg_catalog.count(*) INTO own_users
  FROM public.users
  WHERE id = auth.uid();

  SELECT pg_catalog.count(*) INTO other_users
  FROM public.users
  WHERE id <> auth.uid();

  SELECT pg_catalog.count(*) INTO visible_companies
  FROM public.companies;

  SELECT pg_catalog.count(*) INTO own_companies
  FROM public.companies
  WHERE user_id = auth.uid();

  SELECT pg_catalog.count(*) INTO visible_applicant_profiles
  FROM public.applicant_profiles;

  IF own_users <> 1 OR other_users <> 0 OR visible_companies <> 1
    OR own_companies <> 1
    OR visible_applicant_profiles <> 0 THEN
    RAISE EXCEPTION 'Company SELECT policy checks failed';
  END IF;
END
$company_checks$;

ROLLBACK;
