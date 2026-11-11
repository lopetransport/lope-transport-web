begin;
-- Run as the database owner. Both scripts are repeatable initial migrations.
CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA extensions;
SET LOCAL search_path = pg_catalog, public, extensions;
CREATE SCHEMA IF NOT EXISTS tms;
CREATE TABLE IF NOT EXISTS tms.vehicles (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 unique_id text NOT NULL UNIQUE CHECK(length(unique_id) BETWEEN 1 AND 128),
 name text NOT NULL, vin text UNIQUE, registration text UNIQUE, make text, model text,
 fuel_capacity_l numeric CHECK(fuel_capacity_l > 0),
 odometer_m double precision NOT NULL DEFAULT 0 CHECK(odometer_m >= 0),
 engine_hours double precision NOT NULL DEFAULT 0 CHECK(engine_hours >= 0),
 last_device_time timestamptz, last_point geometry(Point,4326),
 last_ignition boolean, last_speed_kmh double precision,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS tms.geofences (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 name text NOT NULL CHECK(length(name) BETWEEN 1 AND 200),
 category text NOT NULL CHECK(category IN ('DEPOT','CLIENT','RISK')),
 polygon geometry(Polygon,4326), center geometry(Point,4326), radius_m double precision,
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK ((polygon IS NOT NULL AND center IS NULL AND radius_m IS NULL)
 OR (polygon IS NULL AND center IS NOT NULL AND radius_m IS NOT NULL AND radius_m > 0 AND radius_m <= 100000)),
 CHECK(polygon IS NULL OR (ST_IsValid(polygon) AND NOT ST_IsEmpty(polygon)
 AND ST_CoveredBy(polygon,ST_MakeEnvelope(-180,-90,180,90,4326)))),
 CHECK(center IS NULL OR (NOT ST_IsEmpty(center) AND ST_X(center) BETWEEN -180 AND 180 AND ST_Y(center) BETWEEN -90 AND 90))
);
CREATE INDEX IF NOT EXISTS geofences_polygon_gix ON tms.geofences USING gist(polygon) WHERE active;
CREATE INDEX IF NOT EXISTS geofences_center_gix ON tms.geofences USING gist((center::geography)) WHERE active;
CREATE TABLE IF NOT EXISTS tms.trips (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vehicle_id bigint NOT NULL REFERENCES tms.vehicles(id),
 start_time timestamptz NOT NULL, end_time timestamptz,
 distance_m double precision NOT NULL DEFAULT 0,
 average_speed_kmh double precision NOT NULL DEFAULT 0,
 max_speed_kmh double precision NOT NULL DEFAULT 0,
 idle_seconds double precision NOT NULL DEFAULT 0,
 CHECK(end_time IS NULL OR end_time >= start_time),
 UNIQUE(vehicle_id,start_time)
);
CREATE UNIQUE INDEX IF NOT EXISTS trips_one_open ON tms.trips(vehicle_id) WHERE end_time IS NULL;
CREATE INDEX IF NOT EXISTS trips_vehicle_time_idx ON tms.trips(vehicle_id,start_time DESC);
CREATE TABLE IF NOT EXISTS tms.telemetry_positions (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vehicle_id bigint NOT NULL REFERENCES tms.vehicles(id),
 event_key text NOT NULL CHECK(length(event_key) BETWEEN 1 AND 256),
 point geometry(Point,4326) NOT NULL,
 speed_kmh double precision NOT NULL CHECK(speed_kmh BETWEEN 0 AND 400),
 ignition boolean, fuel_percent double precision CHECK(fuel_percent BETWEEN 0 AND 100),
 altitude_m double precision CHECK(altitude_m BETWEEN -1000 AND 30000),
 course double precision CHECK(course >= 0 AND course < 360),
 device_time timestamptz NOT NULL, server_time timestamptz NOT NULL,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 raw_payload jsonb NOT NULL,
 distance_delta_m double precision NOT NULL DEFAULT 0,
 interval_seconds double precision NOT NULL DEFAULT 0,
 idle_seconds double precision NOT NULL DEFAULT 0,
 processed boolean NOT NULL DEFAULT false,
 quality text NOT NULL DEFAULT 'pending' CHECK(quality IN ('pending','accepted','late','jump')),
 trip_id bigint REFERENCES tms.trips(id),
 UNIQUE(vehicle_id,event_key),
 CHECK(NOT ST_IsEmpty(point) AND ST_X(point) BETWEEN -180 AND 180 AND ST_Y(point) BETWEEN -90 AND 90),
 CHECK(device_time <= received_at + interval '10 minutes')
);
CREATE INDEX IF NOT EXISTS positions_vehicle_time_idx ON tms.telemetry_positions(vehicle_id,device_time DESC,id DESC);
CREATE INDEX IF NOT EXISTS positions_point_gix ON tms.telemetry_positions USING gist(point);
CREATE INDEX IF NOT EXISTS positions_trip_idx ON tms.telemetry_positions(trip_id) WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS positions_received_brin ON tms.telemetry_positions USING brin(received_at);
-- Persist membership so overlapping geofences each have independent dwell timers.
CREATE TABLE IF NOT EXISTS tms.vehicle_geofence_state (
 vehicle_id bigint NOT NULL REFERENCES tms.vehicles(id),
 geofence_id bigint NOT NULL REFERENCES tms.geofences(id),
 entered_at timestamptz NOT NULL,
 PRIMARY KEY(vehicle_id,geofence_id)
);
CREATE TABLE IF NOT EXISTS tms.geofence_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 vehicle_id bigint NOT NULL REFERENCES tms.vehicles(id),
 geofence_id bigint NOT NULL REFERENCES tms.geofences(id),
 event_type text NOT NULL CHECK(event_type IN ('ENTER','EXIT')),
 event_time timestamptz NOT NULL,
 dwell_seconds double precision CHECK(dwell_seconds >= 0),
 UNIQUE(vehicle_id,geofence_id,event_time,event_type)
);
CREATE INDEX IF NOT EXISTS geofence_events_vehicle_time_idx ON tms.geofence_events(vehicle_id,event_time DESC);
CREATE INDEX IF NOT EXISTS geofence_events_zone_time_idx ON tms.geofence_events(geofence_id,event_time DESC);
-- BEFORE INSERT ensures the stored row contains computed deltas and trip assignment.
-- All writers serialize on the vehicle row; duplicate retries return NULL before effects.
CREATE OR REPLACE FUNCTION tms.process_telemetry_point() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, public, extensions, tms AS $$
DECLARE
 v tms.vehicles%ROWTYPE;
 zone record;
 inside_ids bigint[];
 trip bigint;
 elapsed double precision := 0;
 delta double precision := 0;
 effective_ignition boolean;
