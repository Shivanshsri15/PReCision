import { Injectable } from '@nestjs/common';

export interface AppEvent {
  type: string;
  data: unknown;
  at: string;
}

type Listener = (event: AppEvent) => void;
type SnapshotProvider = (userId: string) => unknown;

/**
 * In-process, per-user event bus behind `GET /api/v1/events/stream`.
 * Services publish progress (indexing, pushes, analyses) and contribute to
 * the snapshot a client receives when it (re)connects.
 */
@Injectable()
export class EventsService {
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly snapshotProviders = new Map<string, SnapshotProvider>();

  subscribe(userId: string, listener: Listener): () => void {
    const set = this.listeners.get(userId) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(userId, set);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(userId);
    };
  }

  emit(userId: string, type: string, data: unknown) {
    const event: AppEvent = { type, data, at: new Date().toISOString() };
    for (const listener of this.listeners.get(userId) ?? []) {
      try {
        listener(event);
      } catch {
        // A broken connection must not stop delivery to the others.
      }
    }
  }

  registerSnapshot(name: string, provider: SnapshotProvider) {
    this.snapshotProviders.set(name, provider);
  }

  snapshot(userId: string): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [name, provider] of this.snapshotProviders) {
      result[name] = provider(userId);
    }
    return result;
  }
}
