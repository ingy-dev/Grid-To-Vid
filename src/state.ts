import type { Clip } from './types'

export function disposeClip(clip: Clip) {
  if (clip.kind === 'gif') {
    for (const frame of clip.frames) frame.close()
    return
  }
  clip.still?.close()
  URL.revokeObjectURL(clip.url)
}
