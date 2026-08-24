export interface ArtifactDefinition {
  slug: 'damages-ytd' | '3pl-opportunity-model';
  title: string;
  description: string;
  kind: 'report' | 'tool';
  version: string;
  owner: string;
  dataDate: string;
  datasetKeys: string[];
  capabilities: string[];
  accent: 'blue' | 'teal';
}

interface DatasetEnvelope {
  artifactId: string;
  datasetKey: string;
  schemaVersion: number;
  generatedAt: string;
  checksum: string;
  payload: unknown;
}

export const ARTIFACTS: ArtifactDefinition[] = [
  {
    slug: 'damages-ytd',
    title: 'Damages YTD',
    description: 'Explore fictional damage rates, trends, products and company performance from January to July 2026.',
    kind: 'report',
    version: 'POC 1.0',
    owner: 'Operations demonstration',
    dataDate: 'Synthetic · 31 Jul 2026',
    datasetKeys: ['damages'],
    capabilities: [],
    accent: 'teal'
  },
  {
    slug: '3pl-opportunity-model',
    title: '3PL opportunity model',
    description: 'Model a fictional fulfilment opportunity, compare scenarios and exercise the download workflow.',
    kind: 'tool',
    version: 'POC 1.0',
    owner: 'Commercial demonstration',
    dataDate: 'Synthetic · Aug 2026',
    datasetKeys: ['3pl-rate-card'],
    capabilities: ['downloads'],
    accent: 'blue'
  }
];

const months = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07'];
const products = [
  { pc: 'DEMO-1001', de: 'Demo temperature monitor', sup: 'Northstar Supplies', ca: 'Diagnostics', price: 28 },
  { pc: 'DEMO-1002', de: 'Demo surgical drape pack', sup: 'Example Medical', ca: 'Consumables', price: 17 },
  { pc: 'DEMO-1003', de: 'Demo nutrition case', sup: 'Sample Nutrition', ca: 'Nutrition', price: 42 },
  { pc: 'DEMO-1004', de: 'Demo fluid therapy set', sup: 'Northstar Supplies', ca: 'Clinical', price: 31 },
  { pc: 'DEMO-1005', de: 'Demo protective collar', sup: 'Example Medical', ca: 'Consumables', price: 12 }
];

const damageRows = months.reduce<Array<Record<string, string | number>>>((rows, month, monthIndex) => {
  products.forEach((product, productIndex) => {
    const units = 1 + ((monthIndex + productIndex * 2) % 6);
    const latestValue = units * product.price * (0.48 + productIndex * 0.035);
    rows.push({
      sup: product.sup,
      pc: product.pc,
      de: product.de,
      dt: `${month}-${String(5 + ((monthIndex * 3 + productIndex * 4) % 22)).padStart(2, '0')}`,
      u: units,
      lv: Number(latestValue.toFixed(2)),
      av: Number((latestValue * (0.91 + monthIndex * 0.018)).toFixed(2)),
      em: ['Demo User A', 'Demo User B', 'Demo User C'][(monthIndex + productIndex) % 3],
      ca: product.ca
    });
  });
  return rows;
}, []);

const salesByProduct: Record<string, Record<string, [number, number]>> = {};
products.forEach((product, productIndex) => {
  salesByProduct[product.pc] = {};
  months.forEach((month, monthIndex) => {
    const units = 850 + productIndex * 170 + monthIndex * 55;
    salesByProduct[product.pc][month] = [units, units * product.price];
  });
});

const companySales: Record<string, [number, number]> = {};
months.forEach((month, monthIndex) => {
  companySales[month] = [128000 + monthIndex * 4100, 3840000 + monthIndex * 142000];
});

const demoRateCard = {
  meta: { oppName: 'Example veterinary network', preparedBy: 'Demonstration user', date: '2026-08-20', rateCardVersion: 'Synthetic POC rates v1' },
  period: 'month',
  vol: { orders: 4200, lines: 12600, units: 31500, packages: 4600, recPallets: 72, palletsDelivered: 18, skus: 620, chilledSkus: 85, reserveLocations: 310, pickLocations: 480, ordersPerDelivery: 2.4, stockValue: 1250000, returnsRate: 0.018, vetPct: 0.42, sqpPct: 0.08, barcodedPct: 0.94, unitsPerLine: 2.5 },
  opts: { pickingBasis: 'Per line', fleetBasis: 'Existing customer', deliveryRoute: 'Own fleet', courierSharePct: 0.12, setupCustomers: 14 },
  rates: { accountSetup: 18, goodsReceipt: 7.5, barcoding: 0.08, reserveStorage: 3.25, chilledStorage: 5.9, pickLocation: 2.1, pickingPerLine: 0.42, pickingFirstUnit: 0.29, pickingNextUnit: 0.09, packaging: 0.68, fleetExisting: 8.4, fleetNonCustomer: 12.6, courier: 5.75, palletDelivery: 38, insurancePerMillion: 850, returnsFee: 2.4, vetCheck: 1.2, sqpCheck: 0.8, packagingMargin: 0.18, deliveryMargin: 0.15, courierMargin: 0.12 },
  prod: { grLinesPctOfLines: 0.03, grLinesPerHour: 14, unitsPerHourBarcode: 200, conveyorPerLine: 1, conveyorLinesPerHour: 180, ordersPerHourLoad: 34, weeklyHours: 32.5, holidayUplift: 1.151, salary: 28500 },
  scenarios: [{ name: 'Conservative', volPct: 0.65 }, { name: 'Expected', volPct: 0.82 }, { name: 'Growth', volPct: 1 }],
  terms: { arDays: 45, apDays: 35, vatFactor: 1.2 },
  ramp: { startDate: '2026-10-01', months: 6, startPct: 0.3, profile: null }
};

export const DEMO_DATASETS: Record<string, DatasetEnvelope> = {
  damages: {
    artifactId: 'damages-ytd', datasetKey: 'damages', schemaVersion: 1,
    generatedAt: '2026-08-20T09:00:00Z', checksum: 'sha256:synthetic-sharepoint-poc',
    payload: { d: damageRows, s: salesByProduct, c: companySales }
  },
  '3pl-rate-card': {
    artifactId: '3pl-opportunity-model', datasetKey: '3pl-rate-card', schemaVersion: 1,
    generatedAt: '2026-08-20T09:00:00Z', checksum: 'sha256:synthetic-sharepoint-poc',
    payload: demoRateCard
  }
};