BEGIN
 SELECT * INTO STRICT v FROM tms.vehicles WHERE id=NEW.vehicle_id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM tms.telemetry_positions WHERE vehicle_id=NEW.vehicle_id AND event_key=NEW.event_key) THEN
   RETURN NULL;
 END IF;
 IF v.last_device_time IS NOT NULL AND NEW.device_time <= v.last_device_time THEN
   NEW.quality := 'late'; RETURN NEW;
 END IF;
 effective_ignition := coalesce(NEW.ignition,v.last_ignition);
 IF v.last_device_time IS NOT NULL THEN
   elapsed := extract(epoch FROM NEW.device_time-v.last_device_time);
   delta := ST_Distance(v.last_point::geography,NEW.point::geography);
   -- Reject implausible jumps (>200 km/h plus 100 m GPS tolerance) from all live state.
   IF delta > (200.0/3.6)*elapsed+100 THEN
     NEW.quality := 'jump'; RETURN NEW;
   END IF;
 END IF;
 NEW.processed := true; NEW.quality := 'accepted';
 NEW.distance_delta_m := delta; NEW.interval_seconds := elapsed;
 -- Zero-order hold: previous speed/ignition describes the interval ending here.
 -- Gaps >5 minutes contribute distance but no inferred idle/engine time.
 IF v.last_ignition IS TRUE AND v.last_speed_kmh < 3 AND elapsed <= 300 THEN
   NEW.idle_seconds := elapsed;
 END IF;
 SELECT id INTO trip FROM tms.trips WHERE vehicle_id=v.id AND end_time IS NULL;
 IF trip IS NULL AND effective_ignition IS TRUE THEN
   INSERT INTO tms.trips(vehicle_id,start_time) VALUES(v.id,NEW.device_time) RETURNING id INTO trip;
   -- Do not attribute a pre-ignition interval to a newly opened trip.
   NEW.idle_seconds := 0;
   NEW.trip_id := trip;
   UPDATE tms.trips SET max_speed_kmh=NEW.speed_kmh WHERE id=trip;
 ELSIF trip IS NOT NULL THEN
   NEW.trip_id := trip;
   UPDATE tms.trips SET
     distance_m=distance_m+delta,
     idle_seconds=idle_seconds+NEW.idle_seconds,
     max_speed_kmh=greatest(max_speed_kmh,NEW.speed_kmh),
     average_speed_kmh=CASE WHEN NEW.device_time > start_time
       THEN (distance_m+delta)/extract(epoch FROM NEW.device_time-start_time)*3.6 ELSE 0 END,
     end_time=CASE WHEN effective_ignition IS FALSE THEN NEW.device_time ELSE NULL END
   WHERE id=trip;
 END IF;
 -- Polygon boundaries count as inside. Geography circles use meters, not degrees.
 SELECT coalesce(array_agg(id),'{}'::bigint[]) INTO inside_ids FROM (
   SELECT id FROM tms.geofences WHERE active AND polygon IS NOT NULL AND ST_Covers(polygon,NEW.point)
   UNION ALL
   SELECT id FROM tms.geofences WHERE active AND center IS NOT NULL
     AND ST_DWithin(center::geography,NEW.point::geography,radius_m)
 ) hits;
 FOR zone IN SELECT * FROM tms.vehicle_geofence_state
   WHERE vehicle_id=v.id AND NOT(geofence_id=ANY(inside_ids))
 LOOP
   INSERT INTO tms.geofence_events(vehicle_id,geofence_id,event_type,event_time,dwell_seconds)
   VALUES(v.id,zone.geofence_id,'EXIT',NEW.device_time,extract(epoch FROM NEW.device_time-zone.entered_at));
   DELETE FROM tms.vehicle_geofence_state WHERE vehicle_id=v.id AND geofence_id=zone.geofence_id;
 END LOOP;
 FOR zone IN SELECT unnest(inside_ids) AS id LOOP
   INSERT INTO tms.vehicle_geofence_state(vehicle_id,geofence_id,entered_at)
   VALUES(v.id,zone.id,NEW.device_time) ON CONFLICT DO NOTHING;
   IF FOUND THEN
     INSERT INTO tms.geofence_events(vehicle_id,geofence_id,event_type,event_time)
     VALUES(v.id,zone.id,'ENTER',NEW.device_time);
   END IF;
 END LOOP;
 UPDATE tms.vehicles SET odometer_m=odometer_m+delta,
   engine_hours=engine_hours+CASE WHEN v.last_ignition IS TRUE AND elapsed<=300 THEN elapsed/3600 ELSE 0 END,
   last_device_time=NEW.device_time,last_point=NEW.point,last_ignition=effective_ignition,last_speed_kmh=NEW.speed_kmh
 WHERE id=v.id;
 RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS process_telemetry_point ON tms.telemetry_positions;
