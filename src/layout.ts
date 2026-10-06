import { MAX_CLIP_SECONDS, type FileSize, type Fit, type FrameFit, type FrameId, type ShapePref } from './types'

export const FPS = 30

export function gridShape(count: number, pref: ShapePref): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 }
  const target = pref === 'wide' ? 16 / 9 : pref === 'tall' ? 9 / 16 : 1
  let best: { cols: number; rows: number; score: number; aspect: number } | null = null
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    const empty = cols * rows - count
    const aspect = cols / rows
    const score = empty * 1.15 + Math.abs(Math.log(aspect / target))
    if (
      !best ||
      score < best.score - 1e-9 ||
      (Math.abs(score - best.score) < 1e-9 && aspect > best.aspect)
    ) {
      best = { cols, rows, score, aspect }
    }
  }
  return { cols: best!.cols, rows: best!.rows }
}

export function clipFrameCount(seconds: number): number {
  return Math.max(1, Math.round(seconds * FPS))
}

export function usedSeconds(seconds: number, clipSeconds: number) {
  return Math.max(0.1, Math.min(seconds, clipSeconds))
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a)
  let y = Math.abs(b)
  while (y) {
    const next = x % y
    x = y
    y = next
  }
  return x || 1
}

/** Length of the file in frames. Auto loops each clip a whole number of times, capped at 10 seconds. */
export function exportFrameCount(durations: number[], lengthSeconds: number | null = null): number {
  if (lengthSeconds != null && lengthSeconds > 0) return Math.max(1, Math.round(FPS * lengthSeconds))
  const cap = FPS * MAX_CLIP_SECONDS
  let cycle = 1
  for (const seconds of durations) {
    const n = clipFrameCount(seconds)
    cycle = (cycle / gcd(cycle, n)) * n
    if (!Number.isFinite(cycle) || cycle > cap) return cap
  }
  return Math.max(1, Math.round(cycle))
}

export type FrameSpec = {
  id: Exclude<FrameId, 'grid'>
  width: number
  height: number
  ratio: string
  name: string
  use: string
}

export const FRAMES: FrameSpec[] = [
  { id: '1920x1080', width: 1920, height: 1080, ratio: '16:9', name: 'Screen', use: 'YouTube and computers' },
  { id: '1280x720', width: 1280, height: 720, ratio: '16:9', name: 'Small screen', use: 'A smaller screen video' },
  { id: '1440x1080', width: 1440, height: 1080, ratio: '4:3', name: 'CRT', use: 'Old TVs and monitors' },
  { id: '1080x1920', width: 1080, height: 1920, ratio: '9:16', name: 'Phone', use: 'Stories, Reels, and TikTok' },
  { id: '720x1280', width: 720, height: 1280, ratio: '9:16', name: 'Small phone', use: 'A smaller phone video' },
  { id: '1080x1080', width: 1080, height: 1080, ratio: '1:1', name: 'Square', use: 'An Instagram post' },
  { id: '1080x1350', width: 1080, height: 1350, ratio: '4:5', name: 'Portrait', use: 'An Instagram portrait' },
]

export function frameById(id: Exclude<FrameId, 'grid'>): FrameSpec {
  const found = FRAMES.find((frame) => frame.id === id)
  if (!found) throw new Error('Unknown size')
  return found
}

const GIF_EDGE: Record<FileSize, number> = { small: 360, medium: 480, large: 640, actual: 800 }
const GIF_COLORS: Record<FileSize, number> = { small: 64, medium: 128, large: 192, actual: 256 }
const FILE_BITRATE: Record<Exclude<FileSize, 'actual'>, number> = {
  small: 2_000_000,
  medium: 4_000_000,
  large: 8_000_000,
}

export function gifSize(width: number, height: number, longEdge = 640) {
  if (width >= height) {
    return { width: longEdge, height: even(height * (longEdge / width)) }
  }
  return { width: even(width * (longEdge / height)), height: longEdge }
}

