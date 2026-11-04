# Native compatibility and verification

## Compatibility baseline and provenance

The minimum supported API baseline is VS Code 1.105. The reproducible test target is **1.105.1**. No proposed API, internal command, clipboard keyboard hook, or editor-history replacement is used by the extension.

Research sources, pinned so updates are reviewable:

| Area | Official source | Implementation |
| --- | --- | --- |
| Paste registration, MIME entries, workspace references | [dropOrPasteResource.ts, 1.105.1](https://github.com/microsoft/vscode/blob/1.105.1/extensions/markdown-language-features/src/languageFeatures/copyFiles/dropOrPasteResource.ts) | MDX-only image subset; reads bytes before creating edits |
| Settings, variables, transforms, glob anchoring | [copyFiles.ts, 1.105.1](https://github.com/microsoft/vscode/blob/1.105.1/extensions/markdown-language-features/src/languageFeatures/copyFiles/copyFiles.ts) | Vendored unchanged in `src/native/copy-files.ts` |
| Glob matcher, first match, suffix numbering | [newFilePathGenerator.ts, 1.105.1](https://github.com/microsoft/vscode/blob/1.105.1/extensions/markdown-language-features/src/languageFeatures/copyFiles/newFilePathGenerator.ts) | Same picomatch matching/order and `-1` numbering; stricter filesystem errors and collision guards |
| Snippets, relative paths, escaping | [shared.ts, 1.105.1](https://github.com/microsoft/vscode/blob/1.105.1/extensions/markdown-language-features/src/languageFeatures/copyFiles/shared.ts) | Image-only snippet builder, native path/escaping functions |
| Setting declarations and defaults | [package.json, 1.105.1](https://github.com/microsoft/vscode/blob/1.105.1/extensions/markdown-language-features/package.json) | Read existing settings, never redeclare them |
| Stable API contract | [vscode.d.ts, 1.105.1](https://github.com/microsoft/vscode/blob/1.105.1/src/vscode-dts/vscode.d.ts) | `DocumentPasteEdit`, `SnippetTextEdit`, binary `WorkspaceEdit.createFile` |
| File Undo/Redo implementation | [bulkFileEdits.ts, 1.105.1](https://github.com/microsoft/vscode/blob/1.105.1/src/vs/workbench/contrib/bulkEdit/browser/bulkFileEdits.ts) | Verified with real Host probes, described below |
| Empty insertText and additional edit ordering | [edit.ts, 1.105.1](https://github.com/microsoft/vscode/blob/1.105.1/src/vs/editor/contrib/dropOrPasteInto/browser/edit.ts) | Empty insert text; file edits precede document edits |
| Newer destination containment checks | [copyFiles.ts at 7a4fab9](https://github.com/microsoft/vscode/blob/7a4fab9da6f2494cf11759e57ba0a6b20c4bb8d4/extensions/markdown-language-features/src/languageFeatures/copyFiles/copyFiles.ts) | Adapted into `src/destination-safety.ts`; also reject workspace-root-as-file targets |
| Upstream path test cases | [copyFile.test.ts, 1.105.1](https://github.com/microsoft/vscode/blob/1.105.1/extensions/markdown-language-features/src/test/copyFile.test.ts) | Adapted into `test/upstream-copy-file.ts` and run in the Host |
| Upstream reference test cases | [pasteUrl.test.ts, 1.105.1](https://github.com/microsoft/vscode/blob/1.105.1/extensions/markdown-language-features/src/test/pasteUrl.test.ts) | Source-derived image snippet golden cases |
| Standard MDX language identifier | [MDX analyzer extension manifest](https://github.com/mdx-js/mdx-analyzer/blob/main/packages/vscode-mdx/package.json) | `mdx`, with an extension-specific `**/*.mdx` fallback |

Native Markdown does not expose its resource paste provider or path resolver as a stable extension export. The image-only subset is therefore implemented locally. `vscode-uri` and `picomatch` are bundled to retain native URI and glob behavior. No Markdown parser, language server, UI framework, or runtime package installation is needed.

## Settings and destination semantics

The configuration scope is the current `TextDocument`, so VS Code applies all scopes supported by the existing setting declarations. In the baseline, `copyFiles.destination` and `copyFiles.overwriteBehavior` do not declare a resource scope. VS Code rejects attempts to update them at Folder scope in a multi-root workspace. The tests verify that rejection and User/Workspace precedence instead of pretending to add Folder support. Resource settings such as `editor.filePaste.enabled` respect Folder overrides.

`copyFiles.destination` defaults to `{}` and native overwrite behavior defaults to `nameIncrementally`. MDX always uses incremental naming on collisions, including when the existing Markdown setting is `overwrite`; this is an intentional difference from native Markdown. Configurations are read for every paste. Object entries are traversed in JavaScript's native enumeration order; each glob is tested against the **document URI path**, not the image filename. picomatch uses `{ dot: true }`. Non-`**` relative patterns receive `**/`; leading `/` patterns are expanded against all workspace folders. First match wins. No match saves next to the document.

A destination is trimmed. An empty value becomes `${fileName}`. A leading `/` becomes `${documentWorkspaceFolder}/`; a trailing `/` adds `${fileName}`. Substitution happens once, then URI path resolution normalizes the result. Relative paths resolve against the document directory. `../` is allowed within the authorized workspace, but escaping all workspace roots is rejected. Without a workspace, the containing document directory is the boundary.

| Variable | Meaning |
| --- | --- |
| `documentDirName` | Absolute document parent URI path |
| `documentRelativeDirName` | Parent path relative to its workspace; absolute outside a workspace |
| `documentFileName` | Filename including extension |
| `documentBaseName` | Filename without its last extension |
| `documentExtName` | Last extension without the dot, with original case |
| `documentFilePath` | Absolute document URI path |
| `documentRelativeFilePath` | Document path relative to its workspace; absolute outside a workspace |
| `documentWorkspaceFolder` | Document workspace folder path; document directory outside a workspace |
| `fileName` | Supplied image filename including extension |
| `fileExtName` | Last image extension without the dot, with original case |
| `unixTime` | Current Unix timestamp in **milliseconds** |
| `isoTime` | Current UTC ISO string |

Unknown names, including `fileBaseName`, `fileDirName`, and differently cased names, remain literal. Regex transforms use native `${name/pattern/replacement/}` syntax, escaped slashes, and JavaScript capture groups. Native quirks are retained: an empty replacement does not remove the match, invalid regexes fall back to the untransformed value, and replacement output is not expanded a second time. `isoTime` may produce invalid Windows filename characters unless transformed; its meaning is not changed to hide this platform difference.

URI paths retain schemes and authorities, including remote, drive-letter, and UNC paths. For local file reference generation, the native platform's `path.relative` handles drive-letter casing; the result is normalized to `/`. Other filesystem schemes use POSIX relative paths. Native links use `alt text` placeholders and no leading `./`. Whitespace and unbalanced parentheses receive angle brackets. Native path generation leaves `#` and `%` literal; exhaustive URL encoding is not claimed.

## File history and API limits

All production writes are `WorkspaceEdit.createFile` operations in the paste's `additionalEdit`; direct `workspace.fs` operations only inspect supplied input files and destination metadata. The additional edit lists files first, then snippet text edits, with an empty `insertText`. VS Code's paste combiner uses that order directly. A failed first file operation therefore cannot insert an invalid reference. Provider preparation itself writes nothing.

### Existing-file overwrite cannot restore the old binary

The stable file-create API offers no binary before-image or custom undo callback. In native `CreateOperation.perform`, the inverse is a `DeleteEdit`, even for `overwrite: true`; the previous file contents are not recorded. A real Host test uses the equivalent of:

```ts
await workspace.fs.writeFile(image, oldBytes); // test setup only
const edit = new WorkspaceEdit();
edit.createFile(image, { contents: newBytes, overwrite: true });
edit.insert(document.uri, new Position(0, 0), 'reference');
await workspace.applyEdit(edit);
await commands.executeCommand('undo');
// Actual: text is removed and image is absent. oldBytes are not restored.
await commands.executeCommand('redo');
// Actual: text and newBytes return.
```

This probe is named `native createFile(overwrite) deletes the old image on undo` in `test/host.ts`. It asserts the actual limitation, so an upstream fix will force a review of the evidence. The agreed MDX behavior preserves existing images by choosing the first available filename: `image.png`, `image-1.png`, `image-2.png`, etc. Both `overwrite` and `nameIncrementally` use that same policy, with no collision warning or cancellation. Undo removes only the newly created file and reference; Redo restores their same path and bytes. The earlier image remains intact throughout. A multi-image paste also reserves names within its batch and skips suffixes already on disk. No private history is maintained.

### Resource edits do not guarantee rollback

The public `workspace.applyEdit` contract only promises all-or-nothing for **text-only** edits; resource operations abort at failure. The injected-filesystem test makes `first.png` succeed and `fail.png` throw `FileSystemError.NoPermissions`. Actual results: the combined edit returns false, document text is unchanged, the failing file is absent, and the earlier image remains. This is also an unmet strict rollback requirement. Native file operations do not provide a transaction or a safe generic compensating-undo hook to the paste provider.

Preflight catches known collisions, bad parents, read-only providers, unsafe filenames, symlinks, and escaped roots before any edit is returned. Unexpected disk/remote failures after the first write can still leave partial files. Inspect and remove unreferenced partial images after such failures. No automatic cleanup is attempted because it could delete files modified by someone else or disturb the editor's undo history. New empty parent directories can remain after Undo, as with native Markdown.

### Outside changes and concurrent pastes

The external-change probe pastes a new PNG, replaces its bytes externally with a GIF, and undoes/redoes the paste. Native Undo removes the file; Redo restores the externally changed bytes captured at undo time. The extension preserves this native behavior and cannot guarantee the original paste payload after external mutation. VS Code may display additional confirmation prompts depending on affected resources and editor state.

Batch-local paths are reserved while planning multiple images. Cross-request creates always use `overwrite: false`, even when the requested overwrite policy is `overwrite`. If another operation creates the path after preflight, VS Code rejects the creation; the preexisting image is unchanged and no reference text is inserted when the first file fails. A user may need to repeat one of two simultaneous pastes. Stable filesystem APIs do not support an atomic no-symlink/open-under-root primitive; destination containment is a preflight check, not a guarantee against a different process replacing directories between inspection and write.

## Validation boundaries

Local verification on 2026-11-04 (macOS arm64):

| Check | Result |
| --- | --- |
| TypeScript against stable 1.105 API declarations | Passed |
| Node unit tests | 23 passed |
| VS Code 1.105.1 Extension Host | 40 passed, 1 optional clipboard test pending, 0 failed |
| VS Code 1.144.1 Extension Host | 40 passed, 1 optional clipboard test pending, 0 failed |
| Existing overwrite before-image probe | Both versions delete the target on Undo; Redo restores new bytes |
| Injected second-file write failure | Both versions leave the first file and keep document text unchanged |
| External image modification probe | Both versions use the bytes present at Undo as the Redo payload |
| VSIX package and content inspection | Passed; test fixtures, sources, dependencies, and local profiles excluded |
| Real screenshots / file-manager clipboard / SSH / WSL / Containers | Not manually verified |
| GitHub CI jobs and Marketplace account access | Configured locally; not run/authenticated in this session |

`pnpm test:unit` tests binary recognition, portable filename validation, every native variable, regex transforms, fallback rules, and POSIX/Windows/UNC/remote URI resolution. Host tests execute the upstream destination cases, verify configuration scopes and globs, apply actual provider-generated WorkspaceEdits, and exercise native Undo/Redo against both real files and a registered test filesystem. They verify document text, exact image paths, existence, binary contents, and operation order.

Image recognition is a header check, not a complete image decoder or an integrity validator. Unsupported or unrecognized input falls back without writes. URI-list entries must name a supported image suffix before bytes are read; DataTransfer files are checked from bytes regardless of MIME. HTTP URLs are never downloaded. Clipboard filenames containing separators, traversal, control characters, drive syntax, or Windows reserved names are refused across platforms. This intentionally makes some unusual POSIX filenames unsupported.

There is an opt-in live native Markdown clipboard comparison (`NATIVE_CLIPBOARD_TEST=1 pnpm test:integration`). In this development session, programmatic copy in the isolated macOS window did not invoke `prepareDocumentPaste`; that live check is **not a pass**. It is pending by default. Automated compatibility evidence uses the pinned upstream destination tests and source-derived reference golden cases. OS screenshots, Finder/Explorer copies, WSL/SSH/Containers, and visual MDX language-service behavior remain manual checks in `manual-tests.md`.

The CI matrix is configured for Windows, macOS, and Linux on 1.105.1 and current stable. A configured job is not evidence that it has run on GitHub. Machine-readable local Host results are written under `artifacts/host-<version>.json` and are excluded from the VSIX. Source changes that alter provider behavior require rerunning the appropriate tests before a release.
