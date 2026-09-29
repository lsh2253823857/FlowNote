# Self-Describing Drag JSON Design

## Goal

Make every newly recorded drag understandable without relying on undocumented assumptions about coordinate units, origins, reference elements, slider values, or replay priority.

## Recording schema

New recordings use root `schemaVersion: 3`. Versions 1 and 2 remain readable. Every `drag` step contains:

```json
{
  "action": "drag",
  "dragType": "range",
  "coordinateSystem": {"unit": "ratio", "origin": "top-left"},
  "start": {"x": 0.2, "y": 0.5, "relativeTo": "source"},
  "end": {"x": 0.8, "y": 0.5, "relativeTo": "source"},
  "startValue": "20",
  "targetValue": "80",
  "replayStrategy": "set-value-first"
}
```

Coordinates are inclusive ratios from 0 through 1. `start.relativeTo` is always `source`. Range and canvas endpoints are relative to `source`; sortable and ordinary element endpoints are relative to `dropTarget`. Canvas path points are also relative to `source`.

Replay strategies are explicit: `set-value-first` for ranges, `semantic-drop-first` for sort and element drags, and `path-first` for canvas gestures. A range still receives a runtime parameter; captured values are examples only.

## Compatibility and privacy

The normalizer and converter accept legacy drag steps without `coordinateSystem` or `relativeTo`, infer the established meaning from `dragType`, and emit the new self-describing structure. Legacy range `value` is accepted as an alias for `targetValue`. New recordings write only `targetValue`.

Actual range values remain behind the existing “保留填写示例” switch. Relative coordinates and semantic targets are always retained. Sensitive sliders continue to degrade to manual steps.

## Verification

Pure core tests cover the exact v3 shape, privacy behavior, legacy normalization, invalid metadata, and per-type reference rules. Converter tests verify v1/v2 compatibility and v3 preservation. Browser smoke assertions verify that newly captured drag steps contain the metadata, while syntax, metadata, and documentation checks cover packaging.
