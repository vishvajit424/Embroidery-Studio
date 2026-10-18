import { gql, userErrorsMessage, type AdminGraphql, ShopifyApiError } from "./types";

const STAGED_UPLOAD = `#graphql
mutation EmbroideryStagedUpload($input: [StagedUploadInput!]!) {
  stagedUploadsCreate(input: $input) {
    stagedTargets { url resourceUrl parameters { name value } }
    userErrors { field message }
  }
}`;

const FILE_CREATE = `#graphql
mutation EmbroideryFileCreate($files: [FileCreateInput!]!) {
  fileCreate(files: $files) {
    files { id fileStatus ... on MediaImage { image { url } } }
    userErrors { field message }
  }
}`;

const FILE_STATUS = `#graphql
query EmbroideryFileStatus($id: ID!) {
  node(id: $id) { ... on MediaImage { id fileStatus image { url } } }
}`;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Uploads an image to Shopify Files: staged upload -> POST the bytes to the
 * staged target -> fileCreate -> wait until Shopify has processed it.
 * Credentials never leave the server; the browser only receives the CDN URL.
 */
export async function uploadImageToShopifyFiles(
  admin: AdminGraphql,
  file: { bytes: Uint8Array; filename: string; mimeType: string; alt: string },
  maxPolls = 12,
): Promise<{ fileId: string; url: string | null; status: string }> {
  const staged = await gql(admin, STAGED_UPLOAD, {
    input: [{
      filename: file.filename,
      mimeType: file.mimeType,
      httpMethod: "POST",
      resource: "IMAGE",
      fileSize: String(file.bytes.byteLength),
    }],
  });
  const stagedErrors = userErrorsMessage(staged.stagedUploadsCreate?.userErrors);
  const target = staged.stagedUploadsCreate?.stagedTargets?.[0];
  if (stagedErrors || !target) throw new ShopifyApiError(stagedErrors || "Could not prepare the upload.");

  const form = new FormData();
  for (const param of target.parameters) form.append(param.name, param.value);
  form.append("file", new Blob([new Uint8Array(file.bytes)], { type: file.mimeType }), file.filename);
  const uploadResponse = await fetch(target.url, { method: "POST", body: form });
  if (!uploadResponse.ok) {
    throw new ShopifyApiError(`Upload to storage failed (${uploadResponse.status}).`);
  }

  const created = await gql(admin, FILE_CREATE, {
    files: [{ originalSource: target.resourceUrl, contentType: "IMAGE", alt: file.alt.slice(0, 500) }],
  });
  const createErrors = userErrorsMessage(created.fileCreate?.userErrors);
  const createdFile = created.fileCreate?.files?.[0];
  if (createErrors || !createdFile) throw new ShopifyApiError(createErrors || "Shopify did not create the file.");

  let status = createdFile.fileStatus as string;
  let url: string | null = createdFile.image?.url || null;
  for (let attempt = 0; !url && status !== "FAILED" && attempt < maxPolls; attempt += 1) {
    await sleep(500);
    const data = await gql(admin, FILE_STATUS, { id: createdFile.id });
    status = data.node?.fileStatus || status;
    url = data.node?.image?.url || null;
  }
  if (status === "FAILED") throw new ShopifyApiError("Shopify could not process this image.");
  return { fileId: createdFile.id, url, status };
}

/** Looks up the CDN URL for files that were still processing. */
export async function fileUrl(admin: AdminGraphql, fileId: string): Promise<string | null> {
  const data = await gql(admin, FILE_STATUS, { id: fileId });
  return data.node?.image?.url || null;
}
