"""
SQL schemata for the application DBs
"""

from app.config import db_vars

db_schema = {}

# Create main tables
db_schema["postgres_schema"] = """
CREATE SCHEMA {postgres_schema};
REVOKE ALL ON SCHEMA {postgres_schema} FROM public;
SET SCHEMA '{postgres_schema}';
""".format(**db_vars)

db_schema["paper_table"] = """
CREATE TABLE {paper_table}
(
        id TEXT NOT NULL,
        title TEXT,
        sections TEXT,
        locked BOOLEAN,
        annotation_pass INTEGER,
        last_modified TIMESTAMP WITH TIME ZONE,
        PRIMARY KEY (id)
);
""".format(**db_vars)

db_schema["sentence_table"] = """
CREATE TABLE {sentence_table}
(
        id SERIAL NOT NULL,
        line_num INTEGER,
        sentence TEXT,
        paper_id TEXT,
        PRIMARY KEY (id),
        FOREIGN KEY(paper_id) REFERENCES {paper_table} (id)
);
""".format(**db_vars)

db_schema["context_table"] = """
CREATE TABLE {context_table}
(
        id SERIAL NOT NULL,
        line_num INTEGER,
        interval_start INTEGER,
        interval_end INTEGER,
        type TEXT,
        paper_id TEXT,
        free_text TEXT,
        PRIMARY KEY (id),
        FOREIGN KEY(paper_id) REFERENCES {paper_table} (id),
        FOREIGN KEY(free_text) REFERENCES {grounding_text_table} (free_text)
);
CREATE INDEX {context_table}_free_text_idx ON {context_table} (free_text);
""".format(**db_vars)

db_schema["event_table"] = """
CREATE TABLE {event_table}
(
        id SERIAL NOT NULL,
        line_num INTEGER,
        interval_start INTEGER,
        interval_end INTEGER,
        type TEXT,
        paper_id TEXT,
        false_positive BOOLEAN,
        PRIMARY KEY (id),
        FOREIGN KEY(paper_id) REFERENCES {paper_table} (id)
);
""".format(**db_vars)

db_schema["grounding_table"] = """
CREATE TABLE {grounding_table}
(
        id TEXT NOT NULL,
        PRIMARY KEY (id)
);
""".format(**db_vars)

db_schema["grounding_text_table"] = """
CREATE TABLE {grounding_text_table}
(
        free_text TEXT NOT NULL,
        grounding_id TEXT NOT NULL,
        PRIMARY KEY (free_text),
        FOREIGN KEY(grounding_id) REFERENCES {grounding_table} (id)
);
CREATE INDEX {grounding_text_table}_grounding_id_idx ON {grounding_text_table} (grounding_id);
""".format(**db_vars)

db_schema["comment_table"] = """
CREATE TABLE {comment_table}
(
        id SERIAL NOT NULL,
        comment TEXT,
        paper_id TEXT,
        PRIMARY KEY (id),
        FOREIGN KEY(paper_id) REFERENCES {paper_table} (id)
);
""".format(**db_vars)

db_schema["association_table"] = """
CREATE TABLE {association_table}
(
        event_id INTEGER NOT NULL,
        grounding_id TEXT NOT NULL,
        PRIMARY KEY (event_id, grounding_id),
        FOREIGN KEY(event_id) REFERENCES {event_table} (id),
        FOREIGN KEY(grounding_id) REFERENCES {grounding_table} (id)
);
""".format(**db_vars)

