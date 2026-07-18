declare module "redis" {
  export function createClient(options?: { url?: string }): {
    connect(): Promise<void>;
    ping(): Promise<string>;
    disconnect(): Promise<void>;
  };
}
