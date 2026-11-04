# Changelog

## 0.1.0

- Add MDX-only native image paste with PNG, JPEG, GIF, and WebP header detection.
- Reuse Markdown destination variables, transforms, globs, and incremental naming.
- Group new image files and references in native Undo/Redo history.
- Support multiple images, workspace file references, and remote URI paths.
- Preserve existing images by automatically adding numeric suffixes on conflicts, including when Markdown's overwrite setting is enabled.
- Reject unsafe destinations and document verified stable API limitations.
- Add unit tests, real Extension Host history tests, an optional OS clipboard comparison, CI, and VSIX packaging.
