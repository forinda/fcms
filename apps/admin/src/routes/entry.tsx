import { useForm } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate, useParams } from "react-router";

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
import { api, ApiError, type ContentType, type Entry, type Field } from "@/lib/api";
import { entriesQuery, specQuery } from "@/lib/queries";

/**
 * One row, edited.
 *
 * The controls come from the type's declarations, exactly as the server-
 * rendered form does (ADR 0038): one generator, no per-type screens, and a
 * field the schema knows about is editable without being told.
 *
 * What it deliberately does not do yet is references, files and opening hours.
 * Those need the pickers and the grid the server form has, and a text box that
 * saves `ref:service/cut` is the transcription this project already refused
 * once — so those fields hand over to the screen that can.
 */
export default function EntryEdit() {
  const { type: typeKey = "", id = "" } = useParams();
  const navigate = useNavigate();
  const queries = useQueryClient();

  const spec = useQuery(specQuery);
  const rows = useQuery(entriesQuery(typeKey));

  const type = spec.data?.content.find((t) => t.key === typeKey);
  const entry = rows.data?.find((row) => row.id === id);

  const save = useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.patch<{ entry: Entry }>(`/api/entries/${typeKey}/${id}`, { data }),
    // Every screen showing these rows hears about it, which is the thing a
    // hand-rolled cache never quite gets right.
    onSuccess: () => queries.invalidateQueries({ queryKey: ["entries", typeKey] }),
  });

  const form = useForm({
    defaultValues: (entry?.data ?? {}) as Record<string, unknown>,
    onSubmit: async ({ value }) => {
      await save.mutateAsync(value);
    },
  });

  if (spec.isPending || rows.isPending) return <p className="text-muted-foreground">Loading…</p>;
  if (!type || !entry) return <p className="text-muted-foreground">That entry is not here.</p>;

  return (
    <>
      <p className="text-sm">
        <Link className="underline underline-offset-4" to={`/content/${type.key}`}>
          ← {type.labelPlural ?? type.label}
        </Link>
      </p>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">
        Edit {type.label.toLowerCase()}
      </h1>

      {save.error ? (
        <p role="alert" className="mt-3 rounded-md bg-destructive/10 px-3 py-2 text-destructive">
          {reason(save.error)}
        </p>
      ) : null}
      {save.isSuccess && !save.isPending ? (
        <p role="status" className="mt-3 text-sm text-muted-foreground">
          Saved.
        </p>
      ) : null}

      <form
        className="mt-4 grid max-w-xl gap-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        {type.fields.map((field) => (
          <form.Field key={field.name} name={field.name}>
            {(bound) => (
              <Control
                field={field}
                type={type}
                entryId={entry.id}
                value={bound.state.value}
                onChange={(value) => bound.handleChange(value)}
              />
            )}
          </form.Field>
        ))}

        <div className="flex gap-2">
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? "Saving…" : "Save"}
          </Button>
          <Button type="button" variant="outline" onClick={() => navigate(`/content/${type.key}`)}>
            Back
          </Button>
        </div>
      </form>
    </>
  );
}

function Control({
  field,
  type,
  entryId,
  value,
  onChange,
}: {
  field: Field;
  type: ContentType;
  entryId: string;
  value: unknown;
  onChange: (value: unknown) => void;
}) {
  const id = `f-${field.name}`;
  const text = value === undefined || value === null ? "" : String(value);

  // Handed over rather than half-built: these need the pickers and the grid
  // the server-rendered form has, and a text box holding `asset:01a0…` is the
  // transcription ADR 0038 exists to have removed.
  if (["reference", "asset", "hours", "geo", "aggregate", "computed"].includes(field.type)) {
    return (
      <p className="text-sm">
        <span className="font-medium">{field.label}</span>{" "}
        <a className="underline underline-offset-4" href={`/admin/content/${type.key}/${entryId}`}>
          edit this one in the full form
        </a>
      </p>
    );
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>
        {field.label}
        {field.required ? <span className="ml-1 text-muted-foreground">required</span> : null}
      </Label>

      {field.type === "boolean" ? (
        <input
          id={id}
          type="checkbox"
          className="size-4 accent-[var(--color-primary)]"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : field.type === "select" || field.type === "state" ? (
        <Select value={text} onValueChange={onChange}>
          <SelectTrigger id={id} className="w-full">
            <SelectValue placeholder="—" />
          </SelectTrigger>
          <SelectContent>
            {(field.options ?? (field.values ?? []).map((v) => ({ value: v, label: v }))).map(
              (option) => (
                <SelectItem key={option.value} value={option.value}>
                  {option.label}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      ) : (
        <Input
          id={id}
          type={inputType(field.type)}
          value={text}
          onChange={(event) =>
            onChange(field.type === "number" ? Number(event.target.value) : event.target.value)
          }
        />
      )}
    </div>
  );
}

/** The engine names the field; its own words say more than friendlier ones. */
function reason(error: unknown): string {
  if (error instanceof ApiError && error.issues.length > 0) {
    return error.issues.map((i) => `${i.path ?? ""}: ${i.message ?? ""}`.trim()).join("; ");
  }
  return error instanceof Error ? error.message : String(error);
}

/** The same mapping the renderer uses, kept short until this shares it. */
function inputType(fieldType: string): string {
  switch (fieldType) {
    case "email":
      return "email";
    case "phone":
      return "tel";
    case "url":
      return "url";
    case "number":
      return "number";
    case "date":
      return "date";
    case "datetime":
      return "datetime-local";
    default:
      return "text";
  }
}
