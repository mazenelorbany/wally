import * as React from 'react';
import {
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  GripVertical,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button, Spinner } from '@wally/ui';
import type { MerchandiseRow } from '@wally/types';

import { ProductThumb } from './ProductThumb';
import {
  useAddMerchandise,
  useProducts,
  useRemoveMerchandise,
  useReorderPlanogram,
} from '../lib/hooks';
import {
  addShelf,
  emptyShelfToUnsorted,
  moveFacing,
  removeShelf,
  renameShelf,
  seedShelves,
  shiftFacing,
  shiftShelf,
  sigFromRows,
  sigFromShelves,
  toBody,
  type Facing,
  type Shelf,
} from './planogram/layout';

// Native HTML5 drag payload — kept in a module ref because dataTransfer.getData
// is unreadable during dragover (where we need it to compute the drop slot).
type Drag =
  | { kind: 'facing'; facingId: string }
  | { kind: 'shelf'; shelfId: string }
  | null;

/**
 * The drag-and-drop planogram editor. Organise shelves and facings freely:
 * drag products within / between shelves, reorder, add / rename / remove
 * shelves. Every structural change persists as one PATCH (the server owns the
 * order); add / remove a product go through the merchandise endpoints.
 */
export function PlanogramEditor({
  campaignId,
  fixtureId,
  guideFixtureId,
  merchandise,
  onDone,
  large = false,
}: {
  campaignId: string;
  fixtureId: string;
  guideFixtureId: string;
  merchandise: MerchandiseRow[];
  onDone: () => void;
  /** Roomy mode (in the modal): bigger facings, easier to see and drag. */
  large?: boolean;
}) {
  const [shelves, setShelves] = React.useState<Shelf[]>(() => seedShelves(merchandise));
  const lastSig = React.useRef(sigFromRows(merchandise));

  // Re-seed only when the SERVER layout changes from what we last persisted
  // (so our own reorder echoes don't clobber local edits, but adds/removes do).
  React.useEffect(() => {
    const incoming = sigFromRows(merchandise);
    if (incoming !== lastSig.current) {
      lastSig.current = incoming;
      setShelves(seedShelves(merchandise));
    }
  }, [merchandise]);

  const reorder = useReorderPlanogram(campaignId, fixtureId);
  const remove = useRemoveMerchandise(campaignId, fixtureId);

  const persistTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const apply = (next: Shelf[]) => {
    setShelves(next);
    lastSig.current = sigFromShelves(next);
    clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(
      () => reorder.mutate({ guideFixtureId, body: toBody(next) }),
      350,
    );
  };
  React.useEffect(() => () => clearTimeout(persistTimer.current), []);

  const dragRef = React.useRef<Drag>(null);
  const [over, setOver] = React.useState<string | null>(null); // shelfId being dragged over

  const onDropFacing = (toShelfId: string, toIndex: number) => {
    const d = dragRef.current;
    if (d?.kind === 'facing') apply(moveFacing(shelves, d.facingId, toShelfId, toIndex));
    dragRef.current = null;
    setOver(null);
  };

  const total = shelves.reduce((n, s) => n + s.facings.length, 0);

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-brand text-steel">
          Editing planogram · {total} facing{total === 1 ? '' : 's'}
        </span>
        <div className="flex items-center gap-1.5">
          {reorder.isPending ? (
            <Spinner className="text-sm text-steel" />
          ) : (
            <Check className="h-3.5 w-3.5 text-pass" />
          )}
          <Button size="sm" variant="outline" onClick={onDone}>
            Done
          </Button>
        </div>
      </div>

      <div className="overflow-hidden rounded-lg border border-mist bg-paper">
        {shelves.map((shelf, i) => (
          <ShelfRow
            key={shelf.id}
            shelf={shelf}
            index={i}
            count={shelves.length}
            isOver={over === shelf.id}
            campaignId={campaignId}
            fixtureId={fixtureId}
            guideFixtureId={guideFixtureId}
            large={large}
            dragRef={dragRef}
            onDragOverShelf={() => setOver(shelf.id)}
            onDropFacing={onDropFacing}
            onShiftFacing={(fid, dir) => apply(shiftFacing(shelves, fid, dir))}
            onRemoveFacing={(mid) => remove.mutate({ guideFixtureId, merchandiseId: mid })}
            onShiftShelf={(dir) => apply(shiftShelf(shelves, shelf.id, dir))}
            onRename={(label) => apply(renameShelf(shelves, shelf.id, label))}
            onRemoveShelf={() => {
              if (shelf.facings.length === 0) {
                apply(removeShelf(shelves, shelf.id));
              } else if (
                window.confirm(
                  `Move ${shelf.facings.length} product(s) to "Unsorted" and remove this shelf? (Cancel to keep it)`,
                )
              ) {
                apply(emptyShelfToUnsorted(shelves, shelf.id));
              }
            }}
            onAdded={() => {
              /* server changes → re-seed picks it up */
            }}
          />
        ))}
      </div>

      <Button
        size="sm"
        variant="ghost"
        onClick={() => setShelves((s) => addShelf(s))}
        className="w-full justify-center border border-dashed border-mist text-steel hover:text-ink"
      >
        <Plus className="h-3.5 w-3.5" /> Add shelf
      </Button>
    </div>
  );
}

