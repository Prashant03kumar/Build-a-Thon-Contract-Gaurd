export type Health = {
  status: "ok" | "degraded";
  service: string;
  uptimeSeconds: number;
  timestamp: string;
  webhookReceiver: {
    url: string;
    reachable: boolean;
    latencyMs: number | null;
    error: string | null;
  };
};

export async function fetchHealth(): Promise<Health | null> {
  try {
    const response = await fetch("/api/health");
    if (!response.ok) return null;
    return (await response.json()) as Health;
  } catch {
    return null;
  }
}
