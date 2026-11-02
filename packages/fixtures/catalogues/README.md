# Shade catalogues

Shade ranges for mock mode. A range here is a JSON file in the `ShadeRange` shape
(`packages/schemas/src/shade.ts`): brand, product, and each shade's id, name and hex.

**The two files here are samples.** They are invented colours spaced evenly from light to deep, with
`"sample": true`, and the screens say "sample range". They are not any brand's products. Real ranges
go here once someone has read them from a product page they may use, with the page address in
`source` and the date it was read; set `"sample": false` only for those (docs/FACTS.md rule 12).
