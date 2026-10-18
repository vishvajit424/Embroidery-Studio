/** Minimal shape of the Admin GraphQL client returned by authenticate.*() */
export type AdminGraphql = {
  graphql: (query: string, options?: { variables?: Record<string, unknown> }) => Promise<Response>;
};

export class ShopifyApiError extends Error {
  details: unknown;
  constructor(message: string, details?: unknown) {
    super(message);
    this.name = "ShopifyApiError";
    this.details = details;
  }
}

/** Runs a GraphQL call and throws a ShopifyApiError on transport/GraphQL errors. */
export async function gql<T = any>(admin: AdminGraphql, query: string, variables?: Record<string, unknown>): Promise<T> {
  const response = await admin.graphql(query, variables ? { variables } : undefined);
  const json: any = await response.json();
  if (json.errors) {
    const message = Array.isArray(json.errors)
      ? json.errors.map((e: any) => e.message).join("; ")
      : String(json.errors.message || json.errors);
    throw new ShopifyApiError(message, json.errors);
  }
  return json.data as T;
}

export function userErrorsMessage(errors: Array<{ message: string }> | undefined | null): string {
  return (errors || []).map((e) => e.message).join("; ");
}