CREATE TRIGGER process_telemetry_point BEFORE INSERT ON tms.telemetry_positions
FOR EACH ROW EXECUTE FUNCTION tms.process_telemetry_point();

-- Refresh complete trip aggregates for trips intersecting [start_time,end_time).
-- Deliberately uses accepted assignments, excludes late/jump points, and never clips
-- a trip at the report window. This is a summary refresh, not historical replay.
CREATE OR REPLACE PROCEDURE tms.generate_trip_summary(vehicle_id bigint,start_time timestamptz,end_time timestamptz)
LANGUAGE plpgsql SET search_path = pg_catalog, public, extensions, tms AS $$
DECLARE t record; totals record;
BEGIN
 IF start_time IS NULL OR end_time IS NULL OR end_time<=start_time THEN
   RAISE EXCEPTION 'Invalid summary window' USING ERRCODE='22023';
 END IF;
 PERFORM 1 FROM tms.vehicles v WHERE v.id=vehicle_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'Unknown vehicle' USING ERRCODE='22023'; END IF;
 FOR t IN SELECT tr.* FROM tms.trips tr WHERE tr.vehicle_id=generate_trip_summary.vehicle_id
   AND tr.start_time<generate_trip_summary.end_time
   AND coalesce(tr.end_time,'infinity'::timestamptz)>=generate_trip_summary.start_time
 LOOP
   SELECT coalesce(sum(CASE WHEN p.device_time>t.start_time THEN p.distance_delta_m ELSE 0 END),0) distance,
     coalesce(sum(p.idle_seconds),0) idle,coalesce(max(p.speed_kmh),0) max_speed,
     max(p.device_time) last_time INTO totals
   FROM tms.telemetry_positions p WHERE p.trip_id=t.id AND p.processed;
   UPDATE tms.trips SET distance_m=totals.distance,idle_seconds=totals.idle,max_speed_kmh=totals.max_speed,
     average_speed_kmh=CASE WHEN totals.last_time>t.start_time
       THEN totals.distance/extract(epoch FROM totals.last_time-t.start_time)*3.6 ELSE 0 END
   WHERE id=t.id;
 END LOOP;
