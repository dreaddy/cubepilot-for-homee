// Deutsche Bezeichnungen für Attribute, Werte und Gerätearten.

import { locale, t } from './i18n';
import type { AttributeView, NodeView } from './models';

const ATTRIBUTE_LABELS: Record<string, string> = {
  OnOff: 'Ein/Aus',
  DimmingLevel: 'Helligkeit',
  Position: 'Position',
  UpDown: 'Auf/Ab',
  TargetTemperature: 'Solltemperatur',
  Temperature: 'Temperatur',
  ComfortTemperature: 'Komforttemperatur',
  EcoTemperature: 'Spartemperatur',
  TemperatureOffset: 'Temperatur-Korrektur',
  RelativeHumidity: 'Luftfeuchte',
  CurrentEnergyUse: 'Leistung',
  AccumulatedEnergyUse: 'Verbrauch',
  BatteryLevel: 'Batterie',
  BatteryLowAlarm: 'Batterie schwach',
  Brightness: 'Helligkeit (Sensor)',
  OpenClose: 'Kontakt',
  MotionAlarm: 'Bewegung',
  PresenceAlarm: 'Anwesenheit',
  SmokeAlarm: 'Rauchalarm',
  TamperAlarm: 'Sabotage',
  RainFall: 'Regen',
  RainFallLastHour: 'Regen letzte Stunde',
  RainFallToday: 'Regen heute',
  LockState: 'Schloss',
  ColorTemperature: 'Farbtemperatur',
  Color: 'Farbe',
  HomeeMode: 'homee-Modus',
  ButtonState: 'Taste',
  LinkQuality: 'Funkqualität',
  SunProtection: 'Sonnenschutz',
  FreezeProtection: 'Frostschutz',
  FlyScreen: 'Insektenschutz',
  ShutterOrientation: 'Lamellen',
  Locked: 'Bediensperre',
  CO2Level: 'CO₂',
  AirPressure: 'Luftdruck',
  Sonometer: 'Lautstärke',
  CurrentLocalTemperature: 'Außentemperatur',
  CurrentLocalHumidity: 'Außenfeuchte',
  CurrentLocalWindSpeed: 'Wind',
  CurrentLocalGustSpeed: 'Böen',
  CurrentLocalWeatherCondition: 'Wetter',
  SunriseTime: 'Sonnenaufgang',
  SunsetTime: 'Sonnenuntergang',
  KnownPersonPresence: 'Bekannte Person',
  UnknownPersonPresence: 'Unbekannte Person',
  SurveillanceOnOff: 'Überwachung',
  WatchdogOnOff: 'Watchdog',
  IdentificationMode: 'Identifizieren',
  RestoreLastKnownState: 'Letzten Zustand wiederherstellen',
  ManualOperation: 'Handbetrieb',
  AutomaticMode: 'Automatik',
  HighTemperatureAlarm: 'Übertemperatur',
  MotorBlockedAlarm: 'Motor blockiert',
  MalfunctionAlarm: 'Störung',
  PowerSupplyAlarm: 'Stromversorgung',
  FlowAlarm: 'Durchflussalarm',
  Text: 'Text',
  TotalConsumptionNow: 'Aktueller Gesamtverbrauch',
  ConsumptionLimitPeak: 'Verbrauchslimit (Spitze)',
  ConsumptionLimitDaily: 'Verbrauchslimit (Tag)',
  DailyConsumptionAccumulated: 'Verbrauch heute',
  EnergyManagerSwitchRule: 'Energiemanager-Regel',
  CurrentMarketPrice: 'Aktueller Strompreis',
  ConnectedDevices: 'Verbundene Geräte',
  EnergyManagerRuleActive: 'Energiemanager-Regel aktiv',
  EnergyManagerRuleOnThreshold: 'Einschaltschwelle',
  EnergyManagerRuleOffThreshold: 'Ausschaltschwelle',
  EnergyManagerRuleLockTime: 'Sperrzeit',
  EnergyManagerRuleDevices: 'Geräte der Regel',
};

const VALUE_LABELS: Record<string, Record<number, string>> = {
  OnOff: { 0: 'Aus', 1: 'An' },
  LockState: { 0: 'Entriegelt', 1: 'Verriegelt' },
  HomeeMode: { 0: 'Zuhause', 1: 'Nacht', 2: 'Abwesend', 3: 'Urlaub' },
  OpenClose: { 0: 'Geschlossen', 1: 'Offen' },
  MotionAlarm: { 0: 'Keine Bewegung', 1: 'Bewegung' },
  PresenceAlarm: { 0: 'Niemand', 1: 'Anwesend' },
  SmokeAlarm: { 0: 'Kein Alarm', 1: 'Alarm' },
  TamperAlarm: { 0: 'OK', 1: 'Alarm' },
  BatteryLowAlarm: { 0: 'OK', 1: 'Schwach' },
  UpDown: { 0: 'Offen', 1: 'Geschlossen', 2: 'Stopp', 3: 'Öffnet', 4: 'Schließt' },
  ButtonState: { 1: 'Gedrückt', 2: 'Losgelassen' },
  SunProtection: { 0: 'Aus', 1: 'An' },
  FreezeProtection: { 0: 'Aus', 1: 'An' },
  FlyScreen: { 0: 'Aus', 1: 'An' },
  Locked: { 0: 'Aus', 1: 'An' },
  SurveillanceOnOff: { 0: 'Aus', 1: 'An' },
  KnownPersonPresence: { 0: 'Niemand', 1: 'Erkannt' },
  UnknownPersonPresence: { 0: 'Niemand', 1: 'Erkannt' },
  MotorBlockedAlarm: { 0: 'Nein', 1: 'Ja' },
  HighTemperatureAlarm: { 0: 'Nein', 1: 'Ja' },
  MalfunctionAlarm: { 0: 'Nein', 1: 'Ja' },
  PowerSupplyAlarm: { 0: 'OK', 1: 'Störung' },
  ManualOperation: { 0: 'Nein', 1: 'Ja' },
  FlowAlarm: { 0: 'Kein Alarm', 1: 'Alarm' },
  EnergyManagerRuleActive: { 0: 'Aus', 1: 'An' },
  AutomaticMode: { 0: 'Aus', 1: 'An' },
};

