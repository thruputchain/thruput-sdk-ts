export interface Transport {
  request(method: string, params?: unknown): Promise<unknown>;
}
