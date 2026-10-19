import { Injectable, computed, inject, signal } from '@angular/core';
import { Api } from './api';
import type { AttributeView, GroupView, HomeegramView, NodeView, Status } from './models';

/** Hält Status, Geräte, Gruppen und Homeegramme aktuell (REST + Live-Ereignisse vom Backend). */
@Injectable({ providedIn: 'root' })
export class Live {
  private readonly api = inject(Api);
  private source: EventSource | null = null;

  readonly status = signal<Status | null>(null);
  /** Alle Nodes inkl. homee selbst (id -1). */
  readonly allNodes = signal<NodeView[]>([]);
  /** Echte Geräte (ohne homee selbst). */
  readonly nodes = computed(() => this.allNodes().filter((n) => n.id !== -1));
  readonly groups = signal<GroupView[]>([]);
  readonly homeegrams = signal<HomeegramView[]>([]);
  readonly error = signal<string | null>(null);
  readonly loading = signal(false);
  readonly loaded = signal(false);

  readonly readOnly = computed(() => this.status()?.readOnly ?? false);

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      this.status.set(await this.api.status());
      const [nodes, groups, homeegrams] = await Promise.all([this.api.nodes(), this.api.groups(), this.api.homeegrams()]);
      this.allNodes.set(nodes);
      this.groups.set(groups);
      this.homeegrams.set(homeegrams);
      this.error.set(null);
      this.loaded.set(true);
    } catch (err) {
      this.error.set((err as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  start(): void {
    void this.load();
    this.connectEvents();
  }

  connectEvents(): void {
    this.source?.close();
    const es = new EventSource(this.api.eventsUrl());
    this.source = es;

    es.addEventListener('attribute', (e) => this.applyAttribute(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('homeegram', (e) => this.applyHomeegram(JSON.parse((e as MessageEvent).data)));
    es.addEventListener('state', () => void this.load());
    es.addEventListener('connection', (e) => {
      const { connected } = JSON.parse((e as MessageEvent).data);
      this.status.update((s) => (s ? { ...s, connected } : s));
      if (connected) void this.load();
    });
  }

  node(id: number): NodeView | undefined {
    return this.allNodes().find((n) => n.id === id);
  }

  attribute(id: number): AttributeView | undefined {
    for (const n of this.allNodes()) {
      const a = n.attributes.find((x) => x.id === id);
      if (a) return a;
    }
    return undefined;
  }

  private applyAttribute(a: AttributeView): void {
    this.allNodes.update((nodes) =>
      nodes.map((n) =>
        n.id !== a.nodeId ? n : { ...n, attributes: n.attributes.map((x) => (x.id === a.id ? a : x)) },
      ),
    );
  }

  applyHomeegram(h: HomeegramView): void {
    this.homeegrams.update((list) => {
      const i = list.findIndex((x) => x.id === h.id);
      return i < 0 ? [...list, h] : list.map((x) => (x.id === h.id ? h : x));
    });
  }

  removeHomeegram(id: number): void {
    this.homeegrams.update((list) => list.filter((x) => x.id !== id));
  }
}
