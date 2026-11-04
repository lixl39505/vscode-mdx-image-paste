import * as vscode from 'vscode';
import { readImages } from './image-handler';
import { readPasteConfiguration } from './markdown-config';
import { createImageSnippet } from './reference-generator';
import { FilePathGenerator, PasteError } from './path-resolver';

export const imageEditKind = vscode.DocumentDropOrPasteEditKind.Empty.append('markdown', 'link', 'image');
export const mdxSelector: vscode.DocumentSelector = [{ language: 'mdx' }, { pattern: '**/*.mdx' }];

export function isMdxDocument(document: vscode.TextDocument): boolean {
  // The filename fallback supports MDX extensions with a different language id.
  // Explicit Markdown mode is left to the built-in extension.
  return document.languageId !== 'markdown' && (document.languageId === 'mdx' || /\.mdx$/i.test(document.uri.path));
}

export class ImagePasteProvider implements vscode.DocumentPasteEditProvider {
  constructor(private readonly warn: (message: string) => void = () => {}) {}

  async provideDocumentPasteEdits(document: vscode.TextDocument, ranges: readonly vscode.Range[],
    transfer: vscode.DataTransfer, context: vscode.DocumentPasteEditContext,
    token: vscode.CancellationToken): Promise<vscode.DocumentPasteEdit[] | undefined> {
    if (!isMdxDocument(document) || !ranges.length || token.isCancellationRequested) return;
    if (context.only && !context.only.contains(imageEditKind)) return;
    const config = readPasteConfiguration(document);
    if (config.enabled === 'never' || config.enabled === false) return;
    // Native Markdown does not create clipboard files for untitled documents either.
    if (document.uri.scheme === 'untitled') return;
    try {
      const images = await readImages(document, transfer, token);
      if (!images.length || token.isCancellationRequested) return;
      const paths = new FilePathGenerator();
      const edits = new vscode.WorkspaceEdit();
      const uris: vscode.Uri[] = [];
      for (const image of images) {
        // Like Markdown, reference images already in ANY workspace folder without copying.
        if (image.uri && (vscode.workspace.getWorkspaceFolder(image.uri) || config.copyIntoWorkspace === 'never')) {
          uris.push(image.uri);
        } else {
          if (config.copyIntoWorkspace === 'never') return;
          const uri = await paths.next(document, image.name, token);
          // Never overwrite at apply time: another paste or process may have created this path.
          edits.createFile(uri, { contents: image.data, overwrite: false });
          uris.push(uri);
        }
      }
      if (token.isCancellationRequested) return;
      // File edits come first. VS Code then groups the snippet edits with them in its native history.
      // Empty insertText avoids the editor inserting text before a failed file operation.
      edits.set(document.uri, ranges.map(range => new vscode.SnippetTextEdit(range, createImageSnippet(document.uri, uris))));
      const edit = new vscode.DocumentPasteEdit('', images.length > 1 ? 'Insert Markdown Images' : 'Insert Markdown Image', imageEditKind);
      edit.additionalEdit = edits;
      edit.yieldTo = [vscode.DocumentDropOrPasteEditKind.Text,
        imageEditKind.append('attachment')];
      return [edit];
    } catch (error) {
      if (token.isCancellationRequested || error instanceof vscode.CancellationError) return;
      this.warn(error instanceof PasteError ? error.message : 'Image paste cancelled: the image data or destination could not be read.');
      return;
    }
  }
}
