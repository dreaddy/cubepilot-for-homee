import { Injectable, inject } from '@angular/core';
import type { ModelContext } from './homeegram-model';
import { Live } from './live';
import type { AttributeView } from './models';

/** Verbindet das Editor-Modell mit den aktuellen Daten (Geräte, Gruppen, Homeegramme). */
@Injectable({ providedIn: 'root' })
export class ModelCtx implements ModelContext {
  private readonly live = inject(Live);

  node = (id: number) => this.live.node(id);
  attribute = (id: number) => this.live.attribute(id);
  group = (id: number) => this.live.groups().find((g) => g.id === id);
  homeegramName = (id: number) => this.live.homeegrams().find((h) => h.id === id)?.name;

  groupTypes = (groupId: number) => {
    const g = this.group(groupId);
    const seen = new Map<number, { type: number; typeName: string; sample: AttributeView }>();
    for (const nodeId of g?.nodeIds ?? []) {
      for (const a of this.live.node(nodeId)?.attributes ?? []) {
        if (!seen.has(a.type)) seen.set(a.type, { type: a.type, typeName: a.typeName, sample: a });
      }
    }
    return [...seen.values()];
  };
}
