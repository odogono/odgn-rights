## 0.0.2 - 2025-10-13

### Changed

- More robust path normalization (collapse duplicate slashes, handle trailing slash; use `replaceAll`).
- Safer glob-to-RegExp conversion and escaping.
- Consistent handling of composite flag checks across Right/Rights.
- String formats collapse CREATE and DELETE to `c` in masks.
- Minor API typings and serialization shape made more explicit (stable keys in `toJSON`).
