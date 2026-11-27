BEGIN;

DO $preflight$
DECLARE
  duplicate_pairs bigint;
  applicant_id_attnum smallint;
  job_id_attnum smallint;
  unique_constraint_name text;
  document_id_attnum smallint;
  document_fk_name text;
  document_fk_delete_action "char";
  matching_document_fks integer;
BEGIN
  IF to_regclass('public.applications') IS NULL
     OR to_regclass('public.application_document_links') IS NULL
     OR to_regclass('public.application_documents') IS NULL
     OR to_regclass('public.applicant_profiles') IS NULL
     OR to_regclass('public.jobs') IS NULL THEN
    RAISE EXCEPTION
      'Applications migration prerequisites are missing; no schema changes were applied.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'jobs'
      AND column_name = 'deadline'
      AND data_type = 'date'
      AND is_nullable = 'YES'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'applications'
      AND column_name = 'status'
      AND data_type = 'text'
      AND is_nullable = 'NO'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'applications'
      AND column_name = 'submitted_at'
      AND data_type = 'timestamp with time zone'
      AND is_nullable = 'NO'
  ) THEN
    RAISE EXCEPTION
      'Applications migration prerequisite column types/nullability differ from the verified schema.';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_proc AS existing_function
    JOIN pg_catalog.pg_namespace AS existing_schema
      ON existing_schema.oid = existing_function.pronamespace
    WHERE existing_schema.nspname = 'public'
      AND existing_function.proname = 'submit_job_application'
  ) THEN
    RAISE EXCEPTION
      'A public.submit_job_application function already exists. Review it before installing this RPC.';
  END IF;

  SELECT count(*)
    INTO duplicate_pairs
  FROM (
    SELECT applicant_id, job_id
    FROM public.applications
    GROUP BY applicant_id, job_id
    HAVING count(*) > 1
  ) AS existing_duplicates;

  IF duplicate_pairs > 0 THEN
    RAISE EXCEPTION
      'Cannot add one-application-per-job constraint: % duplicate applicant/job pair(s) exist. Review and resolve them explicitly; this migration does not delete or merge applications.',
      duplicate_pairs;
  END IF;

  SELECT attnum
    INTO applicant_id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.applications'::regclass
    AND attname = 'applicant_id'
    AND NOT attisdropped;

  SELECT attnum
    INTO job_id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.applications'::regclass
    AND attname = 'job_id'
    AND NOT attisdropped;

  IF applicant_id_attnum IS NULL OR job_id_attnum IS NULL THEN
    RAISE EXCEPTION
      'Cannot identify applications applicant_id/job_id columns for unique constraint.';
  END IF;

  SELECT conname
    INTO unique_constraint_name
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.applications'::regclass
    AND contype IN ('u', 'p')
    AND cardinality(conkey) = 2
    AND conkey @> ARRAY[applicant_id_attnum, job_id_attnum]::smallint[]
    AND conkey <@ ARRAY[applicant_id_attnum, job_id_attnum]::smallint[]
  LIMIT 1;

  IF unique_constraint_name IS NULL THEN
    IF EXISTS (
      SELECT 1
      FROM pg_catalog.pg_constraint
      WHERE conrelid = 'public.applications'::regclass
        AND conname = 'applications_applicant_job_unique'
    ) THEN
      RAISE EXCEPTION
        'Constraint name applications_applicant_job_unique already exists with a different definition.';
    END IF;

    ALTER TABLE public.applications
      ADD CONSTRAINT applications_applicant_job_unique
      UNIQUE (applicant_id, job_id);
  END IF;

  SELECT attnum
    INTO document_id_attnum
  FROM pg_catalog.pg_attribute
  WHERE attrelid = 'public.application_document_links'::regclass
    AND attname = 'document_id'
    AND NOT attisdropped;

  IF document_id_attnum IS NULL THEN
    RAISE EXCEPTION
      'Cannot identify application_document_links.document_id for FK update.';
  END IF;

  SELECT count(*)
    INTO matching_document_fks
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.application_document_links'::regclass
    AND contype = 'f'
    AND confrelid = 'public.application_documents'::regclass
    AND cardinality(conkey) = 1
    AND conkey = ARRAY[document_id_attnum]::smallint[];

  IF matching_document_fks <> 1 THEN
    RAISE EXCEPTION
      'Expected exactly one FK from application_document_links.document_id to application_documents; found %. Review actual constraints before applying.',
      matching_document_fks;
  END IF;

  SELECT conname, confdeltype
    INTO document_fk_name, document_fk_delete_action
  FROM pg_catalog.pg_constraint
  WHERE conrelid = 'public.application_document_links'::regclass
    AND contype = 'f'
    AND confrelid = 'public.application_documents'::regclass
    AND cardinality(conkey) = 1
    AND conkey = ARRAY[document_id_attnum]::smallint[];

  IF document_fk_delete_action = 'c' THEN
    EXECUTE format(
      'ALTER TABLE public.application_document_links DROP CONSTRAINT %I',
      document_fk_name
    );
    ALTER TABLE public.application_document_links
      ADD CONSTRAINT application_document_links_document_id_fkey
      FOREIGN KEY (document_id)
      REFERENCES public.application_documents(id)
      ON DELETE RESTRICT;
  ELSIF document_fk_delete_action <> 'r' THEN
    RAISE EXCEPTION
      'The document FK % has delete action code %, expected CASCADE or RESTRICT. No automatic FK replacement was attempted.',
      document_fk_name,
      document_fk_delete_action;
  END IF;
