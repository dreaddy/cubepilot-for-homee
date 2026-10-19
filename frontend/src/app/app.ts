import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { Api } from './core/api';
import { lang, setLang, t } from './core/i18n';
import { Live } from './core/live';
import { Toasts } from './core/toast';
import { Icon } from './shared/icon';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, RouterLink, RouterLinkActive, Icon],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly live = inject(Live);
  protected readonly toasts = inject(Toasts);
  private readonly api = inject(Api);
  protected readonly t = t;
  protected readonly lang = lang;
  protected readonly setLang = setLang;

  constructor() {
    this.live.start();
  }

  protected setKey(): void {
    const key = prompt(t('API-Schlüssel (API_TOKEN aus der .env; leer lassen, wenn keiner gesetzt ist):'), this.api.apiKey());
    if (key === null) return;
    this.api.setApiKey(key.trim());
    this.live.start();
  }
}
