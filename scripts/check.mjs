// Offline static checks: TS/TSX syntax, GraphQL syntax, Liquid tag balance +
// schema JSON, TOML (via python if present is separate), JS syntax.
// Usage: node scripts/check.mjs   (needs `typescript` and `graphql` installed)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const tryRequire = (names) => { for (const n of names) { try { return require(n); } catch {} } return null; };
const ts = tryRequire(["typescript", "/opt/node-tools/node_modules/typescript"]);
const graphql = tryRequire(["graphql", path.join(root, "extensions/embroidery-cart-transform/node_modules/graphql")]);
let failures = 0;
const fail = (msg) => { failures++; console.log("✗", msg); };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "build", ".react-router", ".git", "dist", "generated"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}
const files = walk(root);

// TypeScript / TSX syntax
if (ts) {
  let n = 0;
  for (const f of files.filter((f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"))) {
    const sf = ts.createSourceFile(f, fs.readFileSync(f, "utf8"), ts.ScriptTarget.Latest, true, f.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
    for (const d of sf.parseDiagnostics) fail(`${path.relative(root, f)}: ${ts.flattenDiagnosticMessageText(d.messageText, " ")}`);
    n++;
  }
  console.log(`✓ TypeScript syntax: ${n} files`);
} else console.log("- skipped TypeScript (install typescript)");

// GraphQL: .graphql files and #graphql template literals
if (graphql) {
  let n = 0;
  for (const f of files.filter((f) => /\.(graphql|ts|tsx)$/.test(f))) {
    const text = fs.readFileSync(f, "utf8");
    const docs = f.endsWith(".graphql") ? [text] : [...text.matchAll(/`#graphql([\s\S]*?)`/g)].map((m) => m[1]);
    for (const doc of docs) {
      try { graphql.parse(doc); n++; } catch (e) { fail(`${path.relative(root, f)}: GraphQL ${e.message}`); }
    }
  }
  console.log(`✓ GraphQL syntax: ${n} documents`);
} else console.log("- skipped GraphQL (install graphql)");

// Liquid: balanced block tags and valid schema JSON
for (const f of files.filter((f) => f.endsWith(".liquid"))) {
  const text = fs.readFileSync(f, "utf8");
  const schema = /{%\s*schema\s*%}([\s\S]*?){%\s*endschema\s*%}/.exec(text);
  try { if (schema) JSON.parse(schema[1]); } catch (e) { fail(`${path.relative(root, f)}: schema JSON ${e.message}`); }
  const body = text.replace(/{%\s*schema\s*%}[\s\S]*?{%\s*endschema\s*%}/, "").replace(/{%-?\s*comment\s*-?%}[\s\S]*?{%-?\s*endcomment\s*-?%}/g, "");
  const tags = [];
  for (const m of body.matchAll(/{%-?\s*([\s\S]*?)\s*-?%}/g)) {
    const inner = m[1].trim();
    if (inner.startsWith("liquid")) {
      for (const line of inner.slice(6).split("\n")) { const w = line.trim().split(/\s+/)[0]; if (w) tags.push(w); }
    } else tags.push(inner.split(/\s+/)[0]);
  }
  const stack = [];
  const blocks = { if: "endif", unless: "endunless", for: "endfor", case: "endcase", capture: "endcapture" };
  for (const t of tags) {
    if (blocks[t]) stack.push(t);
    else if (Object.values(blocks).includes(t)) {
      const open = stack.pop();
      if (blocks[open] !== t) fail(`${path.relative(root, f)}: ${t} closes ${open || "nothing"}`);
    } else if (["elsif", "else"].includes(t) && !stack.length) fail(`${path.relative(root, f)}: ${t} outside a block`);
  }
  if (stack.length) fail(`${path.relative(root, f)}: unclosed ${stack.join(", ")}`);
  console.log(`✓ Liquid structure: ${path.relative(root, f)} (${tags.length} tags)`);
}

// Plain JS syntax
for (const f of files.filter((f) => /extensions\/.*\.js$/.test(f))) {
  try { new Function(fs.readFileSync(f, "utf8").replace(/^\s*export\s+(\*|\{[^}]*\})\s+from\s+['"][^'"]+['"];?/gm, "").replace(/^export\s+/gm, "")); }
  catch (e) { fail(`${path.relative(root, f)}: ${e.message}`); }
}
console.log("✓ JavaScript syntax: extension scripts");

// JSON files
for (const f of files.filter((f) => f.endsWith(".json") && !f.includes("package-lock"))) {
  try { JSON.parse(fs.readFileSync(f, "utf8")); } catch (e) { fail(`${path.relative(root, f)}: ${e.message}`); }
}
console.log("✓ JSON files");

process.exitCode = failures ? 1 : 0;
console.log(failures ? `\n${failures} problem(s)` : "\nAll static checks passed");
