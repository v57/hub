import {
  Grid,
  GridColumn,
  HStack,
  ProgressBar,
  ScrollView,
  Spacer,
  State,
  TabBar,
  TaskHost,
  Terminal,
  Text,
  VStack,
  type TaskContext,
} from '../index'

type Metric = {
  id: string
  label: string
  value: string
  progress: number
  delta: string
}

type Region = {
  id: string
  name: string
  revenue: number
}

const terminal = new Terminal()

const selectedTab = State('Overview')
const status = State('Loading ops data...')
let tick = 0

const tabs = ['Overview', 'Regions', 'Ops']

let metrics: Metric[] = [
  { id: 'revenue', label: 'Revenue', value: '$84.2k', progress: 0.82, delta: '+12%' },
  { id: 'users', label: 'Active users', value: '12,804', progress: 0.64, delta: '+8%' },
  { id: 'conversion', label: 'Conversion', value: '7.4%', progress: 0.37, delta: '-1%' },
  { id: 'uptime', label: 'Uptime', value: '99.98%', progress: 0.99, delta: '+0%' },
]

let regions: Region[] = [
  { id: 'na', name: 'North America', revenue: 42000 },
  { id: 'eu', name: 'Europe', revenue: 28000 },
  { id: 'apac', name: 'APAC', revenue: 19000 },
  { id: 'latam', name: 'LATAM', revenue: 9000 },
]

let ops = [
  { id: 'api', label: 'API latency', progress: 0.28, value: '128 ms' },
  { id: 'queue', label: 'Queue depth', progress: 0.56, value: '312' },
  { id: 'cpu', label: 'CPU load', progress: 0.71, value: '71%' },
  { id: 'mem', label: 'Memory', progress: 0.62, value: '62%' },
]

let revenueHistory = [18, 22, 19, 31, 36, 41, 52, 49, 58, 63, 61, 70]

function wave(base: number, amplitude: number, offset: number) {
  return base + Math.round(Math.sin((tick + offset) / 2) * amplitude)
}

function percentDelta(value: number) {
  const sign = value >= 0 ? '+' : ''
  return `${sign}${value}%`
}

function updateDashboard() {
  tick += 1

  const revenue = wave(84200, 5200, 0)
  const users = wave(12804, 920, 1)
  const conversion = 7.4 + Math.sin((tick + 2) / 3) * 0.8
  const uptime = 99.93 + Math.sin((tick + 3) / 4) * 0.05

  metrics = [
    { id: 'revenue', label: 'Revenue', value: `$${(revenue / 1000).toFixed(1)}k`, progress: Math.min(0.95, revenue / 105000), delta: percentDelta(Math.round(((revenue - 84200) / 84200) * 100)) },
    { id: 'users', label: 'Active users', value: users.toLocaleString('en-US'), progress: Math.min(0.9, users / 18000), delta: percentDelta(Math.round(((users - 12804) / 12804) * 100)) },
    { id: 'conversion', label: 'Conversion', value: `${conversion.toFixed(1)}%`, progress: Math.min(0.8, conversion / 12), delta: percentDelta(Math.round((conversion - 7.4) * 2)) },
    { id: 'uptime', label: 'Uptime', value: `${uptime.toFixed(2)}%`, progress: Math.min(1, uptime / 100), delta: percentDelta(Math.round((uptime - 99.93) * 100)) },
  ]

  regions = regions.map((region, index) => ({
    ...region,
    revenue: Math.max(5000, region.revenue + wave(0, 1400, index) - wave(0, 800, index + 2)),
  }))

  ops = [
    { id: 'api', label: 'API latency', progress: Math.min(1, Math.max(0.1, wave(128, 68, 0) / 300)), value: `${wave(128, 68, 0)} ms` },
    { id: 'queue', label: 'Queue depth', progress: Math.min(1, Math.max(0.1, wave(312, 180, 1) / 700)), value: String(wave(312, 180, 1)) },
    { id: 'cpu', label: 'CPU load', progress: Math.min(1, Math.max(0.1, wave(58, 18, 2) / 100)), value: `${wave(58, 18, 2)}%` },
    { id: 'mem', label: 'Memory', progress: Math.min(1, Math.max(0.1, wave(62, 9, 3) / 100)), value: `${wave(62, 9, 3)}%` },
  ]

  revenueHistory = [...revenueHistory.slice(1), Math.round(revenue / 1000)]
}

