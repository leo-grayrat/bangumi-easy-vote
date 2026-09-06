# Poster visual library and per-ranking state design

## Goal

Keep the poster preview visible while editing long ranking lists, preserve each ranking mode independently, and make previously prepared anime visuals reusable across ranking modes on the same computer.

## Confirmed behavior

- Desktop preview stays visible while the left editor column scrolls. Narrow single-column layouts keep normal document flow.
- Red, black, controversy, and favorite rankings each keep their own complete project state. Switching away and back restores that ranking exactly.
- A reusable visual plan is the unit shared across rankings: source image + crop zoom/offset + brightness + readable label + anime identity.
- Different rankings do not automatically choose the same visual plan for an anime. They only expose existing plans for one-click reuse.
- If two rankings intentionally choose the same visual plan, they share that plan as-is. No automatic copy-on-write or hidden duplication is introduced.
- JSON remains a same-computer project format: it stores references and crop state, not image binaries.
- Physical image files may remain UUID-named internally. Human usability comes from an indexed visual-plan library and readable UI labels.

## Storage model

Existing image binaries remain in `.local/poster-assets/<scope>/`.

Add `.local/poster-visuals/<scope>.json` with entries shaped like:

```json
{
  "version": 1,
  "visuals": [
    {
      "visualId": "uuid",
      "animeTitle": "再见 拉拉",
      "providerIds": {"tmdb": 123},
      "label": "S1E5 · 第5集剧照",
      "asset": {"assetId": "...jpg", "scope": "project-x", "fileName": "tmdb-s1e5.jpg", "source": "tmdb"},
      "crop": {"zoom": 1.35, "offsetX": -0.24, "offsetY": 0.08},
      "brightness": 0.78
    }
  ]
}
```

Anime matching prefers equal TMDB id when both sides have one and otherwise falls back to normalized title equality.

Each ranking project item keeps `visualId` plus its materialized image/crop snapshot so old JSON remains readable and rendering stays simple. On restore, if `visualId` exists in the local visual library, the current library version refreshes the snapshot.

Ranking project states are stored by `(scope, mode)` instead of a single shared file. Legacy `<scope>.json` remains readable as a one-time fallback for its embedded mode.

## UI

Each row keeps the existing local-upload and TMDB controls and gains `已有视觉方案 (N)`. A modal shows only plans matching that anime, with final cropped preview, readable label, source/original filename, rename control, and one-click use.

New local/TMDB images automatically create a visual plan using the original filename or TMDB description as the initial label. Crop/zoom/brightness edits update the active visual plan.

## Compatibility

- Existing assets are not renamed or moved.
- Existing project JSON without `visualId` continues to render normally.
- Existing single-state files are accepted as migration fallback.
- No ZIP/base64 portable export is added.
