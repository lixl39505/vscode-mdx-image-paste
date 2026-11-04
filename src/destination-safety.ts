// Adapted from VS Code (Microsoft), MIT. See THIRD_PARTY_NOTICES.md.
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';

export type GetWorkspaceFolder = (documentUri: vscode.Uri) => vscode.Uri | undefined;

/**
 * Checks that a copy destination does not leave the workspace, neither lexically nor through
 * symbolic links or junctions.
 *
 * Destinations must stay inside a workspace folder, or inside the document's directory if the
 * document is not part of a workspace.
 */
export async function isSafeCopyDestination(
	documentUri: vscode.Uri,
	destination: vscode.Uri,
	getWorkspaceFolder: GetWorkspaceFolder,
	fs: Pick<vscode.FileSystem, 'stat'>,
): Promise<boolean> {
	const root = getCopyDestinationRoot(documentUri, destination, getWorkspaceFolder);
	if (!root) {
		return false;
	}

	const relativePath = destination.path.slice(root.path.replace(/\/$/, '').length);
	// `\` separates paths on Windows but is a regular character on POSIX, so reject it everywhere
	if (relativePath.includes('\\')) {
		return false;
	}

	let current = root;
	for (const segment of relativePath.split('/').filter(Boolean)) {
		current = vscode.Uri.joinPath(current, segment);
		let stat: vscode.FileStat;
		try {
			stat = await fs.stat(current);
		} catch {
			// Does not exist yet, so the rest of the path gets created as regular folders and files
			return true;
		}
		if (stat.type & vscode.FileType.SymbolicLink) {
			return false;
		}
	}
	return true;
}

function getCopyDestinationRoot(documentUri: vscode.Uri, destination: vscode.Uri, getWorkspaceFolder: GetWorkspaceFolder): vscode.Uri | undefined {
	if (getWorkspaceFolder(documentUri)) {
		// Uses the same path casing rules as the file system of the workspace folder
		return getWorkspaceFolder(destination);
	}

	const documentDir = Utils.dirname(documentUri);
	const isInsideDocumentDir = destination.scheme === documentDir.scheme
		&& destination.authority === documentDir.authority
		&& destination.path.startsWith(documentDir.path.replace(/\/$/, '') + '/');
	return isInsideDocumentDir ? documentDir : undefined;
}
