import * as React from 'react';
import { Camera, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@wally/ui';

import type { Slot } from './slots';
import { SlotStatus } from './SlotStatus';

/**
 * One fixture slot, expanded — the active card in the guided flow. Shows the
 * current photo (server-signed URL or a local just-captured preview), the
 * capture control (opens the rear camera on mobile), and per-slot actions.
 */
export function CaptureSlot({
  slot,
  index,
  total,
  onCapture,
  onRetake,
  onSkip,
  onUnskip,
  onRetry,
  onRemove,
}: {
  slot: Slot;
  index: number;
  total: number;
  onCapture: (file: File) => void;
  onRetake: () => void;
  onSkip: () => void;
  onUnskip: () => void;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const previewUrl = slot.localPreviewUrl ?? slot.photo?.url;
  const hasPhoto =
    slot.state === 'queued' ||
    slot.state === 'uploading' ||
    slot.state === 'error' ||
    slot.state === 'uploaded' ||
    slot.state === 'scored';

  const pick = () => inputRef.current?.click();
  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) onCapture(file);
    // Allow re-selecting the same file later.
    e.target.value = '';
  };

  return (
    <div className="animate-fade-up">
      <div className="mb-3 flex items-center justify-between">
        <p className="text-[11px] uppercase tracking-brand text-steel">
          Fixture {index + 1} of {total}
        </p>
        <SlotStatus slot={slot} />
      </div>

      <h2 className="font-display text-2xl font-semibold tracking-tight text-ink">
        {slot.label}
      </h2>

      {/* Photo stage */}
      <div className="mt-4 overflow-hidden rounded-xl border border-mist/70 bg-surface">
        {hasPhoto && previewUrl ? (
          <div className="relative aspect-[4/3] w-full">
            <img
              src={previewUrl}
              alt={`Captured photo of ${slot.label}`}
              className="h-full w-full object-cover"
            />
            {slot.state === 'uploading' ? (
              <div className="absolute inset-x-0 bottom-0 bg-ink/60 px-3 py-1.5 text-center text-xs font-medium text-paper">
                Uploading…
              </div>
            ) : null}
          </div>
        ) : slot.state === 'skipped' ? (
          <div className="grid aspect-[4/3] w-full place-items-center text-center">
            <div>
              <p className="font-display text-base font-semibold text-graphite">
                Marked as not available
              </p>
              <p className="mt-1 text-sm text-steel">
                This fixture won't count against the store.
              </p>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={pick}
            className="tap grid aspect-[4/3] w-full place-items-center text-center"
            aria-label={`Take a photo of ${slot.label}`}
          >
            <div>
              <span className="mx-auto mb-3 grid h-14 w-14 place-items-center rounded-full bg-paper text-ink shadow-card">
                <Camera className="h-6 w-6" aria-hidden="true" />
              </span>
              <p className="font-display text-base font-semibold text-ink">
                Take photo
              </p>
              <p className="mt-1 text-sm text-steel">Tap to open your camera</p>
            </div>
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        onChange={onFile}
      />

      {slot.state === 'error' ? (
        <p className="mt-3 text-sm text-signal">
          {slot.queued?.error ?? 'Upload failed.'} It is saved on this device.
        </p>
      ) : null}

      {/* Actions */}
      <div className="mt-4 flex flex-wrap gap-2">
        {slot.state === 'error' ? (
          <>
            <Button onClick={onRetry}>
              <RotateCcw className="h-4 w-4" />
              Retry upload
            </Button>
            <Button variant="outline" onClick={() => inputRef.current?.click()}>
              <Camera className="h-4 w-4" />
              Re-take
            </Button>
            <Button variant="ghost" onClick={onRemove}>
              <Trash2 className="h-4 w-4" />
              Discard
            </Button>
          </>
        ) : hasPhoto ? (
          <>
            <Button variant="outline" onClick={onRetake}>
              <Camera className="h-4 w-4" />
              Re-take
            </Button>
          </>
        ) : slot.state === 'skipped' ? (
          <Button variant="outline" onClick={onUnskip}>
            <Camera className="h-4 w-4" />
            Actually, take a photo
          </Button>
        ) : (
          <>
            <Button onClick={pick}>
              <Camera className="h-4 w-4" />
              Take photo
            </Button>
            <Button variant="ghost" onClick={onSkip}>
              Don&apos;t have it
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
