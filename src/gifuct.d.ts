declare module 'gifuct-js' {
  export function parseGIF(buffer: ArrayBuffer): {
    lsd: { width: number; height: number }
  }

  export function decompressFrames(
    gif: ReturnType<typeof parseGIF>,
    buildPatch: boolean,
  ): Array<{
    dims: { top: number; left: number; width: number; height: number }
    delay?: number
    disposalType?: number
    patch?: Uint8ClampedArray
  }>
}
