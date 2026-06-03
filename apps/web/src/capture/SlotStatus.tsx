import * as React from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Circle,
  CloudUpload,
  Loader2,
  MinusCircle,
} from 'lucide-react';
import { Verdict } from '@wally/ui';

import type { Slot, SlotState } from './slots';

// Colour-blind-safe slot status: every state carries an icon + word, never hue
// alone. Upload mechanics (queued/uploading/error) are neutral graphite/amber;
// scored slots defer to the shared <Verdict> atom for the actual band.

const meta: Record<
  Exclude<SlotState, 'scored'>,
  { icon: React.ComponentType<{ className?: string }>; label: string; tone: string }
> = {
  todo: { icon: Circle, label: 'To do', tone: 'text-steel' },
  queued: { icon: CloudUpload, label: 'Queued', tone: 'text-graphite' },
  uploading: { icon: Loader2, label: 'Uploading', tone: 'text-ink' },
  error: { icon: AlertCircle, label: 'Upload failed', tone: 'text-signal' },
  uploaded: { icon: CheckCircle2, label: 'Uploaded', tone: 'text-pass' },
  skipped: { icon: MinusCircle, label: "Don't have it", tone: 'text-steel' },
};

export function SlotStatus({ slot, size = 'md' }: { slot: Slot; size?: 'sm' | 'md' }) {
  if (slot.state === 'scored' && slot.photo?.score) {
    return <Verdict tone={slot.photo.score.overall} size={size} />;
  }
  const m = meta[slot.state as Exclude<SlotState, 'scored'>];
  const Icon = m.icon;
  const text = size === 'sm' ? 'text-[11px]' : 'text-xs';
  return (
    <span className={`inline-flex items-center gap-1.5 font-medium ${m.tone} ${text}`}>
      <Icon
        className={`h-4 w-4 shrink-0 ${slot.state === 'uploading' ? 'animate-wally-spin' : ''}`}
        aria-hidden="true"
      />
      {m.label}
    </span>
  );
}
