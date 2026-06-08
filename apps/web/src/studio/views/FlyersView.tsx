// =============================================================================
// FLYERS — canvas flyer/template editor (Slice 1: the editor shell).
//
// A Konva-backed design surface where an author lays out a flyer or shelf
// ticket by hand: add text / shapes / images, drag + resize them, reorder
// layers, undo/redo, then export the artboard to PNG or PDF.
//
// This slice is deliberately frontend-only and data-agnostic — it proves the
// editing UX. Later slices layer on: data-bound fields (auto-fill from the
// campaign/product DB), saved templates, the full preset-size set with
// per-size tweaks, and server-side bulk generation.
//
// Coordinate model: every element lives in ARTBOARD space (0..artW, 0..artH).
// The Konva Stage is scaled by `scale` to fit the viewport, so pointer maths
// stays correct; export multiplies pixelRatio back up for crisp output.
// =============================================================================

import * as React from 'react';
import { Stage, Layer, Rect, Text, Image as KonvaImage, Transformer } from 'react-konva';
import type Konva from 'konva';
import jsPDF from 'jspdf';
import {
  Type,
  Square,
  ImagePlus,
  Trash2,
  Undo2,
  Redo2,
  Download,
  FileText,
  ArrowUp,
  ArrowDown,
  ZoomIn,
  ZoomOut,
  Maximize,
  Layers,
} from 'lucide-react';
import { Button, Spinner, cn } from '@wally/ui';

import { useSetStudioTopBar } from '../components/StudioContext';
import { useProducts } from '../lib/hooks';
import { useToast } from '../../lib/toast';
import { TEMPLATES } from '../flyers/templates';
import { generateTicketsPdf } from '../flyers/generate';
import {
  type El,
  type BaseEl,
  type TextEl,
  type RectEl,
  type ImageEl,
  type FlyerProduct,
  type BindKey,
  FONT_DISPLAY,
  BIND_OPTIONS,
  displayText,
  savePct,
} from '../flyers/model';

// --- Artboard presets --------------------------------------------------------
// Px sizes at 96dpi. These are sensible defaults so the editor is usable today;
// the canonical preset list is a later slice (awaiting Mazen's size list).
interface SizePreset {
  key: string;
  label: string;
  w: number;
  h: number;
}
const SIZES: SizePreset[] = [
  { key: 'a4p', label: 'A4 Portrait', w: 794, h: 1123 },
  { key: 'a4l', label: 'A4 Landscape', w: 1123, h: 794 },
  { key: 'a3p', label: 'A3 Portrait', w: 1123, h: 1587 },
  { key: 'sq', label: 'Square 1080', w: 1080, h: 1080 },
  { key: 'story', label: 'Story 1080×1920', w: 1080, h: 1920 },
  { key: 'web', label: 'Web 1920×1080', w: 1920, h: 1080 },
  { key: 'ticket', label: 'Shelf ticket A6', w: 559, h: 397 },
];

// Export resolution multipliers relative to the 96dpi artboard.
const PNG_SCALE = 2; // crisp screen / social
const PDF_SCALE = 3.125; // ~300dpi for print

// Element model + data binding live in ../flyers/model (shared with the
// template factory and the bulk generator).

let idSeq = 0;
const nextId = (t: string) => `${t}_${Date.now().toString(36)}_${idSeq++}`;

// --- Loads a src into an HTMLImageElement for Konva (CORS-safe for export) ----
function useHtmlImage(src: string): HTMLImageElement | null {
  const [img, setImg] = React.useState<HTMLImageElement | null>(null);
  React.useEffect(() => {
    if (!src) {
      setImg(null);
      return;
    }
    const image = new window.Image();
    image.crossOrigin = 'anonymous';
    let alive = true;
    image.onload = () => alive && setImg(image);
    image.onerror = () => alive && setImg(null);
    image.src = src;
    return () => {
      alive = false;
    };
  }, [src]);
  return img;
}

