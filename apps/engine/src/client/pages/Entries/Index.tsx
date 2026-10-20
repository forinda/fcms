import { Head, router } from "@inertiajs/react";
import { useState, type FormEvent } from "react";

import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "../../components/ui/table";
import { Layout } from "../../Layout";

/**
 * One type's rows, a page at a time (ADR 0037, ADR 0051).
 *
 * Searching, filtering, ordering and paging all happen in SQL; this page only
 * asks for a different URL. So a filtered list is still something somebody
 * can bookmark, and "12 of 3,400" is about the site rather than about what
 * happened to be loaded.
 */
type Status = "" | "draft" | "published";
type Sort = "newest" | "oldest" | "updated" | "title";

interface Props {
  type: { key: string; label: string; labelPlural: string; derived: boolean };
  secondLabel: string | null;
  rows: {
    id: string;
    title: string;
    second: string | null;
    slug: string;
    status: "draft" | "published";
  }[];
  total: number;
  page: number;
  pages: number;
  perPage: number;
  filters: { q: string; status: Status; sort: Sort };
  canWrite: boolean;
}

const SORTS: { value: Sort; label: string }[] = [
  { value: "newest", label: "Newest first" },
  { value: "oldest", label: "Oldest first" },
  { value: "updated", label: "Recently changed" },
  { value: "title", label: "By name" },
];

export default function EntriesIndex(props: Props) {
  const { type, rows, total, page, pages, perPage, filters, canWrite } = props;
  const [q, setQ] = useState(filters.q);
  const base = `/admin/content/${type.key}`;
  const filtered = filters.q !== "" || filters.status !== "";

  // Only what differs from the default goes in the URL, so the plain list
  // stays the plain address.
  const visit = (next: Partial<Props["filters"]> & { page?: number }) => {
    const wanted = { ...filters, q, page: 1, ...next };
    const query: Record<string, string> = {};
    if (wanted.q) query["q"] = wanted.q;
    if (wanted.status) query["status"] = wanted.status;
    if (wanted.sort !== "newest") query["sort"] = wanted.sort;
    if (wanted.page > 1) query["page"] = String(wanted.page);
    router.get(base, query, { preserveState: true, preserveScroll: true });
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    visit({});
  };

  const first = total === 0 ? 0 : (page - 1) * perPage + 1;
  const last = Math.min(page * perPage, total);

  return (
    <Layout>
      <Head title={`${type.labelPlural} — Admin`} />

      <h1 className="text-2xl font-semibold tracking-tight">{type.labelPlural}</h1>
      <p className="mt-1 text-sm">
        {type.derived ? (
          <span className="text-muted-foreground">
            Computed from other content, so there is nothing to edit here.
          </span>
        ) : (
          <a className="underline underline-offset-4" href={`${base}/new`}>
            Add {type.label.toLowerCase()}
          </a>
        )}
      </p>

      <form role="search" className="mt-4 flex flex-wrap items-end gap-3" onSubmit={search}>
        <div className="grid gap-1.5">
          <Label htmlFor="q">Search</Label>
          <Input
            id="q"
            type="search"
            value={q}
            placeholder="Name or slug…"
            className="w-64"
            onChange={(event) => setQ(event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="status">Showing</Label>
          <Select
            value={filters.status || "all"}
            onValueChange={(value) => visit({ status: value === "all" ? "" : (value as Status) })}
          >
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
        <div className="grid gap-1.5">
          <Label htmlFor="sort">Ordered</Label>
          <Select value={filters.sort} onValueChange={(value) => visit({ sort: value as Sort })}>
            <SelectTrigger id="sort" className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.value} value={s.value}>
                  {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <Button type="submit">Search</Button>
        {filtered ? (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setQ("");
              visit({ q: "", status: "" });
            }}
          >
            Clear
          </Button>
        ) : null}
      </form>

      {rows.length === 0 ? (
        <p className="mt-4 text-muted-foreground">
          {filtered ? "Nothing matches that." : `No ${type.labelPlural.toLowerCase()} yet.`}
        </p>
      ) : (
        <>
          <p className="mt-3 text-sm text-muted-foreground">
            {first}–{last} of {total}
          </p>

          <Table className="mt-1">
            <caption className="sr-only">{type.labelPlural}</caption>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">{type.label}</TableHead>
                {props.secondLabel ? <TableHead scope="col">{props.secondLabel}</TableHead> : null}
                <TableHead scope="col">Slug</TableHead>
                <TableHead scope="col">On the site</TableHead>
                {canWrite ? (
                  <TableHead scope="col">
                    <span className="sr-only">Actions</span>
                  </TableHead>
                ) : null}
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
                    {type.derived ? (
                      row.title
                    ) : (
                      <a className="underline-offset-4 hover:underline" href={`${base}/${row.id}`}>
                        {row.title}
                      </a>
                    )}
                  </TableCell>
                  {props.secondLabel ? (
                    <TableCell className="text-muted-foreground">{row.second}</TableCell>
                  ) : null}
                  <TableCell className="text-muted-foreground">{row.slug}</TableCell>
                  <TableCell>
                    <Badge variant={row.status === "draft" ? "secondary" : "default"}>
                      {row.status}
                    </Badge>
                  </TableCell>
                  {canWrite ? (
                    <TableCell>
                      <Button
                        variant="link"
                        size="sm"
                        onClick={() =>
                          router.post(
                            `${base}/${row.id}/status`,
                            { status: row.status === "draft" ? "published" : "draft" },
                            { preserveScroll: true },
                          )
                        }
                      >
                        {row.status === "draft" ? "publish" : "unpublish"}
                      </Button>
                    </TableCell>
                  ) : null}
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {pages > 1 ? (
            <nav
              className="mt-4 flex items-center gap-3 text-sm"
              aria-label={`Pages of ${type.labelPlural.toLowerCase()}`}
            >
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => visit({ ...filters, page: page - 1 })}
              >
                Previous
              </Button>
              <span className="text-muted-foreground">
                Page {page} of {pages}
              </span>
              <Button
                variant="outline"
                size="sm"
                disabled={page >= pages}
                onClick={() => visit({ ...filters, page: page + 1 })}
              >
                Next
              </Button>
            </nav>
          ) : null}
        </>
      )}
    </Layout>
  );
}
