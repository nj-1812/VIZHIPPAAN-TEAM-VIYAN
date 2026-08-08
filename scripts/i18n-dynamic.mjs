/**
 * Pass 2: wrap dynamic label-ish display values ({item.title}, {kpi.label}, ...)
 * with td() so data-driven strings (mock data, backend enums, feature names)
 * are translated at render time with English fallback.
 */
import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import _traverse from "@babel/traverse";

const traverse = _traverse.default ?? _traverse;
const PROPS = new Set([
  "label", "title", "description", "subtitle", "caption", "heading", "text",
  "summary", "recommendation", "insight", "message", "name", "category",
  "reason", "status", "severity", "riskLevel", "action", "note", "detail",
]);
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.tsx$/.test(e.name) && !p.includes("/ui/")) files.push(p);
  }
};
walk("src");

let count = 0;
for (const f of files) {
  let code = fs.readFileSync(f, "utf8");
  let ast;
  try {
    ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"] });
  } catch {
    continue;
  }
  const edits = [];
  const wrap = (node) => {
    if (!node || node.type !== "MemberExpression" || node.computed) return false;
    const prop = node.property;
    if (prop.type !== "Identifier" || !PROPS.has(prop.name)) return false;
    edits.push({ s: node.start, e: node.end, txt: `td(${code.slice(node.start, node.end)})` });
    return true;
  };
  traverse(ast, {
    JSXExpressionContainer(p) {
      if (p.parent.type === "JSXAttribute") {
        const an = p.parent.name.name;
        if (typeof an !== "string" || !/^(title|label|placeholder|aria-label|description|alt)$/.test(an)) return;
      }
      wrap(p.node.expression);
    },
  });
  if (!edits.length) continue;
  edits.sort((a, b) => b.s - a.s);
  for (const e of edits) code = code.slice(0, e.s) + e.txt + code.slice(e.e);
  if (/from "@\/i18n"/.test(code)) {
    code = code.replace(/import \{ ([^}]*) \} from "@\/i18n";/, (m, g) =>
      g.includes("td") ? m : `import { ${g.trim()}, td } from "@/i18n";`,
    );
  } else {
    const lines = code.split("\n");
    let idx = -1;
    for (let i = 0; i < lines.length; i++) if (/^import |^\} from /.test(lines[i])) idx = i;
    lines.splice(idx + 1, 0, `import { td } from "@/i18n";`);
    code = lines.join("\n");
  }
  fs.writeFileSync(f, code);
  count += edits.length;
  console.log(f, edits.length);
}
console.log("wrapped", count);
