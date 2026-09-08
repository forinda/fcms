import { useQuery } from "@tanstack/react-query";
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from "@tanstack/react-table";
import { useMemo, useState } from "react";
import { Link, useParams } from "react-router";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ContentType, Entry } from "@/lib/api";
import { entriesQuery, specQuery } from "@/lib/queries";

/**
 * One type's rows.
 *
 * TanStack Table does the sorting, filtering and paging over what the API
 * returned. That is a stated ceiling rather than a design: the server-rendered
 * list does all three in SQL (ADR 0037), and this matches it when the API grows
 * the same parameters. Until then the screen says how many rows it is looking
 * at, so nobody mistakes a filtered page for the whole site.
 */
export default function Entries() {
  const { type: typeKey = "" } = useParams();
  const spec = useQuery(specQuery);
  const rows = useQuery(entriesQuery(typeKey));

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");

  const type = spec.data?.content.find((t) => t.key === typeKey);
  const columns = useMemo(() => columnsFor(type), [type]);

  const filtered = useMemo(
    () => (rows.data ?? []).filter((entry) => status === "all" || entry.status === status),
    [rows.data, status],
  );

  const table = useReactTable({
    data: filtered,
    columns,
    state: { globalFilter: search },
    onGlobalFilterChange: setSearch,
    globalFilterFn: "includesString",
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    initialState: { pagination: { pageSize: 25 } },
  });

  if (spec.isPending || rows.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (rows.error) {
    return (
      <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
        {rows.error.message}
      </p>
    );
  }
  if (!type) return <p className="text-muted-foreground">This site has no “{typeKey}” to show.</p>;

  const page = table.getState().pagination.pageIndex + 1;
  const pages = Math.max(1, table.getPageCount());

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">{type.labelPlural ?? type.label}</h1>
      <p className="mt-1 text-sm">
        <a className="underline underline-offset-4" href={`/admin/content/${type.key}/new`}>
          Add {type.label.toLowerCase()}
        </a>
      </p>

      <form
        role="search"
        className="mt-4 flex flex-wrap items-end gap-3"
        onSubmit={(event) => event.preventDefault()}
      >
        <div className="grid gap-1.5">
          <Label htmlFor="q">Search</Label>
          <Input
            id="q"
            type="search"
            value={search}
            placeholder="Search these rows…"
            className="w-64"
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="status">Showing</Label>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger id="status" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Everything</SelectItem>
              <SelectItem value="published">Published</SelectItem>
              <SelectItem value="draft">Drafts</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </form>

      <p className="mt-3 text-sm text-muted-foreground">
        {table.getFilteredRowModel().rows.length} of {rows.data.length} loaded
      </p>

      <Table className="mt-1">
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : (
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 hover:text-foreground"
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      {flexRender(header.column.columnDef.header, header.getContext())}
                      <span aria-hidden="true">
                        {{ asc: "↑", desc: "↓" }[header.column.getIsSorted() as string] ?? ""}
                      </span>
                    </button>
                  )}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {table.getRowModel().rows.map((row) => (
            <TableRow key={row.id}>
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  {flexRender(cell.column.columnDef.cell, cell.getContext())}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {pages > 1 ? (
        <nav className="mt-4 flex items-center gap-3 text-sm" aria-label="Pages">
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
          >
            Previous
          </Button>
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
          >
            Next
          </Button>
        </nav>
      ) : null}
    </>
  );
}

/**
 * The columns a type deserves.
 *
 * Its title, its slug, whether the public can see it — and one more, chosen
 * from what the type declares (ADR 0037 §4), because a table of names and slugs
 * makes an owner open every row to find the one they want.
 */
function columnsFor(type: ContentType | undefined): ColumnDef<Entry>[] {
  if (!type) return [];
  const titleField = type.titleField ?? "name";
  const second = type.fields.find(
    (field) =>
      field.name !== titleField &&
      field.name !== "slug" &&
      ["state", "datetime", "date", "reference", "select", "number"].includes(field.type),
  );

  return [
    {
      id: "title",
      header: type.label,
      accessorFn: (entry) =>
        String(entry.data[titleField] ?? entry.data["title"] ?? entry.slug ?? "—"),
      cell: ({ row, getValue }) => (
        <Link
          className="underline-offset-4 hover:underline"
          to={`/content/${type.key}/${row.original.id}`}
        >
          {String(getValue())}
        </Link>
      ),
    },
    ...(second
      ? [
          {
            id: second.name,
            header: second.label,
            accessorFn: (entry: Entry) => cell(entry.data[second.name]),
            cell: ({ getValue }) => (
              <span className="text-muted-foreground">{String(getValue())}</span>
            ),
          } satisfies ColumnDef<Entry>,
        ]
      : []),
    {
      id: "slug",
      header: "Slug",
      accessorFn: (entry) => entry.slug ?? "",
      cell: ({ getValue }) => <span className="text-muted-foreground">{String(getValue())}</span>,
    },
    {
      id: "status",
      header: "On the site",
      accessorFn: (entry) => entry.status,
      cell: ({ getValue }) => (
        <Badge variant={getValue() === "draft" ? "secondary" : "default"}>
          {String(getValue())}
        </Badge>
      ),
    },
  ];
}

/** A value in a cell: readable, short, and never a raw object. */
function cell(value: unknown): string {
  if (value === undefined || value === null || value === "") return "—";
  if (typeof value === "object") return "—";

  // A reference is stored as `ref:type/slug` (ADR 0001). The slug is the half a
  // person recognises; the rest is addressing. Resolving it to the row's title
  // needs the API to answer for another type, which is the next increment.
  const text = String(value);
  return text.startsWith("ref:") ? (text.split("/").pop() ?? text) : text;
}
