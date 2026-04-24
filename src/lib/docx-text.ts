import mammoth from 'mammoth';

export async function extractDocxText(buffer: ArrayBuffer): Promise<string> {
  // mammoth has two entry points:
  //   - Node (used in tests): accepts { path } or { buffer: Buffer }
  //   - Browser (used in the extension bundle via package.json "browser"
  //     field): accepts { arrayBuffer: ArrayBuffer }
  // Vite rewrites the import to the browser entry at build time. In the Node
  // test runtime we convert to a Buffer. Detect which runtime we're in by
  // checking for the Buffer global.
  const hasBuffer = typeof Buffer !== 'undefined';
  const input = hasBuffer
    ? ({ buffer: Buffer.from(buffer) } as unknown as Parameters<
        typeof mammoth.extractRawText
      >[0])
    : ({ arrayBuffer: buffer } as Parameters<
        typeof mammoth.extractRawText
      >[0]);
  const result = await mammoth.extractRawText(input);
  return result.value;
}