END $$;
-- Functions are invoker-security. Provision an isolated API login as described in README.
REVOKE ALL ON FUNCTION tms.process_telemetry_point() FROM PUBLIC;
REVOKE ALL ON PROCEDURE tms.generate_trip_summary(bigint,timestamptz,timestamptz) FROM PUBLIC;
create schema logistics;
revoke all on schema logistics from public, anon, authenticated;
grant usage on schema logistics to service_role;

-- Canonical shipment record for the logistics backend.
create table logistics.waybills (
  waybill_id text primary key,
  trip_id bigint not null references tms.trips(id),
  origin_label text not null,
  destination_label text not null,
  dispatched_at timestamptz not null,
  tracking_ends_at timestamptz not null,
  in_transit_at timestamptz,
  arriving_at timestamptz,
  delivered_at timestamptz,
  unique (waybill_id, trip_id),
  check (tracking_ends_at > dispatched_at),
  check (in_transit_at is null or in_transit_at >= dispatched_at),
  check (arriving_at is null or arriving_at >= coalesce(in_transit_at, dispatched_at)),
  check (delivered_at is null or delivered_at >= coalesce(arriving_at, in_transit_at, dispatched_at))
);
create table logistics.tracking_grants (
  token_hash text primary key check (token_hash ~ '^[0-9a-f]{64}$'),
  waybill_id text not null references logistics.waybills(waybill_id) on delete cascade,
  expires_at timestamptz not null,
  revoked_at timestamptz
);
create index tracking_grants_waybill_idx on logistics.tracking_grants(waybill_id);
alter table logistics.waybills enable row level security;
alter table logistics.tracking_grants enable row level security;
grant select on logistics.waybills, logistics.tracking_grants to service_role;
grant usage on schema tms to service_role;
grant select (id, end_time) on tms.trips to service_role;
grant select (id, trip_id, quality, processed, device_time, point)
  on tms.telemetry_positions to service_role;

