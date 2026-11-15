export function ErrorNote({ message }: { message?: string }) {
  if (!message) return null
  return <p className="err" role="alert">{message}</p>
}
