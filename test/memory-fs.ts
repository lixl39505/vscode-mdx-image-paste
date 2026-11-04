import * as vscode from 'vscode';

/** Test-only provider: lets real WorkspaceEdits encounter deterministic late I/O failures. */
export class MemoryFileSystem implements vscode.FileSystemProvider {
  private readonly changes = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
  readonly onDidChangeFile = this.changes.event;
  private readonly entries = new Map<string, { type: vscode.FileType; data: Uint8Array }>([
    ['/', { type: vscode.FileType.Directory, data: new Uint8Array() }],
  ]);
  failName?: string;
  watch(): vscode.Disposable { return new vscode.Disposable(() => {}); }
  private entry(uri: vscode.Uri) {
    const entry = this.entries.get(uri.path);
    if (!entry) throw vscode.FileSystemError.FileNotFound(uri);
    return entry;
  }
  stat(uri: vscode.Uri): vscode.FileStat {
    const entry = this.entry(uri);
    return { type: entry.type, ctime: 1, mtime: 1, size: entry.data.length };
  }
  readDirectory(uri: vscode.Uri): [string, vscode.FileType][] {
    this.entry(uri);
    const prefix = uri.path.replace(/\/$/, '') + '/';
    return Array.from(this.entries).filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes('/'))
      .map(([key, entry]) => [key.slice(prefix.length), entry.type]);
  }
  createDirectory(uri: vscode.Uri): void {
    let current = '';
    for (const component of uri.path.split('/').filter(Boolean)) {
      current += '/' + component;
      if (!this.entries.has(current)) this.entries.set(current, { type: vscode.FileType.Directory, data: new Uint8Array() });
    }
  }
  readFile(uri: vscode.Uri): Uint8Array { return this.entry(uri).data.slice(); }
  writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean }): void {
    if (uri.path.endsWith('/' + this.failName)) throw vscode.FileSystemError.NoPermissions('Injected image write failure');
    if (this.entries.has(uri.path) && !options.overwrite) throw vscode.FileSystemError.FileExists(uri);
    if (!this.entries.has(uri.path) && !options.create) throw vscode.FileSystemError.FileNotFound(uri);
    this.entries.set(uri.path, { type: vscode.FileType.File, data: content.slice() });
  }
  delete(uri: vscode.Uri): void {
    this.entry(uri);
    this.entries.delete(uri.path);
    for (const key of this.entries.keys()) if (key.startsWith(uri.path + '/')) this.entries.delete(key);
  }
  rename(oldUri: vscode.Uri, newUri: vscode.Uri): void {
    this.entries.set(newUri.path, this.entry(oldUri));
    this.entries.delete(oldUri.path);
  }
}
