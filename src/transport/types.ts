export interface Transport {
  request<T = unknown>(method: string, params?: unknown[]): Promise<T>;
}
