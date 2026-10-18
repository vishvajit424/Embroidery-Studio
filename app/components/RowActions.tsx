import { useFetcher } from "react-router";

/** Up / down / delete buttons for a library row, posted via a fetcher. */
export function RowActions({ id, first, last, label }: { id: string; first: boolean; last: boolean; label: string }) {
  const fetcher = useFetcher();
  const busy = fetcher.state !== "idle";
  const post = (intent: string) => {
    if (intent === "delete" && !window.confirm(`Delete ${label}?`)) return;
    fetcher.submit({ intent, id }, { method: "post" });
  };
  return (
    <s-stack direction="inline" gap="small-200">
      <s-button variant="tertiary" icon="arrow-up" accessibilityLabel={`Move ${label} up`} disabled={first || busy} onClick={() => post("up")} />
      <s-button variant="tertiary" icon="arrow-down" accessibilityLabel={`Move ${label} down`} disabled={last || busy} onClick={() => post("down")} />
      <s-button variant="tertiary" tone="critical" icon="delete" accessibilityLabel={`Delete ${label}`} disabled={busy} onClick={() => post("delete")} />
    </s-stack>
  );
}
