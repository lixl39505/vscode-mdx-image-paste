import * as picomatch from 'picomatch';
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';
import { getCopyFileConfiguration, parseGlob, resolveCopyDestination } from './native/copy-files';
import { isSafeCopyDestination } from './destination-safety';

export class PasteError extends Error {}

export function desiredDestination(document: vscode.TextDocument, name: string): vscode.Uri {
  const config = getCopyFileConfiguration(document);
  for (const [glob, destination] of Object.entries(config.destination)) {
    for (const pattern of parseGlob(glob)) {
      const normalizeDrive = (value: string) => value.replace(/^\/[A-Z]:/, drive => drive.toLowerCase());
      if (picomatch.isMatch(normalizeDrive(document.uri.path), normalizeDrive(pattern), { dot: true })) {
        return resolveCopyDestination(document.uri, name, destination,
          uri => vscode.workspace.getWorkspaceFolder(uri)?.uri);
      }
    }
  }
  return vscode.Uri.joinPath(Utils.dirname(document.uri), name);
}

export async function statIfExists(uri: vscode.Uri): Promise<vscode.FileStat | undefined> {
  try { return await vscode.workspace.fs.stat(uri); }
  catch (error) {
    if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') return;
    throw error;
  }
}

export async function validateDestination(document: vscode.TextDocument, uri: vscode.Uri): Promise<void> {
  const fs = vscode.workspace.fs;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (folder && uri.path.replace(/\/$/, '') === folder.uri.path.replace(/\/$/, '')) {
    throw new PasteError('The image destination must name a file inside a workspace folder.');
  }
  if (!(await isSafeCopyDestination(document.uri, uri,
    value => vscode.workspace.getWorkspaceFolder(value)?.uri, { stat: async value => {
      const stat = await statIfExists(value);
      if (!stat) throw vscode.FileSystemError.FileNotFound(value);
      return stat;
    } }))) {
    throw new PasteError('The image destination must stay inside a workspace folder (or the document directory) and must not contain symbolic links.');
  }
  // Preflight every existing parent before returning any file edits. No writes happen here.
  for (let parent = Utils.dirname(uri); ; parent = Utils.dirname(parent)) {
    const stat = await statIfExists(parent);
    if (stat) {
      if (!(stat.type & vscode.FileType.Directory)) throw new PasteError('An image destination parent is not a directory.');
      if (stat.permissions === vscode.FilePermission.Readonly) throw new PasteError('The image destination is read-only.');
      break;
    }
    if (parent.path === '/' || parent.path === '') throw new PasteError('The image destination is unavailable.');
  }
  if (!fs.isWritableFileSystem(uri.scheme)) throw new PasteError('The image destination file system is read-only or unavailable.');
}

/** Always preserve existing files, using native incremental naming even for overwrite settings. */
export class FilePathGenerator {
  private readonly used = new Set<string>();

  async next(document: vscode.TextDocument, name: string, token: vscode.CancellationToken): Promise<vscode.Uri> {
    const desired = desiredDestination(document, name);
    await validateDestination(document, desired);
    const root = Utils.dirname(desired);
    const ext = Utils.extname(desired);
    const base = Utils.basename(desired).slice(0, Utils.basename(desired).length - ext.length);
    for (let i = 0; ; i++) {
      if (token.isCancellationRequested) throw new vscode.CancellationError();
      const uri = vscode.Uri.joinPath(root, (i ? `${base}-${i}` : base) + ext);
      // Reserve case-insensitively within a batch too, for macOS and Windows volumes.
      const key = uri.toString().toLowerCase();
      if (this.used.has(key)) continue;
      const existing = await statIfExists(uri);
      if (existing) continue;
      this.used.add(key);
      return uri;
    }
  }
}
