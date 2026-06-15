import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Editorial data table — the surface most of Wally's review work lives on
 * (store rosters, photo queues, score breakdowns). Hairline rules, generous
 * leading, geometric heads. Wrap in <Table> for horizontal scroll on narrow
 * viewports; compose the parts (<TableHeader>, <TableBody>, <TableRow>,
 * <TableHead>, <TableCell>) to build the grid.
 *
 * Colour-blind safe by construction: status is carried by <Verdict> / <Badge>
 * cells, never by row tinting alone.
 */

export const Table = React.forwardRef<
  HTMLTableElement,
  React.TableHTMLAttributes<HTMLTableElement>
>(({ className, ...rest }, ref) => (
  <div className="relative w-full overflow-x-auto">
    <table
      ref={ref}
      className={cn(
        "w-full caption-bottom border-collapse font-sans text-[13px] text-ink",
        className,
      )}
      {...rest}
    />
  </div>
));
Table.displayName = "Table";

export const TableHeader = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...rest }, ref) => (
  <thead
    ref={ref}
    className={cn("[&_tr]:border-b [&_tr]:border-mist/70", className)}
    {...rest}
  />
));
TableHeader.displayName = "TableHeader";

export const TableBody = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...rest }, ref) => (
  <tbody
    ref={ref}
    className={cn(
      "[&_tr:last-child]:border-0 [&_tr]:border-b [&_tr]:border-mist/40",
      className,
    )}
    {...rest}
  />
));
TableBody.displayName = "TableBody";

export const TableFooter = React.forwardRef<
  HTMLTableSectionElement,
  React.HTMLAttributes<HTMLTableSectionElement>
>(({ className, ...rest }, ref) => (
  <tfoot
    ref={ref}
    className={cn(
      "border-t border-mist/70 bg-surface/60 font-medium text-graphite",
      className,
    )}
    {...rest}
  />
));
TableFooter.displayName = "TableFooter";

export const TableRow = React.forwardRef<
  HTMLTableRowElement,
  React.HTMLAttributes<HTMLTableRowElement>
>(({ className, ...rest }, ref) => (
  <tr
    ref={ref}
    className={cn(
      "transition-colors duration-fast ease-standard hover:bg-surface/60 data-[state=selected]:bg-surface",
      className,
    )}
    {...rest}
  />
));
TableRow.displayName = "TableRow";

export const TableHead = React.forwardRef<
  HTMLTableCellElement,
  React.ThHTMLAttributes<HTMLTableCellElement>
>(({ className, ...rest }, ref) => (
  <th
    ref={ref}
    scope="col"
    className={cn(
      "h-9 px-3 text-left align-middle font-sans text-xs font-medium text-steel",
      "[&:has([role=checkbox])]:pr-0",
      className,
    )}
    {...rest}
  />
));
TableHead.displayName = "TableHead";

export const TableCell = React.forwardRef<
  HTMLTableCellElement,
  React.TdHTMLAttributes<HTMLTableCellElement>
>(({ className, ...rest }, ref) => (
  <td
    ref={ref}
    className={cn(
      "px-3 py-2.5 align-middle leading-tight [&:has([role=checkbox])]:pr-0",
      className,
    )}
    {...rest}
  />
));
TableCell.displayName = "TableCell";

export const TableCaption = React.forwardRef<
  HTMLTableCaptionElement,
  React.HTMLAttributes<HTMLTableCaptionElement>
>(({ className, ...rest }, ref) => (
  <caption
    ref={ref}
    className={cn("mt-3 text-xs text-steel", className)}
    {...rest}
  />
));
TableCaption.displayName = "TableCaption";
