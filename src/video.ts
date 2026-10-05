import { ALL_FORMATS, BlobSource, Input } from 'mediabunny'
import type { VideoClip } from './types'

const DECODE_ERROR =
  'Couldn’t play that video here. Try Chrome, or save it again as a normal MP4.'

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
    }
  } catch (error) {
    if (error instanceof Error && error.message === DECODE_ERROR) throw error
    throw new Error(DECODE_ERROR)
  } finally {
    input.dispose()
  }
}
