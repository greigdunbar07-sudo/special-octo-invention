export interface QlikColumn {
  key: string;
  title: string;
  role: 'dimension' | 'measure';
}

export type QlikCell = string | number | null;

export interface QlikTablePayload {
  asOf: string;
  appId: string;
  objectId: string;
  columns: QlikColumn[];
  rows: QlikCell[][];
}

export interface ExpandedQlikTablePayload {
  asOf: string;
  appId: string;
  objectId: string;
  columns: QlikColumn[];
  rows: Array<Record<string, QlikCell>>;
}
