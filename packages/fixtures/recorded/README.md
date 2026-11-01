# Recorded responses

`pnpm fixtures:record <feature> --input <image> --params <json>` writes here, one folder per
feature:

```text
recorded/<feature>/<name>.json        the fixture (request key, latency, outcome, units)
recorded/<feature>/files/<hash>.<ext>  result images, kept under the references in the fixture
recorded/feature-cost.json             the prices read when recording
```

Input photos are never stored. Result images that show a real face are stored only when that
person has given written consent, listed in `../CONSENT.md`. Signed URLs are replaced with
`fixture://` references before anything is written.

This folder is empty until someone records with a real YouCam key. Until then mock mode shows
synthetic sample results and says so.