function ShelfRow({
  shelf,
  index,
  count,
  isOver,
  campaignId,
  fixtureId,
  guideFixtureId,
  large,
  dragRef,
  onDragOverShelf,
  onDropFacing,
  onShiftFacing,
  onRemoveFacing,
  onShiftShelf,
  onRename,
  onRemoveShelf,
  onAdded,
}: {
  shelf: Shelf;
  index: number;
  count: number;
  isOver: boolean;
  campaignId: string;
  fixtureId: string;
  guideFixtureId: string;
  large: boolean;
  dragRef: React.MutableRefObject<Drag>;
  onDragOverShelf: () => void;
  onDropFacing: (toShelfId: string, toIndex: number) => void;
  onShiftFacing: (facingId: string, dir: -1 | 1) => void;
  onRemoveFacing: (merchandiseId: string) => void;
  onShiftShelf: (dir: -1 | 1) => void;
  onRename: (label: string) => void;
  onRemoveShelf: () => void;
  onAdded: () => void;
}) {
  const [renaming, setRenaming] = React.useState(false);
  const [label, setLabel] = React.useState(shelf.row);
  const [picking, setPicking] = React.useState(false);
  React.useEffect(() => setLabel(shelf.row), [shelf.row]);

  return (
    <div
      className={`border-b border-mist/40 last:border-b-0 ${isOver ? 'bg-pass/5' : ''}`}
      onDragOver={(e) => {
        if (dragRef.current?.kind === 'facing') {
          e.preventDefault();
          onDragOverShelf();
        }
      }}
      onDrop={(e) => {
        if (dragRef.current?.kind === 'facing') {
          e.preventDefault();
          onDropFacing(shelf.id, shelf.facings.length); // append by default
        }
      }}
    >
      {/* Shelf header */}
      <div className="flex items-center gap-1.5 px-2 pt-2">
        <GripVertical className="h-3.5 w-3.5 shrink-0 text-mist" />
        {renaming ? (
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onBlur={() => {
              setRenaming(false);
              if (label.trim() && label.trim() !== shelf.row) onRename(label);
              else setLabel(shelf.row);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
              if (e.key === 'Escape') {
                setLabel(shelf.row);
                setRenaming(false);
              }
            }}
            className="min-w-0 flex-1 rounded border border-mist bg-paper px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-brand text-ink focus:border-steel focus:outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => setRenaming(true)}
            className="min-w-0 flex-1 truncate text-left text-[10px] font-semibold uppercase tracking-brand text-graphite hover:text-ink"
            title="Rename shelf"
          >
            {shelf.row}
          </button>
        )}
        <span className="shrink-0 text-[10px] tabular-nums text-steel">
          {shelf.facings.length}
        </span>
        <IconBtn label="Move shelf up" disabled={index === 0} onClick={() => onShiftShelf(-1)}>
          <ChevronUp className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn
          label="Move shelf down"
          disabled={index === count - 1}
          onClick={() => onShiftShelf(1)}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn label="Add product to shelf" onClick={() => setPicking((v) => !v)}>
          <Plus className="h-3.5 w-3.5" />
        </IconBtn>
        <IconBtn label="Remove shelf" onClick={onRemoveShelf} danger>
          <Trash2 className="h-3.5 w-3.5" />
        </IconBtn>
      </div>

      {/* Per-shelf product picker */}
      {picking ? (
        <ShelfPicker
          campaignId={campaignId}
          fixtureId={fixtureId}
          guideFixtureId={guideFixtureId}
          row={shelf.row}
          placedIds={new Set(shelf.facings.map((f) => f.id))}
          onClose={() => setPicking(false)}
          onAdded={onAdded}
        />
      ) : null}

      {/* The shelf: facings left → right, sitting on a baseline */}
      <div className="flex items-end gap-1.5 overflow-x-auto px-2 pb-1 pt-1.5">
        {shelf.facings.length === 0 ? (
          <div
            className={`grid w-full place-items-center rounded border border-dashed border-mist text-[10px] text-mist ${
              large ? 'h-20' : 'h-14'
            }`}
          >
            Drop products here
          </div>
        ) : (
          shelf.facings.map((f, fi) => (
            <FacingSquare
              key={f.merchandiseId}
              facing={f}
              first={fi === 0}
              last={fi === shelf.facings.length - 1}
              large={large}
              dragRef={dragRef}
              onDragOverHere={() => onDragOverShelf()}
              onDropBefore={() => onDropFacing(shelf.id, fi)}
              onShiftLeft={() => onShiftFacing(f.merchandiseId, -1)}
              onShiftRight={() => onShiftFacing(f.merchandiseId, 1)}
              onRemove={() => onRemoveFacing(f.merchandiseId)}
            />
          ))
        )}
      </div>
      <div className="mx-2 mb-2 h-1 rounded-full bg-graphite/15" />
    </div>
  );
}

