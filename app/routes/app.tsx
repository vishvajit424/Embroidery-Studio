import { Outlet, useLoaderData, useRouteError, Link } from "react-router";
import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";

export async function loader({ request }: LoaderFunctionArgs) {
  await authenticate.admin(request);
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
}

export default function AppLayout() {
  const { apiKey } = useLoaderData<typeof loader>();
  return (
    <AppProvider apiKey={apiKey}>
      <NavMenu>
        <Link to="/app" rel="home">Dashboard</Link>
        <Link to="/app/products">Products</Link>
        <Link to="/app/library">Design library</Link>
        <Link to="/app/icons">Icons</Link>
        <Link to="/app/fonts">Fonts</Link>
        <Link to="/app/colors">Colors</Link>
        <Link to="/app/pricing">Pricing</Link>
        <Link to="/app/preview-settings">Preview settings</Link>
        <Link to="/app/uploads">Uploads</Link>
        <Link to="/app/settings">Settings</Link>
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => boundary.headers(headersArgs);
