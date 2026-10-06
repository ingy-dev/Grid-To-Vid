import { ALL_FORMATS, BlobSource, Input, VideoSampleSink } from 'mediabunny'
import type { VideoClip } from './types'

const DECODE_ERROR =
  'Couldn’t play that video here. Try Chrome, or save it again as a normal MP4.'

export async function videoDuration(file: File): Promise<number | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track) return null
    const duration = await track.computeDuration()
    return Number.isFinite(duration) && duration > 0 ? duration : null
  } catch {
    return null
  } finally {
    input.dispose()
  }
}

function contentId(value: unknown): string | null {
  const text =
    typeof value === 'string'
      ? value
      : value instanceof Uint8Array
        ? new TextDecoder('latin1').decode(value)
        : ''
  const match = text.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i)
  return match ? match[0].toLowerCase() : null
}

async function idFromInput(input: Input): Promise<string | null> {
  try {
    const raw = (await input.getMetadataTags()).raw
    if (!raw) return null
    for (const [key, value] of Object.entries(raw)) {
      if (!key.toLowerCase().includes('content.identifier')) continue
      const id = contentId(value)
      if (id) return id
    }
    return null
  } catch {
    return null
  }
}

export async function appleContentId(file: File): Promise<string | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  try {
    return await idFromInput(input)
  } finally {
    input.dispose()
  }
}

export async function posterFrame(file: File, at: number): Promise<ImageBitmap | null> {
  const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(file) })
  let sample: Awaited<ReturnType<VideoSampleSink['getSample']>> = null
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) return null
    const start = await track.getFirstTimestamp()
    sample = await new VideoSampleSink(track).getSample(start + Math.max(0, at))
    if (!sample || sample.displayWidth < 2 || sample.displayHeight < 2) return null
    const edge = Math.max(sample.displayWidth, sample.displayHeight)
    const scale = Math.min(1, 2048 / edge)
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(sample.displayWidth * scale))
    canvas.height = Math.max(1, Math.round(sample.displayHeight * scale))
    const ctx = canvas.getContext('2d')
    if (!ctx) return null
    sample.draw(ctx, 0, 0, canvas.width, canvas.height)
    return await createImageBitmap(canvas)
  } catch {
    return null
  } finally {
    sample?.close()
    input.dispose()
  }
}

export async function loadVideo(file: File): Promise<VideoClip> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(file),
  })
  try {
    const track = await input.getPrimaryVideoTrack()
    if (!track || !(await track.canDecode())) throw new Error(DECODE_ERROR)
    const duration = await track.computeDuration()
    const width = await track.getDisplayWidth()
    const height = await track.getDisplayHeight()
    if (!Number.isFinite(duration) || duration <= 0.05 || width < 2 || height < 2) {
      throw new Error(DECODE_ERROR)
    }
    const audio = await input.getPrimaryAudioTrack()
    const live = duration <= 8 && (await idFromInput(input)) != null
    return {
      id: crypto.randomUUID(),
      kind: 'video',
      name: file.name,
      file,
      url: URL.createObjectURL(file),
      duration,
      width,
      height,
      hasAudio: audio !== null,
      live,
    }
  } catch (error) {
    if (error instanceof Error && error.message === DECODE_ERROR) throw error
    throw new Error(DECODE_ERROR)
  } finally {
    input.dispose()
  }
}
