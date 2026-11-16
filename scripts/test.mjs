import { downloadAndUnzipVSCode, runTests } from '@vscode/test-electron';
import { access, mkdir, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const executableIndex = process.argv.indexOf('--vscode-executable');
let executable = executableIndex >= 0 ? process.argv[executableIndex + 1] : process.env.VSCODE_EXECUTABLE_PATH;
if (!executable && process.platform === 'darwin') {
  const downloaded = await downloadAndUnzipVSCode(process.env.VSCODE_VERSION || '1.105.1');
  try { await access(downloaded); } catch {
    const contents = path.resolve(downloaded, '../..');
    const name = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleExecutable', path.join(contents, 'Info.plist')], { encoding: 'utf8' }).trim();
    executable = path.join(contents, 'MacOS', name);
  }
}
const workspace = path.join(root, '.test-workspace');
await mkdir(path.join(workspace, 'one'), { recursive: true });
await mkdir(path.join(workspace, 'two'), { recursive: true });
await writeFile(path.join(workspace, 'test.code-workspace'), JSON.stringify({
  folders: [{ path: 'one' }, { path: 'two' }],
  settings: { 'files.enableTrash': false, 'files.autoSave': 'off',
    'editor.pasteAs.showPasteSelector': 'never', 'editor.experimentalEditContextEnabled': false,
    'security.workspace.trust.enabled': false, 'chat.disableAIFeatures': true },
}));
await runTests({
  version: process.env.VSCODE_VERSION || '1.105.1',
  ...(executable ? { vscodeExecutablePath: executable } : {}),
  extensionDevelopmentPath: [root, path.join(root, 'test/fixture-extension')],
  extensionTestsPath: path.join(root, 'dist/test/host.cjs'),
  launchArgs: [path.join(workspace, 'test.code-workspace'), '--disable-extensions',
    '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-gpu',
    '--user-data-dir', path.join(root, '.vscode-test/user-data'),
    '--extensions-dir', path.join(root, '.vscode-test/extensions')],
});
