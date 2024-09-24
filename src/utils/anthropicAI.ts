// #vercel-disable-blocks
import { ProxyAgent, fetch } from 'undici'
// #vercel-end
import type { RequestInit } from 'undici'
import type { ChatMessage } from '@/types'
import { AItools as AItoolsRaw } from './assistantTools'

/*
!!!!!!!!!!!!!!!!!!!!

This script is a work in progress, we still need to implement a way to
remove the thinking process from the assistant effectively,
implement the cleanupClaudeAssistants function,
and implement Timeouts in case we don't get a response from Claude.

So the Tool system is not implemented yet
we may need to remake how we handle messages with
the Generator.tsx file

!!!!!!!!!!!!!!!!!!!!
*/

// Convert OpenAI tools to Claude tools format
const convertToClaudeTool = (tool: any) => ({
  name: tool.function.name,
  description: tool.function.description,
  input_schema: tool.function.parameters ? tool.function.parameters : {
    // Default to an empty object if no parameters are defined
    "type": "object",
    "properties": {}
  }
})
const AItools = AItoolsRaw.map(convertToClaudeTool)


// I modified the Payload so we can use a model based on the Query String
const defModel = 'claude-3-sonnet-20240229'

const claudeApiKey = import.meta.env.ANTHROPIC_API_KEY
const claudeBaseUrl = ((import.meta.env.ANTHROPIC_API_BASE_URL) || 'https://api.anthropic.com').trim().replace(/\/$/, '')
const httpsProxy = import.meta.env.HTTPS_PROXY

console.log("claudeApiKey", claudeApiKey)

// Update headers as needed
const headerObject = {
  'Content-Type': 'application/json',
  'X-API-Key': `${claudeApiKey}`,
  'anthropic-version': '2023-06-01',
}

// Define an extended type that includes the dispatcher property
interface ExtendedRequestInit extends RequestInit {
  dispatcher?: ProxyAgent;
}

export function cleanupClaudeAssistants() {
  // TODO: Implement cleanupClaudeAssistants
}

/**
 * in our case the name of this assistant is the threadId (since we have custom prompt for every assistant / room)
 * @param threadId
 * @param model
 * @param prompt
 * @param useTool
 * @param roomid
 */
export async function createClaude(
  threadId: string,
  model: string,
  prompt?: string,
  useTool: boolean = false
): Promise<{ id: string }> {
  cleanupClaudeAssistants();
  if (!prompt) prompt = 'You are a personal assistant'

  useTool = false; // Always disable tools for Claude

  //console.log("useTool", useTool)

  const payload = {
    model,
    prompt,
    instructions: prompt,
    tools: useTool ? AItools : [],
    metadata: {
      threadId,
    },
    max_tokens: 1024,
  }

  const initOptions: ExtendedRequestInit = generateClaudePayload([], model, prompt, useTool ? AItools : [])
  // #vercel-disable-blocks
  if (httpsProxy)
    initOptions.dispatcher = new ProxyAgent(httpsProxy)
  // #vercel-end

  const response = await fetch(`${claudeBaseUrl}/v1/assistants`, {
    ...initOptions,
    method: 'POST',
    body: JSON.stringify(payload),
  }).catch((err: Error) => {
    console.error(err)
    throw new Error('Failed to create Claude assistant')
  })

  const assistant = await response.json() as { id: string }
  return { id: assistant.id }
}

export const processClaude = async (
  messages: ChatMessage[],
  model = defModel,
  system = '',
  useTool = false,
) => {
  const payload = {
    model,
    messages,
    system,
    max_tokens: 1024, // Ensure max_tokens is included here
    temperature: 0.6,
    stream: true,
    tools: useTool ? AItools : [],
  }

  const initOptions: ExtendedRequestInit = {
    headers: headerObject,
    method: 'POST',
    body: JSON.stringify(payload),
  }

  // #vercel-disable-blocks
  if (httpsProxy)
    initOptions.dispatcher = new ProxyAgent(httpsProxy)
  // #vercel-end

  const response = await fetch(`${claudeBaseUrl}/v1/messages`, {
    ...initOptions,
  }).catch((err: Error) => {
    console.error(err)
    return new Response(JSON.stringify({
      error: {
        code: err.name,
        message: err.message,
      },
    }), { status: 500 })
  }) as Response
  return parseClaudeStream(response)
}

