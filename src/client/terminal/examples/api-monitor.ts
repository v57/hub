import { ForEach, HStack, NavigationLink, NavigationStack, ProgressBar, ScrollView, Spacer, Terminal, Text, VStack, type Binding, type TaskContext } from '../index'

type RequestRow = { id: string; route: string; method: string; status: number; latency: number }

function binding<T>(get: () => T, set: (value: T) => void): Binding<T> {
  return { get, set }
}

const terminal = new Terminal()

let tick = 0
let path: string[] = []
let requests: RequestRow[] = [
  { id: 'users', route: '/api/users', method: 'GET', status: 200, latency: 84 },
  { id: 'events', route: '/api/events', method: 'GET', status: 200, latency: 143 },
  { id: 'upload', route: '/api/upload', method: 'POST', status: 202, latency: 221 },
  { id: 'search', route: '/api/search', method: 'GET', status: 503, latency: 610 },
]

function averageLatency() {
  return Math.round(requests.reduce((sum, row) => sum + row.latency, 0) / Math.max(1, requests.length))
}

function updateRequests() {
  tick += 1
  requests = requests.map((row, index) => ({
    ...row,
    status: row.route === '/api/search' && tick % 4 === 0 ? 503 : row.status === 503 ? 200 : row.status,
    latency: 60 + ((row.latency + tick * 37 + index * 29) % 580),
  }))
}

async function refreshRequests(context: TaskContext) {
  while (!context.signal.aborted) {
    await Bun.sleep(900)
    if (context.signal.aborted) return
    updateRequests()
    context.setNeedsUpdate()
  }
}

function requestById(id: string) {
  return requests.find(row => row.id === id) ?? requests[0]!
}

function colorFor(row: RequestRow) {
  if (row.status >= 500) return 'red'
  if (row.latency > 300) return 'yellow'
  return 'green'
}

function Master() {
  return VStack(
    [
      HStack([Text('API Monitor').fontWeight('bold').foregroundColor('cyan'), Spacer({ minLength: 1 }), Text(`avg ${averageLatency()}ms`).foregroundColor('secondary')]),
      HStack(
        [
          VStack([Text('Latency'), Text(`${averageLatency()}ms`).fontWeight('bold'), ProgressBar(Math.min(1, averageLatency() / 600)).frame({ maxWidth: -1 })]).frame({ maxWidth: -1 }).padding({ horizontal: 1 }),
          VStack([Text('Errors'), Text(String(requests.filter(row => row.status >= 500).length)).fontWeight('bold'), ProgressBar(requests.filter(row => row.status >= 500).length / requests.length).frame({ maxWidth: -1 })]).frame({ maxWidth: -1 }).padding({ horizontal: 1 }),
        ],
        { spacing: 1 },
      ),
      ScrollView(
        VStack([
          ForEach(
            requests,
            row => row.id,
            row =>
              HStack(
                [
                  Text(row.method).frame({ width: 5 }),
                  NavigationLink(row.route, row.id).frame({ maxWidth: -1, alignment: 'leading' }),
                  Text(String(row.status)).foregroundColor(colorFor(row)).frame({ width: 4 }),
                  Text(`${row.latency}ms`).frame({ width: 7, alignment: 'trailing' }),
                ],
                { spacing: 1 },
              ).id(row.id),
          ),
        ]),
        { axis: 'vertical' },
      ).frame({ maxWidth: -1, maxHeight: -1 }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 }).task('refresh-api-monitor', refreshRequests)
}

function Detail(id: string) {
  const row = requestById(id)
  return VStack(
    [
      HStack([Text('Request').fontWeight('bold').foregroundColor('cyan'), Spacer({ minLength: 1 }), Text(String(row.status)).foregroundColor(colorFor(row))]),
      Text(`${row.method} ${row.route}`).fontWeight('bold').foregroundColor('cyan'),
      HStack([Text('Latency').foregroundColor('secondary'), Spacer({ minLength: 1 }), Text(`${row.latency}ms`)]),
      ProgressBar(Math.min(1, row.latency / 600)).frame({ maxWidth: -1 }),
      Text('Timeline').fontWeight('bold'),
      Text(`dns ${20 + (row.latency % 30)}ms -> app ${Math.max(1, row.latency - 80)}ms -> send ${30 + (row.latency % 20)}ms`, { wrap: true }),
      Text(row.status >= 500 ? 'Latest check failed. Retry in progress.' : 'Latest check healthy.').foregroundColor(row.status >= 500 ? 'red' : 'green'),
    ],
    { spacing: 1 },
  ).padding(1).frame({ maxWidth: -1, maxHeight: -1 }).task('refresh-api-monitor', refreshRequests)
}

terminal.display(() =>
  NavigationStack(
    binding(() => path, value => {
      path = value
    }),
    Master,
    Detail,
  ).frame({ maxWidth: -1, maxHeight: -1 }),
)
