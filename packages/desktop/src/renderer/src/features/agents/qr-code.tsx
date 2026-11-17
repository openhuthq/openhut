import { useEffect, useRef } from 'react'
import QRCode from 'qrcode'

export function QrCode({ text }: { text: string }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    if (canvas.current) void QRCode.toCanvas(canvas.current, text, { margin: 1, width: 232 })
  }, [text])
  return <canvas ref={canvas} role="img" aria-label="WhatsApp link code" />
}
