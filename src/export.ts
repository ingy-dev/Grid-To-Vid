import {
  ALL_FORMATS,
  AudioBufferSink,
  AudioBufferSource,
  BlobSource,
  BufferTarget,
  CanvasSource,
  Input,
  Mp4OutputFormat,
  Output,
  Quality,
  VideoSampleSink,
  getFirstEncodableAudioCodec,
  getFirstEncodableVideoCodec,
  type VideoSample,
} from 'mediabunny'
import { GIFEncoder, applyPalette, quantize } from 'gifenc'
import { clipFrameCount, exportFrameCount, FPS, outputLayout, placedRect, usedSeconds, videoBitrate } from './layout'
import { liveStill, type Clip, type FileSize, type Fit, type FrameFit, type FrameId, type GifClip, type VideoClip } from './types'

const ENCODE_ERROR = 'Couldn’t make the video in this browser. Open this page in Chrome and try again.'
const GIF_ERROR = 'Couldn’t make the GIF. Try again.'
const PNG_ERROR = 'Couldn’t make the picture. Try again.'

class VideoSampler {
  private current: VideoSample | null = null

  constructor(
    private sink: VideoSampleSink,
    private start: number,
    private span: number,
  ) {}

  async frame(local: number): Promise<VideoSample | null> {
    const timestamp = Math.min(this.start + this.span - 1e-4, Math.max(this.start, this.start + local))
    if (this.current) {
      const end = this.current.timestamp + Math.max(this.current.duration, 0)
      if (timestamp >= this.current.timestamp && timestamp < end) return this.current
    }
    const next = await this.sink.getSample(timestamp)
    if (this.current && this.current !== next) this.current.close()
    this.current = next
    return next
  }

  close() {
    this.current?.close()
    this.current = null
  }
}

function gifFrameIndex(delays: number[], localSeconds: number) {
  const total = delays.reduce((sum, delay) => sum + delay, 0) || 1
  let ms = (((localSeconds * 1000) % total) + total) % total
  for (let i = 0; i < delays.length; i++) {
    if (ms < delays[i]) return i
    ms -= delays[i]
  }
  return delays.length - 1
}

function concatAudio(buffers: AudioBuffer[]) {
  const channels = Math.max(...buffers.map((buffer) => buffer.numberOfChannels))
  const rate = buffers[0].sampleRate
  const length = buffers.reduce((sum, buffer) => sum + buffer.length, 0)
  const context = new AudioContext({ sampleRate: rate })
  const mixed = context.createBuffer(channels, Math.max(1, length), rate)
  for (let channel = 0; channel < channels; channel++) {
    const destination = mixed.getChannelData(channel)
    let offset = 0
    for (const buffer of buffers) {
      const source = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))
      destination.set(source, offset)
      offset += buffer.length
    }
  }
  void context.close()
  return mixed
}

function mixAudio(buffers: AudioBuffer[]): AudioBuffer {
  const rate = Math.max(...buffers.map((buffer) => buffer.sampleRate))
  const channels = Math.min(2, Math.max(...buffers.map((buffer) => buffer.numberOfChannels)))
  const length = Math.max(1, ...buffers.map((buffer) => Math.round(buffer.duration * rate)))
  const context = new AudioContext({ sampleRate: rate })
  const mixed = context.createBuffer(channels, length, rate)
  const gain = 1 / buffers.length
  for (let channel = 0; channel < channels; channel++) {
    const into = mixed.getChannelData(channel)
    for (const buffer of buffers) {
      const from = buffer.getChannelData(Math.min(channel, buffer.numberOfChannels - 1))
      if (!from.length) continue
      const step = buffer.sampleRate / rate
      for (let i = 0; i < into.length; i++) {
        const position = i * step
        const index = Math.floor(position)
        if (index >= from.length) continue
        const next = Math.min(index + 1, from.length - 1)
        const blend = position - index
        into[i] += (from[index] * (1 - blend) + from[next] * blend) * gain
      }
    }
  }
  void context.close()
  return mixed
}

function loopAudio(source: AudioBuffer, seconds: number) {
  const channels = source.numberOfChannels
  const rate = source.sampleRate
  const length = Math.max(1, Math.ceil(seconds * rate))
  const context = new AudioContext({ sampleRate: rate })
  const looped = context.createBuffer(channels, length, rate)
  for (let channel = 0; channel < channels; channel++) {
    const from = source.getChannelData(channel)
    const to = looped.getChannelData(channel)
    if (!from.length) continue
    for (let i = 0; i < length; i++) to[i] = from[i % from.length]
  }
  void context.close()
  return looped
}

