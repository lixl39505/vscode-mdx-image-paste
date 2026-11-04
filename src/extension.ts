import * as vscode from 'vscode';
import { ImagePasteProvider, imageEditKind, mdxSelector } from './paste-provider';

export function activate(context: vscode.ExtensionContext): void {
  context.subscriptions.push(vscode.languages.registerDocumentPasteEditProvider(
    mdxSelector, new ImagePasteProvider(message => { void vscode.window.showWarningMessage(message); }),
    { providedPasteEditKinds: [imageEditKind], pasteMimeTypes: ['image/*', 'files', 'text/uri-list'] },
  ));
}
