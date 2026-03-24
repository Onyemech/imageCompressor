export type VercelRequest = {
  query: Record<string, string | string[] | undefined>
  headers: Record<string, string | string[] | undefined>
  method?: string
  url?: string
}

export type VercelResponse = {
  status(code: number): VercelResponse
  send(body?: unknown): unknown
  json(body: unknown): unknown
  setHeader(name: string, value: string): unknown
}