async function audioFor(clip: VideoClip, sourceSeconds: number, exportSeconds: number): Promise<AudioBuffer | null> {
  const input = new Input({
    formats: ALL_FORMATS,
    source: new BlobSource(clip.file),
  })
  try {
    const track = await input.getPrimaryAudioTrack()
    if (!track || !(await track.canDecode())) return null
    const start = await track.getFirstTimestamp()
    const sink = new AudioBufferSink(track)
    const pieces: AudioBuffer[] = []
    for await (const piece of sink.buffers(start, start + sourceSeconds)) {
      if (piece.buffer.length) pieces.push(piece.buffer)
    }
    if (!pieces.length) return null
    return loopAudio(concatAudio(pieces), exportSeconds)
  } finally {
    input.dispose()
  }
}

export async function exportGrid(options: {
  clips: Clip[]
  cols: number
  rows: number
  fit: Fit
  background: string
  frame: FrameId
  frameFit: FrameFit
  sounds: VideoClip[]
  clipSeconds: number
  lengthSeconds: number | null
  fileSize: FileSize
  onProgress: (done: number, total: number) => void
}): Promise<{ blob: Blob; soundFailed: boolean; soundPartial: boolean }> {
  const { clips, cols, rows, fit, background, frame, frameFit, sounds, clipSeconds, lengthSeconds, fileSize, onProgress } = options
  const layout = outputLayout(cols, rows, frame, frameFit, fileSize)
  const { cell, width, height, offsetX, offsetY } = layout
  const frameCount = exportFrameCount(
    clips.map((clip) => usedSeconds(clip.duration, clipSeconds)),
    lengthSeconds,
  )
  const exportSeconds = frameCount / FPS
  const quality =
    fileSize === 'actual'
      ? new Quality('high')
      : new Quality({ bitrate: videoBitrate(width, height, fileSize), bitrateMode: 'variable' })
  const audioQuality =
    fileSize === 'actual' ? new Quality('high') : new Quality({ bitrate: fileSize === 'small' ? 96_000 : 128_000 })
  const format = new Mp4OutputFormat({ fastStart: 'in-memory' })
  const videoCodecs = format.getSupportedVideoCodecs()
  const codec =
    (await getFirstEncodableVideoCodec(
      videoCodecs.filter((item) => item === 'avc'),
      { width, height, quality, frameRate: FPS },
    )) ??
    (await getFirstEncodableVideoCodec(videoCodecs, { width, height, quality, frameRate: FPS }))
  if (!codec || typeof VideoEncoder === 'undefined') throw new Error(ENCODE_ERROR)

  let soundFailed = false
  let soundPartial = false
  let audioBuffer: AudioBuffer | null = null
  if (sounds.length) {
    const pieces: AudioBuffer[] = []
    for (const clip of sounds) {
      try {
        const piece = await audioFor(clip, usedSeconds(clip.duration, clipSeconds), exportSeconds)
        if (piece) pieces.push(piece)
      } catch {
        // This clip is skipped. The others can still play.
      }
    }
    audioBuffer = pieces.length ? mixAudio(pieces) : null
    soundFailed = pieces.length === 0
    soundPartial = pieces.length > 0 && pieces.length < sounds.length
  }

  const target = new BufferTarget()
  const output = new Output({ format, target })
  const encoded: { video: CanvasSource | null; audio: AudioBufferSource | null } = {
    video: null,
    audio: null,
  }

  await paintFrames(
    {
      clips,
      cols,
      fit,
      background: background === 'transparent' ? '#000000' : background,
      cell,
      width,
      height,
      offsetX,
      offsetY,
      clipSeconds,
      lengthSeconds,
      failure: ENCODE_ERROR,
      onProgress,
    },
    async (ctx, i) => {
      if (!encoded.video) {
        encoded.video = new CanvasSource(ctx.canvas, {
          codec,
          quality,
          keyFrameInterval: exportSeconds,
        })
        output.addVideoTrack(encoded.video)
        if (audioBuffer) {
          const supported = format.getSupportedAudioCodecs()
          const ordered = [
            ...supported.filter((item) => item === 'aac'),
            ...supported.filter((item) => item !== 'aac'),
          ]
          const audioCodec = await getFirstEncodableAudioCodec(ordered, {
            numberOfChannels: audioBuffer.numberOfChannels,
            sampleRate: audioBuffer.sampleRate,
            quality: audioQuality,
          })
          if (!audioCodec) {
            soundFailed = true
          } else {
            encoded.audio = new AudioBufferSource({ codec: audioCodec, quality: audioQuality })
            output.addAudioTrack(encoded.audio)
          }
        }
        await output.start()
      }
      await encoded.video.add(i / FPS, 1 / FPS, i === 0 ? { keyFrame: true } : undefined)
    },
  )

  if (encoded.audio && audioBuffer) await encoded.audio.add(audioBuffer)
  encoded.video?.close()
  encoded.audio?.close()
  await output.finalize()
  const buffer = target.buffer
  if (!buffer) throw new Error(ENCODE_ERROR)
  return { blob: new Blob([buffer], { type: 'video/mp4' }), soundFailed, soundPartial }
}

