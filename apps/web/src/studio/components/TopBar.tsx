import * as React from 'react';
import { Send } from 'lucide-react';
import { Badge, Button } from '@wally/ui';

import { StoreSwitcher } from '../../components/StoreSwitcher';

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
  eyebrow = 'Create guide',
  stores,
  storeId,
  onStoreChange,
  onPublish,
  publishing = false,
}: {
  guideName: string;
  guideKey?: string;
  eyebrow?: string;
  stores: StudioStore[];
  storeId?: string;
  onStoreChange?: (storeId: string) => void;
  onPublish?: () => void;
  publishing?: boolean;
}) {
  const hasStores = stores.length > 0;

  return (
    <header className="relative z-40 flex h-16 shrink-0 items-center gap-4 border-b border-mist/60 bg-paper/85 px-5 backdrop-blur">
      {/* Store selector — only on store-scoped pages (floor plan). Hidden on
          org-level pages that pass no stores, so it doesn't read as a stray
          "No store selected" control everywhere. */}
      {hasStores ? (
        <StoreSwitcher
          stores={stores}
          value={storeId}
          onChange={(id) => onStoreChange?.(id)}
          disabled={!onStoreChange}
          className="w-60"
        />
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
          {eyebrow}
        </p>
      </div>

      {/* Publish is an authoring action — only the surfaces that wire a handler
          (Floor Plan, Rubrics) show it. Read-only surfaces (Gallery, analytics,
          the reviewer queue) pass no onPublish and get no stray button. */}
      {onPublish ? (
        <div className="ml-auto flex items-center gap-2">
          <Button variant="gold" size="md" onClick={onPublish} loading={publishing}>
            <Send className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Publish &amp; notify stores</span>
            <span className="sm:hidden">Publish</span>
          </Button>
        </div>
      ) : null}
    </header>
  );
}
