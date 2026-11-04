// Adapted from VS Code (Microsoft), MIT. See THIRD_PARTY_NOTICES.md.
import * as path from 'path';
import * as vscode from 'vscode';
import { Utils } from 'vscode-uri';
const Schemes = { file: 'file' };

export function createImageSnippet(document: vscode.Uri, images: readonly vscode.Uri[]): vscode.SnippetString {
  const snippet = new vscode.SnippetString();
  images.forEach((uri, i) => {
    if (i) snippet.appendText(' ');
    const mdPath = getRelativeMdPath(Utils.dirname(document), uri) ?? uri.toString();
    snippet.appendText('![').appendPlaceholder(escapeBrackets('alt text'), i + 1)
      .appendText(`](${escapeMarkdownLinkPath(mdPath)})`);
  });
  return snippet;
}

function getRelativeMdPath(dir: vscode.Uri | undefined, file: vscode.Uri): string | undefined {
	if (dir && dir.scheme === file.scheme && dir.authority === file.authority) {
		if (file.scheme === Schemes.file) {
			// On windows, we must use the native `path.relative` to generate the relative path
			// so that drive-letters are resolved cast insensitively. However we then want to
			// convert back to a posix path to insert in to the document.
			const relativePath = path.relative(dir.fsPath, file.fsPath);
			return path.posix.normalize(relativePath.split(path.sep).join(path.posix.sep));
		}

		return path.posix.relative(dir.path, file.path);
	}
	return undefined;
}

function escapeMarkdownLinkPath(mdPath: string): string {
	if (needsBracketLink(mdPath)) {
		return '<' + mdPath.replaceAll('<', '\\<').replaceAll('>', '\\>') + '>';
	}

	return mdPath;
}

function escapeBrackets(value: string): string {
	value = value.replace(/[\[\]]/g, '\\$&'); // CodeQL [SM02383] The Markdown is fully sanitized after being rendered.
	return value;
}

function needsBracketLink(mdPath: string): boolean {
	// Links with whitespace or control characters must be enclosed in brackets
	if (mdPath.startsWith('<') || /\s|[\u007F\u0000-\u001f]/.test(mdPath)) {
		return true;
	}

	// Check if the link has mis-matched parens
	if (!/[\(\)]/.test(mdPath)) {
		return false;
	}

	let previousChar = '';
	let nestingCount = 0;
	for (const char of mdPath) {
		if (char === '(' && previousChar !== '\\') {
			nestingCount++;
		} else if (char === ')' && previousChar !== '\\') {
			nestingCount--;
		}

		if (nestingCount < 0) {
			return true;
		}
		previousChar = char;
	}

	return nestingCount > 0;
}
