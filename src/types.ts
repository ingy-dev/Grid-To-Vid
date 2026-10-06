export type Fit = 'contain' | 'cover'
export type ShapePref = 'square' | 'wide' | 'tall'
export type FrameFit = 'letterbox' | 'crop'
export type FrameId = 'grid' | '1920x1080' | '1280x720' | '1440x1080' | '1080x1920' | '720x1280' | '1080x1080' | '1080x1350'

export type GifClip = {
  id: string
  kind: 'gif'
  name: string
  frames: ImageBitmap[]
  delays: number[]
  duration: number
  width: number
  height: number
}

export type VideoClip = {
  id: string
  kind: 'video'
  name: string
  file: File
  url: string
  duration: number
  width: number
  height: number
  hasAudio: boolean
}

export type Clip = GifClip | VideoClip

export const MAX_CLIPS = 12
export const MAX_BYTES = 15 * 1024 * 1024
export const MAX_CLIP_SECONDS = 10
