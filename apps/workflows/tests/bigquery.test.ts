import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const DIR = join(import.meta.dirname, "../../../infra/bigquery");
const sql = (f: string) => readFileSync(join(DIR, f), "utf8");

describe("the BigQuery views keep the cohort rule the console code keeps", () => {
  const views = sql("views.sql");

  it("declare the same minimum as the environment default", () => {
    const m = /DECLARE k INT64 DEFAULT (\d+);/.exec(views);
    expect(Number(m?.[1])).toBe(20);
  });

  it("filter every view on the minimum before returning a row", () => {
    const made = views.match(/CREATE OR REPLACE VIEW/g)?.length ?? 0;
    const filtered = views.match(/HAVING COUNT\(\*\) >= k/g)?.length ?? 0;
    expect(made).toBe(3);
    expect(filtered).toBe(made);
  });

  it("read only the tables, never a raw row", () => {
    expect(views).not.toMatch(/SELECT \*/);
  });
});

describe("the tables hold nothing that names a person", () => {
  // The file's comments say what is absent; only the columns count.
  const tables = sql("tables.sql")
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n");
  it("have no user id, image or day-level date", () => {
    expect(tables).not.toMatch(/user|image|url|photo|email|timestamp|date\b/i);
    expect(tables.match(/week\s+STRING NOT NULL/g)).toHaveLength(3);
  });
});