/** Werte, die man setzen kann (weicht bei Zustands-Attributen von der Anzeige ab). */
const CONTROL_LABELS: Record<string, Record<number, string>> = {
  UpDown: { 0: 'Öffnen', 2: 'Stopp', 1: 'Schließen' },
};

export function controlLabels(typeName: string): Record<number, string> | null {
  return translated(CONTROL_LABELS[typeName] ?? VALUE_LABELS[typeName]);
}

function translated(map: Record<number, string> | undefined): Record<number, string> | null {
  return map ? Object.fromEntries(Object.entries(map).map(([k, v]) => [k, t(v)])) : null;
}

/** Technische Attribute, die man normalerweise nicht sehen will. */
export const TECHNICAL = new Set([
  'LinkQuality',
  'SoftwareRevision',
  'FirmwareRevision',
  'IdentificationMode',
  'WatchdogOnOff',
  'RestoreLastKnownState',
  'EndPositionConfiguration',
  'PollingInterval',
  'WakeUpInterval',
  'MemoryUsage',
  'ProcessorUtilization',
  'UsedStorage',
  'StorageAlarm',
  'ColorMode',
  'BrightnessReportInterval',
  'TemperatureReportInterval',
  'PresenceAlarmCancelationDelay',
  'HighTemperatureAlarmTreshold',
  'MeshPartners',
  'IometerStreamingMode',
]);

function splitCamel(s: string): string {
  return s.replace(/([a-z])([A-Z])/g, '$1 $2');
}

export function attributeLabel(a: Pick<AttributeView, 'typeName' | 'instance'>): string {
  const base = t(ATTRIBUTE_LABELS[a.typeName] ?? splitCamel(a.typeName));
  return a.instance > 0 ? `${base} ${a.instance}` : base;
}

export function typeLabel(typeName: string): string {
  return t(ATTRIBUTE_LABELS[typeName] ?? splitCamel(typeName));
}

export function valueLabels(typeName: string): Record<number, string> | null {
  return translated(VALUE_LABELS[typeName]);
}

export function unitOf(a: Pick<AttributeView, 'unit'>): string {
  return a.unit && a.unit !== 'n/a' && a.unit !== 'text' ? a.unit : '';
}

export function formatValue(a: Pick<AttributeView, 'typeName' | 'unit'>, value: number): string {
  const labels = VALUE_LABELS[a.typeName];
  if (labels && labels[value] !== undefined) return t(labels[value]);
  const v = Number.isInteger(value) ? String(value) : value.toLocaleString(locale(), { maximumFractionDigits: 1 });
  const unit = unitOf(a);
  return unit ? `${v} ${unit}` : v;
}

// ---------------------------------------------------------------- Gerätearten

export interface Category {
  key: string;
  name: string;
  icon: string;
  test: RegExp;
}

export const CATEGORIES: Category[] = [
  { key: 'shutter', name: 'Rollläden', icon: 'blinds', test: /Shutter|Blind|Awning/i },
  { key: 'light', name: 'Licht', icon: 'bulb', test: /Light|Bulb|DimmablePlug|DimmableSwitch/i },
  { key: 'heating', name: 'Heizung', icon: 'thermometer', test: /Thermostat|Radiator|Heating/i },
  { key: 'plug', name: 'Steckdosen', icon: 'plug', test: /Plug|Switch|Relay/i },
  { key: 'security', name: 'Sicherheit', icon: 'shield', test: /Lock|Smoke|OpenClose|Presence|Motion|Camera|Siren|Alarm/i },
  { key: 'sensor', name: 'Sensoren', icon: 'gauge', test: /Sensor|Netatmo|Temperature|Rain|Weather|Meter/i },
  { key: 'remote', name: 'Fernbedienungen', icon: 'remote', test: /Remote|Button/i },
];

export const OTHER_CATEGORY: Category = { key: 'other', name: 'Sonstige', icon: 'box', test: /./ };

export function categoryOf(n: Pick<NodeView, 'profileName'>): Category {
  return CATEGORIES.find((c) => c.test.test(n.profileName)) ?? OTHER_CATEGORY;
}

/** Spezielleres Icon je Geräteart. */
export function nodeIcon(n: Pick<NodeView, 'profileName' | 'id'>): string {
  if (n.id === -1) return 'home';
  const p = n.profileName;
  if (/Lock/.test(p)) return 'lock';
  if (/Smoke/.test(p)) return 'flame';
  if (/Camera/.test(p)) return 'camera';
  if (/OpenClose/.test(p)) return 'door';
  if (/Presence|Motion/.test(p)) return 'activity';
  if (/Rain/.test(p)) return 'droplet';
  return categoryOf(n).icon;
}
