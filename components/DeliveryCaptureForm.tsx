'use client';

import { useRef, useState, type FormEvent, type PointerEvent } from 'react';

export type DeliveryCapture = {
  submissionId: string;
  receiverName: string;
  signature: Blob;
  photos: File[];
  position: { latitude: number; longitude: number; accuracy: number; capturedAt: string };
  capturedAt: string;
  damage: boolean;
  notes: string;
};

// Mount only after the server verifies the driver and the assigned delivery stop.
export function DeliveryCaptureForm({ submit }: { submit: (capture: DeliveryCapture) => Promise<void> }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<number | null>(null);
  const submission = useRef<DeliveryCapture | null>(null);
  const pending = useRef(false);
  const [signed, setSigned] = useState(false);
  const [position, setPosition] = useState<DeliveryCapture['position']>();
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [prepared, setPrepared] = useState(false);

  function draw(event: PointerEvent<HTMLCanvasElement>, start: boolean) {
    const surface = event.currentTarget;
    const context = surface.getContext('2d');
    if (!context) return;
    const bounds = surface.getBoundingClientRect();
    const x = (event.clientX - bounds.left) * surface.width / bounds.width;
    const y = (event.clientY - bounds.top) * surface.height / bounds.height;
    if (start) {
      if (pointer.current !== null || event.button !== 0) return;
      pointer.current = event.pointerId;
      surface.setPointerCapture(event.pointerId);
      context.beginPath();
      context.moveTo(x, y);
      return;
    }
    if (pointer.current !== event.pointerId) return;
    context.lineWidth = 3;
    context.lineCap = 'round';
    context.lineTo(x, y);
    context.stroke();
    setSigned(true);
  }

  function locate() {
    if (!navigator.geolocation) {
      setNotice('This device cannot provide a location.');
      return;
    }
    navigator.geolocation.getCurrentPosition(({ coords, timestamp }) => {
      setPosition({
        latitude: coords.latitude, longitude: coords.longitude, accuracy: coords.accuracy,
        capturedAt: new Date(timestamp).toISOString(),
      });
      setNotice('Delivery location captured.');
    }, () => setNotice('Location unavailable. Enable location access and try again.'),
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15_000 });
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || done) return;
    const fields = new FormData(event.currentTarget);
    pending.current = true;
    setBusy(true);
    setNotice('');
    try {
      if (!submission.current) {
        const receiverName = String(fields.get('receiver') ?? '').trim();
        const photos = fields.getAll('photos').filter((file): file is File => file instanceof File && file.size > 0);
        if (!receiverName || !signed || !position || !photos.length) {
          setNotice('Enter the receiver name and capture a signature, location and photo.');
          return;
        }
        if (photos.length > 5 || photos.reduce((total, file) => total + file.size, 0) > 3_900_000) {
          setNotice('Add up to five photos totalling 3.9 MB or less.');
          return;
        }
        const signature = await new Promise<Blob | null>(resolve => {
          if (canvas.current) canvas.current.toBlob(resolve, 'image/png');
          else resolve(null);
        });
        if (!signature) throw new Error('Signature capture failed');
        if (signature.size + photos.reduce((total, file) => total + file.size, 0) > 4_000_000) {
          setNotice('The signature and photos must total 4 MB or less.');
          return;
        }
        submission.current = {
          submissionId: crypto.randomUUID(), receiverName, signature, photos, position,
          capturedAt: new Date().toISOString(), damage: fields.get('damage') === 'on',
          notes: String(fields.get('notes') ?? '').trim(),
        };
        setPrepared(true);
      }
      await submit(submission.current);
      submission.current = null;
      setDone(true);
      setNotice('Delivery evidence received.');
    } catch {
      setNotice(submission.current
        ? 'Submission could not be confirmed. Keep this screen open and retry when connected.'
        : 'Evidence could not be prepared. Try again.');
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  return <form onSubmit={save}>
    <fieldset disabled={busy || prepared || done} style={{ display: 'grid', gap: '1rem' }}>
      <legend>Delivery evidence</legend>
      <label>Receiver full name <input name="receiver" required maxLength={150} /></label>
      <div>
        <p>Receiver signature</p>
        <canvas ref={canvas} width={640} height={240} aria-label="Draw receiver signature"
          style={{ width: '100%', maxWidth: '32rem', touchAction: 'none', background: 'white', border: '1px solid #777',
            pointerEvents: busy || prepared || done ? 'none' : 'auto' }}
          onPointerDown={event => draw(event, true)} onPointerMove={event => draw(event, false)}
          onLostPointerCapture={() => { pointer.current = null; }} />
        <button type="button" onClick={() => {
          const surface = canvas.current;
          if (surface) surface.getContext('2d')?.clearRect(0, 0, surface.width, surface.height);
          setSigned(false);
        }}>Clear signature</button>
      </div>
      <button type="button" onClick={locate}>Capture delivery location</button>
      <label>Cargo photos <input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple required /></label>
      <label><input type="checkbox" name="damage" /> Damage observed</label>
      <label>Condition notes <textarea name="notes" maxLength={2000} /></label>
    </fieldset>
    <button disabled={busy || done}>{busy ? 'Submittingâ€¦' : prepared ? 'Retry submission' : 'Submit delivery evidence'}</button>
    <p role="status">{notice}</p>
  </form>;
}