create function public.lope_tracking_snapshot(p_waybill text, p_token_hash text)
returns jsonb
language sql stable security invoker
set search_path = pg_catalog, public, extensions
as $$
  select jsonb_build_object(
    'origin', a.origin_label,
    'destination', a.destination_label,
    'status', case
      when a.delivered_at is not null then 'Delivered'
      when a.arriving_at is not null then 'Arriving Soon'
      when a.in_transit_at is not null then 'In Transit'
      else 'Dispatched' end,
    'dispatchedAt', a.dispatched_at,
    'arrivingAt', a.arriving_at,
    'deliveredAt', a.delivered_at,
    'position', case when fix.device_time >= now() - interval '10 minutes'
      then jsonb_build_object('lat', round(st_y(fix.point)::numeric, 2),
                              'lng', round(st_x(fix.point)::numeric, 2),
                              'at', fix.device_time) end
  )
  from logistics.tracking_grants g
  join logistics.waybills a using (waybill_id)
  join tms.trips t on t.id = a.trip_id
  left join lateral (
    select p.point, p.device_time
    from tms.telemetry_positions p
    where p.trip_id = a.trip_id and p.processed and p.quality = 'accepted'
      and p.device_time >= a.dispatched_at and p.device_time <= now()
      and p.device_time < a.tracking_ends_at
    order by p.device_time desc, p.id desc limit 1
  ) fix on a.delivered_at is null and t.end_time is null and a.tracking_ends_at > now()
  where g.waybill_id = p_waybill and g.token_hash = p_token_hash
    and g.revoked_at is null and g.expires_at > now();
$$;
revoke all on function public.lope_tracking_snapshot(text, text) from public, anon, authenticated;
grant execute on function public.lope_tracking_snapshot(text, text) to service_role;

create table logistics.stops (
  id bigint generated always as identity primary key,
  waybill_id text not null references logistics.waybills(waybill_id),
  trip_id bigint not null references tms.trips(id),
  driver_id uuid not null references auth.users(id),
  unique (trip_id, driver_id),
  foreign key (waybill_id, trip_id) references logistics.waybills(waybill_id, trip_id)
);
create table logistics.epod_proofs (
  submission_id uuid primary key,
  stop_id bigint not null unique references logistics.stops(id),
  receiver_name text not null check (length(receiver_name) between 1 and 150),
  captured_at timestamptz not null,
  received_at timestamptz not null default now(),
  location jsonb not null,
  damage boolean not null,
  notes text not null check (length(notes) <= 2000),
  signature_key text not null,
  photo_keys text[] not null check (cardinality(photo_keys) between 1 and 5)
);
alter table logistics.stops enable row level security;
alter table logistics.epod_proofs enable row level security;
grant select on logistics.stops, logistics.epod_proofs to service_role;
grant insert on logistics.epod_proofs to service_role;
grant insert on logistics.waybills, logistics.stops, logistics.tracking_grants to service_role;
grant update (delivered_at) on logistics.waybills to service_role;
grant usage, select on all sequences in schema logistics, tms to service_role;
revoke all on schema tms from public, anon, authenticated;
grant select, insert, update on all tables in schema tms to service_role;
grant execute on function tms.process_telemetry_point() to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('lope-epod', 'lope-epod', false, 4000000, array['image/png','image/jpeg','image/webp']);

create function public.lope_ingest_telemetry(p_device text, p_event text, p_at timestamptz,
  p_lat float8, p_lng float8, p_speed float8, p_ignition boolean, p_raw jsonb)
returns text language plpgsql security invoker set search_path = pg_catalog, public, extensions as $$
declare vehicle bigint; result text;
begin
  select id into vehicle from tms.vehicles where unique_id = p_device for update;
  if not found then return 'unknown_device'; end if;
  insert into tms.telemetry_positions
    (vehicle_id,event_key,point,speed_kmh,ignition,device_time,server_time,raw_payload)
  values (vehicle,p_event,st_setsrid(st_makepoint(p_lng,p_lat),4326),p_speed,p_ignition,p_at,now(),p_raw)
  returning quality into result;
  return coalesce(result,'duplicate');
end;
$$;

create function public.lope_driver_stop(p_trip bigint, p_driver uuid)
returns text language sql stable security invoker set search_path = pg_catalog as $$
  select s.id::text from logistics.stops s where s.trip_id = p_trip and s.driver_id = p_driver;
$$;

create function public.lope_save_epod(p_trip bigint, p_driver uuid, p_submission uuid, p_receiver text,
  p_at timestamptz, p_location jsonb, p_damage boolean, p_notes text, p_signature text, p_photos text[])
