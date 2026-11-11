'use client';

import { DeliveryCaptureForm, type DeliveryCapture } from '../../../../components/DeliveryCaptureForm';

export function DriverCapture({ trip }: { trip: string }) {
  async function submit({ signature, photos, ...details }: DeliveryCapture) {
    const body = new FormData();
    body.set('details', JSON.stringify(details));
    body.set('signature', signature, 'signature.png');
    photos.forEach(photo => body.append('photos', photo));
    const response = await fetch('/api/driver/pod/' + trip, { method: 'POST', body });
    if (!response.ok) {
      const result = await response.json().catch(() => null);
      throw new Error(result?.error ?? 'Submission could not be confirmed.');
    }
  }
  return <DeliveryCaptureForm submit={submit} />;
}

