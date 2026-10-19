import { Component, ElementRef, computed, effect, inject, input, output, signal, viewChild } from '@angular/core';
import { RouterLink } from '@angular/router';
import { Api } from '../../core/api';
import { TECHNICAL, attributeLabel, formatValue, nodeIcon } from '../../core/labels';
import { t } from '../../core/i18n';
import { Live } from '../../core/live';
import type { AttributeView, HomeegramSummary } from '../../core/models';
import { Toasts } from '../../core/toast';
import { Icon } from '../../shared/icon';
import { ValueInput } from '../../shared/value-input';

/** Details eines Geräts: alle Werte, Steuerung und die Homeegramme, die es verwenden. */
@Component({
  selector: 'app-device-dialog',
  imports: [Icon, ValueInput, RouterLink],
  template: `
    <dialog #dlg (close)="closed.emit()" (click)="backdrop($event)">
      @if (node(); as n) {
        <header>
          <span class="bubble"><app-icon [name]="icon(n)" [size]="22" /></span>
          <div class="grow">
            <h2>{{ n.name }}</h2>
            <div class="faint small">{{ n.profileName }} · #{{ n.id }} · {{ n.protocol }}
              @if (n.state !== 'Available') { · <span class="badge warn">{{ n.state }}</span> }
            </div>
          </div>
          <button type="button" class="ghost icon" (click)="dlg.close()" [attr.aria-label]="t('Schließen')"><app-icon name="x" /></button>
        </header>

        <div class="body">
          @if (controls().length) {
            <h3>{{ t('Steuern') }}</h3>
            @for (a of controls(); track a.id) {
              <div class="row">
                <span class="label">{{ attributeLabel(a) }}
                  @if (a.target !== a.value) { <span class="badge accent">{{ t('läuft') }}</span> }
                </span>
                <app-value-input [meta]="a" [value]="a.target" [live]="true" [disabled]="busy() === a.id" (valueChange)="set(a, $event)" />
              </div>
            }
          }

          @if (readings().length) {
            <h3>{{ t('Messwerte') }}</h3>
            <dl>
              @for (a of readings(); track a.id) {
                <div><dt>{{ attributeLabel(a) }}</dt><dd>{{ formatValue(a, a.value) }}</dd></div>
              }
            </dl>
          }

          <h3>{{ t('Verwendet in') }}</h3>
          <a class="usage replace" routerLink="/geraete/tauschen" [queryParams]="{ from: n.id }" (click)="dlg.close()">
            <app-icon name="refresh" [size]="15" />
            <span class="grow">{{ t('Gerät ersetzen …') }} <span class="faint small">{{ t('(in allen Homeegrammen durch ein neues Gerät tauschen)') }}</span></span>
            <app-icon name="chevron-right" [size]="15" />
          </a>
          @if (usage(); as u) {
            @for (h of u; track h.id) {
              <a class="usage" [routerLink]="['/homeegramme', h.id]" (click)="dlg.close()">
                <app-icon name="zap" [size]="15" />
                <span class="grow">{{ h.name }}</span>
                @if (!h.active) { <span class="badge">{{ t('inaktiv') }}</span> }
                <app-icon name="chevron-right" [size]="15" />
              </a>
            } @empty {
              <p class="faint small">{{ t('Keinem Homeegramm.') }}</p>
            }
          } @else {
            <p class="faint small">{{ t('Lade …') }}</p>
          }

          <details>
            <summary class="small muted">{{ t('Technische Werte') }} ({{ technical().length }})</summary>
            <dl>
              @for (a of technical(); track a.id) {
                <div><dt>{{ a.typeName }} <span class="faint">#{{ a.id }}</span></dt><dd>{{ formatValue(a, a.value) }}</dd></div>
              }
            </dl>
          </details>
        </div>
      }
    </dialog>
  `,
  styles: `
    header { display: flex; align-items: center; gap: 12px; padding: 18px 18px 14px; border-bottom: 1px solid var(--border); }
    .bubble { width: 44px; height: 44px; border-radius: 12px; display: grid; place-items: center; background: var(--accent-soft); color: var(--accent-text); flex: none; }
    .grow { flex: 1; min-width: 0; }
    .body { padding: 6px 18px 20px; overflow: auto; max-height: calc(100vh - 160px); }
    h3 { font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--text-faint); margin: 18px 0 8px; font-weight: 650; }
    .row { display: flex; flex-direction: column; gap: 6px; padding: 8px 0; border-bottom: 1px solid var(--border); }
    .label { font-weight: 550; display: flex; gap: 8px; align-items: center; }
    dl { margin: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px 16px; }
    dt { font-size: 0.75rem; color: var(--text-faint); }
    dd { margin: 0; font-weight: 550; }
    .usage { display: flex; align-items: center; gap: 10px; padding: 9px 10px; border-radius: 10px; color: var(--text); text-decoration: none; }
    .usage:hover { background: var(--hover); }
    details { margin-top: 18px; }
    details dl { margin-top: 10px; }
    summary { cursor: pointer; }
  `,
})
export class DeviceDialog {
  readonly nodeId = input.required<number>();
  readonly closed = output<void>();

  private readonly live = inject(Live);
  private readonly api = inject(Api);
  private readonly toasts = inject(Toasts);
  private readonly dlg = viewChild.required<ElementRef<HTMLDialogElement>>('dlg');

  protected readonly node = computed(() => this.live.node(this.nodeId()));
  protected readonly usage = signal<HomeegramSummary[] | null>(null);
  protected readonly busy = signal<number | null>(null);

  protected readonly controls = computed(() => (this.node()?.attributes ?? []).filter((a) => a.editable && !TECHNICAL.has(a.typeName)));
  protected readonly readings = computed(() => (this.node()?.attributes ?? []).filter((a) => !a.editable && !TECHNICAL.has(a.typeName)));
  protected readonly technical = computed(() => (this.node()?.attributes ?? []).filter((a) => TECHNICAL.has(a.typeName)));

  protected readonly icon = nodeIcon;
  protected readonly attributeLabel = attributeLabel;
  protected readonly t = t;
  protected readonly formatValue = formatValue;

  constructor() {
    effect(() => {
      const id = this.nodeId();
      this.usage.set(null);
      this.api.nodeUsage(id).then((u) => this.usage.set(u), () => this.usage.set([]));
    });
    effect(() => {
      const d = this.dlg().nativeElement;
      if (!d.open) d.showModal();
    });
  }

  protected backdrop(e: MouseEvent): void {
    if (e.target === this.dlg().nativeElement) this.dlg().nativeElement.close();
  }

  protected async set(a: AttributeView, v: number): Promise<void> {
    this.busy.set(a.id);
    await this.toasts.run(() => this.api.setValue(a.nodeId, a.id, v));
    this.busy.set(null);
  }
}
