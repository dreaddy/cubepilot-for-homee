import { Injectable, signal } from '@angular/core';

export interface Toast {
  id: number;
  text: string;
  kind: 'ok' | 'error';
}

@Injectable({ providedIn: 'root' })
export class Toasts {
  readonly items = signal<Toast[]>([]);
  private next = 1;

  ok(text: string): void {
    this.push(text, 'ok');
  }

  error(err: unknown): void {
    this.push(err instanceof Error ? err.message : String(err), 'error');
  }

  /** Führt eine Aktion aus und meldet Erfolg oder Fehler. */
  async run<T>(fn: () => Promise<T>, success?: string): Promise<T | undefined> {
    try {
      const r = await fn();
      if (success) this.ok(success);
      return r;
    } catch (err) {
      this.error(err);
      return undefined;
    }
  }

  dismiss(id: number): void {
    this.items.update((l) => l.filter((t) => t.id !== id));
  }

  private push(text: string, kind: Toast['kind']): void {
    const id = this.next++;
    this.items.update((l) => [...l, { id, text, kind }]);
    setTimeout(() => this.dismiss(id), kind === 'error' ? 8000 : 3000);
  }
}
