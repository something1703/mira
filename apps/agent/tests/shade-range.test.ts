import { loadCataloguePage } from "@mira/fixtures";
import { describe, expect, it } from "vitest";
import { buildApp } from "../src/app";
import { checkUrl, isPublicAddress } from "../src/extract/safe-fetch";
import {
  SwatchReader,
  cleanName,
  extractShadeRange,
  normaliseHex,
  type ShadeReader,
} from "../src/extract/shade-range";

const page = loadCataloguePage("sample-product") ?? "";
const bad = loadCataloguePage("unreadable") ?? "";
const at = { url: "https://shop.example/products/sample" };

describe("reading swatches", () => {
  it("finds each shade's name and colour from the attributes a page marks them with", async () => {
    const read = await extractShadeRange(page, at);
    expect(read.ok).toBe(true);
    if (!read.ok) return;
    expect(read.range.shades.map((s) => [s.name, s.hex])).toEqual([
      ["Porcelain 110", "#F1D5BF"],
      ["Ivory 120", "#E8C4A5"],
      ["Sand 130", "#D9AE8A"],
      ["Honey 140", "#C99870"],
      ["Caramel 150", "#B07F58"],
      ["Chestnut 160", "#8F5D3C"],
      ["Espresso 170", "#6E442B"],
    ]);
    expect(read.range).toMatchObject({
      brand: "Sample brand",
      product: "Sample foundation, warm-leaning",
      sample: false,
      source: { kind: "page", url: at.url },
    });
  });

  it("counts a shade once however often the page lists it, and drops what is not a colour or has no name", async () => {
    const read = await extractShadeRange(page, at);
    if (!read.ok) throw new Error("not read");
    expect(read.range.shades.filter((s) => s.name === "Espresso 170")).toHaveLength(1);
    expect(read.range.shades.some((s) => s.name === "Broken")).toBe(false);
    expect(read.range.shades.some((s) => s.hex === "#FFFFFF")).toBe(false);
  });

  it("never reads text a page hides, so a hidden instruction cannot add a shade", async () => {
    const read = await extractShadeRange(page, at);
    if (!read.ok) throw new Error("not read");
    expect(JSON.stringify(read.range)).not.toMatch(/Free units|previous instructions/);
  });

  it("a page with no swatches is not readable", async () => {
    expect(await extractShadeRange(bad, at)).toEqual({ ok: false, reason: "range_not_readable" });
    expect(await extractShadeRange("", at)).toEqual({ ok: false, reason: "range_not_readable" });
  });

  it("a page with only one or two swatches is not a range", async () => {
    const two =
      '<button data-hex="#AA8866" aria-label="A"></button><button data-hex="#997755" aria-label="B"></button>';
    expect((await extractShadeRange(two, at)).ok).toBe(false);
  });

  it("gives every shade a unique id, and a name repeated with a different colour its own id", async () => {
    const html = ["#F0D0B0", "#E0C0A0", "#D0B090"]
      .map((h) => `<i data-hex="${h}" aria-label="Beige"></i>`)
      .join("");
    const read = await extractShadeRange(html, at);
    if (!read.ok) throw new Error("not read");
    expect(read.range.shades.map((s) => s.id)).toEqual(["beige", "beige-2", "beige-3"]);
  });

  it("whatever a reader answers is checked: a bad shape, bad colours and absurd sizes are refused", async () => {
    const reader = (answer: unknown): ShadeReader => ({ read: () => Promise.resolve(answer) });
    expect((await extractShadeRange("", at, reader("nonsense"))).ok).toBe(false);
    expect(
      (await extractShadeRange("", at, reader({ shades: [{ name: "A", hex: "red" }] }))).ok,
    ).toBe(false);
    const many = {
      shades: Array.from({ length: 500 }, (_, i) => ({ name: `S${String(i)}`, hex: "#AA8866" })),
    };
    expect((await extractShadeRange("", at, reader(many))).ok).toBe(false);
    const throwing: ShadeReader = { read: () => Promise.reject(new Error("model down")) };
    expect(await extractShadeRange("", at, throwing)).toEqual({
      ok: false,
      reason: "range_not_readable",
    });
  });

  it("names are plain text: markup and control characters are stripped, length is capped", () => {
    expect(cleanName("<b>Warm</b>\u0007 Sand &amp; Gold")).toBe("Warm Sand & Gold");
    expect(cleanName("x".repeat(500))).toHaveLength(80);
    expect(normaliseHex("#abc")).toBe("#AABBCC");
    expect(normaliseHex("rgb(1,2,3)")).toBeUndefined();
  });

  it("the swatch reader is just a reader: it can be swapped for another behind the same schema", async () => {
    expect(await new SwatchReader().read(page)).toMatchObject({ shades: expect.any(Array) });
  });
});

