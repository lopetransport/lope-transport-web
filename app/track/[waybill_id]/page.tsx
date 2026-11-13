import type { Metadata } from 'next';
import { TrackingStatus } from './tracking-status';

export const metadata: Metadata = {
  title: 'Track your shipment | Lope Transport',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function TrackingPage({ params }: { params: Promise<{ waybill_id: string }> }) {
  const { waybill_id } = await params;
  return <TrackingStatus key={waybill_id} waybill={waybill_id} />;
}

