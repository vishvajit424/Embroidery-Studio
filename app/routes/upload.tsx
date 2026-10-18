/**
 * Customer logo upload, called from the theme block through the app proxy:
 *   POST https://{shop}/apps/embroidery-studio/upload   (multipart: file, productId)
 *   GET  https://{shop}/apps/embroidery-studio/upload?id={uploadId}  (status poll)
 *
 * The app proxy signs every request; authenticate.public.appProxy verifies
 * the signature, so only the shop's own storefront can reach this endpoint.
 * The file is validated (extension, MIME, magic bytes, size, empty) and
 * stored in Shopify Files. The browser only ever receives the CDN URL.
 */
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import prisma from "../db.server";
import { authenticate } from "../shopify.server";
import { uploadImageToShopifyFiles, fileUrl } from "../services/files.server";
import { rateLimit } from "../services/rate-limit.server";
import { log } from "../services/logger.server";
import { CUSTOMER_UPLOAD_TYPES, MAX_UPLOAD_MB, extensionOf, isShopifyGid, sniffImageType, validateFileMeta } from "../utils/validation";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

function clientKey(request: Request, shop: string) {
  const ip = (request.headers.get("x-forwarded-for") || request.headers.get("x-real-ip") || "unknown").split(",")[0].trim();
  return `${shop}:${ip}`;
}

export async function loader({ request }: LoaderFunctionArgs) {
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) return json({ ok: false, error: "Embroidery Studio is not installed on this store." }, 401);
  const id = new URL(request.url).searchParams.get("id") || "";
  if (!id) return json({ ok: false, error: "Missing upload id." }, 400);
  if (!rateLimit(`poll:${clientKey(request, session.shop)}`, 120, 10 * 60 * 1000)) {
    return json({ ok: false, error: "Too many requests. Please wait a moment." }, 429);
  }

  const upload = await prisma.upload.findFirst({ where: { id, shop: session.shop } });
  if (!upload) return json({ ok: false, error: "Upload not found." }, 404);
  if (!upload.url && upload.fileId && upload.status !== "FAILED") {
    try {
      const url = await fileUrl(admin, upload.fileId);
      if (url) {
        await prisma.upload.update({ where: { id }, data: { url, status: "READY" } });
        return json({ ok: true, uploadId: id, url, status: "READY" });
      }
    } catch (error) {
      log.warn("upload.poll_failed", { shop: session.shop, uploadId: id, error });
    }
  }
  return json({ ok: upload.status !== "FAILED", uploadId: id, url: upload.url, status: upload.status, error: upload.status === "FAILED" ? "Upload failed. Please try another file." : undefined });
}

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") return json({ ok: false, error: "Method not allowed." }, 405);
  const { session, admin } = await authenticate.public.appProxy(request);
  if (!session || !admin) return json({ ok: false, error: "Embroidery Studio is not installed on this store." }, 401);
  const shop = session.shop;

  if (!rateLimit(`upload:${clientKey(request, shop)}`, 10, 10 * 60 * 1000)) {
    return json({ ok: false, error: "Too many uploads. Please wait a few minutes and try again." }, 429);
  }
  const declared = Number(request.headers.get("content-length") || 0);
  if (declared > (MAX_UPLOAD_MB + 1) * 1024 * 1024) {
    return json({ ok: false, error: `File must be ${MAX_UPLOAD_MB} MB or smaller.` }, 413);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "Invalid upload." }, 400);
  }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ ok: false, error: "Please choose a file." }, 400);

  // Size limit: the product's own setting, else the shop default.
  const store = await prisma.store.findUnique({ where: { shop } });
  if (!store) return json({ ok: false, error: "Embroidery Studio is not set up on this store yet." }, 400);
  let maxMb = store.uploadMaxMb;
  const productId = String(form.get("productId") || "");
  if (isShopifyGid(productId, "Product")) {
    const config = await prisma.productEmbroideryConfig.findUnique({ where: { shop_productId: { shop, productId } } });
    if (config) maxMb = config.uploadMaxSize;
  }

  const metaError = validateFileMeta({ name: file.name, type: file.type, size: file.size }, maxMb, CUSTOMER_UPLOAD_TYPES);
  if (metaError) return json({ ok: false, error: metaError }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const expected = CUSTOMER_UPLOAD_TYPES[extensionOf(file.name)];
  const actual = sniffImageType(bytes);
  if (!actual || actual !== expected) {
    log.warn("upload.rejected_content", { shop, declared: file.type, detected: actual });
    return json({ ok: false, error: "This file is not a valid PNG, JPG or WebP image." }, 400);
  }

  const safeName = `embroidery-logo-${Date.now()}.${extensionOf(file.name) === "jpeg" ? "jpg" : extensionOf(file.name)}`;
  const upload = await prisma.upload.create({
    data: { shop, filename: file.name.slice(0, 200), mimeType: expected, size: file.size, status: "PENDING" },
  });

  try {
    // Keep the request short (app proxy timeout); the browser polls if needed.
    const result = await uploadImageToShopifyFiles(admin, { bytes, filename: safeName, mimeType: expected, alt: "Customer embroidery logo" }, 4);
    const status = result.url ? "READY" : "PENDING";
    await prisma.upload.update({ where: { id: upload.id }, data: { fileId: result.fileId, url: result.url, status } });
    log.info("upload.stored", { shop, uploadId: upload.id, size: file.size, status });
    return json({ ok: true, uploadId: upload.id, fileId: result.fileId, url: result.url, status });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    await prisma.upload.update({ where: { id: upload.id }, data: { status: "FAILED", error: message.slice(0, 500) } });
    log.error("upload.failed", { shop, uploadId: upload.id, error });
    return json({ ok: false, error: "We couldn't upload your logo. Please try again." }, 502);
  }
}
