import { Button, ForEach, HStack, ScrollView, Spacer, Terminal, Text, TextField, VStack, type Binding } from '../index'

type Message = {
  id: string
  author: string
  text: string
  date: Date
  replyTo?: Pick<Message, 'id' | 'author' | 'text'>
}

function binding<T>(get: () => T, set: (value: T) => void): Binding<T> {
  return { get, set }
}

const terminal = new Terminal()
const draftFocusId = 'chat-draft-input'

terminal.focus(draftFocusId)

let draft = ''
let replyingTo: Message | undefined
let scrollOffset = Number.MAX_SAFE_INTEGER
let messages: Message[] = [
  {
    id: crypto.randomUUID(),
    author: 'Mila',
    text: 'Local chat ready.',
    date: new Date(),
  },
  {
    id: crypto.randomUUID(),
    author: 'You',
    text: 'Everything stays in memory.',
    date: new Date(),
  },
]

const draftBinding = binding(
  () => draft,
  value => {
    draft = value
  },
)

const scrollBinding = binding(
  () => scrollOffset,
  value => {
    scrollOffset = value
  },
)

function sendMessage() {
  const text = draft.trim()
  if (text.length === 0) return

  const replyTo = replyingTo
    ? {
        id: replyingTo.id,
        author: replyingTo.author,
        text: replyingTo.text,
      }
    : undefined
  messages = [
    ...messages,
    {
      id: crypto.randomUUID(),
      author: 'You',
      text,
      date: new Date(),
      replyTo,
    },
  ]
  draft = ''
  replyingTo = undefined
}

function MessageRow(message: Message) {
  const time = message.date.toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
  })

  return VStack(
    [
      HStack(
        [
          Text(message.author).fontWeight('bold'),
          Spacer({ minLength: 1 }),
          Text(time).frame({ maxWidth: -1, alignment: 'trailing' }),
        ],
        { alignment: 'center', spacing: 2 },
      ),
      ...(message.replyTo
        ? [
            Text(`reply to ${message.replyTo.author}: ${message.replyTo.text}`, {
              truncation: 'tail',
            }).foregroundColor('secondary'),
          ]
        : []),
      Text(message.text, { wrap: true }),
    ],
    { spacing: 0 },
  )
    .padding({ horizontal: 1 })
    .contextMenu([
      {
        label: 'Reply',
        action: () => {
          replyingTo = message
          draft = ''
          terminal.focus(draftFocusId)
        },
      },
      {
        label: 'Copy text',
        action: () => {
          draft = message.text
        },
      },
    ])
}

terminal.display(() => {
  return VStack(
    [
      Text('Local Chat')
        .frame({
          maxWidth: -1,
          height: 1,
          alignment: 'center',
        })
        .foregroundColor('cyan')
        .fontWeight('bold'),

      ScrollView(
        VStack([
          ForEach(
            messages,
            message => message.id,
            message => MessageRow(message),
          ),
        ]),
        { axis: 'vertical', offset: scrollBinding, anchor: 'bottom' },
      ).frame({ maxWidth: -1, maxHeight: -1 }),

      HStack(
        [
          VStack(
            [
              ...(replyingTo
                ? [
                    HStack([
                      Text(`Replying to ${replyingTo.author}: ${replyingTo.text}`, { truncation: 'tail' })
                        .foregroundColor('secondary')
                        .frame({ maxWidth: -1 }),
                      Button('Cancel', () => {
                        replyingTo = undefined
                      }),
                    ]),
                  ]
                : []),
              TextField(draftBinding, {
                placeholder: replyingTo ? 'Reply' : 'Message',
                onSubmit: sendMessage,
              }).frame({ maxWidth: -1 }).focusId(draftFocusId),
            ],
            { spacing: 0 },
          ).frame({ maxWidth: -1 }),
          Button('Send', sendMessage),
        ],
        { spacing: 1, alignment: 'center' },
      ).frame({ maxWidth: -1, height: replyingTo ? 2 : 1 }),
    ],
    { spacing: 1 },
  ).frame({ maxWidth: -1, maxHeight: -1 })
})
