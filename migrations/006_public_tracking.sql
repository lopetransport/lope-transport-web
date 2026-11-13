BEGIN;
ALTER TABLE tms.deliveries
  ALTER COLUMN expires_at DROP NOT NULL,
  ADD COLUMN IF NOT EXISTS delivered_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS deliveries_one_active_public_link_per_vehicle
  ON tms.deliveries(vehicle_id)
  WHERE expires_at IS NULL AND status = 'IN_TRANSIT';
COMMIT;
