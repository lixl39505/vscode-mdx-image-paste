import * as assert from 'node:assert/strict';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import Mocha from 'mocha';
import * as vscode from 'vscode';
import { ImagePasteProvider, isMdxDocument, mdxSelector, imageEditKind } from '../src/paste-provider';
import { desiredDestination } from '../src/path-resolver';
import { getCopyFileConfiguration } from '../src/native/copy-files';
import { readPasteConfiguration } from '../src/markdown-config';
import { createImageSnippet } from '../src/reference-generator';
import { png, gif, jpeg, webp, fileTransfer } from './fixtures';
import { registerNativePathTests } from './upstream-copy-file';
import { MemoryFileSystem } from './memory-fs';

const token = new vscode.CancellationTokenSource();
const pasteContext = { triggerKind: vscode.DocumentPasteTriggerKind.Automatic, only: undefined };
const startRange = new vscode.Range(0, 0, 0, 0);
const warnings: string[] = [];
const provider = new ImagePasteProvider(message => warnings.push(message));
let root: vscode.Uri;
let directory: vscode.Uri;
let editor: vscode.TextEditor;
let counter = 0;

const at = (name: string) => vscode.Uri.joinPath(directory, name);
const comparablePath = (uri: vscode.Uri) => uri.path.replace(/^\/[A-Z]:/, drive => drive.toLowerCase());
const config = () => vscode.workspace.getConfiguration('markdown', editor.document);
async function setting(name: string, value: unknown) {
  await config().update(name, value, vscode.ConfigurationTarget.Workspace);
}
async function exists(uri: vscode.Uri): Promise<boolean> {
  try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}
