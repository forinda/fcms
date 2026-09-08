import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { api, ApiError, type ContentType, type Entry, type Field, type Spec } from "../lib/api";
import { useAsync } from "../lib/use-async";

/**
 * One row, edited.
 *
 * The controls come from the type's declarations, exactly as the server-
 * rendered form does (ADR 0038): one generator, no per-type screens, and a
 * field the schema knows about is a field this can edit without being told.
 *
 * What it deliberately does not do yet is references and files. Those need the
 * pickers the server form has, and a text box that saves `ref:service/cut` is
 * the transcription this project already refused once — so those fields hand
 * over to the screen that can.
 */
export function EntryEdit() {
  const { type: typeKey, id } = useParams();
  const navigate = useNavigate();

  const spec = useAsync(() => api.get<{ spec: Spec }>("/api/spec").then((r) => r.spec), []);
  const rows = useAsync(
    () => api.get<{ entries: Entry[] }>(`/api/entries/${typeKey}`).then((r) => r.entries),
    [typeKey],
  );

  const type = spec.data?.content.find((t) => t.key === typeKey);
  const entry = rows.data?.find((row) => row.id === id);

  const [values, setValues] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | undefined>(undefined);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (entry) setValues(entry.data);
  }, [entry]);

  if (spec.loading || rows.loading) return <p className="muted">Loading…</p>;
  if (!type || !entry) return <p className="error">That entry is not here.</p>;

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setProblem(undefined);
    setSaved(false);

    try {
      await api.patch(`/api/entries/${type.key}/${entry.id}`, { data: values });
      setSaved(true);
    } catch (error) {
      // The engine names the field; showing its own words beats inventing
      // friendlier ones that say less.
      setProblem(
        error instanceof ApiError && error.issues.length > 0
          ? error.issues.map((i) => `${i.path ?? ""}: ${i.message ?? ""}`.trim()).join("; ")
          : error instanceof Error
            ? error.message
            : String(error),
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <p className="muted">
        <Link to={`/content/${type.key}`}>← {type.labelPlural ?? type.label}</Link>
      </p>
      <h1>Edit {type.label.toLowerCase()}</h1>

      {problem ? (
        <p className="error" role="alert">
          {problem}
        </p>
      ) : null}
      {saved ? (
        <p className="muted" role="status">
          Saved.
        </p>
      ) : null}

      <form onSubmit={save}>
        {type.fields.map((field) => (
          <Control
            key={field.name}
            field={field}
            type={type}
            entryId={entry.id}
            value={values[field.name]}
            onChange={(value) => setValues((was) => ({ ...was, [field.name]: value }))}
          />
        ))}

        <p>
          <button type="submit" disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </button>{" "}
          <button className="quiet" type="button" onClick={() => navigate(`/content/${type.key}`)}>
            Back
          </button>
        </p>
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

  // Handed over rather than half-built: these need the pickers and the grid the
  // server-rendered form has, and a text box holding `asset:01a0…` is the
  // transcription ADR 0038 exists to have removed.
  if (["reference", "asset", "hours", "geo", "aggregate", "computed"].includes(field.type)) {
    return (
      <p>
        <strong>{field.label}</strong>{" "}
        <a href={`/admin/content/${type.key}/${entryId}`}>edit this one in the full form</a>
      </p>
    );
  }

  return (
    <p>
      <label htmlFor={id}>
        {field.label}
        {field.required ? <span className="muted"> required</span> : null}
      </label>
      <br />
      {field.type === "boolean" ? (
        <input
          id={id}
          type="checkbox"
          checked={value === true}
          onChange={(event) => onChange(event.target.checked)}
        />
      ) : field.type === "select" || field.type === "state" ? (
        <select id={id} value={text} onChange={(event) => onChange(event.target.value)}>
          <option value="">—</option>
          {(field.options ?? (field.values ?? []).map((v) => ({ value: v, label: v }))).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          id={id}
          type={inputType(field.type)}
          value={text}
          onChange={(event) =>
            onChange(field.type === "number" ? Number(event.target.value) : event.target.value)
          }
        />
      )}
    </p>
  );
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
