import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

// `authenticate.auth` does not exist - OAuth/token-exchange paths are handled
// by `authenticate.admin`.
export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return null;
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
