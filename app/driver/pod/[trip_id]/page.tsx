import { notFound, redirect } from 'next/navigation';
import { serverSupabase } from '../../../../lib/supabase-server';
import { logisticsBackend, tripIdPattern } from '../../../../lib/logistics/backend';
import { DriverCapture } from './driver-capture';

export default async function DriverPod({ params }: { params: Promise<{ trip_id: string }> }) {
  const { trip_id } = await params;
  if (!tripIdPattern.test(trip_id)) notFound();
  const auth = await serverSupabase();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) redirect('/portal/login');
  const db = logisticsBackend();
  if (!db) return <main>Delivery capture is temporarily unavailable.</main>;
  const { data, error } = await db.rpc('lope_driver_stop', { p_trip: trip_id, p_driver: user.id });
  if (error) return <main>Delivery capture is temporarily unavailable.</main>;
  if (!data) notFound();
  return <main style={{ maxWidth: '42rem', margin: 'auto', padding: '2rem 1rem' }}>
    <h1>Lope Transport delivery proof</h1>
    <DriverCapture trip={trip_id} />
  </main>;
}

