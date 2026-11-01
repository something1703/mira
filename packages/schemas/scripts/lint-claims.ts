/**
 * Claim linter CLI (docs/COPY.md §3). Fails if banned language appears in user-facing text:
 * the README, the Devpost description, Skill docs, and every string literal or JSX text in the
 * web app, UI package, agent and MCP server. Code identifiers are never checked; only strings a
 * person or another agent could read.
 *
 * Usage: tsx packages/schemas/scripts/lint-claims.ts [--root <dir>]
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { isExempt, lintText, type ClaimViolation } from "../src/claim-linter";

/** Whole-file prose targets, relative to the repo root. */
const PROSE_FILES = ["README.md", "docs/DEVPOST.md"];
/** Directories whose TS/TSX string literals are user-facing. */
const CODE_DIRS = ["apps/web", "packages/ui/src", "apps/agent/src", "packages/mira-mcp/src"];
/** Directories whose Markdown is user-facing in full. */
const PROSE_DIRS = ["skills"];
const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  "dist",
  ".turbo",
  "playwright-report",
  "test-results",
  "public",
]);

interface Finding extends ClaimViolation {
  readonly file: string;
}

function walk(dir: string, match: (file: string) => boolean, out: string[] = []): string[] {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (SKIP_DIRS.has(entry)) continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) walk(path, match, out);
    else if (match(path)) out.push(path);
  }
  return out;
}

/** Collects every user-visible string in a TS/TSX file with its offset in the source. */
export function extractStrings(fileName: string, source: string): { text: string; pos: number }[] {
  const kind = fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, kind);
  const out: { text: string; pos: number }[] = [];

  const visit = (node: ts.Node): void => {
    // Module specifiers are paths, not copy.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      out.push({ text: node.text, pos: node.getStart(sf) + 1 });
    } else if (ts.isTemplateExpression(node)) {
      out.push({ text: node.head.text, pos: node.head.getStart(sf) + 1 });
      for (const span of node.templateSpans) {
        out.push({ text: span.literal.text, pos: span.literal.getStart(sf) + 1 });
      }
    } else if (ts.isJsxText(node)) {
      if (node.text.trim()) out.push({ text: node.text, pos: node.getStart(sf) });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function lineCol(source: string, index: number): { line: number; column: number } {
  const before = source.slice(0, index);
  const line = before.split("\n").length;
  return { line, column: index - before.lastIndexOf("\n") };
}

export function lintRepo(root: string): Finding[] {
  const findings: Finding[] = [];
  const add = (abs: string, source: string, pieces: { text: string; pos: number }[]) => {
    const file = relative(root, abs).replaceAll("\\", "/");
    if (isExempt(file)) return;
    for (const piece of pieces) {
      for (const v of lintText(piece.text)) {
        findings.push({ ...v, file, ...lineCol(source, piece.pos + v.index) });
      }
    }
  };

  for (const rel of PROSE_FILES) {
    const abs = join(root, rel);
    if (existsSync(abs)) {
      const source = readFileSync(abs, "utf8");
      add(abs, source, [{ text: source, pos: 0 }]);
    }
  }
  for (const dir of PROSE_DIRS) {
    for (const abs of walk(join(root, dir), (f) => f.endsWith(".md"))) {
      const source = readFileSync(abs, "utf8");
      add(abs, source, [{ text: source, pos: 0 }]);
    }
  }
  for (const dir of CODE_DIRS) {
    for (const abs of walk(join(root, dir), (f) => /\.(ts|tsx)$/.test(f) && !f.endsWith(".d.ts"))) {
      const source = readFileSync(abs, "utf8");
      add(abs, source, extractStrings(abs, source));
    }
  }
  return findings;
}

const isMain =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const rootFlag = process.argv.indexOf("--root");
  const root = resolve(
    rootFlag >= 0 && process.argv[rootFlag + 1]
      ? (process.argv[rootFlag + 1] as string)
      : join(dirname(fileURLToPath(import.meta.url)), "../../.."),
  );
  const findings = lintRepo(root);
  if (findings.length === 0) {
    console.log("Claim linter: no banned language found.");
  } else {
    for (const f of findings) {
      console.error(`${f.file}:${f.line}:${f.column}  "${f.match}"  (${f.category}: ${f.ruleId})`);
    }
    console.error(
      `\nClaim linter: ${findings.length} banned phrase(s). Use cosmetic framing from docs/COPY.md §3.`,
    );
    process.exit(1);
  }
}
