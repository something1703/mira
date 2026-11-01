export const NO_CATALOGUE = "Add your range to see who it serves.";
export const CLOSED = "The brand console is not open yet.";
export const RECORDED =
  "Recorded data. The shoppers, outcomes and looks here are invented for the demo, and nothing in them is a real person.";

export const CSV_PROBLEMS: Record<string, string> = {
  not_a_colour: "is not a colour. Use a code like #C99870.",
  missing_product: "has no product name.",
  missing_shade: "has no shade name.",
  wrong_columns: "needs the columns product, shade and hex.",
  too_many_shades: "has more shades than one product can hold (200).",
  too_many_products: "has more products than one range can hold (50).",
};

export const hiddenCell = (k: number) =>
  `Fewer than ${String(k)} shoppers; hidden to protect privacy.`;

/** Words for a hue angle, so a chart cell can be read without seeing it. */
export const hueWord = (h: number): string =>
  h < 45 ? "redder" : h < 65 ? "in the middle" : h < 85 ? "more yellow" : "yellower still";
