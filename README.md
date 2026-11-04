# MDX Image Paste

Paste images into MDX files using VS Code's native Markdown image settings.

Open a saved `.mdx` file, copy a screenshot or image, and press **Cmd+V** (macOS) or **Ctrl+V** (Windows/Linux). The extension saves the image and inserts a Markdown image reference. Your MDX language mode, highlighting, completions, and language server stay in place. Ordinary Markdown and text pastes keep their existing behavior.

## Install

Requires **VS Code 1.105 or later** on desktop, including remote workspaces. Use an MDX language extension such as [MDX](https://marketplace.visualstudio.com/items?itemName=unifiedjs.vscode-mdx) for syntax highlighting and language services; MDX Image Paste does not supply or replace them.

To install a local build, run **Extensions: Install from VSIX...** and select `mdx-image-paste-0.1.0.vsix`. See [Development](#development) to build it. Marketplace publication is a separate maintainer step; this repository does not publish automatically.

## Use your existing Markdown image destination

There are no extension-specific settings or keybindings. With no configuration, new images go next to the document. Conflicting names automatically receive `-1`, `-2`, etc.

For example, keep your existing settings:

```json
{
  "markdown.copyFiles.destination": {
    "*.*": "${documentBaseName}/${fileName}"
  }
}
```

Pasting a new `screenshot.png` into `docs/guide.mdx` creates `docs/guide/screenshot.png` and inserts:

```mdx
![alt text](guide/screenshot.png)
```

`alt text` is an editable snippet placeholder. This format follows native Markdown, including its omission of `./`. Spaces and unmatched parentheses use angle-bracket destinations, for example `![alt text](<guide/my image.png>)`.

If `docs/guide/screenshot.png` already exists, the next paste creates `docs/guide/screenshot-1.png` and references `guide/screenshot-1.png`. Further conflicts use the next available suffix. Existing images keep their original bytes.

The extension reads the current Markdown image destination for the document on every paste. VS Code's own setting scopes apply: `markdown.copyFiles.destination` is window-scoped in the baseline version (User or Workspace); resource-scoped settings such as `markdown.editor.filePaste.enabled` also support Folder settings. No settings are redeclared or overridden.

Destination globs match the **document path**, in configuration insertion order; the first matching entry wins. `/` anchors a glob or destination to a workspace folder. A destination ending in `/` appends the input filename. An unmatched glob falls back to the document directory.

Supported native variables are `documentDirName`, `documentRelativeDirName`, `documentFileName`, `documentBaseName`, `documentExtName`, `documentFilePath`, `documentRelativeFilePath`, `documentWorkspaceFolder`, `fileName`, `fileExtName`, `unixTime`, and `isoTime`. Native `${variable/pattern/replacement/}` transforms and escaping are preserved. `fileBaseName` and `fileDirName` are **not native variables** in the compatibility baseline and are left unresolved. See [the full compatibility notes](docs/compatibility.md).

## Undo and Redo

New image files and document references share VS Code's native undo unit:

| Action | Document | New image files |
| --- | --- | --- |
| Paste | Inserts references | Creates files |
| Undo | Removes references | Deletes created files |
| Redo | Restores references | Restores the same names and bytes |

Use **Cmd+Z / Cmd+Shift+Z** on macOS, or **Ctrl+Z / Ctrl+Y** on Windows/Linux (or your configured Redo binding). Images already inside a workspace are referenced in place and are never deleted by undo.

**Existing images are always preserved.** Same-name pastes automatically add a numeric suffix. Undo removes only the newly created images; Redo restores their same filenames and bytes.

## Supported inputs and limitations

- PNG, JPEG, GIF, and WebP are recognized from their binary headers. Screenshots and external image-file entries work when VS Code exposes their data. Multiple images work when exposed as distinct DataTransfer entries or a URI list.
- Images already in any workspace folder are referenced without copying, matching native Markdown. `markdown.editor.filePaste.copyIntoWorkspace: "never"` keeps existing file references and ignores raw clipboard images.
- Save untitled documents before pasting image data. No destination is guessed for an unsaved MDX document.
- Destination writes must remain inside a workspace folder, or the document directory when opened outside a workspace. Symlink destinations and unsafe clipboard filenames are rejected. The extension never downloads HTTP image URLs or handles SVG/audio/video.
- Concurrent pastes cannot overwrite one another: final file creation disallows overwrites. If two prepared operations choose the same name, VS Code may reject one; paste it again.
- File operations use native history. Unexpected I/O failures in a multi-file edit can leave partial files because the stable API does not guarantee rollback. External changes during Undo/Redo also follow native history semantics. See the evidence and recovery notes in [compatibility notes](docs/compatibility.md#file-history-and-api-limits).
- Native Markdown's parser-dependent smart-paste rules for code, math, and HTML contexts are not reproduced. Image data pastes insert references in MDX; plain text and non-image providers retain priority. `filePaste.enabled: "never"` disables this provider.
- Read-only virtual file systems cannot receive image files. Remote SSH, WSL, and Dev Containers use workspace URIs and `workspace.fs`; actual OS clipboard and remote transport combinations need the [manual checks](docs/manual-tests.md).
- This is a desktop Node extension; browser-only VS Code is not supported. Filename fallback supports `.mdx` documents with other language IDs, while explicit Markdown mode stays with the built-in provider.

## Privacy

No telemetry, clipboard polling, uploads, network clients, shell commands, or background services. Clipboard data is read only in response to a paste. Only pasted inputs and destination metadata are inspected. Image bytes are not decoded or executed. The packaged extension bundles its two small compatibility libraries and needs no separately installed runtime dependencies.

## Development

Use Node.js 22+ and pnpm 12.8.2:

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm test:unit
pnpm test:integration
pnpm package
```

The integration runner downloads VS Code 1.105.1, opens an isolated two-folder workspace, and runs native file/text undo tests. On headless Linux, run `xvfb-run -a pnpm test:integration`. Use `VSCODE_VERSION=stable` to test current stable, or set `VSCODE_EXECUTABLE_PATH` to a desktop executable. Do not run multiple Host suites against the same checkout concurrently.

CI is configured to run the baseline and stable versions on Linux, macOS, and Windows, and upload the VSIX. Test-only clipboard fixtures are excluded from the VSIX. Real screenshots and file-manager copies require the documented manual checks; automated DataTransfer fixtures do not prove OS clipboard compatibility. The opt-in live comparison is `NATIVE_CLIPBOARD_TEST=1 pnpm test:integration`; it is pending in the default suite.

See [release instructions](docs/releasing.md), [native source provenance](docs/compatibility.md), and [third-party licenses](THIRD_PARTY_NOTICES.md).
