import * as React from "react";

import { X } from "lucide-react";

export interface LightboxImage {
  url: string;
  label: string;
}

export interface LightboxProps {
  /** The image to show, or null to render nothing. */
  image: LightboxImage | null;
  onClose: () => void;
}

/**
 * Full-screen image viewer: dimmed backdrop, label on top, Esc / backdrop /
 * close-button to dismiss. Sits at z-[60] so it layers above an open Dialog
 * (z-50) — e.g. zooming a reference image from inside a fixture modal.
 */
export function Lightbox({ image, onClose }: LightboxProps) {
  React.useEffect(() => {
    if (!image) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [image, onClose]);

  if (!image) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={image.label}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-ink/85 p-4 backdrop-blur-sm"
    >
      <span className="absolute left-1/2 top-4 -translate-x-1/2 text-[11px] uppercase tracking-brand text-paper/70">
        {image.label}
      </span>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 z-10 grid h-9 w-9 place-items-center rounded-full bg-paper/15 text-paper transition-colors hover:bg-paper/25"
      >
        <X className="h-5 w-5" />
      </button>
      <img
        src={image.url}
        alt={image.label}
        onClick={(e) => e.stopPropagation()}
        className="block max-h-[88vh] max-w-[94vw] rounded-lg object-contain shadow-lift"
      />
    </div>
  );
}