async function refreshDashboard(context: TaskContext) {
  while (!context.signal.aborted) {
    await Bun.sleep(1000)
    if (context.signal.aborted) return
    updateDashboard()
    context.setNeedsUpdate()
  }
}

function MetricCard(metric: Metric) {
  return VStack(
    [
      HStack(
        [
          Text(metric.label),
          Text(metric.delta).frame({ maxWidth: -1, alignment: 'trailing' }),
        ],
        { spacing: 2 },
      ),
      Text(metric.value),
      ProgressBar(metric.progress).frame({ maxWidth: -1 }),
    ],
    { spacing: 1 },
  )
    .padding({ horizontal: 1 })

    .frame({ width: 30, height: 7 })
}

function RegionRow(region: Region) {
  const maxRevenue = Math.max(...regions.map(item => item.revenue))
  const progress = region.revenue / maxRevenue

  return HStack(
    [
      Text(region.name).frame({ width: 16 }),
      ProgressBar(progress).frame({ maxWidth: -1 }),
      Text(`$${Math.round(region.revenue / 1000)}k`).frame({
        width: 6,
        alignment: 'trailing',
      }),
    ],
    { spacing: 2, alignment: 'center' },
  )
}

function Sparkline(values: number[]) {
  const ticks = ['.', ':', '-', '=', '+', '*', '#', '@']
  const max = Math.max(...values, 1)

  return Text(
    values
      .map(value => {
        const index = Math.min(ticks.length - 1, Math.floor((value / max) * ticks.length))
        return ticks[index] ?? '.'
      })
      .join(''),
  )
}

function OverviewPage() {
  return VStack(
    [
      Grid(metrics, 'id', [GridColumn.adaptive(30)], metric => MetricCard(metric), { columnSpacing: 2, rowSpacing: 1 }),
      VStack(
        [
          Text('Weekly revenue'),
          Sparkline(revenueHistory),
        ],
        { spacing: 1 },
      ).frame({ maxWidth: -1, height: 4 }),
    ],
    { spacing: 1 },
  )
}

function RegionsPage() {
  return VStack(
    [
      Text('Revenue by region'),
      Grid(regions, 'id', [GridColumn.flexible({ min: 24 })], region => RegionRow(region)),
    ],
    { spacing: 1 },
  )
}

function OpsPage() {
  return VStack(
    [
      Text('Operations').fontWeight('bold'),
      Text(() => status.get())
        .foregroundColor('secondary')
        .id('ops-status-label'),
      TaskHost('ops-status', async context => {
          await Bun.sleep(250)
          if (context.signal.aborted) return
          status.set('Ops data loaded')
          context.setNeedsUpdate()
        }),
      Grid(
        ops,
        item => item.id,
        [GridColumn.flexible({ min: 30 })],
        item =>
          HStack(
            [
              ProgressBar(item.progress, { style: 'compact' }),
              Text(item.label).frame({ width: 16 }),
              Spacer({ minLength: 1 }),
              ProgressBar(item.progress).frame({ maxWidth: -1 }),
              Text(item.value).frame({ width: 8, alignment: 'trailing' }),
            ],
            { spacing: 2, alignment: 'center' },
          ),
      ),
    ],
    { spacing: 1 },
  )
}

function CurrentPage() {
  if (selectedTab.get() === 'Regions') return RegionsPage()
  if (selectedTab.get() === 'Ops') return OpsPage()
  return OverviewPage()
}

terminal.display(() => {
  return VStack(
    [
      HStack(
        [
          Text('Dashboard').fontWeight('bold').foregroundColor('cyan'),
          Text(async function* () {
            while (true) {
              yield new Date().toLocaleTimeString()
              await Bun.sleep(1000)
            }
          }).frame({
            maxWidth: -1,
            alignment: 'trailing',
          }),
        ],
        { spacing: 2, alignment: 'center' },
      ).frame({ maxWidth: -1, height: 1 }),

      TabBar(tabs, selectedTab).frame({ maxWidth: -1, height: 1 }).background('black'),

      ScrollView(CurrentPage(), { axis: 'vertical' }).frame({
        maxWidth: -1,
        maxHeight: -1,
      }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 }).task('refresh-dashboard', refreshDashboard)
})
