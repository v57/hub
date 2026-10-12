import { HStack, LazyForEach, Picker, ScrollView, Spacer, State, Terminal, Text, TextField, VStack } from '../index'

type Severity = 'All' | 'Info' | 'Warn' | 'Error'
type LogLine = { id: string; time: string; severity: Exclude<Severity, 'All'>; message: string }

const terminal = new Terminal()

const severity = State<Severity>('All')
const query = State('')
const scrollOffset = State(Number.MAX_SAFE_INTEGER)

const logs: LogLine[] = [
  { id: '1', time: '10:00:01', severity: 'Info', message: 'server started on localhost:3000' },
  { id: '2', time: '10:00:03', severity: 'Info', message: 'loaded 12 routes from src/index.ts' },
  { id: '3', time: '10:00:06', severity: 'Warn', message: 'slow render: dashboard frame took 18ms' },
  { id: '4', time: '10:00:09', severity: 'Info', message: 'client connected from test terminal' },
  { id: '5', time: '10:00:12', severity: 'Error', message: 'request failed: upstream timeout after 2500ms' },
  { id: '6', time: '10:00:15', severity: 'Warn', message: 'retry scheduled with exponential backoff' },
  { id: '7', time: '10:00:20', severity: 'Info', message: 'request recovered and cache refreshed' },
]

function filteredLogs() {
  const needle = query.get().trim().toLowerCase()
  return logs.filter(line => (severity.get() === 'All' || line.severity === severity.get()) && (!needle || line.message.toLowerCase().includes(needle)))
}

function colorFor(line: LogLine) {
  if (line.severity === 'Error') return 'red'
  if (line.severity === 'Warn') return 'yellow'
  return 'green'
}

terminal.display(() =>
  VStack(
    [
      HStack(
        [
          Text('Log Viewer').fontWeight('bold').foregroundColor('cyan'),
          Spacer({ minLength: 1 }),
          Picker('Level', ['All', 'Info', 'Warn', 'Error'] as Severity[], severity),
        ],
        { spacing: 1 },
      ),
      TextField(query, { placeholder: 'Search logs' }).frame({ maxWidth: -1 }),
      ScrollView(
        VStack([
          LazyForEach(
            filteredLogs,
            line => line.id,
            line =>
              HStack(
                [
                  Text(line.time).foregroundColor('secondary').frame({ width: 9 }),
                  Text(line.severity).foregroundColor(colorFor(line)).frame({ width: 6 }),
                  Text(line.message, { truncation: 'tail' }).frame({ maxWidth: -1 }),
                ],
                { spacing: 1 },
              ).id(line.id),
          ),
        ]),
        { axis: 'vertical', anchor: 'bottom', offset: scrollOffset },
      ).frame({ maxWidth: -1, maxHeight: -1 }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 }),
)