export async function exportGif(options: {
  clips: Clip[]
  cols: number
  rows: number
  fit: Fit
  background: string
  frame: FrameId
  frameFit: FrameFit
  clipSeconds: number
  lengthSeconds: number | null
  fileSize: FileSize
  onProgress: (done: number, total: number) => void
}): Promise<Blob> {
  const { clips, cols, rows, fit, background, frame, frameFit, clipSeconds, lengthSeconds, fileSize, onProgress } = options
  const clear = background === 'transparent'
  const layout = outputLayout(cols, rows, frame, frameFit, fileSize)
  const colors = layout.gifColors
  const cell = layout.gifCell
  const width = layout.gifWidth
  const height = layout.gifHeight
  const offsetX = layout.gifOffsetX
  const offsetY = layout.gifOffsetY
  const gif = GIFEncoder()
  const stride = fileSize === 'small' ? 3 : fileSize === 'actual' ? 1 : 2
  const delay = Math.round((1000 / FPS) * stride)

  await paintFrames(
    {
      clips,
      cols,
      fit,
      background: clear ? '#000000' : background,
      clear,
      opaque: !clear,
      cell,
      width,
      height,
      offsetX,
      offsetY,
      clipSeconds,
      lengthSeconds,
      failure: GIF_ERROR,
      onProgress,
    },
    async (ctx, index) => {
      if (index % stride !== 0) return
      const rgba = new Uint8Array(ctx.getImageData(0, 0, width, height).data)
      const frame = indexGif(rgba, colors, clear)
      gif.writeFrame(
        frame.indexed,
        width,
        height,
        Object.assign(
          { palette: frame.palette, delay, repeat: 0 },
          frame.transparent ? { transparent: true, transparentIndex: frame.transparentIndex } : {},
        ),
      )
    },
  )

  gif.finish()
  const bytes = gif.bytes()
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes)
  return new Blob([copy], { type: 'image/gif' })
}

export async function exportPng(options: {
  clips: Clip[]
  cols: number
  rows: number
  fit: Fit
  background: string
  frame: FrameId
  frameFit: FrameFit
  clipSeconds: number
  lengthSeconds: number | null
  fileSize: FileSize
}): Promise<Blob> {
  const { clips, cols, rows, fit, background, frame, frameFit, clipSeconds, lengthSeconds, fileSize } = options
  const clear = background === 'transparent'
  const layout = outputLayout(cols, rows, frame, frameFit, fileSize)
  let blob: Blob | null = null
  await paintFrames(
    {
      clips,
      cols,
      fit,
      background: clear ? '#000000' : background,
      clear,
      opaque: false,
      still: true,
      cell: layout.cell,
      width: layout.width,
      height: layout.height,
      offsetX: layout.offsetX,
      offsetY: layout.offsetY,
      clipSeconds,
      lengthSeconds,
      failure: PNG_ERROR,
      onProgress: () => {},
    },
    async (ctx) => {
      blob = await new Promise((resolve, reject) => {
        ctx.canvas.toBlob((file) => (file ? resolve(file) : reject(new Error(PNG_ERROR))), 'image/png')
      })
    },
  )
  if (!blob) throw new Error(PNG_ERROR)
  return blob
}

function indexGif(rgba: Uint8Array, colors: number, clear: boolean) {
  if (!clear) {
    const palette = quantize(rgba, colors)
    return { palette, indexed: applyPalette(rgba, palette), transparent: false, transparentIndex: 0 }
  }
  const opaque = new Uint8Array(rgba.length)
  let bytes = 0
  for (let i = 0; i < rgba.length; i += 4) {
    if (rgba[i + 3] < 128) continue
    opaque[bytes++] = rgba[i]
    opaque[bytes++] = rgba[i + 1]
    opaque[bytes++] = rgba[i + 2]
    opaque[bytes++] = 255
  }
  const palette = bytes >= 4 ? [...quantize(opaque.subarray(0, bytes), Math.max(1, colors - 1))] : [[255, 0, 255]]
  const transparentIndex = palette.length
  palette.push([255, 0, 255])
  const indexed = bytes >= 4 ? applyPalette(rgba, palette) : new Uint8Array(rgba.length / 4)
  for (let pixel = 0, i = 0; pixel < indexed.length; pixel++, i += 4) {
    if (rgba[i + 3] < 128) indexed[pixel] = transparentIndex
  }
  return { palette, indexed, transparent: true, transparentIndex }
}

