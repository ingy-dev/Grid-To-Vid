import type { GifClip } from './types'
import { isHeic } from './files'

const PHOTO_ERROR = 'Couldn’t open that photo. Try saving it as a JPEG.'
const STILL_SECONDS = 3
const MAX_EDGE = 2048
const MAX_ANIMATION_MS = 10_000

type ImageDecoderLike = {
  tracks: { ready: Promise<void>; selectedTrack: { frameCount: number } | null }
  decode: (options: { frameIndex: number }) => Promise<{ image: VideoFrame }>
  close: () => void
}

function decoderFor(file: File, type: string): ImageDecoderLike | null {
  const Ctor = (
    globalThis as unknown as {
      ImageDecoder?: new (init: { data: BufferSource | ReadableStream; type: string }) => ImageDecoderLike
    }
  ).ImageDecoder
  if (!Ctor) return null
  try {
    return new Ctor({ data: file.stream(), type })
  } catch {
    return null
  }
}

function animationType(file: File): string | null {
  const type = file.type.toLowerCase()
  if (type === 'image/webp' || type === 'image/avif' || type === 'image/png' || type === 'image/apng') return type
  const name = file.name.toLowerCase()
  if (name.endsWith('.webp')) return 'image/webp'
  if (name.endsWith('.avif')) return 'image/avif'
  if (name.endsWith('.apng')) return 'image/apng'
  if (name.endsWith('.png')) return 'image/png'
  return null
}

async function shrink(bitmap: ImageBitmap): Promise<ImageBitmap> {
  const edge = Math.max(bitmap.width, bitmap.height)
  if (bitmap.width < 1 || bitmap.height < 1) {
    bitmap.close()
    throw new Error(PHOTO_ERROR)
  }
  if (edge <= MAX_EDGE) return bitmap
  const scale = MAX_EDGE / edge
  const width = Math.max(1, Math.round(bitmap.width * scale))
  const height = Math.max(1, Math.round(bitmap.height * scale))
  try {
    const next = await createImageBitmap(bitmap, { resizeWidth: width, resizeHeight: height, resizeQuality: 'high' })
    bitmap.close()
    return next
  } catch {
    return bitmap
  }
}

function stillClip(file: File, bitmap: ImageBitmap): GifClip {
  return {
    id: crypto.randomUUID(),
    kind: 'gif',
    name: file.name,
    frames: [bitmap],
    delays: [STILL_SECONDS * 1000],
    duration: STILL_SECONDS,
    width: bitmap.width,
    height: bitmap.height,
  }
}

async function bitmapFromFile(file: File): Promise<ImageBitmap> {
  const bitmap = await createImageBitmap(file)
  return shrink(bitmap)
}

async function loadAnimated(file: File): Promise<GifClip | null> {
  const type = animationType(file)
  if (!type) return null
  const decoder = decoderFor(file, type)
  if (!decoder) return null
  const frames: ImageBitmap[] = []
  const delays: number[] = []
  let keep = false
  try {
    await decoder.tracks.ready
    const track = decoder.tracks.selectedTrack
    if (!track || track.frameCount < 2) return null
    let total = 0
    const count = Math.min(track.frameCount, 240)
    for (let index = 0; index < count && total < MAX_ANIMATION_MS; index++) {
      const { image } = await decoder.decode({ frameIndex: index })
      const delay = Math.min(1000, Math.max(20, image.duration ? image.duration / 1000 : 100))
      try {
        frames.push(await shrink(await createImageBitmap(image)))
        delays.push(delay)
        total += delay
      } finally {
        image.close()
      }
    }
    if (frames.length < 2) return null
    keep = true
    return {
      id: crypto.randomUUID(),
      kind: 'gif',
      name: file.name,
      frames,
      delays,
      duration: delays.reduce((sum, delay) => sum + delay, 0) / 1000,
      width: frames[0].width,
      height: frames[0].height,
    }
  } catch {
    return null
  } finally {
    decoder.close()
    if (!keep) for (const frame of frames) frame.close()
  }
}

async function loadHeic(file: File): Promise<GifClip> {
  try {
    return stillClip(file, await bitmapFromFile(file))
  } catch {
    // Chrome and Firefox need the software decoder. Safari usually succeeds above.
  }
  try {
    const decode = (await import('heic-decode')).default
    const decoded = await decode({ buffer: new Uint8Array(await file.arrayBuffer()) })
    const pixels = decoded.width * decoded.height * 4
    if (decoded.width < 2 || decoded.height < 2 || decoded.data.length < pixels) throw new Error(PHOTO_ERROR)
    const copy = new Uint8ClampedArray(pixels)
    copy.set(decoded.data.subarray(0, pixels))
    const image = new ImageData(copy, decoded.width, decoded.height)
    return stillClip(file, await shrink(await createImageBitmap(image)))
  } catch (error) {
    if (error instanceof Error && error.message === PHOTO_ERROR) throw error
    throw new Error(PHOTO_ERROR)
  }
}

export async function loadImage(file: File): Promise<GifClip> {
  if (isHeic(file)) return loadHeic(file)
  const animated = await loadAnimated(file)
  if (animated) return animated
  try {
    return stillClip(file, await bitmapFromFile(file))
  } catch {
    throw new Error(PHOTO_ERROR)
  }
}
