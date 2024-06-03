import fs from 'fs'
import { writeFile } from 'fs/promises'
import OpenAI from 'openai'
import { AItools } from './assistantTools'
import type { ChatMessage } from '@/types'

const defModel = import.meta.env.OPENAI_API_MODEL || 'gpt-3.5-turbo'
const apiKey = import.meta.env.OPENAI_API_KEY

const openai = new OpenAI({
  apiKey, // This is the default and can be omitted
})

interface ThreadContext{
  assistantId: string
  threadId: string
  runId?: string
  encoder: TextEncoder
  controller?: ReadableStreamDefaultController<any>
}

const contexts = new Map<string, ThreadContext>()
const assistantMap = new Map<string, OpenAI.Beta.Assistants.Assistant[]>()// key is roomID

export function cleanupAssistants() {
  // TODO cleanup temp file on server and on tmp folder
  (async() => {
    try {
      // cleanup old assistants delete assistant of more that a day old
      for await (const assistant of openai.beta.assistants.list()) {
        if (assistant.created_at && new Date(assistant.created_at * 1000).getTime() < (Date.now() - 24 * 60 * 60 * 1000)) {
          try {
            const existingAssistant = await openai.beta.assistants.retrieve(assistant.id)
            if (existingAssistant) {
              try {
                await openai.beta.assistants.del(assistant.id)
                console.log('->Deleted assistant', assistant.id)
              } catch (error: any) {
                console.error(`-->Error deleting assistant ${assistant.id}:`, error)
              }
            }
          } catch (error: any) {
            if (error.status === 404) {
              console.log(`Assistant ${assistant.id} not found, skipping deletion.`)
            } else {
              console.error(`--->Error deleting assistant ${assistant.id}:`, error)
            }
          }
        }
      }
    } catch (error: any) {
      console.error('Error during assistant cleanup:', error)
    }
  })()
}

/**
 * in our case the name of this assistant is the threadId (since we have custom prompt for every assistant / room)
 * @param threadId
 * @param model
 * @param prompt
 * @param useTool
 * @param roomid
 */
export async function createAssistant(threadId: string, model: string = defModel, prompt?: string, useTool?: boolean, roomid?: string): Promise<OpenAI.Beta.Assistants.Assistant> {
  cleanupAssistants()

  if (!prompt) prompt = 'You are a personal assistant'

  const assistant = await openai.beta.assistants.create({
    name: 'Aptero Assistant',
    instructions: `${prompt}`,
    tools: useTool ? AItools : [],
    model,
    metadata: {
      threadId,
    },
  })
  if (roomid) {
    if (assistantMap.has(roomid)) {
      assistantMap.get(roomid).push(assistant)
    } else {
      assistantMap.set(roomid, [assistant])
    }
  }
  return assistant
}

export const processOpenAI = async(
  messages: ChatMessage[],
  assistantId: string,
) => {
  try {
    const assistant = await openai.beta.assistants.retrieve(assistantId)
    const threadId: string = (assistant.metadata as any).threadId
    const runs = await openai.beta.threads.runs.list(
      threadId,
    )
    for (const run of runs.data) {
      // cancel any run in progress
      if (run.status === 'queued' || run.status === 'in_progress' || run.status === 'requires_action') {
        console.warn('Cancelling run reason:', run.status, run.id)
        await openai.beta.threads.runs.cancel(
          threadId,
          run.id,
        )
      }
    }
    if (contexts.has(assistant.id)) {
      try {
        const context = contexts.get(assistant.id)
        context.controller.close()
        contexts.delete(assistant.id)
        await openai.beta.threads.runs.cancel(
          context.threadId,
          context.runId,
        )
      } catch (e) {
        console.error('Error closing previous thread', e)
      }
    }

    for (const message of messages) {
      await openai.beta.threads.messages.create(
        threadId,
        {
          role: message.role as 'user' | 'assistant',
          content: message.content,
        },
      )
    }
    const rawStream = await openai.beta.threads.runs.create(
      threadId,
      { assistant_id: assistant.id, stream: true },
    )
    const context: ThreadContext = {
      assistantId: assistant.id,
      threadId,
      runId: '',
      encoder: new TextEncoder(),
    }
    contexts.set(assistant.id, context)
    const stream = new ReadableStream({
      async start(controller) {
        context.controller = controller
        for await (const event of rawStream) {
          await processEvent(event, context)
        }
      },
    })

    return new Response(stream)
  } catch (e) {
    console.error('Error processing OpenAI', e)
    return new Response(JSON.stringify({
      error: {
        message: e.message,
      },
    }), { status: 500 })
  }
}

