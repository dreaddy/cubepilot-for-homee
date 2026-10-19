import { Component, computed, input, output } from '@angular/core';
import { t } from '../core/i18n';
import { controlLabels, unitOf } from '../core/labels';

export interface ValueMeta {
  typeName: string;
  min: number;
  max: number;
  step: number;
  unit: string;
}

/** Eingabe für einen Attributwert: Segmente (bekannte Werte), Regler oder Zahlenfeld. */
@Component({
  selector: 'app-value-input',
  template: `
    @switch (mode()) {
      @case ('segments') {
        <div class="segmented">
          @for (o of options(); track o.value) {
            <button type="button" [class.on]="o.value === value()" [disabled]="disabled()" (click)="emit(o.value)">{{ o.label }}</button>
          }
        </div>
      }
      @case ('slider') {
        <div class="slider">
          <input
            type="range"
            [min]="meta().min"
            [max]="meta().max"
            [step]="step()"
            [value]="value() ?? meta().min"
            [disabled]="disabled()"
            (input)="preview($any($event.target).value)"
            (change)="emit($any($event.target).value)"
          />
          <div class="input-unit">
            <input type="number" [min]="meta().min" [max]="meta().max" [step]="step()" [value]="value()" [disabled]="disabled()" (change)="emit($any($event.target).value)" />
            @if (unit()) { <span>{{ unit() }}</span> }
          </div>
        </div>
      }
      @default {
        <div class="input-unit">
          <input type="number" [step]="step()" [value]="value()" [disabled]="disabled()" (change)="emit($any($event.target).value)" />
          @if (unit()) { <span>{{ unit() }}</span> }
        </div>
      }
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .slider { display: flex; align-items: center; gap: 12px; }
    .slider input[type='range'] { flex: 1; }
    .slider .input-unit { width: 120px; flex: none; }
    .input-unit input { width: 100%; }
  `,
})
export class ValueInput {
  readonly meta = input.required<ValueMeta>();
  readonly value = input<number | null>(null);
  readonly disabled = input(false);
  /** live: Regler sendet erst beim Loslassen; form: jede Änderung wird gemeldet */
  readonly live = input(false);
  readonly valueChange = output<number>();
  /** Zwischenwerte beim Ziehen (nur Anzeige) */
  readonly previewChange = output<number>();

  protected readonly unit = computed(() => unitOf(this.meta()));
  protected readonly step = computed(() => this.meta().step || (this.meta().max - this.meta().min <= 2 ? 0.1 : 1));

  /** Bekannte Werte mit Bezeichnung; 0/1-Attribute ohne Bezeichnung werden zu „Aus/An“. */
  protected readonly options = computed(() => {
    const labels = controlLabels(this.meta().typeName);
    const { min, max } = this.meta();
    if (!labels) return min === 0 && max === 1 ? [{ value: 0, label: t('Aus') }, { value: 1, label: t('An') }] : [];
    const known = min !== max && Number.isFinite(min) && Number.isFinite(max);
    return Object.entries(labels)
      .map(([v, label]) => ({ value: Number(v), label }))
      .filter((o) => !known || (o.value >= min && o.value <= max));
  });

  protected readonly mode = computed(() => {
    const m = this.meta();
    if (this.options().length >= 2) return 'segments';
    if (Number.isFinite(m.min) && Number.isFinite(m.max) && m.max > m.min && m.max - m.min <= 1000) return 'slider';
    return 'number';
  });

  protected preview(v: string): void {
    this.previewChange.emit(Number(v));
    if (!this.live()) this.valueChange.emit(Number(v));
  }

  protected emit(v: string | number): void {
    const n = Number(v);
    if (Number.isFinite(n)) this.valueChange.emit(n);
  }
}
