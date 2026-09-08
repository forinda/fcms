import { Link } from "react-router";

export function NotFound() {
  return (
    <>
      <h1>Not here</h1>
      <p className="muted">
        Nothing lives at this address. <Link to="/">Back to the overview</Link>, or the{" "}
        <a href="/admin">rest of the admin</a>.
      </p>
    </>
  );
}
