/**
 * Illustrative catalogue shades for the component gallery. They are data, like a brand's range,
 * not UI colours, so they live outside the scanned app and package sources. Product numbers always
 * come from measurements; these are for layout review only.
 */
export const DEMO_SHADES = [
  { colour: "rgb(199 154 120)", name: "320", de: "1.8", state: "best" },
  { colour: "rgb(194 143 107)", name: "330", de: "2.4", state: "selected" },
  { colour: "rgb(205 165 133)", name: "310", de: "3.1", state: "default" },
  { colour: "rgb(120 80 56)", name: "560", de: "14.2", state: "out_of_range" },
] as const;
