export type ImageType = 'png' | 'jpeg' | 'gif' | 'webp';

/** Detect the encoded format from bytes, never from an untrusted clipboard MIME or suffix. */
export function detectImageType(data: Uint8Array): ImageType | undefined {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  if (data.length >= 24 && starts(137, 80, 78, 71, 13, 10, 26, 10)
    && data[12] === 73 && data[13] === 72 && data[14] === 68 && data[15] === 82) return 'png';
  if (data.length >= 4 && starts(255, 216, 255) && data[3] !== 0 && data[3] !== 255) return 'jpeg';
  if (data.length >= 13 && starts(71, 73, 70, 56) && (data[4] === 55 || data[4] === 57) && data[5] === 97) return 'gif';
  if (data.length >= 20 && starts(82, 73, 70, 70) && String.fromCharCode(...data.slice(8, 12)) === 'WEBP'
    && ['VP8 ', 'VP8L', 'VP8X'].includes(String.fromCharCode(...data.slice(12, 16)))) return 'webp';
  return undefined;
}

export function isSafeFileName(name: string): boolean {
  return !!name && name !== '.' && name !== '..' && !/[\\/\x00-\x1f\x7f:<>"|?*]/.test(name)
    && !/[. ]$/.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);
}