async function paintFrames(
  options: {
    clips: Clip[]
    cols: number
    fit: Fit
    background: string
    clear?: boolean
    opaque?: boolean
    still?: boolean
    cell: number
    width: number
    height: number
    offsetX: number
    offsetY: number
    clipSeconds: number
    lengthSeconds: number | null
    failure: string
    onProgress: (done: number, total: number) => void
  },
  afterFrame: (ctx: CanvasRenderingContext2D, index: number, frameCount: number) => Promise<void>,
) {
  const { clips, cols, fit, background, cell, width, height, offsetX, offsetY, clipSeconds, lengthSeconds, failure, onProgress } =
    options
  const clear = options.clear === true
  const opaque = options.opaque !== false
  const frameCount = options.still
    ? 1
    : exportFrameCount(
        clips.map((clip) => usedSeconds(clip.duration, clipSeconds)),
        lengthSeconds,
      )
  const opened: { clip: VideoClip; input: Input; sampler: VideoSampler; frames: number }[] = []
  try {
    for (const clip of clips) {
      if (clip.kind !== 'video' || liveStill(clip)) continue
      const input = new Input({ formats: ALL_FORMATS, source: new BlobSource(clip.file) })
      try {
        const track = await input.getPrimaryVideoTrack()
        if (!track || !(await track.canDecode())) throw new Error(failure)
        const start = await track.getFirstTimestamp()
        const span = usedSeconds(clip.duration, clipSeconds)
        opened.push({
          clip,
          input,
          sampler: new VideoSampler(new VideoSampleSink(track), start, span),
          frames: clipFrameCount(span),
        })
      } catch (error) {
        input.dispose()
        throw error
      }
    }

    const byId = new Map(opened.map((item) => [item.clip.id, item]))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d', { alpha: !opaque })
    if (!ctx) throw new Error(failure)
    ctx.imageSmoothingEnabled = true
    ctx.imageSmoothingQuality = 'high'

    const gifFrames = new Map<string, number>()
    for (const clip of clips) {
      if (clip.kind === 'gif') gifFrames.set(clip.id, clipFrameCount(usedSeconds(clip.duration, clipSeconds)))
    }

    for (let i = 0; i < frameCount; i++) {
      if (clear && !opaque) ctx.clearRect(0, 0, width, height)
      else {
        ctx.fillStyle = background
        ctx.fillRect(0, 0, width, height)
      }
      for (let index = 0; index < clips.length; index++) {
        const clip = clips[index]
        const x = offsetX + (index % cols) * cell
        const y = offsetY + Math.floor(index / cols) * cell
        ctx.save()
        ctx.beginPath()
        ctx.rect(x, y, cell, cell)
        ctx.clip()
        if (clip.kind === 'gif') {
          drawGif(ctx, clip, (i % (gifFrames.get(clip.id) ?? 1)) / FPS, x, y, cell, fit)
        } else if (liveStill(clip)) {
          const rect = placedRect(clip.still.width, clip.still.height, x, y, cell, cell, fit)
          ctx.drawImage(clip.still, rect.dx, rect.dy, rect.dw, rect.dh)
        } else {
          const item = byId.get(clip.id)
          if (item) {
            const sample = await item.sampler.frame((i % item.frames) / FPS)
            if (sample && sample.displayWidth > 0 && sample.displayHeight > 0) {
              const rect = placedRect(
                sample.displayWidth,
                sample.displayHeight,
                x,
                y,
                cell,
                cell,
                fit,
              )
              sample.draw(ctx, rect.dx, rect.dy, rect.dw, rect.dh)
            }
          }
        }
        ctx.restore()
      }
      await afterFrame(ctx, i, frameCount)
      onProgress(i + 1, frameCount)
      await new Promise((resolve) => setTimeout(resolve, 0))
    }
  } catch (error) {
    if (error instanceof Error && error.message === failure) throw error
    console.error(error)
    throw new Error(failure)
  } finally {
    for (const item of opened) {
      item.sampler.close()
      item.input.dispose()
    }
  }
}

function drawGif(
  ctx: CanvasRenderingContext2D,
  clip: GifClip,
  local: number,
  x: number,
  y: number,
  cell: number,
  fit: Fit,
) {
  const frame = clip.frames[gifFrameIndex(clip.delays, local)]
  if (!frame) return
  const rect = placedRect(clip.width, clip.height, x, y, cell, cell, fit)
  ctx.drawImage(frame, rect.dx, rect.dy, rect.dw, rect.dh)
}