# Audit log triggers
# https://github.com/2ndQuadrant/audit-trigger/
db_schema["hstore_setup"] = """
CREATE EXTENSION IF NOT EXISTS hstore WITH SCHEMA pg_catalog;
"""
db_schema["audit_setup"] = """
-- An audit history is important on most tables. Provide an audit trigger that logs to
-- a dedicated audit table for the major relations.
--
-- This file should be generic and not depend on application roles or structures,
-- as it's being listed here:
--
--    https://wiki.postgresql.org/wiki/Audit_trigger_91plus
--
-- This trigger was originally based on
--   http://wiki.postgresql.org/wiki/Audit_trigger
-- but has been completely rewritten.
--
-- Should really be converted into a relocatable EXTENSION, with control and upgrade files.

CREATE SCHEMA audit;
REVOKE ALL ON SCHEMA audit FROM PUBLIC;

COMMENT ON SCHEMA audit IS 'Out-of-table audit/history logging tables and trigger functions';

--
-- Audited data. Lots of information is available, it's just a matter of how much
-- you really want to record. See:
--
--   http://www.postgresql.org/docs/9.1/static/functions-info.html
--
-- Remember, every column you add takes up more audit table space and slows audit
-- inserts.
--
-- Every index you add has a big impact too, so avoid adding indexes to the
-- audit table unless you REALLY need them. The hstore GIST indexes are
-- particularly expensive.
--
-- It is sometimes worth copying the audit table, or a coarse subset of it that
-- you're interested in, into a temporary table where you CREATE any useful
-- indexes and do your analysis.
--
CREATE TABLE audit.logged_actions (
    event_id BIGSERIAL PRIMARY KEY,
    schema_name TEXT NOT NULL,
    table_name TEXT NOT NULL,
    relid OID NOT NULL,
    session_user_name TEXT,
    action_tstamp_tx TIMESTAMP WITH TIME ZONE NOT NULL,
    action_tstamp_stm TIMESTAMP WITH TIME ZONE NOT NULL,
    action_tstamp_clk TIMESTAMP WITH TIME ZONE NOT NULL,
    transaction_id BIGINT,
    application_name TEXT,
    client_addr INET,
    client_port INTEGER,
    client_query TEXT,
    action TEXT NOT NULL CHECK (action IN ('I','D','U', 'T')),
    row_data hstore,
    changed_fields hstore,
    statement_only BOOLEAN NOT NULL
);

REVOKE ALL ON audit.logged_actions FROM PUBLIC;

COMMENT ON TABLE audit.logged_actions IS 'History of auditable actions on audited tables, from audit.if_modified_func()';
COMMENT ON COLUMN audit.logged_actions.event_id IS 'Unique identifier for each auditable event';
COMMENT ON COLUMN audit.logged_actions.schema_name IS 'Database schema audited table for this event is in';
COMMENT ON COLUMN audit.logged_actions.table_name IS 'Non-schema-qualified table name of table event occured in';
COMMENT ON COLUMN audit.logged_actions.relid IS 'Table OID. Changes with drop/create. Get with ''tablename''::regclass';
COMMENT ON COLUMN audit.logged_actions.session_user_name IS 'Login / session user whose statement caused the audited event';
COMMENT ON COLUMN audit.logged_actions.action_tstamp_tx IS 'Transaction start timestamp for tx in which audited event occurred';
COMMENT ON COLUMN audit.logged_actions.action_tstamp_stm IS 'Statement start timestamp for tx in which audited event occurred';
COMMENT ON COLUMN audit.logged_actions.action_tstamp_clk IS 'Wall clock time at which audited event''s trigger call occurred';
COMMENT ON COLUMN audit.logged_actions.transaction_id IS 'Identifier of transaction that made the change. May wrap, but unique paired with action_tstamp_tx.';
COMMENT ON COLUMN audit.logged_actions.client_addr IS 'IP address of client that issued query. Null for unix domain socket.';
COMMENT ON COLUMN audit.logged_actions.client_port IS 'Remote peer IP port address of client that issued query. Undefined for unix socket.';
COMMENT ON COLUMN audit.logged_actions.client_query IS 'Top-level query that caused this auditable event. May be more than one statement.';
COMMENT ON COLUMN audit.logged_actions.application_name IS 'Application name set when this audit event occurred. Can be changed in-session by client.';
COMMENT ON COLUMN audit.logged_actions.action IS 'Action type; I = insert, D = delete, U = update, T = truncate';
COMMENT ON COLUMN audit.logged_actions.row_data IS 'Record value. Null for statement-level trigger. For INSERT this is the new tuple. For DELETE and UPDATE it is the old tuple.';
COMMENT ON COLUMN audit.logged_actions.changed_fields IS 'New values of fields changed by UPDATE. Null except for row-level UPDATE events.';
COMMENT ON COLUMN audit.logged_actions.statement_only IS '''t'' if audit event is from an FOR EACH STATEMENT trigger, ''f'' for FOR EACH ROW';

CREATE INDEX logged_actions_relid_idx ON audit.logged_actions(relid);
CREATE INDEX logged_actions_action_tstamp_tx_stm_idx ON audit.logged_actions(action_tstamp_stm);
CREATE INDEX logged_actions_action_idx ON audit.logged_actions(action);

CREATE OR REPLACE FUNCTION audit.if_modified_func() RETURNS TRIGGER AS $body$
DECLARE
    audit_row audit.logged_actions;
    include_values BOOLEAN;
    log_diffs BOOLEAN;
    h_old hstore;
    h_new hstore;
    excluded_cols TEXT[] = ARRAY[]::TEXT[];
BEGIN
    IF TG_WHEN <> 'AFTER' THEN
        RAISE EXCEPTION 'audit.if_modified_func() may only run as an AFTER trigger';
    END IF;

    audit_row = ROW(
        nextval('audit.logged_actions_event_id_seq'), -- event_id
        TG_TABLE_SCHEMA::TEXT,                        -- schema_name
        TG_TABLE_NAME::TEXT,                          -- table_name
        TG_RELID,                                     -- relation OID for much quicker searches
        session_user::TEXT,                           -- session_user_name
        current_timestamp,                            -- action_tstamp_tx
        statement_timestamp(),                        -- action_tstamp_stm
        clock_timestamp(),                            -- action_tstamp_clk
        txid_current(),                               -- transaction ID
        current_setting('application_name'),          -- client application
        inet_client_addr(),                           -- client_addr
        inet_client_port(),                           -- client_port
        current_query(),                              -- top-level query or queries (if multistatement) from client
        substring(TG_OP,1,1),                         -- action
        NULL, NULL,                                   -- row_data, changed_fields
        'f'                                           -- statement_only
        );

    IF NOT TG_ARGV[0]::BOOLEAN IS DISTINCT FROM 'f'::BOOLEAN THEN
        audit_row.client_query = NULL;
    END IF;

    IF TG_ARGV[1] IS NOT NULL THEN
        excluded_cols = TG_ARGV[1]::TEXT[];
    END IF;

    IF (TG_OP = 'UPDATE' AND TG_LEVEL = 'ROW') THEN
        audit_row.row_data = hstore(OLD.*) - excluded_cols;
        audit_row.changed_fields =  (hstore(NEW.*) - audit_row.row_data) - excluded_cols;
        IF audit_row.changed_fields = hstore('') THEN
            -- All changed fields are ignored. Skip this update.
            RETURN NULL;
        END IF;
    ELSIF (TG_OP = 'DELETE' AND TG_LEVEL = 'ROW') THEN
        audit_row.row_data = hstore(OLD.*) - excluded_cols;
    ELSIF (TG_OP = 'INSERT' AND TG_LEVEL = 'ROW') THEN
        audit_row.row_data = hstore(NEW.*) - excluded_cols;
    ELSIF (TG_LEVEL = 'STATEMENT' AND TG_OP IN ('INSERT','UPDATE','DELETE','TRUNCATE')) THEN
        audit_row.statement_only = 't';
    ELSE
        RAISE EXCEPTION '[audit.if_modified_func] - Trigger func added as trigger for unhandled case: %, %',TG_OP, TG_LEVEL;
        RETURN NULL;
    END IF;
    INSERT INTO audit.logged_actions VALUES (audit_row.*);
    RETURN NULL;
END;
$body$
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public;


COMMENT ON FUNCTION audit.if_modified_func() IS $body$
Track changes to a table at the statement and/or row level.

Optional parameters to trigger in CREATE TRIGGER call:

param 0: boolean, whether to log the query text. Default 't'.

param 1: text[], columns to ignore in updates. Default [].

         Updates to ignored cols are omitted from changed_fields.

         Updates with only ignored cols changed are not inserted
         into the audit log.

         Almost all the processing work is still done for updates
         that ignored. If you need to save the load, you need to use
         WHEN clause on the trigger instead.

         No warning or error is issued if ignored_cols contains columns
         that do not exist in the target table. This lets you specify
         a standard set of ignored columns.

There is no parameter to disable logging of values. Add this trigger as
a 'FOR EACH STATEMENT' rather than 'FOR EACH ROW' trigger if you do not
want to log row values.

Note that the user name logged is the login role for the session. The audit trigger
cannot obtain the active role because it is reset by the SECURITY DEFINER invocation
of the audit trigger its self.
$body$;



CREATE OR REPLACE FUNCTION audit.audit_table(target_table REGCLASS, audit_rows BOOLEAN, audit_query_text BOOLEAN, ignored_cols TEXT[]) RETURNS VOID AS $body$
DECLARE
  stm_targets TEXT = 'INSERT OR UPDATE OR DELETE OR TRUNCATE';
  _q_txt TEXT;
  _ignored_cols_snip TEXT = '';
BEGIN
    EXECUTE 'DROP TRIGGER IF EXISTS audit_trigger_row ON ' || quote_ident(target_table::TEXT);
    EXECUTE 'DROP TRIGGER IF EXISTS audit_trigger_stm ON ' || quote_ident(target_table::TEXT);

    IF audit_rows THEN
        IF array_length(ignored_cols,1) > 0 THEN
            _ignored_cols_snip = ', ' || quote_literal(ignored_cols);
        END IF;
        _q_txt = 'CREATE TRIGGER audit_trigger_row AFTER INSERT OR UPDATE OR DELETE ON ' ||
                 quote_ident(target_table::TEXT) ||
                 ' FOR EACH ROW EXECUTE PROCEDURE audit.if_modified_func(' ||
                 quote_literal(audit_query_text) || _ignored_cols_snip || ');';
        RAISE NOTICE '%',_q_txt;
        EXECUTE _q_txt;
        stm_targets = 'TRUNCATE';
    ELSE
    END IF;

    _q_txt = 'CREATE TRIGGER audit_trigger_stm AFTER ' || stm_targets || ' ON ' ||
             target_table ||
             ' FOR EACH STATEMENT EXECUTE PROCEDURE audit.if_modified_func('||
             quote_literal(audit_query_text) || ');';
    RAISE NOTICE '%',_q_txt;
    EXECUTE _q_txt;

END;
$body$
LANGUAGE 'plpgsql';

COMMENT ON FUNCTION audit.audit_table(REGCLASS, BOOLEAN, BOOLEAN, TEXT[]) IS $body$
Add auditing support to a table.

Arguments:
   target_table:     Table name, schema qualified if not on search_path
   audit_rows:       Record each row change, or only audit at a statement level
   audit_query_text: Record the text of the client query that triggered the audit event?
   ignored_cols:     Columns to exclude from update diffs, ignore updates that change only ignored cols.
$body$;

-- Pg doesn't allow variadic calls with 0 params, so provide a wrapper
CREATE OR REPLACE FUNCTION audit.audit_table(target_table REGCLASS, audit_rows BOOLEAN, audit_query_text BOOLEAN) RETURNS VOID AS $body$
SELECT audit.audit_table($1, $2, $3, ARRAY[]::TEXT[]);
$body$ LANGUAGE SQL;

-- And provide a convenience call wrapper for the simplest case
-- of row-level logging with no excluded cols and query logging enabled.
--
CREATE OR REPLACE FUNCTION audit.audit_table(target_table REGCLASS) RETURNS VOID AS $body$
SELECT audit.audit_table($1, BOOLEAN 't', BOOLEAN 't');
$body$ LANGUAGE 'sql';

COMMENT ON FUNCTION audit.audit_table(REGCLASS) IS $body$
Add auditing support to the given table. Row-level changes will be logged with full client query text. No cols are ignored.
$body$;
"""

