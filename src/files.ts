const VIDEO_EXT = /\.(mp4|m4v|mov|qt|webm|mkv|3gp|3g2|mpeg|mpg|ts|m2ts|mts)$/i
const IMAGE_EXT = /\.(png|jpe?g|jfif|jpe|webp|avif|heic|heif|bmp|tiff?|apng|jxl|svg)$/i
const HEIC_MIME = new Set(['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence'])
const RAW_EXT = new Set(['dng', 'raw', 'cr2', 'cr3', 'nef', 'arw', 'orf', 'rw2', 'raf', 'srw', 'psd', 'psb'])
const SKIP_EXT = new Set(['aae', 'xmp', 'thm', 'ds_store'])

export type FileKind = 'gif' | 'video' | 'image'

export function extOf(file: File): string {
  const base = file.name.split(/[/\\]/).pop() ?? file.name
  const dot = base.lastIndexOf('.')
  return dot >= 0 ? base.slice(dot + 1).toLowerCase() : ''
}

export function stemOf(file: File): string {
  const base = file.name.split(/[/\\]/).pop() ?? file.name
  const dot = base.lastIndexOf('.')
  return (dot > 0 ? base.slice(0, dot) : base).trim().toLowerCase()
}

export function isSidecar(file: File): boolean {
  return SKIP_EXT.has(extOf(file))
}

export function isRawPhoto(file: File): boolean {
  const type = file.type.toLowerCase()
  return RAW_EXT.has(extOf(file)) || type === 'image/x-adobe-dng' || type === 'image/vnd.adobe.photoshop'
}

export function isHeic(file: File): boolean {
  return HEIC_MIME.has(file.type.toLowerCase()) || /\.(heic|heif)$/i.test(file.name)
}

export function kindOf(file: File): FileKind | null {
  if (isSidecar(file) || isRawPhoto(file)) return null
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  if (type === 'image/gif' || name.endsWith('.gif')) return 'gif'
  if (isHeic(file)) return 'image'
  if (type.startsWith('video/') || VIDEO_EXT.test(name)) return 'video'
  if (type.startsWith('image/') || IMAGE_EXT.test(name)) return 'image'
  return null
}
