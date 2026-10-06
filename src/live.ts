import { extOf, isRawPhoto, isSidecar, kindOf, stemOf, type FileKind } from './files'
import { MAX_BYTES } from './types'

const LIVE_VIDEO = new Set(['mov', 'mp4', 'm4v', 'qt'])
const LIVE_STILL = new Set(['heic', 'heif', 'jpg', 'jpeg'])
const LIVE_SECONDS = 8

export type ImportJob =
  | { kind: FileKind; file: File }
  | { kind: 'pair'; video: File; still: File }

type Entry = { file: File; kind: FileKind; stem: string; index: number; taken: boolean }

function bytesInclude(haystack: Uint8Array, needle: string): boolean {
  const length = needle.length
  if (!length || haystack.length < length) return false
  const codes = new Uint8Array(length)
  for (let i = 0; i < length; i++) codes[i] = needle.charCodeAt(i)
  const last = haystack.length - length
  for (let i = 0; i <= last; i++) {
    let found = true
    for (let j = 0; j < length; j++) {
      let byte = haystack[i + j]
      if (byte >= 65 && byte <= 90) byte += 32
      if (byte !== codes[j]) {
        found = false
        break
      }
    }
    if (found) return true
  }
  return false
}

async function fileHasId(file: File, id: string): Promise<boolean> {
  if (file.size > MAX_BYTES) return false
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (bytesInclude(bytes, id)) return true
  const wide = new Uint8Array(id.length * 2)
  for (let i = 0; i < id.length; i++) wide[i * 2] = id.charCodeAt(i)
  return bytesInclude(bytes, String.fromCharCode(...wide))
}

export async function planImports(incoming: File[]): Promise<{ jobs: ImportJob[]; notes: string[] }> {
  const notes: string[] = []
  const entries: Entry[] = []
  let ignored = 0
  incoming.forEach((file, index) => {
    if (isSidecar(file)) {
      ignored += 1
      return
    }
    if (isRawPhoto(file)) {
      notes.push('Save that photo as a JPEG or HEIC first.')
      return
    }
    const kind = kindOf(file)
    if (!kind) {
      ignored += 1
      notes.push('Use a photo, a GIF, or a video.')
      return
    }
    entries.push({ file, kind, stem: stemOf(file), index, taken: false })
  })

  const jobs: { index: number; job: ImportJob }[] = []
  if (entries.some((entry) => entry.kind === 'video')) {
    const { videoDuration, appleContentId } = await import('./video')
    const durations = new Map<File, Promise<number | null>>()
    const durationOf = (file: File) => {
      let pending = durations.get(file)
      if (!pending) {
        pending = videoDuration(file)
        durations.set(file, pending)
      }
      return pending
    }

    for (const video of entries) {
      if (video.taken || video.kind !== 'video' || !video.stem || video.file.size > MAX_BYTES) continue
      const stills = entries
        .filter((entry) => !entry.taken && entry.kind === 'image' && entry.stem === video.stem)
        .sort((a, b) => stillRank(a.file) - stillRank(b.file))
      for (const still of stills) {
        if (!(await sameLivePhoto(video.file, still.file, durationOf))) continue
        video.taken = true
        still.taken = true
        jobs.push({ index: Math.min(video.index, still.index), job: { kind: 'pair', video: video.file, still: still.file } })
        break
      }
    }

    const videosLeft = entries.filter((entry) => !entry.taken && entry.kind === 'video' && entry.file.size <= MAX_BYTES)
    const imagesLeft = entries.filter((entry) => !entry.taken && entry.kind === 'image')
    if (videosLeft.length && imagesLeft.length) {
      for (const video of videosLeft) {
        if (video.taken) continue
        const id = await appleContentId(video.file)
        if (!id) continue
        for (const still of imagesLeft) {
          if (still.taken) continue
          if (!(await fileHasId(still.file, id))) continue
          video.taken = true
          still.taken = true
          jobs.push({
            index: Math.min(video.index, still.index),
            job: { kind: 'pair', video: video.file, still: still.file },
          })
          break
        }
      }
    }
  }

  for (const entry of entries) {
    if (entry.taken) continue
    jobs.push({ index: entry.index, job: { kind: entry.kind, file: entry.file } })
  }

  if (!jobs.length && ignored && !notes.length) notes.push('Use a photo, a GIF, or a video.')
  return { jobs: jobs.sort((a, b) => a.index - b.index).map((item) => item.job), notes }
}

function stillRank(file: File): number {
  const ext = extOf(file)
  if (ext === 'heic' || ext === 'heif') return 0
  if (ext === 'jpg' || ext === 'jpeg') return 1
  return 2
}

async function sameLivePhoto(
  video: File,
  still: File,
  durationOf: (file: File) => Promise<number | null>,
): Promise<boolean> {
  const videoExt = extOf(video)
  const stillExt = extOf(still)
  if (!LIVE_VIDEO.has(videoExt) || !LIVE_STILL.has(stillExt)) return false
  const duration = await durationOf(video)
  if (duration == null) return stillExt === 'heic' || stillExt === 'heif' || videoExt === 'mov'
  return duration <= LIVE_SECONDS
}
