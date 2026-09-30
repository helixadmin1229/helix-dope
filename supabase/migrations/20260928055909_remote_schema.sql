


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."assign_event_seq"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin
  select coalesce(max(seq), -1) + 1 into new.seq
  from workflow_events where workflow_id = new.workflow_id;
  return new;
end;
$$;


ALTER FUNCTION "public"."assign_event_seq"() OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."workflow_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "job_type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "max_attempts" integer DEFAULT 3 NOT NULL,
    "run_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "completed_at" timestamp with time zone,
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    CONSTRAINT "workflow_jobs_job_type_check" CHECK (("job_type" = ANY (ARRAY['run_workflow'::"text", 'run_lens'::"text", 'run_drill'::"text", 'run_opinion'::"text"]))),
    CONSTRAINT "workflow_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'dead'::"text"])))
);


ALTER TABLE "public"."workflow_jobs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_next_job"() RETURNS "public"."workflow_jobs"
    LANGUAGE "plpgsql"
    AS $$
declare
  job workflow_jobs;
begin
  select * into job
  from workflow_jobs
  where status = 'pending'
    and run_at <= now()
  order by run_at asc
  limit 1
  for update skip locked;

  if not found then return null; end if;

  update workflow_jobs
  set status = 'running', started_at = now(), attempts = attempts + 1
  where id = job.id;

  return job;
end;
$$;


ALTER FUNCTION "public"."claim_next_job"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."touch_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    AS $$
begin new.updated_at = now(); return new; end;
$$;


ALTER FUNCTION "public"."touch_updated_at"() OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."drill_reports" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "idea_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "verdict" "text",
    "verdict_reason" "text",
    "competitors" "jsonb" DEFAULT '[]'::"jsonb",
    "gtm" "text",
    "tech_risk" "text",
    "market_risk" "text",
    "arr_12m" "text",
    "mvp_weeks" integer,
    "mvp_team" "text",
    "mvp_cost" "text",
    "summary" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "drill_reports_verdict_check" CHECK (("verdict" = ANY (ARRAY['GO'::"text", 'MAYBE'::"text", 'PASS'::"text"])))
);


ALTER TABLE "public"."drill_reports" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."ideas" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "event_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "tagline" "text",
    "problem" "text",
    "target" "text",
    "gap" "text",
    "signals" "jsonb" DEFAULT '[]'::"jsonb",
    "tags" "jsonb" DEFAULT '[]'::"jsonb",
    "score" integer,
    "confidence" integer,
    "difficulty" "text",
    "market_size" "text",
    "lens" "text",
    "shortlisted" boolean DEFAULT false NOT NULL,
    "skipped" boolean DEFAULT false NOT NULL,
    "decided" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "ideas_difficulty_check" CHECK (("difficulty" = ANY (ARRAY['low'::"text", 'medium'::"text", 'high'::"text"]))),
    CONSTRAINT "ideas_market_size_check" CHECK (("market_size" = ANY (ARRAY['small'::"text", 'medium'::"text", 'large'::"text"])))
);


ALTER TABLE "public"."ideas" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."queue_health" AS
 SELECT "status",
    "job_type",
    "count"(*) AS "count",
    "avg"(EXTRACT(epoch FROM (COALESCE("completed_at", "now"()) - "started_at"))) AS "avg_duration_secs",
    "max"("attempts") AS "max_attempts_seen"
   FROM "public"."workflow_jobs"
  GROUP BY "status", "job_type"
  ORDER BY "status", "job_type";


ALTER VIEW "public"."queue_health" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "seq" bigint NOT NULL,
    "type" "text" NOT NULL,
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "source" "text" DEFAULT 'system'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workflow_events_source_check" CHECK (("source" = ANY (ARRAY['system'::"text", 'llm'::"text", 'human'::"text"])))
);


ALTER TABLE "public"."workflow_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflow_snapshots" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "workflow_id" "uuid" NOT NULL,
    "seq" bigint NOT NULL,
    "state" "jsonb" NOT NULL,
    "event_count" integer NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"()
);


ALTER TABLE "public"."workflow_snapshots" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."workflow_summary" AS
SELECT
    NULL::"uuid" AS "id",
    NULL::"text" AS "session_id",
    NULL::"text" AS "status",
    NULL::"jsonb" AS "input",
    NULL::"jsonb" AS "config",
    NULL::timestamp with time zone AS "created_at",
    NULL::bigint AS "idea_count",
    NULL::bigint AS "shortlisted_count",
    NULL::bigint AS "decided_count",
    NULL::bigint AS "drill_count",
    NULL::bigint AS "event_count",
    NULL::timestamp with time zone AS "last_event_at";


