type Props = { errors?: string[] | null; warnings?: string[] | null; success?: string | null };

/** Error / warning / success banners for action results. */
export function Banners({ errors, warnings, success }: Props) {
  return (
    <>
      {errors?.length ? (
        <s-banner tone="critical" heading="Please fix the following">
          <s-unordered-list>{errors.map((e) => <s-list-item key={e}>{e}</s-list-item>)}</s-unordered-list>
        </s-banner>
      ) : null}
      {warnings?.length ? (
        <s-banner tone="warning">
          <s-unordered-list>{warnings.map((w) => <s-list-item key={w}>{w}</s-list-item>)}</s-unordered-list>
        </s-banner>
      ) : null}
      {success && !errors?.length ? <s-banner tone="success">{success}</s-banner> : null}
    </>
  );
}
