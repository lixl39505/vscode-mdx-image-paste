import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';
import { detectImageType, isSafeFileName } from './image-type';

export interface ImageInput {
  readonly name: string;
  readonly data: Uint8Array;
  readonly uri?: vscode.Uri;
}

/** Only inspect the files explicitly supplied by this paste. Never fetch HTTP clipboard URLs. */
export async function readImages(document: vscode.TextDocument, transfer: vscode.DataTransfer,
  token: vscode.CancellationToken): Promise<ImageInput[]> {
  const images: ImageInput[] = [];
  const seenUris = new Set<string>();
  const seenFiles = new Set<vscode.DataTransferFile>();
  async function add(name: string, read: () => PromiseLike<Uint8Array>, uri?: vscode.Uri) {
    if (!isSafeFileName(name) || token.isCancellationRequested) return;
    if (uri && seenUris.has(uri.toString())) return;
    const data = await read();
    if (!detectImageType(data) || token.isCancellationRequested) return;
    if (uri) seenUris.add(uri.toString());
    images.push({ name, data, uri });
  }
  for (const [, item] of transfer) {
    const file = item.asFile();
    if (!file || seenFiles.has(file)) continue;
    seenFiles.add(file);
    // Native file entries carry image MIME types, but bytes decide whether we handle them.
    await add(file.name, () => file.data(), file.uri);
  }
  const uriList = await transfer.get('text/uri-list')?.asString();
  for (const value of uriList?.split(/\r?\n/) ?? []) {
    if (!value || value.startsWith('#') || token.isCancellationRequested) continue;
    let uri: vscode.Uri;
    try { uri = vscode.Uri.parse(value, true); } catch { continue; }
    // Same remote authority is allowed; HTTP, command, data, and arbitrary schemes are not.
    if (uri.scheme !== 'file' && !(uri.scheme === document.uri.scheme
      && uri.authority === document.uri.authority)) continue;
    if (['http', 'https', 'data', 'command', 'untitled'].includes(uri.scheme)) continue;
    if (uri.query || uri.fragment) continue;
    if (!/\.(png|jpe?g|gif|webp)$/i.test(uri.path)) continue;
    await add(Utils.basename(uri), () => vscode.workspace.fs.readFile(uri), uri);
  }
  return images;
}
