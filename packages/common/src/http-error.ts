export class HttpError extends Error {
  readonly status: number
  readonly param?: string

  constructor(status: number, message: string, detail: { param?: string } = {}) {
    super(message)
    this.status = status
    this.param = detail.param
  }
}
