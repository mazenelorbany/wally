// =============================================================================
// @wally/ui — public surface.
//
// The TCC design system: warm monochrome + ONE signal red, geometric type,
// colour-blind-safe verdicts (icon + label always carry meaning; hue is
// reinforcement only). Emits CommonJS via tsc; consumed by apps/web (Vite).
//
//   import { Button, Verdict, verdictMeta } from "@wally/ui";
//   import "@wally/ui/styles.css";                 // tokens as CSS vars
//   // tailwind.config.cjs:
//   //   presets: [require("@wally/ui/tailwind-preset.cjs")]
// =============================================================================

// --- Utilities ---------------------------------------------------------------
export { cn } from "./lib/cn";

// --- Design tokens (runtime-pure data) --------------------------------------
export {
  palette,
  verdictMeta,
  criterionMeta,
  fontStack,
  radius,
  easing,
  duration,
  type PaletteToken,
  type VerdictMeta,
  type VerdictKey,
  type VerdictIconName,
} from "./tokens";

// --- Primitives -------------------------------------------------------------
export { Button, type ButtonProps } from "./components/Button";

export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/Card";

export { Badge, type BadgeProps } from "./components/Badge";

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableRow,
  TableHead,
  TableCell,
  TableCaption,
} from "./components/Table";

export {
  Dialog,
  DialogTrigger,
  DialogClose,
  DialogPortal,
  DialogOverlay,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
  type DialogContentProps,
} from "./components/Dialog";

export {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from "./components/Tooltip";

export { Spinner, type SpinnerProps } from "./components/Spinner";

// --- Brand atoms ------------------------------------------------------------
export {
  Verdict,
  type VerdictProps,
  type VerdictTone,
} from "./components/Verdict";

export {
  StatusSpine,
  type StatusSpineProps,
  type SpineStep,
  type StepState,
} from "./components/StatusSpine";

export {
  ConfidenceBar,
  type ConfidenceBarProps,
} from "./components/ConfidenceBar";

export { Brandmark, type BrandmarkProps } from "./components/Brandmark";
