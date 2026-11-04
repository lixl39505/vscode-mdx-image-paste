import { test } from 'node:test';
import * as assert from 'node:assert/strict';
import { URI } from 'vscode-uri';
import { detectImageType, isSafeFileName } from '../src/image-type';
import { resolveCopyDestination, parseGlob } from '../src/native/copy-files';
import { png, jpeg, gif, webp } from './images';

const doc = URI.parse('test://host/project/docs/guide.test.mdx');
const workspace = () => URI.parse('test://host/project');
const resolve = (value: string, file = 'screen.shot.PNG') => resolveCopyDestination(doc, file, value, workspace).path;

for (const [type, data] of Object.entries({ png, jpeg, gif, webp })) {
  test(`recognizes ${type} bytes`, () => assert.equal(detectImageType(data), type));
}
test('rejects spoofed and truncated image content', () => {
  for (const data of [new Uint8Array(), png.slice(0, 8), Buffer.from('this is not a PNG'), webp.slice(0, 12)]) {
    assert.equal(detectImageType(data), undefined);
  }
});
test('rejects unsafe clipboard names across operating systems', () => {
  for (const name of ['', '.', '..', '../a.png', 'a/b.png', 'a\\b.png', 'C:a.png', '\u0000.png', 'nul.png', 'CON', 'a.png.', 'a.png ']) {
    assert.equal(isSafeFileName(name), false, name);
  }
  for (const name of ['截图.png', 'a b.png', 'a#b.png', 'a(b).png', 'a$1.png']) assert.ok(isSafeFileName(name));
});

const variables: Record<string, string> = {
  documentDirName: '/project/docs', documentRelativeDirName: 'docs',
  documentFileName: 'guide.test.mdx', documentBaseName: 'guide.test', documentExtName: 'mdx',
  documentFilePath: '/project/docs/guide.test.mdx', documentRelativeFilePath: 'docs/guide.test.mdx',
  documentWorkspaceFolder: '/project', fileName: 'screen.shot.PNG', fileExtName: 'PNG',
};
for (const [name, value] of Object.entries(variables)) {
  test(`native variable ${name}`, () => {
    const expected = value.startsWith('/') ? `${value}/output` : `/project/docs/${value}/output`;
    assert.equal(resolve(`\${${name}}/output`), expected);
  });
}
test('time variables use milliseconds and ISO UTC', () => {
  const before = Date.now();
  const time = Number(resolve('${unixTime}').split('/').at(-1));
  assert.ok(time >= before && time <= Date.now());
  assert.match(resolve('${isoTime}'), /\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
});
test('unsupported variable names are preserved as native does', () => {
  assert.equal(resolve('${fileBaseName}/${fileDirName}/${FileName}'), '/project/docs/${fileBaseName}/${fileDirName}/${FileName}');
});
test('native transform syntax, capture groups, invalid patterns and empty replacements', () => {
  assert.equal(resolve('${fileName/(.+)\\.(.+)/$2.$1/}'), '/project/docs/PNG.screen.shot');
  assert.equal(resolve('${fileName/(.+)/x\\/y/}.${fileExtName}'), '/project/docs/x/y.PNG');
  // Native intentionally only applies a transform when both pattern and replacement are nonempty.
  assert.equal(resolve('${fileName/.PNG//}'), '/project/docs/screen.shot.PNG');
  assert.equal(resolve('${fileName/[/x/}'), '/project/docs/screen.shot.PNG');
  assert.equal(resolve('\\${fileName}'), '/project/docs/${fileName}');
});
test('variables are replaced in a single pass', () => {
  assert.equal(resolve('${fileName}', '${documentBaseName}.png'), '/project/docs/${documentBaseName}.png');
});
test('native root anchoring, trailing slash, empty value and parent resolution', () => {
  assert.equal(resolve('/images/'), '/project/images/screen.shot.PNG');
  assert.equal(resolve('  '), '/project/docs/screen.shot.PNG');
  assert.equal(resolve('../images/${fileName}'), '/project/images/screen.shot.PNG');
  assert.equal(resolveCopyDestination(doc, '图 片.png', '/images/', () => undefined).path, '/project/docs/images/图 片.png');
});
test('drive letters and UNC authorities are retained using URI paths', () => {
  for (const value of ['file:///C:/Project/docs/guide.mdx', 'file://server/share/docs/guide.mdx', 'vscode-remote://ssh-remote+host/project/docs/guide.mdx']) {
    const uri = URI.parse(value);
    const result = resolveCopyDestination(uri, '截图.png', '${documentBaseName}/${fileName}', () => undefined);
    assert.equal(result.scheme, uri.scheme);
    assert.equal(result.authority, uri.authority);
    assert.equal(result.path, uri.path.replace('guide.mdx', 'guide/截图.png'));
  }
});
test('unanchored globs receive the native **/ prefix', () => {
  assert.deepEqual([...parseGlob('docs/*.mdx')], ['**/docs/*.mdx']);
  assert.deepEqual([...parseGlob('**/*.mdx')], ['**/*.mdx']);
  assert.deepEqual([...parseGlob('/docs/*.mdx')], []);
});
