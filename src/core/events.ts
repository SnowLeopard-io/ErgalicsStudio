// ==========================================================================
// Typed event bus — used for plugin↔plugin and plugin↔host communication
// (spec §6.2, publish/subscribe model).
// ==========================================================================

export type EventHandler<T> = (payload: T) => void;

const handlers = new Map<string, Set<EventHandler<unknown>>>();

const pluginChannels = new Map<string, Set<string>>();

export interface BusSubscription {
  unsubscribe(): void;
}

export function emit<T>(channel: string, payload: T): void {
  const set = handlers.get(channel);
  if (!set) return;
  for (const handler of [...set]) {
    try {
      handler(payload);
    } catch (err) {
      console.error(`[bus] handler for "${channel}" threw`, err);
    }
  }
}

export function on<T>(channel: string, handler: EventHandler<T>): BusSubscription {
  let set = handlers.get(channel);
  if (!set) {
    set = new Set();
    handlers.set(channel, set);
  }
  const h = handler as EventHandler<unknown>;
  set.add(h);
  return {
    unsubscribe() {
      const s = handlers.get(channel);
      if (s) s.delete(h);
    },
  };
}

export function once<T>(channel: string, handler: EventHandler<T>): BusSubscription {
  const sub = on<T>(channel, (payload) => {
    sub.unsubscribe();
    handler(payload);
  });
  return sub;
}

/** Remove all handlers on a channel (used when unloading plugins). */
export function clearChannel(channel: string): void {
  handlers.delete(channel);
}

// ---- plugin-scoped channels ----
// A plugin owns a namespace so it can emit/receive without colliding.

export function pluginChannel(pluginId: string, name: string): string {
  return `plugin:${pluginId}:${name}`;
}

export function registerPluginChannel(pluginId: string): string[] {
  // A plugin "owns" every `plugin:<id>:` channel (spec §6.2). Actual channels
  // are created lazily via pluginChannel(); registration is advisory.
  const base = [pluginChannel(pluginId, '*')];
  pluginChannels.set(pluginId, new Set(base));
  return base;
}

export function clearPluginChannels(pluginId: string): void {
  // Delete every handler registered under this plugin's namespace. The old
  // implementation only cleared the literal "*" pseudo-channel, which no one
  // ever emits on, so plugin handlers survived unloading the plugin.
  const prefix = `plugin:${pluginId}:`;
  for (const channel of handlers.keys()) {
    if (channel.startsWith(prefix)) {
      clearChannel(channel);
    }
  }
  pluginChannels.delete(pluginId);
}