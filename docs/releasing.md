# Release preparation

`pnpm package` performs the TypeScript check and bundled build through `vscode:prepublish`, then creates `artifacts/mdx-image-paste-<version>.vsix`. `pnpm package:check` lists the included files. Only the extension bundle, manifest, README, changelog, licenses, and end-user compatibility/test notes belong in the archive.

Before publishing:

1. Run the CI matrix and the applicable manual checks in `manual-tests.md`. Verify automatic numeric suffixes on collisions for both Markdown overwrite settings, with existing images preserved through Undo/Redo. Review the remaining file-operation rollback limitations.
2. Confirm that you own the Marketplace publisher ID `lixl39505`. It is inferred from this repository owner and has not been authenticated or registered by this project. If another ID is needed, update `package.json` and the extension ID used by Host tests before packaging.
3. Review `README.md`, license attribution, repository URL, version, and changelog. Install the VSIX in a clean VS Code profile and verify normal paste and language-service coexistence.
4. Create or select your publisher through the [Marketplace publisher management page](https://marketplace.visualstudio.com/manage). Publishing requires the publisher's credentials or a configured Trusted Publishing policy; none are stored here.
5. Upload the reviewed VSIX through the publisher management page, or configure [GitHub Actions Trusted Publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#publish-with-github-actions-and-trusted-publishing) and use `pnpm exec vsce publish --oidc --packagePath artifacts/mdx-image-paste-0.1.0.vsix`. The CI workflow in this repository only builds and tests; it has no publish permission.

The [official publishing guide](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) documents publisher registration, metadata constraints, authentication, and packaging. No external publishing, repository push, tag, or Marketplace account creation is performed by the local build scripts.
