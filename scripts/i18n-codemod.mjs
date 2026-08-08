/**
 * Build-time codemod: wraps user-facing English strings in t(...) calls.
 * Run: node scripts/i18n-codemod.mjs [--dry]
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default ?? _traverse;
const ROOT = process.cwd();
const DRY = process.argv.includes("--dry");

const DIRS = ["src/routes", "src/components", "src/lib", "src/data", "src/services", "src/hooks"];
const SKIP = [/src\/components\/ui\//, /routeTree\.gen/, /\.test\./, /src\/i18n\//];

const ATTR_PROPS = new Set([
  "title", "subtitle", "label", "placeholder", "description", "aria-label",
  "heading", "emptyText", "tooltip", "caption", "cta", "helperText", "hint",
  "actionLabel", "buttonLabel",
]);

const en = JSON.parse(fs.readFileSync(path.join(ROOT, "src/locales/en.json"), "utf8"));

const files = [];
function walk(dir) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(rel);
    else if (/\.tsx?$/.test(entry.name) && !SKIP.some((r) => r.test(rel))) files.push(rel);
  }
}
DIRS.forEach(walk);

const hasLetters = (s) => /[A-Za-z]{2,}/.test(s);
const isTranslatable = (s) => {
  const v = s.trim();
  if (!v || !hasLetters(v)) return false;
  if (/^[A-Z0-9_]+$/.test(v) && v.length <= 4) return false; // acronyms alone
  if (/^https?:|^\/|^#|^[a-z-]+\/[a-z-]+$/.test(v)) return false;
  return true;
};

const strings = new Set();
let changedFiles = 0;

for (const rel of files) {
  const abs = path.join(ROOT, rel);
  const code = fs.readFileSync(abs, "utf8");
  let ast;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch (e) {
    console.warn("parse fail", rel, e.message);
    continue;
  }

  const edits = [];
  const push = (start, end, text) => edits.push({ start, end, text });

  traverse(ast, {
    JSXText(p) {
      const raw = p.node.value;
      const trimmed = raw.trim();
      if (!isTranslatable(trimmed)) return;
      const lead = raw.slice(0, raw.indexOf(trimmed));
      const tail = raw.slice(raw.indexOf(trimmed) + trimmed.length);
      const leadSpace = /\s$/.test(lead) ? (lead.includes("\n") ? lead : " ") : lead;
      const tailSpace = /^\s/.test(tail) ? (tail.includes("\n") ? tail : " ") : tail;
      strings.add(trimmed);
      push(p.node.start, p.node.end, `${leadSpace}{t(${JSON.stringify(trimmed)})}${tailSpace}`);
    },
    JSXAttribute(p) {
      const name = p.node.name.name;
      if (typeof name !== "string" || !ATTR_PROPS.has(name)) return;
      const v = p.node.value;
      if (!v) return;
      if (v.type === "StringLiteral") {
        if (!isTranslatable(v.value)) return;
        strings.add(v.value.trim());
        push(v.start, v.end, `{t(${JSON.stringify(v.value.trim())})}`);
      }
    },
    ObjectProperty(p) {
      const key = p.node.key;
      const keyName = key.type === "Identifier" ? key.name : key.type === "StringLiteral" ? key.value : null;
      const OBJ_KEYS = new Set(["label", "title", "description", "subtitle", "caption", "heading", "helperText", "hint", "text", "summary", "recommendation", "insight"]);
      if (!keyName || !OBJ_KEYS.has(keyName)) return;
      const v = p.node.value;
      if (v.type !== "StringLiteral" || !isTranslatable(v.value)) return;
      strings.add(v.value.trim());
      push(v.start, v.end, `t(${JSON.stringify(v.value.trim())})`);
    },
    CallExpression(p) {
      // existing t("dotted.key") -> t("English source")
      const callee = p.node.callee;
      if (callee.type !== "Identifier" || callee.name !== "t") return;
      const arg = p.node.arguments[0];
      if (!arg || arg.type !== "StringLiteral") return;
      const mapped = en[arg.value];
      if (!mapped) {
        if (isTranslatable(arg.value)) strings.add(arg.value.trim());
        return;
      }
      strings.add(mapped);
      push(arg.start, arg.end, JSON.stringify(mapped));
    },
  });

  if (!edits.length) continue;
  edits.sort((a, b) => b.start - a.start);
  let out = code;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);

  // ensure t import (module-level function; provider re-renders tree on change)
  if (!/from "@\/i18n"/.test(out)) {
    const lines = out.split("\n");
    let idx = 0;
    for (let i = 0; i < lines.length; i++) {
      if (/^import /.test(lines[i]) || /^\} from /.test(lines[i])) idx = i;
      if (/^(export |const |function |interface |type )/.test(lines[i]) && i > 0) break;
    }
    lines.splice(idx + 1, 0, `import { t } from "@/i18n";`);
    out = lines.join("\n");
  }
  // drop now-shadowing local t from useLanguage destructuring
  out = out.replace(/const \{\s*t\s*\} = useLanguage\(\);\n?/g, "");
  out = out.replace(/const \{\s*t,\s*/g, "const { ");
  out = out.replace(/,\s*t\s*\} = useLanguage\(\)/g, " } = useLanguage()");

  if (!DRY) fs.writeFileSync(abs, out);
  changedFiles++;
}

const list = [...strings].sort();
fs.mkdirSync(path.join(ROOT, "scripts/out"), { recursive: true });
fs.writeFileSync(path.join(ROOT, "scripts/out/strings.json"), JSON.stringify(list, null, 2));
console.log(`files changed: ${changedFiles}, unique strings: ${list.length}`);