export const parseClaudeStream = (rawResponse: Response) => {
  const encoder = new TextEncoder()
  const decoder = new TextDecoder()
  if (!rawResponse.ok) {
    return new Response(rawResponse.body, {
      status: rawResponse.status,
      statusText: rawResponse.statusText,
    })
  }

  const stream = new ReadableStream({
    async start(controller) {
      const reader = rawResponse.body.getReader()
      let buffer = ''

      let isThinking = false;
      let thinkCheck = false;
      let thinkingDone = false;
      let thinkingBuffer = '';

      while (true) {
        try {
          const { done, value } = await reader.read()
          if (done) {
            if (buffer) {
              controller.enqueue(encoder.encode(buffer))
            }
            controller.close()
            break
          }

          const chunk = decoder.decode(value, { stream: true })
          buffer += chunk;

          let toolExecution = false;

          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            if (line.startsWith('data:')) {
              const data = line.substring('data:'.length).trim()
              if (data) {
                try {
                  const eventData = JSON.parse(data)
                  //console.log("eventData", eventData)
                  if (eventData.type === 'content_block_start'
                  &&  eventData.content_block?.type === 'tool_use'
                  ) {// Claude wants to execute a tool
                    const tool = eventData.content_block.name;
                    const toolCallId = eventData.content_block.tool_call_id;
                    const toolParams = eventData.content_block.parameters;

                    console.log(`Executing Tool: ${tool}`);

                    // Execute the tool
                    /*const toolOutput = await executeTool(tool, toolParams);
                    
                    // Notify the tool execution result
                    const payload = { toolCallId, output: toolOutput };
                    await fetch('./api/notifyCall', { method: 'POST', body: JSON.stringify(payload) });
                    */
                    toolExecution = true;
                  }


                  if (!toolExecution && eventData.type === 'content_block_delta' && eventData.delta.type === 'text_delta') {
                    //controller.enqueue(encoder.encode(eventData.delta.text))
                    //console.log('eventData.delta.text ['+eventData.delta.text+"]");
                    
                    // 1) Check if we suspect a '<thinking>' tag
                    if (!thinkingDone && eventData.delta.text.startsWith('<')) {
                      thinkCheck = true;
                    }

                    // 4) Only send the text if the AI is not thinking
                    // Nor checking for AI thinking
                    if (!thinkCheck && !isThinking) {
                      controller.enqueue(encoder.encode(eventData.delta.text))
                    }

                    // 3) Check if the AI is done thinking
                    if (isThinking) {
                      thinkingBuffer += eventData.delta.text;
                      if (thinkingBuffer.includes('</thinking>')) {
                        // The AI is done thinking
                        isThinking = false;
                        thinkingDone = true;
                        console.log("AI is done thinking:\n"+thinkingBuffer);

                        // Remove EVERYTHING inside thinkingBuffer, except for the text after '</thinking>'
                        thinkingBuffer = thinkingBuffer.substring(thinkingBuffer.indexOf('</thinking>') + '</thinking>'.length);
                        controller.enqueue(encoder.encode(thinkingBuffer+"Processing command"));
                        
                        thinkingBuffer = '';
                      }
                    }

                    // 2) Check if the AI is thinking
                    if (!thinkingDone && thinkCheck) {
                      thinkingBuffer += eventData.delta.text;

                      // First, compare thinkingBuffer to each letter of '<thinking>'
                      // If the letter is the same, continue
                      for (let i = 0; i < thinkingBuffer.length; i++) {
                        if (i < '<thinking>'.length
                        && thinkingBuffer.charAt(i) !== '<thinking>'.charAt(i)) {
                          // The AI was not thinking, oops!
                          thinkCheck = false;
                          isThinking = false;
                          controller.enqueue(encoder.encode(thinkingBuffer));
                          thinkingBuffer = '';
                          break;
                        }
                      }

                      if (thinkCheck && thinkingBuffer.startsWith('<thinking>')) {
                        // The AI is thinking
                        isThinking = true;
                        thinkCheck = false;
                        console.log("AI is thinking");
                      }
                    }
                    

                  }
                } catch (e) {
                  console.error('Error parsing JSON:', e)
                  console.error('Offending JSON string:', data)
                  // Skip the invalid data and continue processing
                  continue
                }
              }
            }
          }
        } catch (e) {
          controller.error(e)
          break
        }
      }
    },
  })

  return new Response(stream)
}

const generateClaudePayload = (messages: ChatMessage[], model = defModel, system = '', AItools:any): ExtendedRequestInit => ({
  headers: headerObject,
  method: 'POST',
  body: JSON.stringify({
    model,
    messages,
    system,
    max_tokens: 1024, // Ensure max_tokens is included here as well
    temperature: 0.6,
    stream: true,
    tools: AItools,
  }),
})
