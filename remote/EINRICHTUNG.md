# Fernzugang: homee per ChatGPT vom Handy steuern

> **Derzeit deaktiviert.** Der Code bleibt erhalten, ist aber nicht in den npm-Skripten, der `.env.example` oder der
> README. Zum Einschalten: Variablen aus dieser Anleitung in die `.env` eintragen, `REMOTE_ENABLED=true` setzen und
> `npm run dev -w remote` starten.

Der Dienst `remote/` gibt einem eigenen GPT in ChatGPT Zugriff auf homee – aber nur auf das, was ein eigener,
eingeschränkter homee-Benutzer darf. Die volle lokale Steuerung (Backend, MCP, Oberfläche) bleibt im Heimnetz.

```
ChatGPT (Handy) ──► OpenAI ──HTTPS──► Cloudflare Tunnel ──► remote (127.0.0.1:5312) ──► homee
                                                           Benutzer „remote“ (Kleiner homee)
```

## 1. homee-Benutzer anlegen

In der homee-App unter **Einstellungen → Benutzer** einen neuen Benutzer anlegen, z. B. `remote`:

- Rolle **Kleiner homee**
- Nur die Geräte (und ggf. Homeegramme) freischalten, die vom Handy aus steuerbar sein sollen

Zugangsdaten in die `.env` eintragen:

```
REMOTE_HOMEE_USER=remote
REMOTE_HOMEE_PASSWORD=…
```

Einen eigenen Schlüssel erzeugen:

```
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Zusätzlich in `.env` eintragen:

```
REMOTE_ENABLED=true
REMOTE_API_KEY=<selbst erzeugter Schlüssel, mindestens 32 Zeichen>
REMOTE_PORT=5312
REMOTE_RATE_LIMIT=30
REMOTE_PUBLIC_URL=https://homee.deine-domain.de
```

Der Schlüssel ist das Passwort des GPT – nicht weitergeben. `READ_ONLY=true` blockiert auch diesen Fernzugang.

Testen: `npm run dev -w remote` starten, dann

```
curl -H "Authorization: Bearer <REMOTE_API_KEY>" http://127.0.0.1:5312/devices
```

Es dürfen nur die freigeschalteten Geräte erscheinen.

## 2. Cloudflare Tunnel

```
winget install Cloudflare.cloudflared
```

**Schnelltest** (zufällige Adresse, ändert sich bei jedem Start – nur zum Ausprobieren):

```
cloudflared tunnel --url http://127.0.0.1:5312
```

Die angezeigte `https://….trycloudflare.com`-Adresse als `REMOTE_PUBLIC_URL` in die `.env` eintragen und `remote`
neu starten.

**Dauerhaft** (feste Adresse, braucht ein kostenloses Cloudflare-Konto und eine Domain, die bei Cloudflare liegt):

```
cloudflared tunnel login
cloudflared tunnel create homee
cloudflared tunnel route dns homee homee.deine-domain.de
cloudflared tunnel run --url http://127.0.0.1:5312 homee
```

Dann `REMOTE_PUBLIC_URL=https://homee.deine-domain.de`. Als Windows-Dienst: `cloudflared service install`.

Nach außen geht nur `remote`. Backend (5311) und Oberfläche (5310) bleiben lokal.

## 3. GPT in ChatGPT anlegen

ChatGPT → **GPTs → Erstellen → Konfigurieren** (braucht ein bezahltes ChatGPT-Abo):

- **Name:** z. B. „Mein Zuhause“
- **Anweisungen:** Text aus dem Abschnitt unten einfügen
- **Aktionen → Neue Aktion erstellen → Von URL importieren:** `https://<REMOTE_PUBLIC_URL>/openapi.json`
- **Authentifizierung:** API-Schlüssel, Typ **Bearer**, Schlüssel = `REMOTE_API_KEY`
- **Freigabe:** „Nur ich“

Danach in der ChatGPT-App auf dem Handy den GPT öffnen – auch im Sprachmodus.

### Anweisungen für den GPT

```
Du steuerst mein Smart Home (homee). Antworte kurz auf Deutsch.

- Rufe vor jeder Steuerung listDevices auf und ordne Raum-/Gerätenamen den IDs zu. Gerätenamen sind meist Räume
  (z. B. „Bad oben“, „Küche“, „wz Fenster“ = Wohnzimmer Fenster).
- Rollladen: Position 0 = ganz offen („hoch“, „auf“), 100 = ganz geschlossen („runter“, „zu“), Zwischenwerte in %.
  Stoppen: UpDown = 2.
- Heizung: TargetTemperature in °C, innerhalb von min/max.
- Mehrere Geräte („alle Rollläden“, „oben“) in einem controlDevices-Aufruf mit mehreren Befehlen.
- Ist unklar, welches Gerät gemeint ist, frag kurz nach, statt zu raten.
- Bestätige nach dem Ausführen in einem Satz, was passiert ist. Rollläden brauchen bis zu 30 Sekunden.
- Wenn homee etwas ablehnt, sag das ehrlich – der Zugang ist absichtlich eingeschränkt.
```

## Sicherheit

- Rechte vergibt homee (Benutzer „Kleiner homee“). Der Dienst kann nichts, was dieser Benutzer nicht darf.
- Ohne gültigen Schlüssel wird jede Anfrage abgewiesen; Fehlversuche stehen im Log.
- Zugriffslimit: 30 Anfragen pro Minute (`REMOTE_RATE_LIMIT`).
- Jede Steuerung landet mit Quelle `remote` im Verlauf der Oberfläche.
- Schlüssel ändern: neuen Wert für `REMOTE_API_KEY` setzen, `remote` neu starten, im GPT aktualisieren.
- Der Rechner, auf dem `remote` und der Tunnel laufen, muss eingeschaltet sein.
