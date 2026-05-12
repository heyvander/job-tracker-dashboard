import Redis from "ioredis";

export type SyncCompleteEvent = {
  email: string;
  scanned: number;
  updated: number;
  at: string;
};

type SyncListener = (event: SyncCompleteEvent) => void;

const listeners = new Set<SyncListener>();
const SYNC_EVENTS_CHANNEL = process.env.SYNC_EVENTS_CHANNEL || "job-tracker:sync-complete";
let publisher: Redis | null = null;
let redisMisconfiguredLogged = false;

function getRedisUrl(): string | null {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw) return null;
  if (raw.startsWith("http://") || raw.startsWith("https://")) {
    if (!redisMisconfiguredLogged) {
      redisMisconfiguredLogged = true;
      console.warn("REDIS_URL must be a Redis TCP URL (redis:// or rediss://), not REST URL.");
    }
    return null;
  }
  if (!raw.startsWith("redis://") && !raw.startsWith("rediss://")) {
    if (!redisMisconfiguredLogged) {
      redisMisconfiguredLogged = true;
      console.warn("REDIS_URL must start with redis:// or rediss://.");
    }
    return null;
  }
  return raw;
}

function attachRedisErrorHandler(client: Redis, role: "publisher" | "subscriber"): void {
  client.on("error", (error) => {
    // Prevent unhandled ioredis error events from spamming/crashing route logs.
    console.warn(`[sync-events:${role}] Redis connection issue: ${error.message}`);
  });
}

function createRedisClient(redisUrl: string, role: "publisher" | "subscriber"): Redis {
  const client = new Redis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: true,
  });
  attachRedisErrorHandler(client, role);
  return client;
}

function getPublisher(): Redis | null {
  const redisUrl = getRedisUrl();
  if (!redisUrl) return null;
  if (publisher) return publisher;
  publisher = createRedisClient(redisUrl, "publisher");
  void publisher.connect().catch(() => {
    // Publish path remains best-effort; failures are handled in emitSyncComplete.
  });
  return publisher;
}

export function onSyncComplete(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export async function subscribeSyncComplete(listener: SyncListener): Promise<() => void> {
  const redisUrl = getRedisUrl();
  if (!redisUrl) {
    return onSyncComplete(listener);
  }

  const subscriber = createRedisClient(redisUrl, "subscriber");

  const onMessage = (channel: string, message: string) => {
    if (channel !== SYNC_EVENTS_CHANNEL) return;
    try {
      const payload = JSON.parse(message) as SyncCompleteEvent;
      listener(payload);
    } catch {
      // Ignore malformed message payloads.
    }
  };

  subscriber.on("message", onMessage);
  try {
    await subscriber.connect();
    await subscriber.subscribe(SYNC_EVENTS_CHANNEL);
  } catch {
    subscriber.off("message", onMessage);
    void subscriber.quit().catch(() => {});
    return onSyncComplete(listener);
  }

  return () => {
    subscriber.off("message", onMessage);
    void subscriber.unsubscribe(SYNC_EVENTS_CHANNEL).catch(() => {});
    void subscriber.quit().catch(() => {});
  };
}

export async function emitSyncComplete(event: SyncCompleteEvent): Promise<void> {
  for (const listener of listeners) {
    try {
      listener(event);
    } catch {
      // Ignore listener errors and continue delivering events.
    }
  }

  const redis = getPublisher();
  if (!redis) return;
  try {
    await redis.publish(SYNC_EVENTS_CHANNEL, JSON.stringify(event));
  } catch {
    // Keep sync path resilient if Redis publish fails.
  }
}
