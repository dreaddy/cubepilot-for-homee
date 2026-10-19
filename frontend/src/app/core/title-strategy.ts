import { Injectable, effect, inject } from '@angular/core';
import { Title } from '@angular/platform-browser';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { lang, t } from './i18n';

/** Übersetzt die Seitentitel aus den Routen und hängt „CubePilot for homee“ an; reagiert auf Sprachwechsel. */
@Injectable({ providedIn: 'root' })
export class TranslatedTitleStrategy extends TitleStrategy {
  private readonly title = inject(Title);
  private current: string | undefined;

  constructor() {
    super();
    effect(() => {
      lang();
      this.apply();
    });
  }

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.current = this.buildTitle(snapshot);
    this.apply();
  }

  private apply(): void {
    this.title.setTitle(this.current ? `${t(this.current)} · CubePilot for homee` : 'CubePilot for homee');
  }
}
