import { Form, useActionData, useLoaderData } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { login } from "../shopify.server";

function errorMessage(errors: any) {
  if (errors?.shop === "MISSING_SHOP") return "Please enter your shop domain.";
  if (errors?.shop === "INVALID_SHOP") return "Please enter a valid shop domain (your-store.myshopify.com).";
  return "";
}

export async function loader({ request }: LoaderFunctionArgs) {
  // Only try to log in when a shop was passed; a bare visit shows the form.
  if (!new URL(request.url).searchParams.get("shop")) return { error: "" };
  const errors = await login(request);
  return { error: errorMessage(errors) };
}

export async function action({ request }: ActionFunctionArgs) {
  const errors = await login(request);
  return { error: errorMessage(errors) };
}

export default function Login() {
  const loaderData = useLoaderData<typeof loader>();
  const actionData = useActionData<typeof action>();
  const error = actionData?.error || loaderData?.error;
  return (
    <div style={{ maxWidth: 420, margin: "80px auto", fontFamily: "system-ui, sans-serif", padding: "0 16px" }}>
      <h1>Embroidery Studio</h1>
      <Form method="post">
        <label htmlFor="shop">Shop domain</label>
        <input id="shop" name="shop" placeholder="your-store.myshopify.com" autoComplete="on"
          style={{ display: "block", width: "100%", padding: 8, margin: "8px 0" }} />
        {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}
        <button type="submit">Log in</button>
      </Form>
    </div>
  );
}