describe("which addresses may be fetched", () => {
  it("only public https addresses on the default port", () => {
    expect(checkUrl("https://shop.example/p").ok).toBe(true);
    for (const url of [
      "http://shop.example/p",
      "https://user:pw@shop.example/p",
      "https://shop.example:8443/p",
      "https://localhost/p",
      "https://metadata.google.internal/p",
      "https://127.0.0.1/p",
      "https://169.254.169.254/computeMetadata/v1/",
      "https://10.0.0.5/p",
      "https://[::1]/p",
      "file:///etc/passwd",
    ]) {
      expect(checkUrl(url).ok, url).toBe(false);
    }
    expect(checkUrl("not a url")).toEqual({ ok: false, reason: "url_invalid" });
  });

  it("classifies addresses: private, loopback, link-local, carrier-grade and mapped ones are not public", () => {
    for (const a of [
      "10.1.2.3",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "::1",
      "::",
      "fd00::1",
      "fe80::1",
      "::ffff:10.0.0.1",
      "not-an-ip",
    ]) {
      expect(isPublicAddress(a), a).toBe(false);
    }
    for (const a of [
      "93.184.216.34",
      "8.8.8.8",
      "172.32.0.1",
      "2606:4700:4700::1111",
      "::ffff:8.8.8.8",
    ]) {
      expect(isPublicAddress(a), a).toBe(true);
    }
  });
});

describe("POST /internal/extract/shade-range", () => {
  const post = async (app: ReturnType<typeof buildApp>["app"], url: string) =>
    await app.inject({ method: "POST", url: "/internal/extract/shade-range", payload: { url } });

  it("reads a saved fixture page in mock mode and says which page", async () => {
    const { app } = buildApp({});
    const res = await post(app, "fixture:sample-product");
    expect(res.statusCode).toBe(200);
    expect(res.json<{ range: { shades: unknown[]; source: unknown } }>().range.shades).toHaveLength(
      7,
    );
  });

  it("an unreadable page is a 422 the screen can explain, and costs nothing", async () => {
    const { app } = buildApp({});
    const res = await post(app, "fixture:unreadable");
    expect([res.statusCode, res.json<{ error: string }>().error]).toEqual([
      422,
      "range_not_readable",
    ]);
  });

  it("an unknown fixture and a blocked address are refused", async () => {
    const { app } = buildApp({});
    expect((await post(app, "fixture:nope")).statusCode).toBe(502);
    const blocked = await post(app, "https://169.254.169.254/");
    expect([blocked.statusCode, blocked.json<{ error: string }>().error]).toEqual([
      422,
      "url_blocked",
    ]);
  });

  it("reads a real address through the fetcher it is given", async () => {
    const seen: string[] = [];
    const { app } = buildApp(
      {},
      {
        fetchPage: (url) => {
          seen.push(url);
          return Promise.resolve({
            ok: true as const,
            html: page,
            finalUrl: "https://shop.example/final",
          });
        },
      },
    );
    const res = await post(app, "https://shop.example/p");
    expect(seen).toEqual(["https://shop.example/p"]);
    expect(res.json<{ range: { source: { url: string } } }>().range.source.url).toBe(
      "https://shop.example/final",
    );
  });
});
