'use client';

import { useEffect, useState } from 'react';

const milestones = ['Dispatched', 'In Transit', 'Arriving Soon', 'Delivered'] as const;
type Snapshot = {
  origin: string;
  destination: string;
  status: typeof milestones[number];
  position: { lat: number; lng: number; at: string } | null;
};

export function TrackingStatus({ waybill }: { waybill: string }) {
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [notice, setNotice] = useState('Checking your tracking link…');

  useEffect(() => {
    const token = location.hash.slice(1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) {
      setNotice('Open the complete tracking link from Lope Transport.');
      return;
    }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch('/api/track/' + encodeURIComponent(waybill), {
          method: 'POST', headers: { Authorization: 'Bearer ' + token },
          cache: 'no-store', signal: controller.signal,
        });
        if (response.status === 404) {
          setSnapshot(null);
          setNotice('This tracking link is unavailable or has expired.');
          return;
        }
        if (!response.ok) throw new Error('Tracking unavailable');
        const data: Snapshot = await response.json();
        setSnapshot(data);
        setNotice('');
        if (data.status === 'Delivered') return;
      } catch {
        if (controller.signal.aborted) return;
        setSnapshot(null);
        setNotice('Tracking is temporarily unavailable. Retrying…');
      }
      if (!controller.signal.aborted) timer = setTimeout(refresh, 30_000);
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [waybill]);

  return <main style={{ maxWidth: '42rem', margin: 'auto', padding: '3rem 1.25rem' }}>
    <p style={{ color: '#b71023', fontWeight: 700 }}>LOPE TRANSPORT</p>
    <h1>Track your shipment</h1>
    <p aria-live="polite">{notice || snapshot?.status}</p>
    {snapshot && <>
      <h2>{snapshot.origin} → {snapshot.destination}</h2>
      <ol>{milestones.map(status => <li key={status} aria-current={status === snapshot.status ? 'step' : undefined}>{status}</li>)}</ol>
      {snapshot.position
        ? <p>Approximate position {snapshot.position.lat.toFixed(2)}, {snapshot.position.lng.toFixed(2)}<br />
          Updated {new Date(snapshot.position.at).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' })} SAST</p>
        : snapshot.status !== 'Delivered' && <p>No recent location available.</p>}
    </>}
  </main>;
}