ALTER VIEW "public"."workflow_summary" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."workflow_token_usage" AS
 SELECT "workflow_id",
    "sum"((("payload" ->> 'tokens'::"text"))::integer) AS "total_tokens",
    "count"(*) FILTER (WHERE ("type" = 'TOOL_INVOKED'::"text")) AS "total_tool_calls",
    "count"(*) FILTER (WHERE ("type" = 'SANDBOX_VIOLATION'::"text")) AS "violations",
    "count"(*) FILTER (WHERE ("type" = 'TOOL_FAILED'::"text")) AS "tool_failures"
   FROM "public"."workflow_events"
  WHERE ("type" = ANY (ARRAY['TOKEN_USAGE'::"text", 'TOOL_INVOKED'::"text", 'SANDBOX_VIOLATION'::"text", 'TOOL_FAILED'::"text"]))
  GROUP BY "workflow_id";


ALTER VIEW "public"."workflow_token_usage" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workflows" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "session_id" "text",
    "status" "text" DEFAULT 'running'::"text" NOT NULL,
    "input" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "workflows_status_check" CHECK (("status" = ANY (ARRAY['running'::"text", 'completed'::"text", 'failed'::"text", 'paused'::"text", 'aborted'::"text"])))
);


ALTER TABLE "public"."workflows" OWNER TO "postgres";


ALTER TABLE ONLY "public"."drill_reports"
    ADD CONSTRAINT "drill_reports_idea_id_key" UNIQUE ("idea_id");



ALTER TABLE ONLY "public"."drill_reports"
    ADD CONSTRAINT "drill_reports_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."ideas"
    ADD CONSTRAINT "ideas_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_events"
    ADD CONSTRAINT "workflow_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_events"
    ADD CONSTRAINT "workflow_events_workflow_id_seq_key" UNIQUE ("workflow_id", "seq");



ALTER TABLE ONLY "public"."workflow_jobs"
    ADD CONSTRAINT "workflow_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_snapshots"
    ADD CONSTRAINT "workflow_snapshots_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workflow_snapshots"
    ADD CONSTRAINT "workflow_snapshots_workflow_id_seq_key" UNIQUE ("workflow_id", "seq");



ALTER TABLE ONLY "public"."workflows"
    ADD CONSTRAINT "workflows_pkey" PRIMARY KEY ("id");



CREATE INDEX "ideas_lens" ON "public"."ideas" USING "btree" ("workflow_id", "lens");



CREATE INDEX "ideas_tags" ON "public"."ideas" USING "gin" ("tags");



CREATE INDEX "ideas_workflow" ON "public"."ideas" USING "btree" ("workflow_id");



CREATE INDEX "jobs_pending" ON "public"."workflow_jobs" USING "btree" ("status", "run_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "snapshots_workflow" ON "public"."workflow_snapshots" USING "btree" ("workflow_id", "seq" DESC);



CREATE INDEX "workflow_events_type" ON "public"."workflow_events" USING "btree" ("workflow_id", "type");



CREATE INDEX "workflow_events_workflow_seq" ON "public"."workflow_events" USING "btree" ("workflow_id", "seq");



CREATE OR REPLACE VIEW "public"."workflow_summary" AS
 SELECT "w"."id",
    "w"."session_id",
    "w"."status",
    "w"."input",
    "w"."config",
    "w"."created_at",
    "count"(DISTINCT "i"."id") AS "idea_count",
    "count"(DISTINCT "i"."id") FILTER (WHERE "i"."shortlisted") AS "shortlisted_count",
    "count"(DISTINCT "i"."id") FILTER (WHERE "i"."decided") AS "decided_count",
    "count"(DISTINCT "dr"."id") AS "drill_count",
    "count"(DISTINCT "we"."id") AS "event_count",
    "max"("we"."created_at") AS "last_event_at"
   FROM ((("public"."workflows" "w"
     LEFT JOIN "public"."ideas" "i" ON (("i"."workflow_id" = "w"."id")))
     LEFT JOIN "public"."drill_reports" "dr" ON (("dr"."workflow_id" = "w"."id")))
     LEFT JOIN "public"."workflow_events" "we" ON (("we"."workflow_id" = "w"."id")))
  GROUP BY "w"."id";



CREATE OR REPLACE TRIGGER "workflow_events_seq" BEFORE INSERT ON "public"."workflow_events" FOR EACH ROW EXECUTE FUNCTION "public"."assign_event_seq"();



CREATE OR REPLACE TRIGGER "workflows_touch" BEFORE UPDATE ON "public"."workflows" FOR EACH ROW EXECUTE FUNCTION "public"."touch_updated_at"();



ALTER TABLE ONLY "public"."drill_reports"
    ADD CONSTRAINT "drill_reports_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."workflow_events"("id");



ALTER TABLE ONLY "public"."drill_reports"
    ADD CONSTRAINT "drill_reports_idea_id_fkey" FOREIGN KEY ("idea_id") REFERENCES "public"."ideas"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."drill_reports"
    ADD CONSTRAINT "drill_reports_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."ideas"
    ADD CONSTRAINT "ideas_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "public"."workflow_events"("id");



ALTER TABLE ONLY "public"."ideas"
    ADD CONSTRAINT "ideas_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_events"
    ADD CONSTRAINT "workflow_events_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workflow_jobs"
    ADD CONSTRAINT "workflow_jobs_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id");



