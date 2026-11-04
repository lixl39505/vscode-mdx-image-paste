import * as vscode from 'vscode';

export function readPasteConfiguration(document: vscode.TextDocument) {
  const config = vscode.workspace.getConfiguration('markdown', document);
  return {
    // The public settings use filePaste. Older native source also reads the legacy paste keys.
    enabled: config.get<string | boolean>('editor.filePaste.enabled',
      config.get<string | boolean>('editor.paste.enabled', 'smart')),
    copyIntoWorkspace: config.get<string>('editor.filePaste.copyIntoWorkspace',
      config.get<string>('editor.paste.copyIntoWorkspace', 'mediaFiles')),
  };
}
