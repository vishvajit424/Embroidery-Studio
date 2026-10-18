/*
 * End-to-end storefront test for the Embroidery Studio block.
 * Runs the real embroidery.js/.css against a mock Dawn-like product page
 * (tests/e2e/server.mjs) in Chromium.
 *
 *   npm i -D playwright && npx playwright install chromium   (once)
 *   npm run test:e2e
 */
const { spawn } = require("node:child_process");
const path = require("node:path");
const assert = require("node:assert/strict");

let chromium;
try { ({ chromium } = require(process.env.PLAYWRIGHT_PATH || "playwright")); }
catch { console.log("SKIP: playwright is not installed (npm i -D playwright)"); process.exit(0); }

const PORT = 4460 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const results = [];

async function scenario(name, fn) {
  try { await fn(); results.push([true, name]); console.log("  ✓", name); }
  catch (error) { results.push([false, name]); console.log("  ✗", name, "\n    ", error.message.split("\n")[0]); }
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--no-warnings", "--experimental-strip-types", path.join(__dirname, "server.mjs")], { env: { ...process.env, PORT: String(PORT) } });
    child.stdout.on("data", (d) => { if (String(d).includes("mock storefront")) resolve(child); });
    child.stderr.on("data", (d) => process.stderr.write(d));
    child.on("exit", (code) => reject(new Error(`server exited ${code}`)));
  });
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
  const errors = [];

  async function open(query = "", viewport = { width: 390, height: 844 }) {
    const page = await browser.newPage({ viewport });
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("dialog", (d) => d.dismiss());
    await page.goto(`${BASE}/${query}`);
    await page.waitForSelector("[data-es-ready]");
    return page;
  }
  const props = (page) => page.$$eval('#product-form-1 [data-es-injected] input', (els) => Object.fromEntries(els.map((e) => [e.name, e.value])));
  const submit = async (page) => {
    const before = await page.evaluate(() => window.cartPosts.length);
    await page.click('button[name="add"]');
    await page.waitForFunction((n) => window.cartPosts.length > n, before);
    return page.evaluate(() => window.cartPosts[window.cartPosts.length - 1]);
  };
  async function configureTop(page, { icon = "Heart" } = {}) {
    await page.click("text=Add Embroidery");
    await page.click('label[for$="-opt-top"]');
    await page.click(".es-foot >> text=Continue");
    await page.fill('input[id$="-firstName"]', "Vishvajit");
    await page.fill('input[id$="-secondName"]', "Software Developer");
    await page.click('label[title="Gold"]');
    await page.click('label.es-chip:has-text("Script")');
    if (icon) await page.click(`label[title="${icon}"]`);
    await page.click(".es-foot >> text=Continue");
  }

  console.log("Embroidery Studio storefront e2e");

  await scenario("product page shows the card with the starting price", async () => {
    const page = await open();
    assert.match(await page.textContent(".es-card"), /CUSTOM EMBROIDERY[\s\S]*Starting at ₹199/);
    await page.close();
  });

  await scenario("no embroidery: add to cart sends no embroidery properties", async () => {
    const page = await open();
    const post = await submit(page);
    assert.equal(post.id, "111");
    assert.ok(!Object.keys(post).some((k) => k.includes("mbroidery")));
    await page.close();
  });

  await scenario("options list with bundle breakdown and saving", async () => {
    const page = await open();
    await page.click("text=Add Embroidery");
    const text = await page.textContent(".es-options");
    assert.match(text, /Embroidery Bundle\s*₹598/);
    assert.match(text, /₹748\s*₹598\s*Save ₹150/);
    assert.match(text, /Top Embroidery\s*₹299/);
    assert.match(text, /Bottom Embroidery\s*₹199/);
    await page.close();
  });

  await scenario("required name: inline error, aria-invalid, nothing reaches the cart", async () => {
    const page = await open();
    await page.click("text=Add Embroidery");
    await page.click('label[for$="-opt-top"]');
    await page.click(".es-foot >> text=Continue");
    await page.click(".es-foot >> text=Continue");
    assert.match(await page.textContent(".es-field.has-error .es-error"), /first name/i);
    assert.equal(await page.getAttribute('input[id$="-firstName"]', "aria-invalid"), "true");
    await page.fill('input[id$="-firstName"]', "<script>");
    await page.click(".es-foot >> text=Continue");
    assert.match(await page.textContent(".es-field.has-error .es-error"), /only use letters/);
    await page.keyboard.press("Escape");
    assert.equal(await page.$(".es-modal"), null, "ESC closes the modal");
    assert.deepEqual(await props(page), {});
    await page.close();
  });

  await scenario("top + icon: live preview, price, confirmation, cart properties", async () => {
    const page = await open();
    await page.click("text=Add Embroidery");
    await page.click('label[for$="-opt-top"]');
    await page.click(".es-foot >> text=Continue");
    await page.fill('input[id$="-firstName"]', "Vishvajit");
    assert.match(await page.textContent(".es-layer--text"), /Vishvajit/, "preview updates while typing");
    await page.fill('input[id$="-secondName"]', "Software Developer");
    await page.click('label[title="Gold"]');
    assert.equal(await page.$eval(".es-layer--text", (n) => getComputedStyle(n).color), "rgb(201, 162, 39)", "preview colour");
    await page.click('label.es-chip:has-text("Script")');
    assert.match(await page.$eval(".es-layer--text", (n) => n.style.fontFamily), /Brush Script/, "preview font");
    await page.click('label[title="Heart"]');
    assert.ok(await page.$(".es-layer--icon .es-mask"), "icon in preview");
    assert.equal(await page.textContent(".es-foot__price"), "₹549");
    await page.click(".es-foot >> text=Continue");
    const confirm = await page.textContent(".es-modal");
    assert.match(confirm, /Here's your final personalised look!/);
    assert.match(confirm, /2-4 business days/);
    assert.match(confirm, /not eligible for return or exchange/);
    await page.click("text=CONFIRM");
    const p = await props(page);
    assert.equal(p["properties[_embroidery_type]"], "top");
    assert.equal(p["properties[_embroidery_first_name]"], "Vishvajit");
    assert.equal(p["properties[_embroidery_second_name]"], "Software Developer");
    assert.equal(p["properties[_embroidery_icon]"], "Heart");
    assert.equal(p["properties[_embroidery_color]"], "Gold (#C9A227)");
    assert.equal(p["properties[_embroidery_font]"], "Script");
    assert.ok(!("properties[_embroidery_price]" in p), "no client price");
    assert.match(await page.textContent(".es-card"), /Top Embroidery[\s\S]*₹549[\s\S]*Edit/);
    await page.close();
  });

  await scenario("variant change after configuring: selected variant is kept and recorded", async () => {
    const page = await open();
    await page.selectOption("#size", "111");
    await configureTop(page);
    await page.click("text=CONFIRM");
    await page.selectOption("#size", "222");
    const post = await submit(page);
    assert.equal(post.id, "222", "variant not overwritten");
    assert.equal(post["properties[_embroidery_variant_id]"], "222");
    assert.equal(post["properties[_embroidery_first_name]"], "Vishvajit");
    await page.close();
  });

  await scenario("preview follows the selected variant image", async () => {
    const page = await open();
    await page.selectOption("#size", "222");
    await page.click("text=Add Embroidery");
    await page.click('label[for$="-opt-top"]');
    await page.click(".es-foot >> text=Continue");
    assert.match(decodeURIComponent(await page.getAttribute(".es-stage__img", "src")), /1f4e79/);
    await page.close();
  });

  await scenario("edit restores every previous value", async () => {
    const page = await open();
    await configureTop(page);
    await page.click("text=CONFIRM");
    await page.click(".es-card >> text=Edit");
    assert.equal(await page.inputValue('input[id$="-firstName"]'), "Vishvajit");
    assert.equal(await page.inputValue('input[id$="-secondName"]'), "Software Developer");
    assert.ok(await page.isChecked('label[title="Gold"] input'));
    assert.ok(await page.isChecked('label.es-chip:has-text("Script") input'));
    assert.ok(await page.isChecked('label[title="Heart"] input'));
    await page.close();
  });

  await scenario("remove and skip leave no stale properties", async () => {
    const page = await open();
    await configureTop(page);
    await page.click("text=CONFIRM");
    await page.click(".es-card >> text=Remove");
    assert.deepEqual(await props(page), {});
    let post = await submit(page);
    assert.ok(!Object.keys(post).some((k) => k.includes("mbroidery")));
    await configureTop(page);
    await page.click("text=CONFIRM");
    await page.click(".es-card >> text=Remove");
    await page.click("text=Skip for Now");
    assert.match(await page.textContent(".es-card"), /No embroidery will be added/);
    post = await submit(page);
    assert.ok(!Object.keys(post).some((k) => k.includes("mbroidery")));
    await page.close();
  });

  await scenario("bottom embroidery requires the bottom name and has no icon section", async () => {
    const page = await open();
    await page.click("text=Add Embroidery");
    await page.click('label[for$="-opt-bottom"]');
    await page.click(".es-foot >> text=Continue");
    assert.equal(await page.$('label[title="Heart"]'), null);
    await page.click(".es-foot >> text=Continue");
    assert.match(await page.textContent(".es-error"), /bottom name/i);
    await page.fill('input[id$="-bottomName"]', "Vishvajit Kumar");
    await page.click(".es-foot >> text=Continue");
    await page.click("text=CONFIRM");
    const p = await props(page);
    assert.equal(p["properties[_embroidery_type]"], "bottom");
    assert.equal(p["properties[_embroidery_bottom]"], "Vishvajit Kumar");
    assert.ok(!("properties[_embroidery_first_name]" in p));
    await page.close();
  });

  await scenario("bundle: bottom name defaults to first name", async () => {
    const page = await open();
    await page.click("text=Add Embroidery");
    await page.click('label[for$="-opt-bundle"]');
    await page.click(".es-foot >> text=Continue");
    await page.fill('input[id$="-firstName"]', "Asha");
    await page.click(".es-foot >> text=Continue");
    assert.match(await page.textContent(".es-dl"), /Bottom text\s*Asha/);
    await page.click("text=CONFIRM");
    const p = await props(page);
    assert.equal(p["properties[_embroidery_bottom]"], "Asha");
    assert.match(await page.textContent(".es-card"), /₹598/);
    await page.close();
  });

  await scenario("logo: invalid and oversized files are rejected", async () => {
    const page = await open();
    await page.click("text=Add Embroidery");
    await page.click('label[for$="-opt-top"]');
    await page.click(".es-foot >> text=Continue");
    await page.setInputFiles(".es-file", { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
    assert.match(await page.textContent(".es-logo .es-error"), /PNG, JPG/);
    await page.setInputFiles(".es-file", { name: "big.png", mimeType: "image/png", buffer: Buffer.alloc(6 * 1024 * 1024, 1) });
    assert.match(await page.textContent(".es-logo .es-error"), /5 MB/);
    await page.setInputFiles(".es-file", { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) });
    assert.match(await page.textContent(".es-logo .es-error"), /empty/);
    await page.close();
  });

  await scenario("logo: upload, preview, remove and re-upload; URL reaches the cart", async () => {
    const page = await open();
    await page.click("text=Add Embroidery");
    await page.click('label[for$="-opt-top"]');
    await page.click(".es-foot >> text=Continue");
    await page.fill('input[id$="-firstName"]', "Asha");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await page.setInputFiles(".es-file", { name: "logo.png", mimeType: "image/png", buffer: png });
    await page.waitForSelector("text=Uploaded");
    assert.ok(await page.$(".es-layer--icon .es-layer__logo"), "logo in preview");
    assert.equal(await page.textContent(".es-foot__price"), "₹549");
    await page.click(".es-logo >> text=Remove");
    assert.equal(await page.$(".es-logo__thumb"), null);
    await page.setInputFiles(".es-file", { name: "logo.png", mimeType: "image/png", buffer: png });
    await page.waitForSelector("text=Uploaded");
    await page.click(".es-foot >> text=Continue");
    await page.click("text=CONFIRM");
    const post = await submit(page);
    assert.equal(post["properties[_embroidery_logo]"], "https://cdn.example.com/logo.png");
    assert.equal(post["properties[Embroidery logo]"], "https://cdn.example.com/logo.png");
    assert.ok(!("properties[_embroidery_icon]" in post));
    await page.close();
  });

  await scenario("logo: slow processing is polled; failures block confirmation", async () => {
    const page = await open();
    await page.click("text=Add Embroidery");
    await page.click('label[for$="-opt-top"]');
    await page.click(".es-foot >> text=Continue");
    await page.fill('input[id$="-firstName"]', "Asha");
    const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
    await page.setInputFiles(".es-file", { name: "slow.png", mimeType: "image/png", buffer: png });
    await page.click(".es-foot >> text=Continue");
    assert.match(await page.textContent(".es-logo .es-error"), /wait/);
    await page.waitForSelector("text=Uploaded", { timeout: 10000 });
    await page.setInputFiles(".es-file", { name: "fail.png", mimeType: "image/png", buffer: png });
    await page.waitForSelector("text=Upload failed");
    await page.click(".es-foot >> text=Continue");
    assert.equal(await page.$(".es-dl"), null, "cannot continue with a failed upload");
    await page.close();
  });

  await scenario("currency: USD customer sees $ prices, never ₹", async () => {
    const page = await open("?currency=USD&rate=0.012");
    const text = await page.textContent(".es-card");
    assert.match(text, /\$2\.39/);
    assert.doesNotMatch(text, /₹/);
    await page.click("text=Add Embroidery");
    assert.doesNotMatch(await page.textContent(".es-options"), /₹/);
    await page.close();
  });

  await scenario("keyboard: focus moves into the dialog and is trapped", async () => {
    const page = await open();
    await page.focus("text=Add Embroidery");
    await page.keyboard.press("Enter");
    assert.ok(await page.evaluate(() => document.activeElement.closest(".es-modal__dialog") !== null));
    for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
    assert.ok(await page.evaluate(() => document.activeElement.closest(".es-modal__dialog") !== null), "focus stays in dialog");
    await page.keyboard.press("Escape");
    assert.equal(await page.evaluate(() => document.activeElement.textContent), "Add Embroidery", "focus returns to opener");
    await page.close();
  });

  await scenario("theme re-renders the form: properties are restored before submit", async () => {
    const page = await open();
    await configureTop(page);
    await page.click("text=CONFIRM");
    await page.evaluate(() => { document.querySelector("[data-es-injected]").remove(); });
    const post = await submit(page);
    assert.equal(post["properties[_embroidery_type]"], "top");
    await page.close();
  });

  for (const width of [320, 375, 390, 430, 768, 1024, 1440]) {
    await scenario(`layout at ${width}px: no horizontal overflow in card or modal`, async () => {
      const page = await open("", { width, height: 800 });
      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      assert.equal(await overflow(), false, "page");
      await page.click("text=Add Embroidery");
      await page.click('label[for$="-opt-bundle"]');
      await page.click(".es-foot >> text=Continue");
      const dialog = await page.$eval(".es-modal__dialog", (d) => ({ w: d.getBoundingClientRect().width, sw: d.scrollWidth, cw: d.clientWidth }));
      assert.ok(dialog.sw <= dialog.cw + 1, "dialog content fits");
      assert.ok(dialog.w <= width, "dialog fits viewport");
      const footer = await page.$eval(".es-foot", (f) => { const r = f.getBoundingClientRect(); return r.bottom <= window.innerHeight + 1; });
      assert.ok(footer, "CTA visible without scrolling");
      await page.close();
    });
  }

  await scenario("no JavaScript errors", async () => {
    assert.deepEqual(errors, []);
  });

  await browser.close();
  server.kill();
  const failed = results.filter(([ok]) => !ok).length;
  console.log(`\n${results.length - failed} passed, ${failed} failed`);
  process.exit(failed ? 1 : 0);
})().catch((error) => { console.error(error); process.exit(1); });
