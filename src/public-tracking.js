import { createHash } from 'node:crypto';

export async function publicTracking(pool, id, authorization) {
  const token = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(authorization ?? '')?.[1];
  if (!token) return null;
  const hash = createHash('sha256').update(token).digest('hex');
  const { rows: [delivery] } = await pool.query(`
    SELECT d.reference, d.destination, d.created_at AS "dispatchedAt",
           d.delivered_at AS "deliveredAt",
           CASE WHEN d.status = 'DELIVERED' THEN 'Delivered' ELSE 'In Transit' END AS status,
           CASE WHEN d.status = 'IN_TRANSIT'
                 AND v.last_device_time BETWEEN greatest(d.created_at, now() - interval '5 minutes') AND now()
                 AND v.last_point IS NOT NULL
                THEN jsonb_build_object('lat', round(ST_Y(v.last_point)::numeric, 2),
                                        'lng', round(ST_X(v.last_point)::numeric, 2),
                                        'at', v.last_device_time)
           END AS position
    FROM tms.deliveries d
    JOIN tms.vehicles v ON v.id = d.vehicle_id
    WHERE d.id = $1 AND d.token_hash = $2 AND d.expires_at IS NULL
      AND (d.status = 'IN_TRANSIT'
        OR (d.status = 'DELIVERED' AND d.delivered_at + interval '7 days' > now()))
  `, [id, hash]);
  return delivery ?? null;
}