export function videoBitrate(width: number, height: number, fileSize: Exclude<FileSize, 'actual'>): number {
  const scale = Math.pow((width * height) / (1920 * 1080), 0.95)
  return Math.max(500_000, Math.ceil((FILE_BITRATE[fileSize] * scale) / 1000) * 1000)
}

export function exportMegabytes(
  width: number,
  height: number,
  seconds: number,
  fileSize: FileSize,
  withAudio: boolean,
): number {
  const audio = withAudio ? (fileSize === 'small' ? 96_000 : fileSize === 'actual' ? 160_000 : 128_000) : 0
  const video =
    fileSize === 'actual'
      ? 18_000_000 * Math.pow((width * height) / (1920 * 1080), 0.95)
      : videoBitrate(width, height, fileSize)
  return Math.max(0.1, ((video + audio) * Math.max(0.1, seconds)) / 8 / 1_000_000)
}

function even(value: number) {
  const rounded = Math.max(2, Math.round(value))
  return rounded % 2 === 0 ? rounded : rounded - 1
}

export function outputLayout(
  cols: number,
  rows: number,
  frameId: FrameId,
  frameFit: FrameFit,
  fileSize: FileSize = 'medium',
) {
  const edge = GIF_EDGE[fileSize]
  const colors = GIF_COLORS[fileSize]
  if (frameId === 'grid') {
    const placed = naturalGrid(cols, rows, 1080)
    const gif = gifSize(placed.width, placed.height, edge)
    const gifPlaced = placeGrid(cols, rows, gif.width, gif.height, 'letterbox')
    return pack(placed, gifPlaced, ratioText(placed.width, placed.height), colors)
  }
  const frame = frameById(frameId)
  const placed = placeGrid(cols, rows, frame.width, frame.height, frameFit)
  const gif = gifSize(frame.width, frame.height, edge)
  const gifPlaced = placeGrid(cols, rows, gif.width, gif.height, frameFit)
  return pack(placed, gifPlaced, frame.ratio, colors)
}

function pack(
  placed: ReturnType<typeof placeGrid>,
  gifPlaced: ReturnType<typeof placeGrid>,
  ratio: string,
  gifColors: number,
) {
  return {
    ...placed,
    ratio,
    gifWidth: gifPlaced.width,
    gifHeight: gifPlaced.height,
    gifCell: gifPlaced.cell,
    gifOffsetX: gifPlaced.offsetX,
    gifOffsetY: gifPlaced.offsetY,
    gifColors,
  }
}

function naturalGrid(cols: number, rows: number, longEdge: number) {
  let cell = Math.floor(longEdge / Math.max(cols, rows))
  if (cell % 2) cell -= 1
  cell = Math.max(2, cell)
  return { cell, width: cell * cols, height: cell * rows, offsetX: 0, offsetY: 0 }
}

function placeGrid(cols: number, rows: number, width: number, height: number, frameFit: FrameFit) {
  const raw =
    frameFit === 'crop' ? Math.max(width / cols, height / rows) : Math.min(width / cols, height / rows)
  const cell = Math.max(2, frameFit === 'crop' ? Math.ceil(raw) : Math.floor(raw))
  const gridWidth = cell * cols
  const gridHeight = cell * rows
  return {
    cell,
    width,
    height,
    offsetX: Math.round((width - gridWidth) / 2),
    offsetY: Math.round((height - gridHeight) / 2),
  }
}

function ratioText(width: number, height: number) {
  const divisor = gcd(width, height)
  return `${width / divisor}:${height / divisor}`
}

export function placedRect(
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  width: number,
  height: number,
  fit: Fit,
) {
  const scale =
    fit === 'cover'
      ? Math.max(width / sourceWidth, height / sourceHeight)
      : Math.min(width / sourceWidth, height / sourceHeight)
  const dw = sourceWidth * scale
  const dh = sourceHeight * scale
  return {
    dx: x + (width - dw) / 2,
    dy: y + (height - dh) / 2,
    dw,
    dh,
  }
}