END
$preflight$;

CREATE FUNCTION public.submit_job_application(
  p_applicant_id uuid,
  p_job_id uuid,
  p_document_id uuid,
  p_cover_letter text DEFAULT NULL
)
RETURNS TABLE (
  application_id uuid,
  applicant_id uuid,
  job_id uuid,
  cover_letter text,
  status text,
  submitted_at timestamp with time zone,
  document_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  selected_job_status text;
  selected_job_deadline date;
  selected_document_id uuid;
  created_application_id uuid;
  created_status text;
  created_submitted_at timestamp with time zone;
BEGIN
  IF p_applicant_id IS NULL OR p_job_id IS NULL OR p_document_id IS NULL THEN
    RAISE EXCEPTION USING
      ERRCODE = '22004',
      MESSAGE = 'Applicant, job, and CV identifiers are required.';
  END IF;

  PERFORM 1
  FROM public.applicant_profiles AS applicant
  WHERE applicant.id = p_applicant_id
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Applicant profile was not found.';
  END IF;

  SELECT job.status, job.deadline
    INTO selected_job_status, selected_job_deadline
  FROM public.jobs AS job
  WHERE job.id = p_job_id
  FOR SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'Job was not found.';
  END IF;

  IF selected_job_status IS DISTINCT FROM 'ACTIVE' THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'Applications can only be submitted to active jobs.';
  END IF;

  IF selected_job_deadline IS NOT NULL
     AND selected_job_deadline < (pg_catalog.now() AT TIME ZONE 'UTC')::date THEN
    RAISE EXCEPTION USING
      ERRCODE = '23514',
      MESSAGE = 'The job application deadline has passed.';
  END IF;

  SELECT document.id
    INTO selected_document_id
  FROM public.application_documents AS document
  WHERE document.id = p_document_id
    AND document.applicant_id = p_applicant_id
    AND document.storage_key LIKE p_applicant_id::text || '/cvs/%'
    AND document.mime_type IN (
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    )
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0002',
      MESSAGE = 'An owned CV document was not found.';
  END IF;

  INSERT INTO public.applications AS inserted_application (
    applicant_id,
    job_id,
    cover_letter,
    status
  )
  VALUES (
    p_applicant_id,
    p_job_id,
    p_cover_letter,
    'TERKIRIM'
  )
  RETURNING
    inserted_application.id,
    inserted_application.status,
    inserted_application.submitted_at
    INTO created_application_id, created_status, created_submitted_at;

  INSERT INTO public.application_document_links (
    application_id,
    document_id
  )
  VALUES (
    created_application_id,
    selected_document_id
  );

  RETURN QUERY
  SELECT
    created_application_id,
    p_applicant_id,
    p_job_id,
    p_cover_letter,
    created_status,
    created_submitted_at,
    selected_document_id;
END
$function$;

REVOKE ALL ON FUNCTION public.submit_job_application(uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.submit_job_application(uuid, uuid, uuid, text)
  TO service_role;

COMMIT;
