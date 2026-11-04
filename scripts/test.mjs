import { runTests } from '@vscode/test-electron';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const executableIndex = process.argv.indexOf('--vscode-executable');
const executable = executableIndex >= 0 ? process.argv[executableIndex + 1] : process.env.VSCODE_EXECUTABLE_PATH;
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
