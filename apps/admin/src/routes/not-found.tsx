import { Link } from "react-router";

export default function NotFound() {
  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Not here</h1>
      <p className="mt-3 text-sm text-muted-foreground">
        Nothing lives at this address.{" "}
        <Link className="underline underline-offset-4" to="/">
          Back to the overview
        </Link>
        , or the{" "}
        <a className="underline underline-offset-4" href="/admin">
          rest of the admin
        </a>
        .
      </p>
    </>
  );
}
