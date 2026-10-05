import { decompressFrames, parseGIF } from 'gifuct-js'
import type { GifClip } from './types'

function canvas2d(width: number, height: number) {
  const canvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : Object.assign(document.createElement('canvas'), { width, height })
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new Error('canvas')
  return { canvas, ctx }
}

export async function loadGif(file: File): Promise<GifClip> {
  const parsed = parseGIF(await file.arrayBuffer())
  const raw = decompressFrames(parsed, true).filter((frame) => frame?.patch && frame.dims)
  const width = parsed.lsd?.width || raw[0]?.dims.width || 0
  const height = parsed.lsd?.height || raw[0]?.dims.height || 0
  if (!raw.length || width < 1 || height < 1) {
    throw new Error('Couldn’t use that file. Try a different GIF or video.')
  }
  if (width > 4096 || height > 4096) {
    throw new Error('That GIF is too large to play here. Try a smaller one.')
  }

  const { canvas, ctx } = canvas2d(width, height)
  const frames: ImageBitmap[] = []
  const delays: number[] = []
  let previousDisposal = 0
  let previousRect = { left: 0, top: 0, width: 0, height: 0 }
  let snapshot: ImageData | null = null

  for (const frame of raw) {
    const dims = frame.dims
    if (dims.width < 1 || dims.height < 1 || !frame.patch) continue
    const expected = dims.width * dims.height * 4
    if (frame.patch.length < expected) continue

    if (previousDisposal === 2) {
      ctx.clearRect(previousRect.left, previousRect.top, previousRect.width, previousRect.height)
    } else if (previousDisposal === 3 && snapshot) {
      ctx.putImageData(snapshot, 0, 0)
    }

    const disposal = frame.disposalType ?? 1
    if (disposal === 3) snapshot = ctx.getImageData(0, 0, width, height)

    const patch = new Uint8ClampedArray(expected)
    patch.set(frame.patch.subarray(0, expected))
    const temp = canvas2d(dims.width, dims.height)
    temp.ctx.putImageData(new ImageData(patch, dims.width, dims.height), 0, 0)
    ctx.drawImage(temp.canvas, dims.left, dims.top)

    frames.push(await createImageBitmap(canvas))
    delays.push(frame.delay != null && frame.delay >= 20 ? frame.delay : 100)
    previousDisposal = disposal
    previousRect = dims
  }

  if (!frames.length) {
    throw new Error('Couldn’t use that file. Try a different GIF or video.')
  }

  const duration = delays.reduce((sum, delay) => sum + delay, 0) / 1000
  return {
    id: crypto.randomUUID(),
    kind: 'gif',
    name: file.name,
    frames,
    delays,
    duration,
    width,
    height,
  }
}
