import * as vscode from 'vscode';
export { png, gif, jpeg, webp } from './images';

export function fileTransfer(files: readonly { name: string; data: Uint8Array; uri?: vscode.Uri; mime?: string }[]): vscode.DataTransfer {
  const transfer = new vscode.DataTransfer();
  files.forEach((file, i) => {
    const item = new vscode.DataTransferItem('');
    item.asFile = () => ({ name: file.name, uri: file.uri, data: async () => file.data });
    // DataTransfer has one item per MIME. Distinct keys model hosts that expose multiple files.
    transfer.set(file.mime ?? `image/x-fixture-${i}`, item);
  });
  return transfer;
}
