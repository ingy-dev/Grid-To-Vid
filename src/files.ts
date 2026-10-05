export function kindOf(file: File): 'gif' | 'video' | null {
  const name = file.name.toLowerCase()
  const type = file.type.toLowerCase()
  if (type === 'image/gif' || name.endsWith('.gif')) return 'gif'
  if (type.startsWith('video/') || /\.(mp4|mov|m4v|webm)$/.test(name)) return 'video'
  return null
}
