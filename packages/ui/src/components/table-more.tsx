import type { ComponentProps, ReactNode } from "react";
import { cn } from "#lib/utils.ts";
import { TableCell, TableRow } from "./table.tsx";

/** One item's rows in a `table`: its row and what continues it, with no rule between them. */
function TableItem({ className, ...props }: ComponentProps<"tbody">) {
  return (
    <tbody
      data-slot="table-item"
      className={cn(
        "last:[&>tr:last-child>td]:border-b-0 [&>tr:not(:last-child)>td]:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

/** What continues an item's row, under it and across the table: a question asked in place, or what to do next. */
function TableMore({
  columns,
  className,
  children,
}: {
  columns: number;
  className?: string;
  children: ReactNode;
}) {
  return (
    <TableRow data-slot="table-more">
      <TableCell colSpan={columns} className={cn("pt-0 pb-3", className)}>
        {children}
      </TableCell>
    </TableRow>
  );
}

export { TableItem, TableMore };