function FacingSquare({
  facing,
  first,
  last,
  large,
  dragRef,
  onDragOverHere,
  onDropBefore,
  onShiftLeft,
  onShiftRight,
  onRemove,
}: {
  facing: Facing;
  first: boolean;
  last: boolean;
  large: boolean;
  dragRef: React.MutableRefObject<Drag>;
  onDragOverHere: () => void;
  onDropBefore: () => void;
  onShiftLeft: () => void;
  onShiftRight: () => void;
  onRemove: () => void;
}) {
  return (
    <article
      className={`group relative shrink-0 ${large ? 'w-24' : 'w-14'}`}
      title={`${facing.name} · ${facing.sku}`}
      draggable
      onDragStart={(e) => {
        dragRef.current = { kind: 'facing', facingId: facing.merchandiseId };
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', facing.merchandiseId);
      }}
      onDragEnd={() => {
        dragRef.current = null;
      }}
      onDragOver={(e) => {
        if (dragRef.current?.kind === 'facing') {
          e.preventDefault();
          e.stopPropagation();
          onDragOverHere();
        }
      }}
      onDrop={(e) => {
        if (dragRef.current?.kind === 'facing') {
          e.preventDefault();
          e.stopPropagation();
          onDropBefore();
        }
      }}
    >
      <ProductThumb
        imageUrl={facing.imageUrl}
        sku={facing.sku}
        name={facing.name}
        className={`aspect-square rounded ${large ? 'w-24' : 'w-14'}`}
      />
      {large ? (
        <p className="mt-1 truncate text-[10px] leading-tight text-steel">{facing.name}</p>
      ) : null}
      <button
        type="button"
        aria-label={`Remove ${facing.name}`}
        onClick={onRemove}
        className="absolute -right-1 -top-1 grid h-5 w-5 place-items-center rounded-full bg-paper text-steel opacity-0 shadow-card transition-opacity hover:text-signal group-hover:opacity-100 focus:opacity-100"
      >
        <Trash2 className="h-3 w-3" />
      </button>
      {/* keyboard / touch reorder */}
      <div className="mt-0.5 flex items-center justify-between opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          aria-label="Move left"
          disabled={first}
          onClick={onShiftLeft}
          className="text-steel hover:text-ink disabled:opacity-30"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          aria-label="Move right"
          disabled={last}
          onClick={onShiftRight}
          className="text-steel hover:text-ink disabled:opacity-30"
        >
          <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </article>
  );
}

function ShelfPicker({
  campaignId,
  fixtureId,
  guideFixtureId,
  row,
  placedIds,
  onClose,
  onAdded,
}: {
  campaignId: string;
  fixtureId: string;
  guideFixtureId: string;
  row: string;
  placedIds: Set<string>;
  onClose: () => void;
  onAdded: () => void;
}) {
  const [q, setQ] = React.useState('');
  const productsQ = useProducts({ search: q });
  const add = useAddMerchandise(campaignId, fixtureId);
  const results = (productsQ.data ?? []).slice(0, 16);

  return (
    <div className="mx-2 mb-1 rounded-md border border-mist/70 bg-surface/40 p-2">
      <div className="relative">
        <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-steel" />
        <input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Add to "${row}" — search…`}
          className="w-full rounded border border-mist bg-paper py-1.5 pl-7 pr-7 text-xs text-ink placeholder:text-steel focus:border-steel focus:outline-none"
        />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-2 top-1/2 -translate-y-1/2 text-steel hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-1.5 max-h-56 overflow-y-auto">
        {productsQ.isLoading ? (
          <div className="grid place-items-center py-4">
            <Spinner className="text-base text-steel" />
          </div>
        ) : results.length === 0 ? (
          <p className="py-3 text-center text-xs text-steel">No products match.</p>
        ) : (
          <ul className="flex flex-col">
            {results.map((p) => {
              const placed = placedIds.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={placed || add.isPending}
                    onClick={() =>
                      add.mutate(
                        { guideFixtureId, productId: p.id, row },
                        { onSuccess: onAdded },
                      )
                    }
                    className="flex w-full items-center gap-2 rounded px-1 py-1 text-left hover:bg-paper disabled:opacity-50"
                  >
                    <ProductThumb
                      imageUrl={p.imageUrl}
                      sku={p.sku}
                      name={p.name}
                      className="h-8 w-8 shrink-0 rounded"
                    />
                    <span className="min-w-0 flex-1 truncate text-xs text-ink">{p.name}</span>
                    {placed ? (
                      <span className="text-[10px] font-medium uppercase tracking-brand text-pass">
                        On shelf
                      </span>
                    ) : (
                      <Plus className="h-3.5 w-3.5 text-steel" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  disabled,
  danger,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`grid h-6 w-6 shrink-0 place-items-center rounded text-steel hover:bg-surface disabled:opacity-30 ${
        danger ? 'hover:text-signal' : 'hover:text-ink'
      }`}
    >
      {children}
    </button>
  );
}