export function FlyersView() {
  useSetStudioTopBar({ guideName: 'Flyers', eyebrow: 'Admin', stores: [] });

  const toast = useToast();
  // Size is an object (not just a preset key) so templates can set their own
  // trim size that isn't in the preset list.
  const [size, setSize] = React.useState<SizePreset>(SIZES[0]!);
  const artW = size.w;
  const artH = size.h;

  // --- Document state + history ----------------------------------------------
  const [els, setEls] = React.useState<El[]>([]);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const past = React.useRef<El[][]>([]);
  const future = React.useRef<El[][]>([]);

  // Commit a new element list, pushing the previous onto the undo stack.
  const commit = React.useCallback((next: El[] | ((prev: El[]) => El[])) => {
    setEls((prev) => {
      const resolved = typeof next === 'function' ? (next as (p: El[]) => El[])(prev) : next;
      past.current.push(prev);
      if (past.current.length > 100) past.current.shift();
      future.current = [];
      return resolved;
    });
  }, []);

  const undo = React.useCallback(() => {
    setEls((prev) => {
      const prior = past.current.pop();
      if (prior === undefined) return prev;
      future.current.push(prev);
      return prior;
    });
  }, []);
  const redo = React.useCallback(() => {
    setEls((prev) => {
      const nextState = future.current.pop();
      if (nextState === undefined) return prev;
      past.current.push(prev);
      return nextState;
    });
  }, []);

  const selected = els.find((e) => e.id === selectedId) ?? null;

  const patchSelected = React.useCallback(
    (patch: Partial<El>) => {
      if (!selectedId) return;
      commit((prev) =>
        prev.map((e) => (e.id === selectedId ? ({ ...e, ...patch } as El) : e)),
      );
    },
    [selectedId, commit],
  );

  const removeSelected = React.useCallback(() => {
    if (!selectedId) return;
    commit((prev) => prev.filter((e) => e.id !== selectedId));
    setSelectedId(null);
  }, [selectedId, commit]);

  // --- Add elements ----------------------------------------------------------
  const addText = () =>
    commit((prev) => {
      const el: TextEl = {
        id: nextId('text'),
        type: 'text',
        x: artW / 2 - 150,
        y: artH / 2 - 30,
        width: 300,
        height: 60,
        rotation: 0,
        opacity: 1,
        text: 'Your headline',
        fontSize: 48,
        fontFamily: FONT_DISPLAY,
        fill: '#0E0E0D',
        align: 'left',
        fontStyle: 'bold',
      };
      setSelectedId(el.id);
      return [...prev, el];
    });

  const addRect = () =>
    commit((prev) => {
      const el: RectEl = {
        id: nextId('rect'),
        type: 'rect',
        x: artW / 2 - 120,
        y: artH / 2 - 80,
        width: 240,
        height: 160,
        rotation: 0,
        opacity: 1,
        fill: '#C99A2E',
        cornerRadius: 8,
        stroke: '',
        strokeWidth: 0,
      };
      setSelectedId(el.id);
      return [...prev, el];
    });

  const fileRef = React.useRef<HTMLInputElement>(null);
  const onPickImage = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const src = String(reader.result);
      const probe = new window.Image();
      probe.onload = () => {
        const ratio = probe.width / probe.height || 1;
        const w = Math.min(400, artW * 0.6);
        commit((prev) => {
          const el: ImageEl = {
            id: nextId('image'),
            type: 'image',
            x: artW / 2 - w / 2,
            y: artH / 2 - w / ratio / 2,
            width: w,
            height: w / ratio,
            rotation: 0,
            opacity: 1,
            src,
          };
          setSelectedId(el.id);
          return [...prev, el];
        });
      };
      probe.src = src;
    };
    reader.readAsDataURL(file);
  };

  // --- Layer order -----------------------------------------------------------
  const reorder = (dir: 'up' | 'down' | 'front' | 'back') => {
    if (!selectedId) return;
    commit((prev) => {
      const i = prev.findIndex((e) => e.id === selectedId);
      if (i < 0) return prev;
      const arr = [...prev];
      const [el] = arr.splice(i, 1);
      if (!el) return prev;
      const j =
        dir === 'up'
          ? Math.min(arr.length, i + 1)
          : dir === 'down'
            ? Math.max(0, i - 1)
            : dir === 'front'
              ? arr.length
              : 0;
      arr.splice(j, 0, el);
      return arr;
    });
  };

  // --- Templates -------------------------------------------------------------
  const loadTemplate = (key: string) => {
    const tpl = TEMPLATES.find((t) => t.key === key);
    if (!tpl) return;
    setSize({ key: tpl.key, label: tpl.label, w: tpl.w, h: tpl.h });
    commit(tpl.build());
    setSelectedId(null);
  };

  // --- Bulk generate from the catalog ----------------------------------------
  // Eligible = products with a genuine discount (rrp > salePrice). These are the
  // products that get a sale ticket.
  const productsQ = useProducts({});
  const onSale: FlyerProduct[] = React.useMemo(
    () =>
      (productsQ.data ?? [])
        .filter((p) => p.rrp != null && p.salePrice != null && p.salePrice < p.rrp)
        .map((p) => ({ name: p.name, sku: p.sku, rrp: p.rrp, salePrice: p.salePrice })),
    [productsQ.data],
  );
  const [genOpen, setGenOpen] = React.useState(false);
  const [progress, setProgress] = React.useState<{ done: number; total: number } | null>(null);
  const runGenerate = async () => {
    if (els.length === 0 || onSale.length === 0) return;
    setProgress({ done: 0, total: onSale.length });
    try {
      const res = await generateTicketsPdf({
        template: els,
        artW,
        artH,
        products: onSale,
        fileName: `sale-tickets-${onSale.length}.pdf`,
        onProgress: (done, total) => setProgress({ done, total }),
      });
      toast.success(`Generated ${res.pages} ticket${res.pages === 1 ? '' : 's'}`);
      setGenOpen(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Generation failed');
    } finally {
      setProgress(null);
    }
  };

  // --- Fit-to-viewport scale -------------------------------------------------
  const wrapRef = React.useRef<HTMLDivElement>(null);
  const [scale, setScale] = React.useState(0.5);
  const fitToScreen = React.useCallback(() => {
    const el = wrapRef.current;
    if (!el) return;
    const pad = 64;
    const s = Math.min((el.clientWidth - pad) / artW, (el.clientHeight - pad) / artH);
    setScale(Math.max(0.05, Math.min(2, s)));
  }, [artW, artH]);
  React.useEffect(() => {
    fitToScreen();
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(fitToScreen);
    ro.observe(el);
    return () => ro.disconnect();
  }, [fitToScreen]);

  // --- Keyboard shortcuts ----------------------------------------------------
  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable))
        return;
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        removeSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [undo, redo, removeSelected, selectedId]);

  // --- Export ----------------------------------------------------------------
  const stageRef = React.useRef<Konva.Stage>(null);
  const exportStage = (multiplier: number): string | null => {
    const stage = stageRef.current;
    if (!stage) return null;
    // pixelRatio is relative to the on-screen pixel size (artboard * scale);
    // divide out `scale` so the output is artboard * multiplier px.
    return stage.toDataURL({ pixelRatio: multiplier / scale, mimeType: 'image/png' });
  };
  const withDeselected = (fn: () => void) => {
    const prev = selectedId;
    setSelectedId(null);
    // Let the transformer unmount before snapshotting.
    requestAnimationFrame(() => {
      fn();
      if (prev) setSelectedId(prev);
    });
  };
  const exportPng = () =>
    withDeselected(() => {
      const uri = exportStage(PNG_SCALE);
      if (!uri) return;
      const a = document.createElement('a');
      a.download = `flyer-${size.key}.png`;
      a.href = uri;
      a.click();
    });
  const exportPdf = () =>
    withDeselected(() => {
      const uri = exportStage(PDF_SCALE);
      if (!uri) return;
      const pdf = new jsPDF({
        orientation: artW > artH ? 'landscape' : 'portrait',
        unit: 'px',
        format: [artW, artH],
      });
      pdf.addImage(uri, 'PNG', 0, 0, artW, artH);
      pdf.save(`flyer-${size.key}.pdf`);
    });

  // --- Render ----------------------------------------------------------------
  return (
    <div className="flex h-full min-h-0 flex-col bg-surface">
      <Toolbar
        size={size}
        onSize={setSize}
        onLoadTemplate={loadTemplate}
        onAddText={addText}
        onAddRect={addRect}
        onAddImage={() => fileRef.current?.click()}
        onUndo={undo}
        onRedo={redo}
        canUndo={past.current.length > 0}
        canRedo={future.current.length > 0}
        scale={scale}
        onZoom={(d) => setScale((s) => Math.max(0.05, Math.min(2, s + d)))}
        onFit={fitToScreen}
        onExportPng={exportPng}
        onExportPdf={exportPdf}
        onGenerate={() => setGenOpen((v) => !v)}
        canGenerate={els.length > 0}
      />
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/webp,image/svg+xml"
        className="sr-only"
        onChange={onPickImage}
      />

      <div className="flex min-h-0 flex-1">
        <LayersPanel
          els={els}
          selectedId={selectedId}
          onSelect={setSelectedId}
          onReorder={reorder}
        />

        {/* Canvas workspace */}
        <div ref={wrapRef} className="relative grid flex-1 place-items-center overflow-auto bg-mist/20">
          <div className="shadow-lift" style={{ lineHeight: 0 }}>
            <Stage
              ref={stageRef}
              width={artW * scale}
              height={artH * scale}
              scaleX={scale}
              scaleY={scale}
              onMouseDown={(e) => {
                if (e.target === e.target.getStage()) setSelectedId(null);
              }}
            >
              <Layer>
                {/* Artboard background */}
                <Rect x={0} y={0} width={artW} height={artH} fill="#FFFFFF" listening={false} />
                {els.map((el) => (
                  <CanvasElement
                    key={el.id}
                    el={el}
                    isSelected={el.id === selectedId}
                    onSelect={() => setSelectedId(el.id)}
                    onChange={(patch) =>
                      commit((prev) =>
                        prev.map((e) => (e.id === el.id ? ({ ...e, ...patch } as El) : e)),
                      )
                    }
                  />
                ))}
              </Layer>
            </Stage>
          </div>
        </div>

        <PropertiesPanel
          selected={selected}
          onPatch={patchSelected}
          onDelete={removeSelected}
          onReplaceImage={() => fileRef.current?.click()}
        />
      </div>

      {genOpen ? (
        <GeneratePanel
          loading={productsQ.isLoading}
          count={onSale.length}
          progress={progress}
          onClose={() => (progress ? undefined : setGenOpen(false))}
          onRun={runGenerate}
        />
      ) : null}
    </div>
  );
}

