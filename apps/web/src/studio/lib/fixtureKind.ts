// Fixture-kind presentation metadata. Meaning is carried by an ICON + a text
// LABEL (never hue alone) — consistent with the colour-blind-safe brand rule.

import {
  Armchair,
  Boxes,
  GalleryVerticalEnd,
  PanelTop,
  ShoppingCart,
  Square,
  type LucideIcon,
} from 'lucide-react';
import type { FixtureKind } from '@wally/types';

export interface FixtureKindMeta {
  label: string;
  icon: LucideIcon;
}

const META: Record<FixtureKind, FixtureKindMeta> = {
  bay: { label: 'Bay', icon: GalleryVerticalEnd },
  table: { label: 'Table', icon: Square },
  stand: { label: 'Stand', icon: Boxes },
  window: { label: 'Window', icon: PanelTop },
  dais: { label: 'Dais', icon: Armchair },
  trolley: { label: 'Trolley', icon: ShoppingCart },
};

export function fixtureKindMeta(kind: FixtureKind): FixtureKindMeta {
  return META[kind] ?? { label: kind, icon: Square };
}
