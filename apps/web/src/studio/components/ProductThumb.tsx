import * as React from 'react';
import { Package } from 'lucide-react';
import { cn } from '@wally/ui';

/**
 * A product image with a graceful SKU placeholder. If the catalog has no image
 * (or it fails to load), we fall back to a calm monogram tile carrying the SKU —
 * the demo never shows a broken image.
 */
export function ProductThumb({
  imageUrl,
  sku,
  name,
  className,
}: {
  imageUrl?: string;
  sku: string;
  name: string;
  className?: string;
}) {
  const [failed, setFailed] = React.useState(false);
  const showImage = Boolean(imageUrl) && !failed;

  return (
    <div
      className={cn(
        'relative overflow-hidden rounded-md border border-mist/60 bg-surface',
        className,
      )}
    >
      {showImage ? (
        <img
          src={imageUrl}
          alt={name}
          loading="lazy"
          onError={() => setFailed(true)}
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center">
          <Package className="h-5 w-5 text-mist" aria-hidden="true" />
          <span className="font-display text-[10px] font-medium uppercase tracking-brand text-steel">
            {sku}
          </span>
        </div>
      )}
    </div>
  );
}