// --- Generate-set panel (overlay) -------------------------------------------
function GeneratePanel({
  loading,
  count,
  progress,
  onRun,
  onClose,
}: {
  loading: boolean;
  count: number;
  progress: { done: number; total: number } | null;
  onRun: () => void;
  onClose: () => void;
}) {
  return (
    <div className="absolute inset-0 z-30 grid place-items-center bg-ink/30" onClick={onClose}>
      <div
        className="w-[26rem] rounded-lg border border-mist/60 bg-paper p-5 shadow-lift"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-display text-lg font-semibold text-ink">Generate the sale set</h2>
        <p className="mt-1 text-sm text-steel">
          Renders the current design once per on-sale product into a single multi-page PDF — one
          ticket per page. Bound fields (Save %, RRP, NOW, name, SKU) fill from the catalog.
        </p>

        <div className="mt-4 rounded-md border border-mist/60 bg-surface/50 px-3 py-2.5 text-sm">
          {loading ? (
            <span className="flex items-center gap-2 text-steel">
              <Spinner className="text-steel" /> Loading catalog…
            </span>
          ) : (
            <span className="text-graphite">
              <b className="text-ink">{count}</b> product{count === 1 ? '' : 's'} on sale
              {count === 0 ? ' — set RRP and a lower sale price on products first.' : ' eligible.'}
            </span>
          )}
        </div>

        {progress ? (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-mist/40">
              <div
                className="h-full bg-gold transition-[width] duration-150"
                style={{ width: `${Math.round((progress.done / progress.total) * 100)}%` }}
              />
            </div>
            <p className="mt-1.5 text-center text-xs tabular-nums text-steel">
              {progress.done} / {progress.total}
            </p>
          </div>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={!!progress}>
            Cancel
          </Button>
          <Button onClick={onRun} loading={!!progress} disabled={loading || count === 0}>
            Generate PDF
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- One element on the canvas ----------------------------------------------
function CanvasElement({
  el,
  isSelected,
  onSelect,
  onChange,
}: {
  el: El;
  isSelected: boolean;
  onSelect: () => void;
  onChange: (patch: Partial<El>) => void;
}) {
  const shapeRef = React.useRef<Konva.Node>(null);
  const trRef = React.useRef<Konva.Transformer>(null);
  const img = useHtmlImage(el.type === 'image' ? el.src : '');

  React.useEffect(() => {
    if (isSelected && trRef.current && shapeRef.current) {
      trRef.current.nodes([shapeRef.current]);
      trRef.current.getLayer()?.batchDraw();
    }
  }, [isSelected]);

  const common = {
    x: el.x,
    y: el.y,
    rotation: el.rotation,
    opacity: el.opacity,
    draggable: true,
    onClick: onSelect,
    onTap: onSelect,
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) =>
      onChange({ x: e.target.x(), y: e.target.y() }),
  };

  // Konva applies transforms as scale; we bake scale back into width/height
  // (and fontSize for text) so our model stays scale-free.
  const onTransformEnd = () => {
    const node = shapeRef.current;
    if (!node) return;
    const scaleX = node.scaleX();
    const scaleY = node.scaleY();
    node.scaleX(1);
    node.scaleY(1);
    const base: Partial<BaseEl> = {
      x: node.x(),
      y: node.y(),
      rotation: node.rotation(),
      width: Math.max(5, (el.width || node.width()) * scaleX),
      height: Math.max(5, (el.height || node.height()) * scaleY),
    };
    if (el.type === 'text') {
      onChange({ ...base, fontSize: Math.max(6, el.fontSize * scaleY) } as Partial<El>);
    } else {
      onChange(base as Partial<El>);
    }
  };

  let node: React.ReactNode = null;
  if (el.type === 'text') {
    node = (
      <Text
        ref={shapeRef as React.Ref<Konva.Text>}
        {...common}
        text={displayText(el, null)}
        width={el.width}
        fontSize={el.fontSize}
        fontFamily={el.fontFamily}
        fontStyle={el.fontStyle}
        textDecoration={el.textDecoration ?? ''}
        fill={el.fill}
        align={el.align}
        onTransformEnd={onTransformEnd}
      />
    );
  } else if (el.type === 'rect') {
    node = (
      <Rect
        ref={shapeRef as React.Ref<Konva.Rect>}
        {...common}
        width={el.width}
        height={el.height}
        fill={el.fill}
        cornerRadius={el.cornerRadius}
        stroke={el.stroke || undefined}
        strokeWidth={el.strokeWidth}
        onTransformEnd={onTransformEnd}
      />
    );
  } else {
    node = (
      <KonvaImage
        ref={shapeRef as React.Ref<Konva.Image>}
        {...common}
        width={el.width}
        height={el.height}
        image={img ?? undefined}
        onTransformEnd={onTransformEnd}
      />
    );
  }

  return (
    <>
      {node}
      {isSelected ? (
        <Transformer
          ref={trRef}
          rotateEnabled
          keepRatio={el.type === 'image'}
          boundBoxFunc={(oldBox, newBox) =>
            Math.abs(newBox.width) < 5 || Math.abs(newBox.height) < 5 ? oldBox : newBox
          }
        />
      ) : null}
    </>
  );
}

// --- Top toolbar -------------------------------------------------------------
function Toolbar(props: {
  size: SizePreset;
  onSize: (s: SizePreset) => void;
  onLoadTemplate: (key: string) => void;
  onAddText: () => void;
  onAddRect: () => void;
  onAddImage: () => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  scale: number;
  onZoom: (delta: number) => void;
  onFit: () => void;
  onExportPng: () => void;
  onExportPdf: () => void;
  onGenerate: () => void;
  canGenerate: boolean;
}) {
  // The size dropdown shows the presets plus, when a template set a custom
  // size, that custom size as a leading option so the selection stays visible.
  const sizeOptions: SizePreset[] = SIZES.some((s) => s.key === props.size.key)
    ? SIZES
    : [props.size, ...SIZES];
  return (
    <div className="flex flex-wrap items-center gap-2 border-b border-mist/60 bg-paper px-4 py-2.5">
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" onClick={props.onAddText}>
          <Type className="h-4 w-4" /> Text
        </Button>
        <Button variant="outline" size="sm" onClick={props.onAddRect}>
          <Square className="h-4 w-4" /> Shape
        </Button>
        <Button variant="outline" size="sm" onClick={props.onAddImage}>
          <ImagePlus className="h-4 w-4" /> Image
        </Button>
      </div>

      <span className="mx-1 h-5 w-px bg-mist/70" />

      <select
        value=""
        onChange={(e) => {
          if (e.target.value) props.onLoadTemplate(e.target.value);
          e.target.value = '';
        }}
        aria-label="Load a template"
        className="rounded-md border border-mist/70 bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-graphite focus:outline-none"
      >
        <option value="">Templates…</option>
        {TEMPLATES.map((t) => (
          <option key={t.key} value={t.key}>
            {t.label}
          </option>
        ))}
      </select>

      <select
        value={props.size.key}
        onChange={(e) => {
          const s = SIZES.find((x) => x.key === e.target.value);
          if (s) props.onSize(s);
        }}
        aria-label="Artboard size"
        className="rounded-md border border-mist/70 bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-graphite focus:outline-none"
      >
        {sizeOptions.map((s) => (
          <option key={s.key} value={s.key}>
            {s.label}
          </option>
        ))}
      </select>

      <span className="mx-1 h-5 w-px bg-mist/70" />

      <div className="flex items-center gap-1">
        <IconBtn label="Undo" onClick={props.onUndo} disabled={!props.canUndo}>
          <Undo2 className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Redo" onClick={props.onRedo} disabled={!props.canRedo}>
          <Redo2 className="h-4 w-4" />
        </IconBtn>
      </div>

      <span className="mx-1 h-5 w-px bg-mist/70" />

      <div className="flex items-center gap-1">
        <IconBtn label="Zoom out" onClick={() => props.onZoom(-0.1)}>
          <ZoomOut className="h-4 w-4" />
        </IconBtn>
        <span className="w-12 text-center text-xs tabular-nums text-steel">
          {Math.round(props.scale * 100)}%
        </span>
        <IconBtn label="Zoom in" onClick={() => props.onZoom(0.1)}>
          <ZoomIn className="h-4 w-4" />
        </IconBtn>
        <IconBtn label="Fit to screen" onClick={props.onFit}>
          <Maximize className="h-4 w-4" />
        </IconBtn>
      </div>

      <div className="ml-auto flex items-center gap-2">
        <Button variant="outline" size="sm" onClick={props.onExportPng}>
          <Download className="h-4 w-4" /> PNG
        </Button>
        <Button variant="outline" size="sm" onClick={props.onExportPdf}>
          <FileText className="h-4 w-4" /> PDF
        </Button>
        <Button size="sm" onClick={props.onGenerate} disabled={!props.canGenerate}>
          <Layers className="h-4 w-4" /> Generate set
        </Button>
      </div>
    </div>
  );
}

function IconBtn({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1.5 text-graphite transition-colors hover:bg-surface disabled:opacity-40"
    >
      {children}
    </button>
  );
}

// --- Left: layers ------------------------------------------------------------
function LayersPanel({
  els,
  selectedId,
  onSelect,
  onReorder,
}: {
  els: El[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onReorder: (dir: 'up' | 'down' | 'front' | 'back') => void;
}) {
  const label = (el: El) =>
    el.type === 'text' ? (el as TextEl).text || 'Text' : el.type === 'rect' ? 'Shape' : 'Image';
  return (
    <aside className="flex w-52 shrink-0 flex-col border-r border-mist/60 bg-paper">
      <div className="flex items-center justify-between px-3 py-2.5">
        <p className="text-[11px] font-medium uppercase tracking-brand text-steel">Layers</p>
        <div className="flex gap-0.5">
          <IconBtn label="Bring forward" onClick={() => onReorder('up')}>
            <ArrowUp className="h-3.5 w-3.5" />
          </IconBtn>
          <IconBtn label="Send backward" onClick={() => onReorder('down')}>
            <ArrowDown className="h-3.5 w-3.5" />
          </IconBtn>
        </div>
      </div>
      <ul className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2">
        {els.length === 0 ? (
          <li className="px-2 py-2 text-xs text-steel">
            Empty canvas. Add text, a shape, or an image to start.
          </li>
        ) : (
          // Top layer first (last in array renders on top).
          [...els].reverse().map((el) => (
            <li key={el.id}>
              <button
                type="button"
                onClick={() => onSelect(el.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  el.id === selectedId
                    ? 'bg-surface font-medium text-ink'
                    : 'text-graphite hover:bg-surface/60',
                )}
              >
                <span className="shrink-0 text-steel">
                  {el.type === 'text' ? (
                    <Type className="h-3.5 w-3.5" />
                  ) : el.type === 'rect' ? (
                    <Square className="h-3.5 w-3.5" />
                  ) : (
                    <ImagePlus className="h-3.5 w-3.5" />
                  )}
                </span>
                <span className="min-w-0 flex-1 truncate">{label(el)}</span>
              </button>
            </li>
          ))
        )}
      </ul>
    </aside>
  );
}

// --- Right: properties -------------------------------------------------------
const fieldCls =
  'w-full rounded-md border border-mist/70 bg-paper px-2.5 py-1.5 text-sm text-ink focus:border-graphite focus:outline-none';

function PropertiesPanel({
  selected,
  onPatch,
  onDelete,
  onReplaceImage,
}: {
  selected: El | null;
  onPatch: (patch: Partial<El>) => void;
  onDelete: () => void;
  onReplaceImage: () => void;
}) {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-l border-mist/60 bg-paper p-4">
      {!selected ? (
        <p className="text-sm text-steel">Select an element to edit its properties.</p>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-[11px] font-medium uppercase tracking-brand text-steel">
              {selected.type}
            </p>
            <button
              type="button"
              onClick={onDelete}
              aria-label="Delete element"
              className="rounded-md p-1.5 text-steel hover:text-fail"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>

          {selected.type === 'text' ? (
            <TextProps el={selected as TextEl} onPatch={onPatch} />
          ) : selected.type === 'rect' ? (
            <RectProps el={selected as RectEl} onPatch={onPatch} />
          ) : (
            <ImageProps onReplace={onReplaceImage} />
          )}

          {/* Common transform */}
          <div>
            <p className="mb-1.5 text-[11px] font-medium uppercase tracking-brand text-steel">
              Position &amp; size
            </p>
            <div className="grid grid-cols-2 gap-2">
              <NumField label="X" value={selected.x} onChange={(v) => onPatch({ x: v })} />
              <NumField label="Y" value={selected.y} onChange={(v) => onPatch({ y: v })} />
              <NumField label="W" value={selected.width} onChange={(v) => onPatch({ width: v })} />
              <NumField
                label="H"
                value={selected.height}
                onChange={(v) => onPatch({ height: v })}
              />
              <NumField
                label="Rotation"
                value={selected.rotation}
                onChange={(v) => onPatch({ rotation: v })}
              />
              <NumField
                label="Opacity"
                value={selected.opacity}
                step={0.1}
                onChange={(v) => onPatch({ opacity: Math.max(0, Math.min(1, v)) })}
              />
            </div>
          </div>
        </>
      )}
    </aside>
  );
}

function TextProps({ el, onPatch }: { el: TextEl; onPatch: (p: Partial<El>) => void }) {
  const bold = el.fontStyle.includes('bold');
  const italic = el.fontStyle.includes('italic');
  const setStyle = (b: boolean, i: boolean) =>
    onPatch({ fontStyle: [b ? 'bold' : '', i ? 'italic' : ''].filter(Boolean).join(' ') });
  const strike = el.textDecoration === 'line-through';
  return (
    <div className="flex flex-col gap-2">
      {/* Data binding — the field that auto-fills this text per product */}
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-steel">Data field</span>
        <select
          value={el.bind ?? ''}
          onChange={(e) =>
            onPatch({ bind: (e.target.value || undefined) as BindKey | undefined })
          }
          className={fieldCls}
        >
          <option value="">— Static text —</option>
          {BIND_OPTIONS.map((o) => (
            <option key={o.key} value={o.key}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <textarea
        value={el.text}
        onChange={(e) => onPatch({ text: e.target.value })}
        rows={2}
        className={cn(fieldCls, 'resize-y')}
        aria-label="Text content"
        placeholder={el.bind ? 'Sample text (replaced by data)' : undefined}
      />
      <div className="grid grid-cols-2 gap-2">
        <NumField label="Size" value={el.fontSize} onChange={(v) => onPatch({ fontSize: v })} />
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-steel">Colour</span>
          <input
            type="color"
            value={el.fill}
            onChange={(e) => onPatch({ fill: e.target.value })}
            className="h-8 w-full rounded-md border border-mist/70 bg-paper"
          />
        </label>
      </div>
      <div className="flex gap-1">
        <ToggleBtn active={bold} onClick={() => setStyle(!bold, italic)} label="Bold">
          B
        </ToggleBtn>
        <ToggleBtn active={italic} onClick={() => setStyle(bold, !italic)} label="Italic">
          <span className="italic">I</span>
        </ToggleBtn>
        <ToggleBtn
          active={strike}
          onClick={() => onPatch({ textDecoration: strike ? '' : 'line-through' })}
          label="Strikethrough"
        >
          <span className="line-through">S</span>
        </ToggleBtn>
        {(['left', 'center', 'right'] as const).map((a) => (
          <ToggleBtn
            key={a}
            active={el.align === a}
            onClick={() => onPatch({ align: a })}
            label={`Align ${a}`}
          >
            {a.charAt(0).toUpperCase()}
          </ToggleBtn>
        ))}
      </div>
    </div>
  );
}

function RectProps({ el, onPatch }: { el: RectEl; onPatch: (p: Partial<El>) => void }) {
  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-steel">Fill</span>
        <input
          type="color"
          value={el.fill}
          onChange={(e) => onPatch({ fill: e.target.value })}
          className="h-8 w-full rounded-md border border-mist/70 bg-paper"
        />
      </label>
      <div className="grid grid-cols-2 gap-2">
        <NumField
          label="Corner radius"
          value={el.cornerRadius}
          onChange={(v) => onPatch({ cornerRadius: v })}
        />
        <NumField
          label="Border width"
          value={el.strokeWidth}
          onChange={(v) => onPatch({ strokeWidth: v })}
        />
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[11px] text-steel">Border colour</span>
        <input
          type="color"
          value={el.stroke || '#000000'}
          onChange={(e) => onPatch({ stroke: e.target.value })}
          className="h-8 w-full rounded-md border border-mist/70 bg-paper"
        />
      </label>
    </div>
  );
}

function ImageProps({ onReplace }: { onReplace: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onReplace}>
      <ImagePlus className="h-4 w-4" /> Replace image
    </Button>
  );
}

function NumField({
  label,
  value,
  step = 1,
  onChange,
}: {
  label: string;
  value: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[11px] text-steel">{label}</span>
      <input
        type="number"
        step={step}
        value={Math.round(value * 100) / 100}
        onChange={(e) => onChange(Number(e.target.value))}
        className={fieldCls}
      />
    </label>
  );
}

function ToggleBtn({
  children,
  active,
  onClick,
  label,
}: {
  children: React.ReactNode;
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'grid h-8 w-8 place-items-center rounded-md border text-sm font-semibold transition-colors',
        active
          ? 'border-ink bg-ink text-paper'
          : 'border-mist/70 text-graphite hover:bg-surface',
      )}
    >
      {children}
    </button>
  );
}
