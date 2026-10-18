import { Form, useLoaderData, useNavigation } from "react-router";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { getStore } from "../services/store.server";
import { fileUrl } from "../services/files.server";
import { log } from "../services/logger.server";
import { formatBytes } from "../utils/format";

const PAGE_SIZE = 50;

export async function loader({ request }: LoaderFunctionArgs) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;
  await getStore(shop);
  const page = Math.max(1, Number(new URL(request.url).searchParams.get("page") || 1));
  const [uploads, total, failed] = await Promise.all([
    prisma.upload.findMany({ where: { shop }, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.upload.count({ where: { shop } }),
    prisma.upload.count({ where: { shop, status: "FAILED" } }),
  ]);
  return {
    page,
    total,
    failed,
    hasNext: page * PAGE_SIZE < total,
    uploads: uploads.map((u) => ({ id: u.id, url: u.url, filename: u.filename, size: u.size, mimeType: u.mimeType, status: u.status, error: u.error, createdAt: u.createdAt.toISOString() })),
  };
}

/** Resolves CDN URLs for uploads Shopify was still processing. */
export async function action({ request }: ActionFunctionArgs) {
  const { admin, session } = await authenticate.admin(request);
  const pending = await prisma.upload.findMany({ where: { shop: session.shop, status: "PENDING", fileId: { not: null } }, take: 50 });
  let resolved = 0;
  for (const upload of pending) {
    try {
      const url = await fileUrl(admin, upload.fileId as string);
      if (url) {
        await prisma.upload.update({ where: { id: upload.id }, data: { url, status: "READY" } });
        resolved += 1;
      }
    } catch (error) {
      log.warn("uploads.refresh_failed", { shop: session.shop, uploadId: upload.id, error });
    }
  }
  return { resolved };
}

export default function Uploads() {
  const { uploads, total, failed, page, hasNext } = useLoaderData<typeof loader>();
  const navigation = useNavigation();
  return (
    <s-page heading="Customer uploads">
      <s-section>
        <s-stack direction="inline" gap="base" alignItems="center" justifyContent="space-between">
          <s-text>{total} upload(s) · {failed} failed. Logos are stored in Shopify Files (Content → Files) and linked from the order line.</s-text>
          <Form method="post"><s-button type="submit" loading={navigation.state === "submitting"}>Refresh pending</s-button></Form>
        </s-stack>
      </s-section>
      <s-section padding="none">
        <s-table>
          <s-table-header-row>
            <s-table-header>Preview</s-table-header>
            <s-table-header>File</s-table-header>
            <s-table-header>Size</s-table-header>
            <s-table-header>Status</s-table-header>
            <s-table-header>Uploaded</s-table-header>
          </s-table-header-row>
          <s-table-body>
            {uploads.map((u) => (
              <s-table-row key={u.id}>
                <s-table-cell>
                  {u.url ? <img src={u.url} alt="" width={48} height={48} style={{ objectFit: "contain", background: "#f4f4f5", borderRadius: 6 }} /> : "—"}
                </s-table-cell>
                <s-table-cell>{u.url ? <s-link href={u.url} target="_blank">{u.filename}</s-link> : u.filename}</s-table-cell>
                <s-table-cell>{formatBytes(u.size)}</s-table-cell>
                <s-table-cell>
                  <s-badge tone={u.status === "READY" ? "success" : u.status === "FAILED" ? "critical" : "caution"}>{u.status.toLowerCase()}</s-badge>
                  {u.error ? <s-text tone="critical"> {u.error}</s-text> : null}
                </s-table-cell>
                <s-table-cell>{new Date(u.createdAt).toLocaleString()}</s-table-cell>
              </s-table-row>
            ))}
          </s-table-body>
        </s-table>
        {uploads.length === 0 ? <s-box padding="base"><s-text color="subdued">No customer uploads yet.</s-text></s-box> : null}
      </s-section>
      <s-section>
        <s-stack direction="inline" gap="base">
          {page > 1 ? <s-button href={`/app/uploads?page=${page - 1}`}>Previous</s-button> : null}
          {hasNext ? <s-button href={`/app/uploads?page=${page + 1}`}>Next</s-button> : null}
        </s-stack>
      </s-section>
    </s-page>
  );
}
