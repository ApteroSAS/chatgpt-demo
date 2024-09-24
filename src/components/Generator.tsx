import { Index, Show, createEffect, createSignal, onCleanup, onMount } from 'solid-js'
import { useThrottleFn } from 'solidjs-use'
import { generateSignature } from '@/utils/auth'
import { accumulateOrGetValue } from '@/aptero/api/Accumulator'
import { FrontEndCommandAPI } from '@/aptero/api/FrontEndCommandAPI'
import { externalTrigger } from '@/aptero/api/ExternalTrigger'
import IconClear from './icons/Clear'
import MessageItem from './MessageItem'
import IconReport from './icons/Report'

import ErrorMessageItem from './ErrorMessageItem'
import type { ChatMessage, ErrorMessage } from '@/types'

const frontEndCommandAPI = new FrontEndCommandAPI()

export default () => {
  let inputRef: HTMLTextAreaElement

  const [currentSystemRoleSettings, setCurrentSystemRoleSettings] = createSignal('')

  const [systemRoleEditing] = createSignal(false)
  const [messageList, setMessageList] = createSignal<ChatMessage[]>([])
  const [currentError, setCurrentError] = createSignal<ErrorMessage>()
  const [currentAssistantMessage, setCurrentAssistantMessage] = createSignal('')
  const [loading, setLoading] = createSignal(true)
  const [controller, setController] = createSignal<AbortController>(null)
  const [isStick, setStick] = createSignal(false)
  const [popupVisible, setPopupVisible] = createSignal(false)
  const [reportText, setReportText] = createSignal('') // Signal to store report text
  const [threadId, setThreadId] = createSignal<string | null>(null)

  // We add a Default MODEL that can be changed using a Query string!
  const [currentModel, setCurrentModel] = createSignal('gpt-3.5-turbo')

  createEffect(() => (isStick() && smoothToBottom()))

  onMount(() => {
    // console.log('onMount')
    let lastPostion = window.scrollY
    const url = new URL(window.location.href)
    const params = url.searchParams

    window.addEventListener('scroll', () => {
      const nowPostion = window.scrollY
      nowPostion < lastPostion && setStick(false)
      lastPostion = nowPostion
    })

    if (params.get('model'))
      setCurrentModel(params.get('model'))

    try {
      if (params.get('intro')) {
        setMessageList([{
          content: params.get('intro'),
          role: 'assistant',
        }])
      }

      if (params.get('prompt'))
        setCurrentSystemRoleSettings(params.get('prompt'))

      if (localStorage.getItem('stickToBottom') === 'stick')
        setStick(true)
    } catch (err) {
      console.error(err)
    }
    // Do not save if the ignorecache is set to true
    if (!params.get('ignorecache')) {
      window.addEventListener('beforeunload', handleBeforeUnload)
      onCleanup(() => {
        window.removeEventListener('beforeunload', handleBeforeUnload)
      })
    }
    (async() => {
      let roomDescription = null
      try {
        if (window.parent) {
          await frontEndCommandAPI.listen()
          roomDescription = await Promise.race([
            frontEndCommandAPI.describe(),
            new Promise(resolve => setTimeout(() => resolve(''), 3000)),
          ])
        }
      } catch (e) {
        console.info('No parent window found (no tool support)')
      }
      const roomDescriptionStr = roomDescription ? `\n\n\nHere is a technical description (as if you used describe) of the room: ${JSON.stringify(roomDescription)}` : ''
      fetch('./api/create', {
        method: 'POST',
        body: JSON.stringify({
          threadId, // TODO load from storage to retreive previous thread // empty to start a new convo
          model: currentModel(),
          systemPrompt: currentSystemRoleSettings() + roomDescriptionStr,
          useTool: !!roomDescription,
          id: (roomDescription as any)?.room?.id,
        }),
      }).then(response => response.json()).then((data) => {
        console.log(data.id)
        setThreadId(data.id)
        setLoading(false)
      }).catch((error) => {
        console.error('Error:', error)
      })
      externalTrigger.onExternalTrigger((message) => {
        // At least have one message so we trigger a reaction with a message
        if (message) {
          setMessageList([
            ...messageList(), {
              role: 'user',
              content: message,
            },
          ])
        } else {
          setMessageList([
            ...messageList(), {
              role: 'assistant',
              content: '**Processing button interaction.**',
            },
          ])
        }
        requestWithLatestMessage()
        instantToBottom()
      })
    })()
  })

  const handleBeforeUnload = () => {
    // console.log('handleBeforeUnload')
    localStorage.setItem('messageList', JSON.stringify(messageList()))
    localStorage.setItem('systemRoleSettings', currentSystemRoleSettings())
    isStick() ? localStorage.setItem('stickToBottom', 'stick') : localStorage.removeItem('stickToBottom')
  }

  const handleButtonClick = async() => {
    // console.log('send', inputRef.value)
    const inputValue = inputRef.value
    if (!inputValue)
      return

    inputRef.value = ''
    setMessageList([
      ...messageList(),
      {
        role: 'user',
        content: inputValue,
      },
    ])
    requestWithLatestMessage()
    instantToBottom()
  }

  const smoothToBottom = useThrottleFn(() => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' })
  }, 300, false, true)

  const instantToBottom = () => {
    window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' })
  }

  const requestWithLatestMessage = async() => {
    // console.log('requestWithLatestMessage',currentModel())
    setLoading(true)
    setCurrentAssistantMessage('')
    setCurrentError(null)
    const storagePassword = localStorage.getItem('pass')
    try {
      const controller = new AbortController()
      setController(controller)
      const requestMessageList = [...messageList()]
      if (currentSystemRoleSettings() && currentModel().startsWith('gpt')) {
        requestMessageList.unshift({
          role: 'system',
          content: currentSystemRoleSettings(),
        })
      }
      const timestamp = Date.now()
      const response = await fetch('./api/generate', {
        method: 'POST',
        body: JSON.stringify({
          model: currentModel(), // We add the model to the request so we can change it using the current Query string
          messages: requestMessageList,
          system: currentModel().startsWith('claude') ? currentSystemRoleSettings() : undefined,
          time: timestamp,
          pass: storagePassword,
          assistantId: threadId(),
          sign: await generateSignature({
            t: timestamp,
            m: requestMessageList?.[requestMessageList.length - 1]?.content || '',
          }),
        }),
        signal: controller.signal,
      })
      if (!response.ok) {
        const error = await response.json()
        console.error(error.error)
        setCurrentError(error.error)
        throw new Error('Request failed')
      }
      const data = response.body
      if (!data)
        throw new Error('No data')

      const reader = data.getReader()
      const decoder = new TextDecoder('utf-8')
      let done = false

      while (!done) {
        const { value, done: readerDone } = await reader.read()
        if (value) {
          let chunk = decoder.decode(value)
          chunk = accumulateOrGetValue(chunk)
          if (chunk) {
            if (chunk.startsWith('JSON://')) {
              const json = JSON.parse(chunk.replace('JSON://', ''))
              if (json.type === 'function') {
                setCurrentAssistantMessage(`${currentAssistantMessage()} \n **Executing Function: ${json.function.name}** \n`)
                frontEndCommandAPI.execCommand(json).then(async(res) => {
                  const payload = { assistantId: threadId(), toolCallId: json.id, output: res }
                  await fetch('./api/notifyCall', { method: 'POST', body: JSON.stringify(payload) })
                  console.log(res)
                }).catch(async(err) => {
                  console.error(err)
                  const payload = { assistantId: threadId(), toolCallId: json.id, output: `ERROR : ${typeof err === 'string' ? err : err.message}` }
                  await fetch('./api/notifyCall', { method: 'POST', body: JSON.stringify(payload) })
                })
              }
              console.log(json)
            } else {
              if (chunk === '\n' && currentAssistantMessage().endsWith('\n'))
                continue
              if (chunk)
                setCurrentAssistantMessage(currentAssistantMessage() + chunk)

              isStick() && instantToBottom()
            }
          }
        }
        done = readerDone
      }
    } catch (e) {
      console.error(e)
      setLoading(false)
      setController(null)
      return
    }
    archiveCurrentMessage()
    isStick() && instantToBottom()
  }

  const archiveCurrentMessage = () => {
    // console.log('archiveCurrentMessage')
    if (currentAssistantMessage()) {
      setMessageList([
        ...messageList(),
        {
          role: 'assistant',
          content: currentAssistantMessage(),
        },
      ])
      setCurrentAssistantMessage('')
      setLoading(false)
      setController(null)
      inputRef.focus()
    }
  }

  const clear = () => {
    // console.log('clear')
    const url = new URL(window.location.href)
    const params = url.searchParams
    inputRef.value = ''
    inputRef.style.height = 'auto'
    if (params.get('intro')) {
      setMessageList([{
        content: params.get('intro'),
        role: 'assistant',
      }])
    } else {
      setMessageList([])
    }
    setCurrentAssistantMessage('')
    setCurrentError(null)
  }

  const stopStreamFetch = () => {
    // console.log('stopStreamFetch')
    if (controller()) {
      controller().abort()
      archiveCurrentMessage()
    }
  }

  const retryLastFetch = () => {
    // console.log('retryLastFetch')
    if (messageList().length > 0) {
      const lastMessage = messageList()[messageList().length - 1]
      if (lastMessage.role === 'assistant')
        setMessageList(messageList().slice(0, -1))

      requestWithLatestMessage()
    }
  }

  const handleKeydown = (e: KeyboardEvent) => {
    // console.log('handleKeydown', e)
    if (e.isComposing || e.shiftKey)
      return

    if (e.keyCode === 13) {
      e.preventDefault()
      handleButtonClick()
    }
  }

  const report = () => {
    setPopupVisible(!popupVisible())
  }

  const hidePopup = () => {
    setPopupVisible(false)
    setReportText('') // Clear the report text when popup is closed
  }

  const reportListPrerocess = () => {
    return messageList().map((message) => {
      let rolePrefix = '';
      
      switch (message.role) {
        case 'system':
          rolePrefix = 'System: ';
          break;
        case 'assistant':
          rolePrefix = 'Assistant: ';
          break;
        case 'user':
          rolePrefix = 'User: ';
          break;
        default:
          rolePrefix = '';
      }
      
      return `${rolePrefix}${message.content}`;
    }).join('\n');
  };  

  const handleReportSubmit = () => {
    if (reportText().trim()) {
      // Preprocess the message list before sending it in the report
      const preprocessedMessages = reportListPrerocess();
  
      const reportData = {
        userMessage: reportText(),
        chatLog: preprocessedMessages, // Use the preprocessed messages here
        currentModel: currentModel(),
        systemPrompt: currentSystemRoleSettings()
      };
  
      fetch('./api/sendReport', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(reportData),
      })
      .then(response => response.json())
      .then(data => {
        if (data.success) {
          alert('Report submitted successfully.');
          hidePopup();
        } else {
          alert('Failed to send the report. Please try again later.');
        }
      })
      .catch((error) => {
        console.error('Failed to send the report:', error);
        alert('Failed to send the report. Please try again later.');
      });
    } else {
      alert('Please write a report before submitting.');
    }
  };
  

  const copyAll = () => { // Copy all the messages to the clipboard (including the currentSystemRoleSettings at the beggining) and sepparated by a comma
    let reportText = `{"role":"system","content":${JSON.stringify(currentSystemRoleSettings())}},`
    messageList().forEach((message) => {
      reportText += JSON.stringify(message)
      if (message !== messageList()[messageList().length - 1])
        reportText += ','
    })
    reportText = `[${reportText}]`
    navigator.clipboard.writeText(reportText)
  }

  return (
    <div class="chatSpace" >
      {/*
      <SystemRoleSettings
        canEdit={() => messageList().length === 0}
        systemRoleEditing={systemRoleEditing}
        setSystemRoleEditing={setSystemRoleEditing}
        currentSystemRoleSettings={currentSystemRoleSettings}
        setCurrentSystemRoleSettings={setCurrentSystemRoleSettings}
      />
      */}
      {popupVisible() && (
        <div class="report-popup">
          <p class="content">Please write your report below:</p>
          <textarea
            class="content"
            value={reportText()}
            onInput={(e) => setReportText((e.target as HTMLTextAreaElement).value)}
            rows="5"
            placeholder="Write your report here..."
            style="width: 100%; margin-bottom: 1em;"
          />
          <div class="content">
            <button class="content" gen-slate-btn style="margin: 0 1em" onClick={handleReportSubmit}>
              Submit Report
            </button>
            <button class="content" gen-slate-btn style="margin: 0 1em" onClick={hidePopup}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <Index each={messageList()}>
        {(message, index) => (
          <MessageItem
            role={message().role}
            message={message().content}
            showRetry={() => ((message().role === 'assistant' && index === messageList().length - 1)
                || (message().role === 'user' && index === messageList().length - 1 && !loading()))}// also retry if the last message is user message the AI is not working on it.
            onRetry={retryLastFetch}
          />
        )}
      </Index>
      {currentAssistantMessage() && (
        <MessageItem
          role="assistant"
          message={currentAssistantMessage}
        />
      )}
      { currentError() && <ErrorMessageItem data={currentError()} onRetry={retryLastFetch} /> }
      <Show
        when={!loading()}
        fallback={() => (
          <div class="gen-cb-wrapper">
            <span>AI is thinking...</span>
            <div class="gen-cb-stop" onClick={stopStreamFetch}>Stop</div>
          </div>
        )}
      >
        <div class:op-50={systemRoleEditing()}>
          <div>
            <textarea
              ref={inputRef!}
              disabled={systemRoleEditing()}
              onKeyDown={handleKeydown}
              placeholder="Enter something..."
              autocomplete="off"
              autofocus
              onInput={() => {
                inputRef.style.height = 'auto'
                inputRef.style.height = `${inputRef.scrollHeight}px`
              }}
              style={{ width: '100%' }}
              rows="1"
              class="gen-textarea"
            />
            <div
              style={{
                'display': 'flex',
                'gap': '10px',
                'flex-direction': 'row-reverse',
              }}
            >
              <button onClick={handleButtonClick} disabled={systemRoleEditing()} gen-slate-btn>
                Send
              </button>
              <button title="Clear" onClick={clear} disabled={systemRoleEditing()} gen-slate-btn>
                <IconClear />
              </button>
              <button 
                title="Report" 
                onClick={() => setPopupVisible(!popupVisible())}
                disabled={systemRoleEditing()}
                gen-slate-btn
              >
                <IconReport />
              </button>
              <div
                class="rounded-md hover:bg-slate/10 w-fit h-fit transition-colors active:scale-90"
                class:stick-btn-on={isStick()}
              >
                <button title="stick to bottom" type="button" onClick={() => setStick(!isStick())} gen-slate-btn>
                  <div i-ph-arrow-down-bold />
                </button>
              </div>
            </div>
          </div>
        </div>
      </Show>
      <div class="sub-footer" style="opacity: 0.6; text-align: center;">
        You can report any inappropriate content using the report button
      </div>

    </div>
  )
}
