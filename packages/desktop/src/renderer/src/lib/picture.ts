export async function squarePicture({ source, size, type }: { source: Blob | string; size: number; type: 'image/jpeg' | 'image/png' }): Promise<string> {
  const url = typeof source === 'string' ? source : URL.createObjectURL(source)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const side = Math.min(image.naturalWidth, image.naturalHeight)
    const canvas = Object.assign(document.createElement('canvas'), { width: size, height: size })
    const context = canvas.getContext('2d')
    if (!context) throw new Error('This computer could not read that picture.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, size, size)
    context.drawImage(image, (image.naturalWidth - side) / 2, (image.naturalHeight - side) / 2, side, side, 0, 0, size, size)
    return canvas.toDataURL(type, 0.85)
  } finally {
    if (typeof source !== 'string') URL.revokeObjectURL(url)
  }
}