returns text language plpgsql security invoker set search_path = pg_catalog as $$
declare assigned logistics.stops%rowtype; existing logistics.epod_proofs%rowtype;
begin
  -- Serialize attempts for the same waybill and recheck the assignment before finalizing.
  perform 1 from logistics.waybills w join logistics.stops s using (waybill_id)
    where s.trip_id = p_trip and s.driver_id = p_driver for update of w;
  if not found then return 'forbidden'; end if;
  select * into assigned from logistics.stops where trip_id = p_trip and driver_id = p_driver;
  select * into existing from logistics.epod_proofs where stop_id = assigned.id;
  if found then
    if existing.submission_id = p_submission and existing.signature_key = p_signature
       and existing.photo_keys = p_photos and existing.receiver_name = p_receiver
       and existing.location = p_location and existing.damage = p_damage and existing.notes = p_notes
       and existing.captured_at = p_at then return 'saved'; end if;
    return 'conflict';
  end if;
  insert into logistics.epod_proofs
    (submission_id,stop_id,receiver_name,captured_at,location,damage,notes,signature_key,photo_keys)
  values (p_submission,assigned.id,p_receiver,p_at,p_location,p_damage,p_notes,p_signature,p_photos)
  on conflict (submission_id) do nothing;
  if not found then return 'conflict'; end if;
  if not exists (
    select 1 from logistics.stops s left join logistics.epod_proofs e on e.stop_id = s.id
    where s.waybill_id = assigned.waybill_id and e.stop_id is null
  ) then
    update logistics.waybills set delivered_at = greatest(now(), dispatched_at, in_transit_at, arriving_at)
      where waybill_id = assigned.waybill_id and delivered_at is null;
  end if;
  return 'saved';
end;
$$;

create function public.lope_seed_mock_trip(p_waybill text, p_hash text, p_driver uuid default null)
returns jsonb language plpgsql security invoker set search_path = pg_catalog, public, extensions as $$
declare device text := 'mock-' || p_waybill; vehicle bigint; trip bigint; at_time timestamptz := now();
begin
  if p_waybill !~ '^DEMO-[a-f0-9]{16}$' then
    raise exception 'Expected a generated demo waybill ID';
  end if;
  insert into tms.vehicles(unique_id,name) values(device,'Demo Truck') returning id into vehicle;
  perform public.lope_ingest_telemetry(device,'seed-1',at_time - interval '1 minute',-26.182,28.087,40,true,'{"demo":true}');
  perform public.lope_ingest_telemetry(device,'seed-2',at_time,-26.187,28.092,42,true,'{"demo":true}');
  select id into strict trip from tms.trips where vehicle_id=vehicle and end_time is null;
  insert into logistics.waybills
    (waybill_id,trip_id,origin_label,destination_label,dispatched_at,in_transit_at,tracking_ends_at)
  values (p_waybill,trip,'Johannesburg','Durban',at_time - interval '1 minute',at_time,at_time + interval '2 hours');
  insert into logistics.tracking_grants(token_hash,waybill_id,expires_at)
    values(p_hash,p_waybill,at_time + interval '2 hours');
  if p_driver is not null then
    insert into logistics.stops(waybill_id,trip_id,driver_id) values (p_waybill,trip,p_driver);
  end if;
  return jsonb_build_object('tripId',trip::text,'deviceId',device);
end;
$$;

revoke all on function public.lope_ingest_telemetry(text,text,timestamptz,float8,float8,float8,boolean,jsonb),
  public.lope_driver_stop(bigint,uuid),
  public.lope_save_epod(bigint,uuid,uuid,text,timestamptz,jsonb,boolean,text,text,text[]),
  public.lope_seed_mock_trip(text,text,uuid) from public, anon, authenticated;
grant execute on function public.lope_ingest_telemetry(text,text,timestamptz,float8,float8,float8,boolean,jsonb),
  public.lope_driver_stop(bigint,uuid),
  public.lope_save_epod(bigint,uuid,uuid,text,timestamptz,jsonb,boolean,text,text,text[]),
  public.lope_seed_mock_trip(text,text,uuid) to service_role;

commit;
