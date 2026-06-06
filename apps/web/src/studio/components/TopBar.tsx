import * as React from 'react';
import { ChevronDown, Send, Store } from 'lucide-react';
import { Badge, Button } from '@wally/ui';

export interface StudioStore {
  storeId: string;
  storeName: string;
}

/**
 * The studio's top bar: which store you're authoring, the guide's name, and the
 * publish action. The store selector is a controlled <select> styled as a quiet
 * pill; the publish button is a no-op for the demo (wired later to the notify
 * pipeline).
 */
export function TopBar({
  guideName,
  guideKey,
  stores,
  storeId,
  onStoreChange,
  onPublish,
  publishing = false,
}: {
  guideName: string;
  guideKey?: string;
  stores: StudioStore[];
  storeId?: string;
  onStoreChange?: (storeId: string) => void;
  onPublish?: () => void;
  publishing?: boolean;
}) {
  const hasStores = stores.length > 0;

  return (
    <header className="flex h-16 shrink-0 items-center gap-4 border-b border-mist/60 bg-paper/85 px-5 backdrop-blur">
      {/* Store selector — only on store-scoped pages (floor plan). Hidden on
          org-level pages that pass no stores, so it doesn't read as a stray
          "No store selected" control everywhere. */}
      {hasStores ? (
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-steel">
            <Store className="h-4 w-4" aria-hidden="true" />
          </span>
          <select
            aria-label="Store"
            value={storeId ?? ''}
            disabled={!onStoreChange}
            onChange={(e) => onStoreChange?.(e.target.value)}
            className="h-9 w-56 appearance-none rounded-md border border-mist bg-surface/60 pl-9 pr-9 font-sans text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/30 disabled:opacity-60"
          >
            {stores.map((s) => (
              <option key={s.storeId} value={s.storeId}>
                {s.storeName}
              </option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-steel">
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </span>
        </div>
      ) : null}

      {/* Guide name */}
      <div className="min-w-0 leading-tight">
        <div className="flex items-center gap-2">
          <h1 className="truncate font-display text-base font-semibold tracking-tight text-ink">
            {guideName}
          </h1>
          {guideKey ? (
            <Badge variant="muted" className="uppercase tracking-brand">
              {guideKey}
            </Badge>
          ) : null}
        </div>
        <p className="text-[11px] uppercase tracking-brand text-steel">
          Create guide
        </p>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button
          variant="gold"
          size="md"
          onClick={onPublish}
          loading={publishing}
        >
          <Send className="h-4 w-4" aria-hidden="true" />
          <span className="hidden sm:inline">Publish &amp; notify stores</span>
          <span className="sm:hidden">Publish</span>
        </Button>
      </div>
    </header>
  );
}
