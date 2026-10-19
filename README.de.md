# CubePilot for homee

[English](README.md) · **Deutsch**

Steuere dein [homee](https://hom.ee)-Smart-Home außerhalb der homee-App: eine schnelle Weboberfläche für Geräte und
Homeegramme (die Automationen von homee) und ein [MCP](https://modelcontextprotocol.io)-Server, mit dem KI-Assistenten
wie Claude deine Einrichtung in normaler Sprache lesen und bearbeiten können.

Die Verbindung läuft über dieselbe WebSocket-Schnittstelle wie die offizielle App – lokal im Heimnetz oder über die
homee-Cloud.

> **Inoffizielles Projekt.** Keine Verbindung zur homee GmbH und nicht von ihr unterstützt. Die homee-Schnittstelle ist
> nicht dokumentiert und kann sich mit jedem Firmware-Update ändern. Nutzung auf eigenes Risiko – die automatischen
> Sicherungen bitte eingeschaltet lassen.

## Funktionen

### Weboberfläche: Geräte steuern
- Geräteübersicht nach Kategorien (Rollläden, Licht, Heizung, Steckdosen, Sicherheit, Sensoren, Fernbedienungen)
- Bedienelemente passend zum Gerät: Schalter, Dimmer- und Positionsregler, Auf/Stopp/Zu für Rollläden,
  Solltemperatur mit −/+, Ver- und Entriegeln mit Rückfrage
- Live-Aktualisierung per Server-Sent Events – Werte ändern sich, sobald homee sie meldet
- Gerätedetails: alle Werte, Messwerte und technischen Attribute sowie die Homeegramme, die das Gerät verwenden
- Suche und Kategoriefilter

### Weboberfläche: Homeegramme bearbeiten
- Liste aller Homeegramme mit lesbarer Kurzfassung von Auslösern, Bedingungen und Aktionen
- Suche nach Name, Gerät oder Uhrzeit; Filter aktiv/inaktiv; Sortierung nach Name oder letzter Ausführung
- Ausführen, Aktivieren und Deaktivieren mit einem Klick (Ausführen mit Rückfrage)
- Visueller Editor für Auslöser, Bedingungen und Aktionen: Zeitpläne (täglich, Wochentage, Intervall, einmalig),
  Sonnenauf-/-untergang mit Versatz, Geräte- und Gruppenwerte, andere Homeegramme, Webhooks, Push-Nachrichten, Tageszeit
- Zeitpläne werden in Ortszeit bearbeitet und mit dem am bearbeiteten Datum geltenden Versatz in UTC umgerechnet
- Änderungen werden als Entwurf gesammelt, vor dem Speichern geprüft und als ein Änderungspaket an homee geschickt
- Homeegramme anlegen, duplizieren, umbenennen und löschen

### Sicherung und Wiederherstellung
- Jede Sicherung enthält alle Homeegramme, Geräte und Gruppen als JSON-Datei in `data/backups/`
- Jede Sicherung lässt sich mit dem aktuellen Stand vergleichen: Jedes Homeegramm wird als unverändert, geändert,
  gelöscht oder neu angezeigt, mit Vorher/Nachher
- Einzelne oder mehrere Homeegramme wiederherstellen; gelöschte werden neu angelegt, und Verweise zwischen
  Homeegrammen (z. B. „Homeegramm X aktivieren“) werden auf die neuen IDs umgestellt
- Sicherungen herunterladen oder von einem anderen Rechner hochladen
- Automatische Sicherungen sind begrenzt (die neuesten 200 bleiben); manuelle und hochgeladene werden nie gelöscht

### Geräte tauschen
- Ein altes Gerät in **allen** Homeegrammen in einem Schritt durch ein neues ersetzen – nach einem neuen Schloss oder
  Sensor oder wenn nach einem Router-Wechsel alle Heizkörper neu angelernt werden mussten
- Mehrere Paare alt → neu auf einmal; neue Geräte gleichen Typs, die noch nirgends verwendet werden, stehen oben
- Attribute werden nach Typ (und Instanz, z. B. Fernbedienungstasten) zugeordnet; was am neuen Gerät fehlt, wird als
  Warnung angezeigt
- Optional werden Gruppenmitgliedschaften (z. B. „Heizungen“) und der Gerätename übernommen (das alte Gerät bekommt
  „(alt)“)
- Vollständige Vorschau, bevor sich etwas ändert; vorher wird gesichert

### KI-Steuerung per MCP
- Ein MCP-Server (stdio), der dein homee für Claude Code, Claude Desktop oder andere MCP-Clients bereitstellt
- Fragen zur Einrichtung stellen, Geräte schalten oder Automationen in normaler Sprache anlegen und ändern
- Schreibzugriffe laufen über dasselbe Backend wie die Oberfläche – Sicherungen, Nur-Lesen-Modus und
  Änderungsprotokoll gelten also auch für die KI

### Sicherheit und Nachvollziehbarkeit
- Automatische Sicherungen vor Änderungen an Homeegrammen (höchstens alle 2 Minuten, vor dem Löschen immer) plus
  manuelle Sicherungen
- Änderungsprotokoll aller Schreibzugriffe aus Oberfläche, KI und REST-API, mit Quelle und Details
- Nur-Lesen-Modus, der jeden Schreibzugriff auf homee blockiert
- Optionaler API-Schlüssel; Pflicht, sobald das Backend nicht nur auf localhost lauscht
- Optionale Konsole für Rohbefehle zum Erkunden der homee-Schnittstelle (standardmäßig aus)

### Weiteres
- Oberfläche auf Englisch (Standard) und Deutsch, umschaltbar unten in der Seitenleiste (DE/EN); die Wahl wird gemerkt
- Funktioniert lokal (homee-IP) oder über die homee-Cloud (homee-ID)
- REST-API mit Live-Ereignissen, nutzbar aus eigenen Skripten
- Werteverlauf von Geräten und das homee-Tagebuch, über API und MCP abrufbar

## Aufbau

```
packages/homee-client   Gemeinsamer TypeScript-Client: Anmeldung, WebSocket, Zustand, lesbare Ansichten
backend                 Fastify-REST-API + Live-Ereignisse (SSE), Sicherungen, Änderungsprotokoll → Port 5311
frontend                Angular-Oberfläche: Geräte, Homeegramme, Sicherungen, Gerätetausch, Verlauf → Port 5310
mcp                     MCP-Server (stdio) für KI-Assistenten; spricht mit dem Backend
```

```
 Browser ──► frontend ──┐
                        ├──► backend ──► homee-client ──WebSocket──► homee (lokal oder Cloud)
 KI-Client ──► mcp ─────┘
```

## Voraussetzungen

- Empfohlen: Node.js ab 24.15 (außerdem unterstützt: ab 22.22.3 innerhalb Node 22 oder ab Node 26)
- Ein homee mit einem **eigenen Benutzer** für dieses Tool (in der homee-App anlegen). homee erlaubt nur eine
  Verbindung pro Gerätename – daher nicht den Login der App unter demselben Gerätenamen verwenden.

## Loslegen

```bash
git clone https://github.com/dreaddy/cubepilot-for-homee.git
cd cubepilot-for-homee
npm run setup          # Abhängigkeiten installieren, dann homee-Zugang abfragen und .env schreiben
npm run probe          # Verbindung testen: listet Geräte und Homeegramme
npm start              # Backend + Frontend → http://localhost:5310
```

`npm run setup` startet einen kurzen Einrichtungsassistenten: lokal (homee-IP) oder Cloud (homee-ID), Benutzername
und Passwort. Die Anmeldung wird getestet, bevor `.env` geschrieben wird, die homee-ID wird automatisch ergänzt.
`npm start`, `npm run serve` und `npm run probe` starten den Assistenten ebenfalls, wenn `.env` fehlt. Mit
`npm run configure` lässt sich der Zugang später ändern; übrige Einstellungen in `.env` bleiben erhalten. Dasselbe geht
in der Oberfläche unter **Einrichtung** (kleiner Link unten in der Seitenleiste): Anmeldung testen, `.env` schreiben
und das Backend ohne Neustart neu verbinden. Ein eigener homee-Benutzer wird empfohlen, der Admin-Zugang funktioniert
aber auch.

Für einen einzelnen Prozess baut `npm run serve` das Frontend und liefert alles über das Backend auf Port 5311 aus.
`npm start` verwendet ein bereits laufendes Backend weiter (z. B. eines, das der MCP-Server gestartet hat).

Für VS Code gibt es fertige Tasks und Startkonfigurationen in `.vscode/` (alles starten oder das Backend mit
Haltepunkten debuggen).

## Konfiguration

Alle Einstellungen stehen in `.env` (wird von Git ignoriert). Siehe [.env.example](.env.example).

| Variable | Bedeutung |
|---|---|
| `HOMEE_MODE` | `local` (Heimnetz, nutzt `HOMEE_IP`) oder `remote` (homee-Cloud, nutzt `HOMEE_ID`, funktioniert überall) |
| `HOMEE_IP` | IP-Adresse des homee (lokaler Modus) |
| `HOMEE_ID` | 12-stellige homee-ID, in der homee-App unter Einstellungen → homee (Cloud-Modus) |
| `HOMEE_USER` / `HOMEE_PASSWORD` | der für dieses Tool angelegte homee-Benutzer |
| `HOMEE_DEVICE_NAME` | Gerätename in homee; pro Name ist nur eine Verbindung erlaubt |
| `BACKEND_HOST` / `BACKEND_PORT` | Standard `127.0.0.1:5311`. Jeder andere Host erfordert `API_TOKEN` |
| `API_TOKEN` | optionaler Schlüssel, wird als Header `x-api-key` gesendet. In der Oberfläche unter **Schlüssel** eintragen |
| `READ_ONLY` | `true` blockiert alle Schreibzugriffe auf homee |
| `KEEP_AUTO_BACKUPS` | Anzahl aufzubewahrender automatischer Sicherungen, Standard `200` |
| `MCP_AUTOSTART_BACKEND` | `true` (Standard): Der MCP-Server startet das Backend, wenn es nicht läuft (nur lokale Adresse) |
| `ALLOW_RAW` | `true` erlaubt Rohbefehle (Konsole und `homee_raw_command`) |
| `HOMEE_BACKEND_URL` | Backend-Adresse für den MCP-Server, Standard `http://127.0.0.1:5311` |

## KI-Anbindung (MCP)

Der MCP-Server liest `.env` selbst. Läuft das Backend nicht, startet es der erste MCP-Befehl im Hintergrund
(Log: `data/backend.log`) und wartet, bis es mit homee verbunden ist. Danach läuft es weiter, sodass auch die
Oberfläche erreichbar bleibt; beenden mit `npm run stop`. Mit `MCP_AUTOSTART_BACKEND=false` lässt sich das abschalten.

**Claude Code:** Der Server ist bereits in [.mcp.json](.mcp.json) eingetragen. Projektordner öffnen und den Server
freigeben, wenn Claude Code fragt.

**Claude Desktop:** Folgendes in `claude_desktop_config.json` eintragen, mit dem absoluten Pfad zum Projekt:

```json
{
  "mcpServers": {
    "cubepilot": {
      "command": "npx",
      "args": ["tsx", "/pfad/zu/cubepilot-for-homee/mcp/src/index.ts"]
    }
  }
}
```

### Werkzeuge

| Werkzeug | Zweck |
|---|---|
| `homee_status` | Verbindungsstatus, homee-Version, Nur-Lesen-Modus |
| `homee_list_devices`, `homee_get_device` | Geräte mit Attributen und aktuellen Werten |
| `homee_set_attribute` | schalten, dimmen, fahren oder einen Gerätewert setzen |
| `homee_list_homeegrams`, `homee_get_homeegram` | Übersicht und Details, optional roh |
| `homee_play_homeegram`, `homee_set_homeegram_active` | ausführen, aktivieren oder deaktivieren |
| `homee_create_homeegram`, `homee_update_homeegram`, `homee_delete_homeegram` | anlegen, umbenennen oder ändern, löschen |
| `homee_add_homeegram_item`, `homee_update_homeegram_item`, `homee_delete_homeegram_item` | einzelne Auslöser, Bedingungen und Aktionen bearbeiten |
| `homee_save_homeegram_changes` | mehrere Änderungen in einem Schritt anwenden |
| `homee_catalog` | Zahlencodes für Eintragsarten, Operatoren und Attribute |
| `homee_history`, `homee_diary` | Werteverlauf von Geräten und Homeegrammen, homee-Tagebuch |
| `homee_backup`, `homee_list_backups` | Sicherungen anlegen und auflisten |
| `homee_compare_backup`, `homee_restore_homeegrams` | Sicherung mit aktuellem Stand vergleichen, Homeegramme wiederherstellen |
| `homee_swap_devices_preview`, `homee_swap_devices` | Gerätetausch in allen Homeegrammen ansehen und ausführen |
| `homee_raw_command` | Rohbefehl an homee (nur mit `ALLOW_RAW=true`) |

### Beispiele

- *„Welche Homeegramme schließen abends die Rollläden?“*
- *„Verschiebe das Homeegramm fürs Morgenlicht auf 7:45 Uhr.“*
- *„Leg ein Homeegramm an, das um 22 Uhr alle Lichter ausschaltet.“*
- *„Ist gerade irgendwo ein Fenster offen?“*
- *„Ich habe das Heizkörperthermostat im Bad getauscht – ersetz das alte überall durch das neue.“*
- *„Wie sahen die Abend-Homeegramme in der Sicherung von gestern aus? Stell sie wieder her.“*

## REST-API

Das Backend stellt alles unter `/api` bereit. Bei gesetztem `API_TOKEN` den Header `x-api-key` mitschicken.

| Methode & Pfad | Zweck |
|---|---|
| `GET /api/status` | Verbindungs- und Konfigurationsstatus |
| `GET /api/nodes`, `GET /api/nodes/:id` | Geräte |
| `PUT /api/nodes/:id/attributes/:attributeId` | Wert setzen (`{ "value": 1 }`) |
| `GET /api/nodes/:id/usage` | Homeegramme, die ein Gerät verwenden |
| `GET /api/groups` | Gruppen |
| `GET /api/homeegrams`, `GET /api/homeegrams/:id` | Homeegramme (`?full=1`, `?raw=1`) |
| `POST /api/homeegrams` | Homeegramm anlegen |
| `PATCH /api/homeegrams/:id` | Felder wie den Namen ändern |
| `POST /api/homeegrams/:id/changes` | Änderungspaket anwenden (Einträge hinzufügen, ändern, entfernen) |
| `POST /api/homeegrams/:id/play`, `/test` | ausführen oder Testlauf |
| `PUT /api/homeegrams/:id/active` | aktivieren oder deaktivieren |
| `DELETE /api/homeegrams/:id` | löschen (vorher wird gesichert) |
| `POST`/`PUT`/`DELETE /api/homeegrams/:id/:kind[/:itemId]` | einzelne Einträge bearbeiten |
| `GET /api/history/:kind/:id`, `GET /api/diary` | Verlauf und Tagebuch |
| `GET`/`POST /api/backups`, `GET /api/backups/:file` | Sicherungen auflisten, anlegen und herunterladen |
| `GET /api/backups/:file/homeegrams` | Sicherung mit aktuellem Stand vergleichen |
| `POST /api/backups/:file/restore` | Homeegramme wiederherstellen (`{ "ids": [1, 2] }`) |
| `POST /api/backups/import` | Sicherungsdatei hochladen |
| `POST /api/swap/preview`, `POST /api/swap/apply` | Gerätetausch (`{ "pairs": [{ "from": 12, "to": 34 }], "groups": true, "rename": true }`) |
| `GET /api/audit` | Änderungsprotokoll |
| `GET /api/catalog` | Zahlencodes |
| `GET /api/events` | Live-Ereignisse (Server-Sent Events) |
| `POST /api/raw` | Rohbefehl (nur mit `ALLOW_RAW=true`) |

## Gut zu wissen

- **Sommer-/Winterzeit:** Wiederkehrende Zeitpläne verwenden eine feste UTC-Uhrzeit. Nach einem Zeitwechsel kann
  sich die lokale Ausführung verschieben. Soll die Ortszeit gleich bleiben, den Zeitplan prüfen und erneut speichern.
- **Änderungspakete laufen schrittweise, ohne Transaktion.** Bei einem Fehler können einzelne Schritte bereits
  angewendet sein. Die Oberfläche meldet Teilergebnisse; der vorherige Stand lässt sich über die Sicherung prüfen
  und wiederherstellen.
- **Einzelne Einträge eines Homeegramms ändern und löschen** (`PUT`/`DELETE homeegrams/<id>/<art>/<eintrag>`) ist von
  homee nicht dokumentiert, funktioniert aber (getestet mit homee 2.41: anlegen, umbenennen, Einträge
  hinzufügen/ändern/löschen, löschen).
- **Zeitpläne** speichert homee als iCal-RRULE mit Uhrzeit in **UTC** (11:30 MESZ = `BYHOUR=9;BYMINUTE=30`).
  Beim Ändern einer Uhrzeit muss `dtstart` mit angepasst werden, sonst rechnet homee die nächste Ausführung ab dem
  alten Startzeitpunkt. Oberfläche und Backend erledigen das automatisch.
- **Tageszeit-Bedingungen** akzeptieren nur *Tag* und *Nacht*; Morgen, Mittag, Abend usw. lehnt homee ab.
- Eine Homeegramm-Aktion kann ein anderes Homeegramm aktivieren oder deaktivieren, aber nicht abspielen. Zum Verketten
  stattdessen den Auslöser „Homeegramm wurde abgespielt“ nutzen – er greift bei jeder Ausführung und nicht, wenn die
  Bedingungen nicht erfüllt waren.
- Bedingungen mit Prüfung **„beim Start und am Ende“** stoppen auch verzögerte Aktionen, wenn sie nach Ablauf der
  Verzögerung nicht mehr erfüllt sind.
- Das homee-eigene **Tagebuch** behält nur die neuesten Einträge. Homeegramme, die jede Minute laufen, verdrängen ältere
  Einträge schnell – besser Ereignis-Auslöser (z. B. „homee-Modus wird …“) statt Minuten-Zeitplänen verwenden.
- Mit der **Konsole** (bei `ALLOW_RAW=true`) lassen sich weitere API-Befehle erkunden; `GET:`-Befehle lesen nur.
- Sicherungen landen in `data/backups/`, das Änderungsprotokoll in `data/audit.jsonl`. Der Ordner `data/` wird von Git
  ignoriert.

## Sicherheit

- Zugangsdaten bleiben in `.env`, die nie eingecheckt wird.
- Standardmäßig lauscht das Backend nur auf `127.0.0.1`. Wenn du es freigibst, `API_TOKEN` setzen und HTTPS davorschalten.
- `ALLOW_RAW=false` lassen, solange du die Schnittstelle nicht gezielt erkundest.
- Dem homee-Benutzer für dieses Tool nur die nötigen Rechte geben.

## Entwicklungsprüfungen

Nach Installation der Abhängigkeiten im Hauptverzeichnis und im Frontend:

```bash
npm test              # Regressionstests ohne homee-Verbindung oder Gerätebefehle
npm run typecheck
npm run build
npm audit
npm audit --prefix frontend
```

## Danksagung

Die Zahlencodes der homee-Schnittstelle (Enum-Tabellen) stammen aus der offiziellen homee-Web-App unter
[my.hom.ee](https://my.hom.ee/), die sie in ihrem JavaScript mitliefert. Nach einem homee-Update lassen sie sich mit
`npm run update-enums` aktualisieren: Das Skript lädt die Web-App, liest das Objekt `ENUMS` als reine Daten (es wird
nichts ausgeführt) und erzeugt `packages/homee-client/src/enums.ts` neu. Danke an Micha für den Hinweis.

Die erste Fassung der Tabellen stammte aus [homee-api](https://github.com/stfnhmplr/homee-api) von stfnhmplr (MIT).
Der Lizenzhinweis steht in [THIRD_PARTY_NOTICES](THIRD_PARTY_NOTICES).

## Lizenz

[MIT](LICENSE)
