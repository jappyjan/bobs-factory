-- Proposed read-only schema guard, not executed by this read-only audit.
-- Invoke only after exact canonical marker/regular-file/SQLite-header fs guard.
-- OPENCODE_DISABLE_MODELS_FETCH=1 is required for this native db command too.
WITH expected(name, created_at, sql_hash) AS (
  VALUES
    ('20260127222353_familiar_lady_ursula', 1769552633000, '30e179e4c29b97cc6ee462ba7b7156113f2ee2d9b5ba302dac93c7d8baa60578'),
    ('20260211171708_add_project_commands', 1770830228000, 'd8dd043540753fd59122af8ee190f04677315c5d6d06356ae407472d5f9b6a12'),
    ('20260213144116_wakeful_the_professor', 1770993676000, '738a920a0fd2afd341bca9fe98cadb216084bd7c8523180e13286ef1e322eb50'),
    ('20260225215848_workspace', 1772056728000, '1b63add3b6fd46b2ca686b0a2c65c0a11a902f574b286cb0820d7f88ad4103d4'),
    ('20260227213759_add_session_workspace_id', 1772228279000, '08353511afa89d1854e61ab0e850ef7271f9757643f74de4cc8d1a5a8b31b1ab'),
    ('20260228203230_blue_harpoon', 1772310750000, '66bf50d953d8efb7294dce096b25acc44a5ecae5cd2f539cea9473c5ef7e884a'),
    ('20260303231226_add_workspace_fields', 1772579546000, '9366bd1666d87aec401b6cb90143ffc339d0fdbabec738d7b487b7ac8cefb2dd'),
    ('20260309230000_move_org_to_state', 1773097200000, 'dd3502975c9f78fa43dad7f4a9c3d57f4094fe949926f844cc8974fd74476520'),
    ('20260312043431_session_message_cursor', 1773290071000, '71bbfd6f63313f47f52c3f3e1c4de40033eeec6281a98f1eaf66dff2ce43fd84')
), actual AS (
  SELECT name, created_at, hash FROM "__drizzle_migrations" LIMIT 10
)
SELECT
  CASE WHEN
    (SELECT count(*) FROM actual) = 9
    AND NOT EXISTS (
      SELECT 1 FROM expected e WHERE NOT EXISTS (
        SELECT 1 FROM actual a
        WHERE a.name = e.name AND a.created_at = e.created_at
          AND (a.hash = '' OR a.hash = e.sql_hash)
      )
    )
    AND (SELECT count(*) FROM pragma_table_info('__drizzle_migrations')) = 5
    AND (SELECT count(*) FROM pragma_table_info('__drizzle_migrations')
         WHERE (name = 'id' AND upper(type) = 'INTEGER' AND pk = 1)
            OR (name = 'hash' AND upper(type) = 'TEXT' AND "notnull" = 1)
            OR (name = 'created_at' AND upper(type) = 'NUMERIC')
            OR (name IN ('name', 'applied_at') AND upper(type) = 'TEXT')) = 5
    AND (SELECT count(*) FROM sqlite_schema
         WHERE type = 'table' AND name IN (
           '__drizzle_migrations', 'account_state', 'permission', 'session')) = 4
    AND (SELECT count(*) FROM pragma_table_info('account_state')
         WHERE name IN ('id', 'active_account_id', 'active_org_id')) = 3
    AND (SELECT count(*) FROM pragma_table_info('permission')
         WHERE name IN ('project_id', 'data')) = 2
    AND (SELECT count(*) FROM pragma_table_info('session')
         WHERE name IN ('id', 'project_id', 'permission')) = 3
  THEN 1 ELSE 0 END AS supportedSchema,
  (SELECT substr(file, 1, 4097) FROM pragma_database_list WHERE name = 'main')
    AS nativeDatabase;
