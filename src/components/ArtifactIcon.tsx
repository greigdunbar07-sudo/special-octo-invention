/* eslint-disable react-refresh/only-export-components */
import {
  Activity, BarChart3, Boxes, Calculator, Calendar, ClipboardList, Database, FileText, FlaskConical,
  Gauge, Layers, Map, PackageSearch, Percent, PieChart, Presentation, ScanSearch, Search, Shield,
  SlidersHorizontal, Sparkles, Table2, Target, TrendingUp, Truck, Users, Warehouse, Wrench,
  type LucideIcon,
} from 'lucide-react';

import { parseArtifactIcon, type ArtifactIcon as ArtifactIconName, type ArtifactKind } from '@/types/portal';

export const ARTIFACT_ICON_GROUPS: Array<{ label: string; items: Array<{ value: ArtifactIconName; label: string }> }> = [
  { label: 'Data', items: [
    { value: 'chart', label: 'Chart' }, { value: 'pie', label: 'Pie' }, { value: 'table', label: 'Table' },
    { value: 'trend', label: 'Trend' }, { value: 'activity', label: 'Activity' }, { value: 'gauge', label: 'Gauge' },
  ] },
  { label: 'Documents', items: [
    { value: 'file', label: 'Document' }, { value: 'clipboard', label: 'Clipboard' }, { value: 'presentation', label: 'Presentation' },
  ] },
  { label: 'Operations', items: [
    { value: 'package', label: 'Package' }, { value: 'boxes', label: 'Boxes' }, { value: 'truck', label: 'Truck' }, { value: 'warehouse', label: 'Warehouse' },
  ] },
  { label: 'Analysis', items: [
    { value: 'calculator', label: 'Calculator' }, { value: 'percent', label: 'Percent' }, { value: 'search', label: 'Search' }, { value: 'sliders', label: 'Sliders' },
  ] },
  { label: 'Tools', items: [
    { value: 'wrench', label: 'Tool' }, { value: 'flask', label: 'Flask' }, { value: 'database', label: 'Database' },
    { value: 'scan', label: 'Scan' }, { value: 'target', label: 'Target' }, { value: 'calendar', label: 'Calendar' },
    { value: 'users', label: 'Users' }, { value: 'shield', label: 'Shield' }, { value: 'layers', label: 'Layers' },
    { value: 'map', label: 'Map' }, { value: 'sparkles', label: 'Sparkles' },
  ] },
];

export const ARTIFACT_ICONS = ARTIFACT_ICON_GROUPS.flatMap((group) => group.items);

const ICONS: Record<ArtifactIconName, LucideIcon> = {
  chart: BarChart3, pie: PieChart, table: Table2, trend: TrendingUp, activity: Activity, gauge: Gauge,
  file: FileText, clipboard: ClipboardList, presentation: Presentation,
  package: PackageSearch, boxes: Boxes, truck: Truck, warehouse: Warehouse,
  calculator: Calculator, percent: Percent, search: Search, sliders: SlidersHorizontal,
  wrench: Wrench, flask: FlaskConical, database: Database, scan: ScanSearch, target: Target,
  calendar: Calendar, users: Users, shield: Shield, layers: Layers, map: Map, sparkles: Sparkles,
};

export function defaultArtifactIcon(kind: ArtifactKind): ArtifactIconName {
  return kind === 'report' ? 'chart' : 'wrench';
}

export function ArtifactIcon({ name, kind }: { name?: ArtifactIconName; kind: ArtifactKind }) {
  const Icon = ICONS[parseArtifactIcon(name) ?? defaultArtifactIcon(kind)];
  return <Icon aria-hidden="true" />;
}

export function ArtifactIconPicker({ name, defaultValue }: { name: string; defaultValue: ArtifactIconName }) {
  return (
    <fieldset className="icon-picker">
      <legend className="sr-only">Choose an icon</legend>
      {ARTIFACT_ICON_GROUPS.map((group) => (
        <div className="icon-picker-group" key={group.label}>
          <p>{group.label}</p>
          <div className="icon-picker-grid">
            {group.items.map((icon) => (
              <label className="icon-picker-option" key={icon.value}>
                <input type="radio" name={name} value={icon.value} defaultChecked={icon.value === defaultValue} />
                <ArtifactIcon name={icon.value} kind="report" />
                <span>{icon.label}</span>
              </label>
            ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