async function processEvent(event: OpenAI.Beta.Assistants.AssistantStreamEvent,
  context: ThreadContext,
) {
  const ignoredEvents = [
    'thread.run.step.delta',
    'thread.run.step.in_progress',
    'thread.run.queued',
    'thread.run.in_progress',
    'thread.run.step.created',
    'thread.run.step.completed',
    'thread.message.completed',
    'thread.message.in_progress',
    'thread.message.created',
  ]
  // https://platform.openai.com/docs/api-reference/runs/createRun
  if (event.event === 'thread.run.created') {
    context.runId = event.data.id
  } else if (event.event === 'thread.run.requires_action') {
    try {
      for (const toolCall of event.data.required_action.submit_tool_outputs.tool_calls) {
        console.log('requires_action', toolCall)
        const payload = `JSON://${JSON.stringify(toolCall)}`
        const queue = context.encoder.encode(`$${payload.length} ${payload}`)
        context.controller.enqueue(queue)
      }
    } catch (e) {
      context.controller.error(e)
    }
  } else if (event.event === 'thread.message.delta') {
    const data = event.data
    try {
      for (const delta of data.delta.content) {
        const text = delta
        if (text.type === 'text') {
          const queue = context.encoder.encode(text.text.value)
          context.controller.enqueue(queue)
        } else {
          context.controller.error(new Error('Unsupported delta type'))
        }
      }
    } catch (e) {
      context.controller.error(e)
    }
  } else if (ignoredEvents.includes(event.event)) {
    // console.log('ignored event', event.event)
    /* ignore */
  } else if (event.event === 'thread.run.completed') {
    context.controller.close()
    contexts.delete(context.assistantId)
  } else {
    console.log('Unhandled event', event)
  }
}

export async function notifyCall(data: { assistantId: string, toolCallId: string, output: any }) {
  if (!data || !data.assistantId || !data.toolCallId) {
    console.error('notifyCall', data)
    return
  }
  const context = contexts.get(data.assistantId)
  if (!context) {
    console.log('notifyCall', data)
    console.log(contexts.keys())
    return
  }
  if (typeof data.output === 'object') data.output = JSON.stringify(data.output)
  await submitToolOutputs(
    [{
      tool_call_id: data.toolCallId,
      output: data.output || 'done',
    }],
    context,
  )
}

export async function notifyRoomAction(roomId: string, description: string, reactionExpected = false, context?: any) {
  if (!assistantMap.has(roomId)) {
    throw new Error('No assistant found for room')
  }
  const assistants = assistantMap.get(roomId)
  for (const assistant of assistants) {
    await openai.beta.threads.messages.create(
      (assistant.metadata as any).threadId,
      {
        role: 'assistant',
        content: `On ${new Date().toISOString()} the user interacted with a button in the room.`
            + `${(context ? `The technical context is ${JSON.stringify(context)}.` : '')}`
            + `${(reactionExpected ? ' In the next message I should try to give an answer or do an action according to this interaction.' : '')}`
            + `The interaction has the following description : ${description}`,
      },
    )
  }
}

async function submitToolOutputs(toolOutputs: { tool_call_id: string, output: string }[], context: ThreadContext) {
  try {
    const imgs = []
    for (const toolOutput of toolOutputs) {
      if (toolOutput.output.startsWith('data:image')) {
        // Extract base64 data
        const base64Data = toolOutput.output.split(',')[1]
        const filePath = `./tmp/image-${Date.now()}.png`

        // Write base64 data to a file
        await writeFile(filePath, base64Data, { encoding: 'base64' })

        // Upload the file
        const file = await openai.files.create({
          file: fs.createReadStream(filePath),
          purpose: 'vision' as any,
        })

        // Store the URL or file id returned by OpenAI for later use
        imgs.push(file.id)

        // Update the output message
        toolOutput.output = 'image captured'
      }
    }

    console.log(toolOutputs)

    // Use the submitToolOutputsStream helper
    const stream = openai.beta.threads.runs.submitToolOutputsStream(
      context.threadId,
      context.runId,
      { tool_outputs: toolOutputs },
    )

    for await (const event of stream) {
      await processEvent(event, context)
    }

    for (const img of imgs) {
      console.log('submitting image', img)
      await openai.beta.threads.messages.create(
        context.threadId,
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Uploaded image' },
            {
              type: 'image_file',
              image_file: {
                file_id: img,
              },
            },
          ],
        },
      )
    }
  } catch (error) {
    console.error('Error submitting tool outputs:', error)
  }
}