db_schema["audit_triggers"] = """
SELECT audit.audit_table('{paper_table}');
SELECT audit.audit_table('{sentence_table}');
SELECT audit.audit_table('{context_table}');
SELECT audit.audit_table('{event_table}');
SELECT audit.audit_table('{grounding_table}');
SELECT audit.audit_table('{comment_table}');
SELECT audit.audit_table('{grounding_text_table}');
SELECT audit.audit_table('{association_table}');
""".format(**db_vars)

# Role/permissions for app user, creating it if it doesn't exist
db_schema["app_role"] = """
DO
$body$
BEGIN
  IF NOT EXISTS (
    SELECT *
    FROM   pg_catalog.pg_user
    WHERE  usename = '{postgres_login}') THEN

    CREATE ROLE {postgres_login} LOGIN
      NOSUPERUSER INHERIT NOCREATEDB NOCREATEROLE NOREPLICATION;
  END IF;
END $body$;
""".format(**db_vars)

db_schema["app_permissions"] = """
DO $$
DECLARE db name;
BEGIN
  db := current_database();
  EXECUTE 'GRANT CONNECT, TEMPORARY ON DATABASE ' || quote_ident(db) || ' TO {postgres_login}';
END$$;

GRANT USAGE ON SCHEMA {postgres_schema} TO {postgres_login};
GRANT ALL ON ALL TABLES IN SCHEMA {postgres_schema} TO {postgres_login};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA {postgres_schema} TO {postgres_login};

GRANT USAGE ON SCHEMA audit TO {postgres_login};
GRANT SELECT, INSERT ON audit.logged_actions TO {postgres_login};
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA audit TO {postgres_login};
""".format(**db_vars)

