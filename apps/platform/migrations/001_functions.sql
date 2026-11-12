-- Trigger functions every table uses (docs/architecture/database.md).

-- Keeps updated_at current so no query can forget it.
CREATE FUNCTION set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END $$;

-- History and audit rows are never edited. A future data fix says so with DISABLE TRIGGER.
CREATE FUNCTION forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END $$;

-- Roll back:
--   DROP FUNCTION forbid_change(), set_updated_at();
