declare module 'heic-decode' {
  function decode(options: { buffer: Uint8Array }): Promise<{
    width: number
    height: number
    data: Uint8ClampedArray
  }>
  export default decode
}