# Last modified trigger
# noinspection SqlNoDataSourceInspection
db_schema["modified_setup"] = """
CREATE OR REPLACE FUNCTION update_paper_modified()
RETURNS TRIGGER AS $$
DECLARE
  paper_id TEXT;
  return_val RECORD;
BEGIN
  -- Pick up a valid paper_id based on the operation performed
  IF (TG_OP = 'DELETE') THEN
    paper_id = OLD.paper_id;
    return_val = OLD;
  ELSE
    paper_id = NEW.paper_id;
    return_val = NEW;
  END IF;

  UPDATE {paper_table} SET last_modified = now() WHERE id = paper_id;
  RETURN return_val;
END;
$$ LANGUAGE 'plpgsql';

CREATE OR REPLACE FUNCTION update_paper_modified_associations()
RETURNS TRIGGER AS $$
DECLARE
  paper_id TEXT;
  return_val RECORD;
BEGIN
  -- Modified version of the trigger for event-grounding associations
  IF (TG_OP = 'DELETE') THEN
    paper_id := (SELECT t.paper_id FROM {event_table} t WHERE t.id = OLD.event_id);
    return_val = OLD;
  ELSE
    paper_id := (SELECT t.paper_id FROM {event_table} t WHERE t.id = NEW.event_id);
    return_val = NEW;
  END IF;

  UPDATE {paper_table} SET last_modified = now() WHERE id = paper_id;
  RETURN return_val;
END;
$$ LANGUAGE 'plpgsql';
""".format(**db_vars)
db_schema["modified_triggers"] = """
-- Create the triggers on every table with paper_id as a foreign key
DROP TRIGGER IF EXISTS modified_trigger ON {sentence_table};
CREATE TRIGGER modified_trigger BEFORE INSERT OR UPDATE OR DELETE
ON {sentence_table} FOR EACH ROW EXECUTE PROCEDURE update_paper_modified();

DROP TRIGGER IF EXISTS modified_trigger ON {context_table};
CREATE TRIGGER modified_trigger BEFORE INSERT OR UPDATE OR DELETE
ON {context_table} FOR EACH ROW EXECUTE PROCEDURE update_paper_modified();

DROP TRIGGER IF EXISTS modified_trigger ON {event_table};
CREATE TRIGGER modified_trigger BEFORE INSERT OR UPDATE OR DELETE
ON {event_table} FOR EACH ROW EXECUTE PROCEDURE update_paper_modified();

DROP TRIGGER IF EXISTS modified_trigger ON {comment_table};
CREATE TRIGGER modified_trigger BEFORE INSERT OR UPDATE OR DELETE
ON {comment_table} FOR EACH ROW EXECUTE PROCEDURE update_paper_modified();

DROP TRIGGER IF EXISTS modified_trigger ON {association_table};
CREATE TRIGGER modified_trigger BEFORE INSERT OR UPDATE OR DELETE
ON {association_table} FOR EACH ROW EXECUTE PROCEDURE update_paper_modified_associations();
""".format(**db_vars)