async function bytes(uri: vscode.Uri, expected: Uint8Array) {
  assert.deepEqual(Buffer.from(await vscode.workspace.fs.readFile(uri)), Buffer.from(expected), uri.toString());
}
async function waitFor(predicate: () => boolean, label: string) {
  const deadline = Date.now() + 5000;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting for ${label}`);
    await new Promise(resolve => setTimeout(resolve, 25));
  }
}
async function openDocument(name = 'guide.mdx') {
  const uri = at(name);
  await vscode.workspace.fs.writeFile(uri, new Uint8Array());
  editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(uri));
  return editor.document;
}
async function editFor(data = fileTransfer([{ name: 'screenshot.png', data: png }]), ranges = [startRange]) {
  const edits = await provider.provideDocumentPasteEdits(editor.document, ranges, data, pasteContext, token.token);
  return edits?.[0];
}
async function paste(data = fileTransfer([{ name: 'screenshot.png', data: png }])) {
  const range = new vscode.Range(editor.selection.start, editor.selection.end);
  const edit = await editFor(data, [range]);
  assert.ok(edit?.additionalEdit, warnings.join('\n'));
  assert.equal(edit.insertText, '');
  assert.equal(await vscode.workspace.applyEdit(edit.additionalEdit), true);
  return editor.document.getText();
}
async function undo() { await vscode.commands.executeCommand('undo'); }
async function redo() { await vscode.commands.executeCommand('redo'); }

function suites() {
  registerNativePathTests();
  suite('MDX image paste: real Extension Host', () => {
    suiteSetup(async () => {
      root = vscode.workspace.workspaceFolders![0]!.uri;
      await vscode.extensions.getExtension('lixl39505.mdx-image-paste')!.activate();
    });
    setup(async () => {
      warnings.length = 0;
      directory = vscode.Uri.joinPath(root, `case-${Date.now()}-${counter++}`);
      await vscode.workspace.fs.createDirectory(directory);
      await openDocument();
      await setting('copyFiles.destination', {});
      await setting('copyFiles.overwriteBehavior', 'nameIncrementally');
      await setting('editor.filePaste.enabled', 'smart');
      await setting('editor.filePaste.copyIntoWorkspace', 'mediaFiles');
    });
    teardown(async () => {
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      // Test-only cleanup. Production code never writes directly through workspace.fs.
      await vscode.workspace.fs.delete(directory, { recursive: true, useTrash: false });
    });

    test('default config and configuration changes are read at each paste', async () => {
      assert.deepEqual(getCopyFileConfiguration(editor.document), { destination: {}, overwriteBehavior: 'nameIncrementally' });
      assert.equal(comparablePath(desiredDestination(editor.document, 'image.png')), comparablePath(at('image.png')));
      await setting('copyFiles.destination', { '*.*': '${documentBaseName}/${fileName}' });
      assert.equal(comparablePath(desiredDestination(editor.document, 'image.png')), comparablePath(at('guide/image.png')));
      assert.equal(await paste(), '![alt text](guide/screenshot.png)');
      await bytes(at('guide/screenshot.png'), png);
    });
    test('user and workspace settings follow native scopes; resource settings support folders', async () => {
      const key = 'copyFiles.overwriteBehavior';
      const previous = config().inspect<string>(key)!;
      try {
        await config().update(key, undefined, vscode.ConfigurationTarget.Workspace);
        await config().update(key, 'overwrite', vscode.ConfigurationTarget.Global);
        assert.equal(getCopyFileConfiguration(editor.document).overwriteBehavior, 'overwrite');
        await config().update(key, 'nameIncrementally', vscode.ConfigurationTarget.Workspace);
        assert.equal(getCopyFileConfiguration(editor.document).overwriteBehavior, 'nameIncrementally');
        await assert.rejects(async () => config().update(key, 'overwrite', vscode.ConfigurationTarget.WorkspaceFolder), /folder resource scope/);
        await config().update('editor.filePaste.enabled', 'never', vscode.ConfigurationTarget.WorkspaceFolder);
        assert.equal(readPasteConfiguration(editor.document).enabled, 'never');
      } finally {
        await config().update(key, previous.globalValue, vscode.ConfigurationTarget.Global);
        await config().update(key, previous.workspaceValue, vscode.ConfigurationTarget.Workspace);
        await config().update('editor.filePaste.enabled', undefined, vscode.ConfigurationTarget.WorkspaceFolder);
      }
    });
    test('glob matches the document, first matching entry wins, unmatched falls back', async () => {
      await setting('copyFiles.destination', { '*.png': 'wrong/', '**/guide.{md,mdx}': 'first/', '*.*': 'second/' });
      assert.equal(comparablePath(desiredDestination(editor.document, 'input.png')), comparablePath(at('first/input.png')));
      await setting('copyFiles.destination', { '**/other.mdx': 'wrong/' });
      assert.equal(comparablePath(desiredDestination(editor.document, 'input.png')), comparablePath(at('input.png')));
    });
    test('workspace-root globs, dot directories, extglobs and second root', async () => {
      const relative = vscode.workspace.asRelativePath(editor.document.uri, false);
      await setting('copyFiles.destination', { [`/${relative}`]: '/assets/${fileName}' });
      assert.equal(comparablePath(desiredDestination(editor.document, 'input.png')), comparablePath(vscode.Uri.joinPath(root, 'assets/input.png')));
      await setting('copyFiles.destination', { '**/@(guide|other).mdx': '.assets/${fileName}' });
      assert.equal(comparablePath(desiredDestination(editor.document, 'input.png')), comparablePath(at('.assets/input.png')));
      const second = vscode.workspace.workspaceFolders![1]!.uri;
      const document = await vscode.workspace.openTextDocument(vscode.Uri.joinPath(second, 'second.mdx')).then(undefined, async () => {
        const uri = vscode.Uri.joinPath(second, 'second.mdx');
        await vscode.workspace.fs.writeFile(uri, new Uint8Array());
        return vscode.workspace.openTextDocument(uri);
      });
      await vscode.workspace.getConfiguration('markdown', document).update('copyFiles.destination', { '/second.mdx': '/assets/${fileName}' }, vscode.ConfigurationTarget.Workspace);
      assert.equal(comparablePath(desiredDestination(document, 'input.png')), comparablePath(vscode.Uri.joinPath(second, 'assets/input.png')));
      await vscode.workspace.fs.delete(document.uri);
    });
    test('language isolation, alternate MDX ids and retained language service identity', async () => {
      assert.equal(editor.document.languageId, 'mdx');
      assert.ok(vscode.languages.match(mdxSelector, editor.document));
      await paste();
      assert.equal(editor.document.languageId, 'mdx');
      const alternate = await vscode.languages.setTextDocumentLanguage(editor.document, 'alternate-mdx');
      assert.ok(isMdxDocument(alternate));
      assert.ok(vscode.languages.match(mdxSelector, alternate));
      const markdown = await openDocument('normal.md');
      assert.equal(markdown.languageId, 'markdown');
      assert.equal(vscode.languages.match(mdxSelector, markdown), 0);
      assert.equal(await editFor(), undefined);
    });
    test('plain text, unsupported bytes and untrusted names safely fall back', async () => {
      const text = new vscode.DataTransfer();
      text.set('text/plain', new vscode.DataTransferItem('hello world'));
      assert.equal(await editFor(text), undefined);
      assert.equal(await editFor(fileTransfer([{ name: 'fake.png', data: Buffer.from('not an image'), mime: 'image/png' }])), undefined);
      assert.equal(await editFor(fileTransfer([{ name: '../escape.png', data: png }])), undefined);
      assert.equal(warnings.length, 0);
      assert.equal(editor.document.getText(), '');
    });
    test('untitled MDX and disabled paste do not create images', async () => {
      await setting('editor.filePaste.enabled', 'never');
      assert.equal(readPasteConfiguration(editor.document).enabled, 'never');
      assert.equal(await editFor(), undefined);
      editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument({ language: 'mdx', content: '' }));
      assert.equal(await editFor(), undefined);
      assert.deepEqual(await vscode.workspace.fs.readDirectory(directory), [['guide.mdx', vscode.FileType.File]]);
    });
    for (const [type, data] of Object.entries({ png, jpeg, gif, webp })) {
      test(`${type} with a generic MIME: paste / undo / redo preserves binary data`, async () => {
        const name = `image.${type}`;
        const text = await paste(fileTransfer([{ name, data, mime: 'application/octet-stream' }]));
        assert.equal(text, `![alt text](${name})`);
        await bytes(at(name), data);
        await undo();
        assert.equal(editor.document.getText(), '');
        assert.equal(await exists(at(name)), false);
        await redo();
        assert.equal(editor.document.getText(), text);
        await bytes(at(name), data);
      });
    }
    for (const behavior of ['nameIncrementally', 'overwrite']) {
      test(`${behavior}: collisions increment names and undo/redo preserves both binaries`, async () => {
        await setting('copyFiles.overwriteBehavior', behavior);
        await vscode.workspace.fs.writeFile(at('screenshot.png'), gif);
        const text = await paste();
        assert.equal(text, '![alt text](screenshot-1.png)');
        await bytes(at('screenshot.png'), gif);
        await undo();
        assert.equal(editor.document.getText(), '');
        assert.equal(await exists(at('screenshot-1.png')), false);
        await bytes(at('screenshot.png'), gif);
        await redo();
        assert.equal(editor.document.getText(), text);
        await bytes(at('screenshot.png'), gif);
        await bytes(at('screenshot-1.png'), png);
        assert.equal(await exists(at('screenshot-2.png')), false);
        assert.deepEqual(warnings, []);
      });
    }
    test('overwrite configuration creates new paths with native undo/redo', async () => {
      await setting('copyFiles.overwriteBehavior', 'overwrite');
      await setting('copyFiles.destination', { '*.*': '${documentBaseName}/${fileName}' });
      const text = await paste();
      await bytes(at('guide/screenshot.png'), png);
      await undo();
      assert.equal(editor.document.getText(), '');
      assert.equal(await exists(at('guide/screenshot.png')), false);
      await redo();
      assert.equal(editor.document.getText(), text);
      await bytes(at('guide/screenshot.png'), png);
    });
    test('configured destination with overwrite increments names and preserves earlier text history', async () => {
      await setting('copyFiles.overwriteBehavior', 'overwrite');
      await setting('copyFiles.destination', { '*.*': '${documentBaseName}/${fileName}' });
      await vscode.workspace.fs.createDirectory(at('guide'));
      await vscode.workspace.fs.writeFile(at('guide/screenshot.png'), gif);
      await editor.edit(builder => builder.insert(new vscode.Position(0, 0), 'before'));
      editor.selection = new vscode.Selection(0, 6, 0, 6);
      const text = await paste();
      assert.equal(text, 'before![alt text](guide/screenshot-1.png)');
      assert.deepEqual(warnings, []);
      await bytes(at('guide/screenshot.png'), gif);
      await bytes(at('guide/screenshot-1.png'), png);
      await undo();
      assert.equal(editor.document.getText(), 'before');
      assert.equal(await exists(at('guide/screenshot-1.png')), false);
      await bytes(at('guide/screenshot.png'), gif);
      await undo();
      assert.equal(editor.document.getText(), '');
      await bytes(at('guide/screenshot.png'), gif);
      await redo();
      assert.equal(editor.document.getText(), 'before');
      assert.equal(await exists(at('guide/screenshot-1.png')), false);
      await redo();
      assert.equal(editor.document.getText(), text);
      await bytes(at('guide/screenshot.png'), gif);
      await bytes(at('guide/screenshot-1.png'), png);
      assert.equal(await exists(at('guide/screenshot-2.png')), false);
    });
    test('two pastes / two undos / two redos', async () => {
      const first = await paste();
      editor.selection = new vscode.Selection(editor.document.positionAt(first.length), editor.document.positionAt(first.length));
      const second = await paste();
      assert.equal(second, first + '![alt text](screenshot-1.png)');
      await undo();
      assert.equal(editor.document.getText(), first);
      await bytes(at('screenshot.png'), png);
      assert.equal(await exists(at('screenshot-1.png')), false);
      await undo();
      assert.equal(editor.document.getText(), '');
      assert.equal(await exists(at('screenshot.png')), false);
      await redo();
      assert.equal(editor.document.getText(), first);
      await bytes(at('screenshot.png'), png);
      await redo();
      assert.equal(editor.document.getText(), second);
      await bytes(at('screenshot-1.png'), png);
    });
    test('paste / text edit / undo / undo / redo / redo keeps ordering', async () => {
      const text = await paste();
      await editor.edit(builder => builder.insert(editor.document.positionAt(text.length), ' more text'));
      await undo();
      assert.equal(editor.document.getText(), text);
      await bytes(at('screenshot.png'), png);
      await undo();
      assert.equal(editor.document.getText(), '');
      assert.equal(await exists(at('screenshot.png')), false);
      await redo();
      assert.equal(editor.document.getText(), text);
      await bytes(at('screenshot.png'), png);
      await redo();
      assert.equal(editor.document.getText(), text + ' more text');
      await bytes(at('screenshot.png'), png);
    });
    for (const behavior of ['nameIncrementally', 'overwrite']) {
      test(`${behavior}: multiple same-name images skip occupied suffixes in one undo/redo unit`, async () => {
        await setting('copyFiles.overwriteBehavior', behavior);
        await vscode.workspace.fs.writeFile(at('image.png'), jpeg);
        await vscode.workspace.fs.writeFile(at('image-1.png'), webp);
        const data = fileTransfer([{ name: 'image.png', data: png }, { name: 'image.png', data: gif }]);
        const text = await paste(data);
        assert.equal(text, '![alt text](image-2.png) ![alt text](image-3.png)');
        await bytes(at('image.png'), jpeg);
        await bytes(at('image-1.png'), webp);
        await bytes(at('image-2.png'), png);
        await bytes(at('image-3.png'), gif);
        await undo();
        assert.equal(editor.document.getText(), '');
        assert.equal(await exists(at('image-2.png')), false);
        assert.equal(await exists(at('image-3.png')), false);
        await bytes(at('image.png'), jpeg);
        await bytes(at('image-1.png'), webp);
        await redo();
        assert.equal(editor.document.getText(), text);
        await bytes(at('image.png'), jpeg);
        await bytes(at('image-1.png'), webp);
        await bytes(at('image-2.png'), png);
        await bytes(at('image-3.png'), gif);
        assert.equal(await exists(at('image-4.png')), false);
        assert.deepEqual(warnings, []);
      });
    }
    test('a new paste after undo reuses the free name and replaces the redo branch', async () => {
      await paste();
      await undo();
      assert.equal(await exists(at('screenshot.png')), false);
      const text = await paste(fileTransfer([{ name: 'screenshot.png', data: gif }]));
      assert.equal(text, '![alt text](screenshot.png)');
      await bytes(at('screenshot.png'), gif);
      await redo();
      assert.equal(editor.document.getText(), text);
      await bytes(at('screenshot.png'), gif);
    });
    test('spaces, Chinese, bracket escaping and native relative paths', async () => {
      const text = await paste(fileTransfer([{ name: '截图 (draft.png', data: png }]));
      assert.equal(text, '![alt text](<截图 (draft.png>)');
      await bytes(at('截图 (draft.png'), png);
      await undo();
      assert.equal(await exists(at('截图 (draft.png')), false);
      await redo();
      assert.equal(editor.document.getText(), text);
      await bytes(at('截图 (draft.png'), png);
    });
    test('image snippet golden cases from native shared.ts and pasteUrl.test.ts', () => {
      const document = vscode.Uri.parse('test://host/project/guide.mdx');
      for (const [file, expected] of [
        ['image.png', '![${1:alt text}](image.png)'],
        ['图 片.png', '![${1:alt text}](<图 片.png>)'],
        ['balanced(x).png', '![${1:alt text}](balanced(x).png)'],
        ['unbalanced(x.png', '![${1:alt text}](<unbalanced(x.png>)'],
        ['unbalanced)x.png', '![${1:alt text}](<unbalanced)x.png>)'],
        ['x#y%.png', '![${1:alt text}](x#y%.png)'],
      ]) {
        assert.equal(createImageSnippet(document, [vscode.Uri.joinPath(document, '..', file!)]).value, expected);
      }
      assert.equal(createImageSnippet(document, [vscode.Uri.parse('https://example.com/cat.png')]).value,
        '![${1:alt text}](https://example.com/cat.png)');
    });
    test('URI lists reference workspace files and copy outside images without HTTP reads', async () => {
      const existing = at('existing.png');
      await vscode.workspace.fs.writeFile(existing, png);
      const data = new vscode.DataTransfer();
      data.set('text/uri-list', new vscode.DataTransferItem(`# comment\r\n${existing}\r\nhttps://example.invalid/a.png`));
      assert.equal(await paste(data), '![alt text](existing.png)');
      await undo();
      await bytes(existing, png); // This file was never owned by the paste.
      const outside = vscode.Uri.joinPath(root, '..', 'outside.png');
      await vscode.workspace.fs.writeFile(outside, gif);
      try {
        data.set('text/uri-list', new vscode.DataTransferItem(outside.toString()));
        assert.equal(await paste(data), '![alt text](outside.png)');
        await bytes(at('outside.png'), gif);
        await undo();
        assert.equal(editor.document.getText(), '');
        assert.equal(await exists(at('outside.png')), false);
        await bytes(outside, gif);
      } finally { await vscode.workspace.fs.delete(outside); }
    });
    test('copyIntoWorkspace never references files but ignores raw clipboard images', async () => {
      await setting('editor.filePaste.copyIntoWorkspace', 'never');
      assert.equal(await editFor(), undefined);
      await vscode.workspace.fs.writeFile(at('existing.png'), png);
      await paste(fileTransfer([{ name: 'existing.png', data: png, uri: at('existing.png') }]));
      await undo();
      await bytes(at('existing.png'), png);
    });
    test('preflight failure cancels the entire multi-image edit', async () => {
      await vscode.workspace.fs.writeFile(at('blocker'), png);
      await setting('copyFiles.destination', { '*.*': 'blocker/${fileName}' });
      assert.equal(await editFor(fileTransfer([{ name: 'one.png', data: png }, { name: 'two.gif', data: gif }])), undefined);
      assert.equal(editor.document.getText(), '');
      await bytes(at('blocker'), png);
      assert.equal(await exists(at('one.png')), false);
      assert.equal(warnings.length, 1);
    });
    test('path traversal and symlink destinations are refused before writes', async () => {
      await setting('copyFiles.destination', { '*.*': '../../escape.png' });
      assert.equal(await editFor(), undefined);
      assert.match(warnings.at(-1)!, /must stay inside/);
      const target = at('actual');
      await vscode.workspace.fs.createDirectory(target);
      const link = at('linked');
      await fs.symlink(target.fsPath, link.fsPath, process.platform === 'win32' ? 'junction' : 'dir');
      await setting('copyFiles.destination', { '*.*': 'linked/${fileName}' });
      assert.equal(await editFor(), undefined);
      assert.equal(await exists(at('actual/screenshot.png')), false);
      await setting('copyFiles.destination', { '*.*': '${documentWorkspaceFolder}' });
      assert.equal(await editFor(), undefined);
      assert.match(warnings.at(-1)!, /must name a file/);
    });
    test('cancellation produces no edit and no files', async () => {
      const cancelled = new vscode.CancellationTokenSource();
      cancelled.cancel();
      assert.equal(await provider.provideDocumentPasteEdits(editor.document, [startRange], fileTransfer([{ name: 'image.png', data: png }]), pasteContext, cancelled.token), undefined);
      cancelled.dispose();
      assert.equal(await exists(at('image.png')), false);
    });
    test('competing prepared pastes cannot overwrite each other', async () => {
      const [one, two] = await Promise.all([editFor(), editFor(fileTransfer([{ name: 'screenshot.png', data: gif }]))]);
      assert.ok(one?.additionalEdit && two?.additionalEdit);
      assert.equal(await vscode.workspace.applyEdit(one.additionalEdit), true);
      const text = editor.document.getText();
      assert.equal(await vscode.workspace.applyEdit(two.additionalEdit), false);
      assert.equal(editor.document.getText(), text);
      await bytes(at('screenshot.png'), png);
    });
    test('probe: native createFile(overwrite) deletes the old image on undo', async () => {
      const uri = at('native-overwrite.png');
      await vscode.workspace.fs.writeFile(uri, gif);
      const edit = new vscode.WorkspaceEdit();
      edit.createFile(uri, { overwrite: true, contents: png });
      edit.insert(editor.document.uri, new vscode.Position(0, 0), 'native overwrite');
      assert.equal(await vscode.workspace.applyEdit(edit), true);
      await bytes(uri, png);
      await undo();
      assert.equal(editor.document.getText(), '');
      // This assertion is evidence of the upstream limitation, NOT desired product behavior.
      assert.equal(await exists(uri), false, 'VS Code changed overwrite undo semantics; update the compatibility evidence.');
      await redo();
      assert.equal(editor.document.getText(), 'native overwrite');
      await bytes(uri, png);
      console.log(`UPSTREAM PROBE ${vscode.version}: overwrite undo deletes the target; redo restores the new bytes.`);
    });
    test('probe: external file changes follow VS Code native undo/redo semantics', async () => {
      const text = await paste();
      await vscode.workspace.fs.writeFile(at('screenshot.png'), gif);
      await undo();
      assert.equal(editor.document.getText(), '');
      assert.equal(await exists(at('screenshot.png')), false);
      await redo();
      assert.equal(editor.document.getText(), text);
      // Native history snapshots the file as it exists at undo time.
      await bytes(at('screenshot.png'), gif);
      console.log(`UPSTREAM PROBE ${vscode.version}: external bytes at undo time become the redo payload.`);
    });
    test('non-file workspace filesystem URIs preserve authority and native file history', async () => {
      const memory = new MemoryFileSystem();
      const registration = vscode.workspace.registerFileSystemProvider('mdx-paste-memory', memory, { isCaseSensitive: true });
      const documentUri = vscode.Uri.parse('mdx-paste-memory://remote-host/docs/guide.mdx');
      const imageUri = vscode.Uri.joinPath(documentUri, '..', '截图.png');
      try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(documentUri, '..'));
        await vscode.workspace.fs.writeFile(documentUri, new Uint8Array());
        editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(documentUri));
        await setting('copyFiles.destination', { '*.*': '${fileName}' });
        const text = await paste(fileTransfer([{ name: '截图.png', data: png }]));
        assert.equal(text, '![alt text](截图.png)');
        await bytes(imageUri, png);
        await undo();
        assert.equal(editor.document.getText(), '');
        assert.equal(await exists(imageUri), false);
        await redo();
        assert.equal(editor.document.getText(), text);
        await bytes(imageUri, png);
      } finally {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        registration.dispose();
      }
    });
    test('probe: a late multi-file write failure is not rollback-atomic in stable WorkspaceEdit', async () => {
      const memory = new MemoryFileSystem();
      const registration = vscode.workspace.registerFileSystemProvider('mdx-paste-failure', memory, { isCaseSensitive: true });
      const documentUri = vscode.Uri.parse('mdx-paste-failure:/docs/guide.mdx');
      try {
        await vscode.workspace.fs.createDirectory(vscode.Uri.joinPath(documentUri, '..'));
        await vscode.workspace.fs.writeFile(documentUri, new Uint8Array());
        editor = await vscode.window.showTextDocument(await vscode.workspace.openTextDocument(documentUri));
        await setting('copyFiles.destination', { '*.*': '${fileName}' });
        memory.failName = 'fail.png';
        const edit = await editFor(fileTransfer([{ name: 'first.png', data: png }, { name: 'fail.png', data: gif }]));
        assert.ok(edit?.additionalEdit);
        assert.equal(await vscode.workspace.applyEdit(edit.additionalEdit), false);
        assert.equal(editor.document.getText(), '');
        assert.equal(await exists(vscode.Uri.parse('mdx-paste-failure:/docs/fail.png')), false);
        await bytes(vscode.Uri.parse('mdx-paste-failure:/docs/first.png'), png);
        console.log(`UPSTREAM PROBE ${vscode.version}: late create failure leaves the earlier file; document text stays unchanged.`);
      } finally {
        await vscode.commands.executeCommand('workbench.action.closeAllEditors');
        registration.dispose();
      }
    });
    (process.env.NATIVE_CLIPBOARD_TEST === '1' ? test : test.skip)('optional OS clipboard comparison with native Markdown (NATIVE_CLIPBOARD_TEST=1)', async () => {
      const uri = at('existing image.png');
      await vscode.workspace.fs.writeFile(uri, png);
      const source = await vscode.workspace.openTextDocument({ language: 'plaintext', content: 'copy fixture' });
      let prepared = false;
      const disposable = vscode.languages.registerDocumentPasteEditProvider('plaintext', {
        prepareDocumentPaste(_document, _ranges, data) {
          data.set('text/uri-list', new vscode.DataTransferItem(uri.toString()));
          prepared = true;
        },
      }, { providedPasteEditKinds: [], copyMimeTypes: ['text/uri-list'], pasteMimeTypes: [] });
      try {
        const sourceEditor = await vscode.window.showTextDocument(source);
        sourceEditor.selection = new vscode.Selection(0, 0, 0, 12);
        await vscode.commands.executeCommand('workbench.action.focusActiveEditorGroup');
        await vscode.commands.executeCommand('editor.action.clipboardCopyAction');
        await waitFor(() => prepared, 'the clipboard preparation provider');
        assert.equal(await vscode.env.clipboard.readText(), 'copy fixture');
        const markdown = await openDocument('native.md');
        await vscode.extensions.getExtension('vscode.markdown-language-features')!.activate();
        await vscode.commands.executeCommand('editor.action.pasteAs', { kind: imageEditKind.value });
        await waitFor(() => !!markdown.getText(), 'native Markdown paste');
        const nativeText = markdown.getText();
        assert.equal(nativeText, '![alt text](<existing image.png>)');
        const snippet = createImageSnippet(markdown.uri, [uri]);
        assert.ok(snippet.value.includes('<existing image.png>'));
        const mdx = await openDocument('comparison.mdx');
        await vscode.commands.executeCommand('editor.action.pasteAs', { kind: imageEditKind.value });
        await waitFor(() => !!mdx.getText(), 'MDX paste');
        assert.equal(mdx.getText(), nativeText);
        await undo();
        assert.equal(mdx.getText(), '');
        await bytes(uri, png);
        await redo();
        assert.equal(mdx.getText(), nativeText);
      } finally { disposable.dispose(); }
    });
  });
}

export async function run(): Promise<void> {
  const mocha = new Mocha({ ui: 'tdd', color: true, timeout: 20000 });
  mocha.suite.emit('pre-require', globalThis, 'host-tests', mocha);
  suites();
  const results: { title: string; state?: string; error?: string }[] = [];
  await new Promise<void>((resolve, reject) => {
    const runner = mocha.run(async failures => {
      try {
        await fs.writeFile(path.resolve(__dirname, `../../artifacts/host-${vscode.version}.json`), JSON.stringify({
          vscode: vscode.version, platform: process.platform, architecture: process.arch,
          date: new Date().toISOString(), stats: runner.stats, tests: results,
        }, null, 2));
      } catch (error) { reject(error); return; }
      failures ? reject(new Error(`${failures} integration tests failed`)) : resolve();
    });
    runner.on('test end', current => results.push({ title: current.fullTitle(), state: current.state, error: current.err?.message }));
  });
  token.dispose();
}