ALTER TABLE ONLY "public"."workflow_snapshots"
    ADD CONSTRAINT "workflow_snapshots_workflow_id_fkey" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE CASCADE;



ALTER TABLE "public"."drill_reports" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."ideas" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "svc_drills" ON "public"."drill_reports" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "svc_events" ON "public"."workflow_events" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "svc_ideas" ON "public"."ideas" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "svc_jobs" ON "public"."workflow_jobs" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "svc_snapshots" ON "public"."workflow_snapshots" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "svc_workflows" ON "public"."workflows" USING (("auth"."role"() = 'service_role'::"text"));



CREATE POLICY "users_read_events" ON "public"."workflow_events" FOR SELECT USING (("workflow_id" IN ( SELECT "workflows"."id"
   FROM "public"."workflows"
  WHERE ("workflows"."session_id" = (("current_setting"('request.headers'::"text", true))::"jsonb" ->> 'x-session-id'::"text")))));



CREATE POLICY "users_read_workflows" ON "public"."workflows" FOR SELECT USING (("session_id" = (("current_setting"('request.headers'::"text", true))::"jsonb" ->> 'x-session-id'::"text")));



ALTER TABLE "public"."workflow_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workflow_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workflow_snapshots" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."workflows" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."workflow_events";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."workflow_jobs";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."workflows";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."assign_event_seq"() TO "anon";
GRANT ALL ON FUNCTION "public"."assign_event_seq"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."assign_event_seq"() TO "service_role";



GRANT ALL ON TABLE "public"."workflow_jobs" TO "anon";
GRANT ALL ON TABLE "public"."workflow_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_jobs" TO "service_role";



GRANT ALL ON FUNCTION "public"."claim_next_job"() TO "anon";
GRANT ALL ON FUNCTION "public"."claim_next_job"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_next_job"() TO "service_role";



GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "anon";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."touch_updated_at"() TO "service_role";


















GRANT ALL ON TABLE "public"."drill_reports" TO "anon";
GRANT ALL ON TABLE "public"."drill_reports" TO "authenticated";
GRANT ALL ON TABLE "public"."drill_reports" TO "service_role";



GRANT ALL ON TABLE "public"."ideas" TO "anon";
GRANT ALL ON TABLE "public"."ideas" TO "authenticated";
GRANT ALL ON TABLE "public"."ideas" TO "service_role";



GRANT ALL ON TABLE "public"."queue_health" TO "anon";
GRANT ALL ON TABLE "public"."queue_health" TO "authenticated";
GRANT ALL ON TABLE "public"."queue_health" TO "service_role";



GRANT ALL ON TABLE "public"."workflow_events" TO "anon";
GRANT ALL ON TABLE "public"."workflow_events" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_events" TO "service_role";



GRANT ALL ON TABLE "public"."workflow_snapshots" TO "anon";
GRANT ALL ON TABLE "public"."workflow_snapshots" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_snapshots" TO "service_role";



GRANT ALL ON TABLE "public"."workflow_summary" TO "anon";
GRANT ALL ON TABLE "public"."workflow_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_summary" TO "service_role";



GRANT ALL ON TABLE "public"."workflow_token_usage" TO "anon";
GRANT ALL ON TABLE "public"."workflow_token_usage" TO "authenticated";
GRANT ALL ON TABLE "public"."workflow_token_usage" TO "service_role";



GRANT ALL ON TABLE "public"."workflows" TO "anon";
GRANT ALL ON TABLE "public"."workflows" TO "authenticated";
GRANT ALL ON TABLE "public"."workflows" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































drop extension if exists "pg_net";


