import { useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Loader2, AlertTriangle, KeyRound } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { ChatHeader } from './ChatHeader'
import { ChatMessageList } from './ChatMessageList'
import { ChatInput, type ChatInputHandle } from './ChatInput'
import { ChatEmptyState } from './ChatEmptyState'
import {
  flattenChatMessages,
  useChatMessages,
  useCreateOrGetChatSession,
  useDeleteChatSession,
  useSendChatMessage,
} from '@/hooks/useChat'
import { useAIGate } from '@/hooks/useAIGate'
import type { ApiError } from '@/lib/types'

interface Props {
  jobId: string | null
  /** Called when the user clicks close. */
  onClose: () => void
  /** Optional handler to open the job's detail drawer from the chat header. */
  onOpenJob?: (jobId: string) => void
}

export function ChatDrawer({ jobId, onClose, onOpenJob }: Props) {
  const { hasKey, isLoading: aiKeyLoading } = useAIGate()
  const navigate = useNavigate()

  // Create-or-get runs exactly once per open.
  const createOrGet = useCreateOrGetChatSession()
  const [sessionId, setSessionId] = useState<string | null>(null)
  const [sessionError, setSessionError] = useState<ApiError | null>(null)
  const initTriggeredRef = useRef<string | null>(null)

  useEffect(() => {
    if (!jobId) {
      setSessionId(null)
      setSessionError(null)
      initTriggeredRef.current = null
      return
    }
    if (!hasKey || aiKeyLoading) return
    if (initTriggeredRef.current === jobId) return

    initTriggeredRef.current = jobId
    setSessionError(null)
    createOrGet.mutate(jobId, {
      onSuccess: (summary) => setSessionId(summary.id),
      onError: (err) => setSessionError(err as unknown as ApiError),
    })
    // createOrGet.mutate identity is stable, intentionally not in deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, hasKey, aiKeyLoading])

  const session = createOrGet.data ?? null

  const messagesQuery = useChatMessages(sessionId)
  const messages = useMemo(() => flattenChatMessages(messagesQuery.data), [messagesQuery.data])

  const send = useSendChatMessage(sessionId)
  const deleteSession = useDeleteChatSession()

  const [sendTick, setSendTick] = useState(0)
  const inputRef = useRef<ChatInputHandle>(null)

  const handleSend = async (content: string) => {
    if (!sessionId) return
    setSendTick((t) => t + 1)
    try {
      await send.mutateAsync({ content })
    } catch {
      /* onError in the hook already handles cache state */
    }
  }

  const handleRetry = (content: string) => {
    inputRef.current?.setValue(content)
    inputRef.current?.focus()
  }

  const handleClearHistory = async () => {
    if (!sessionId) return
    const ok = window.confirm(
      'Clear this chat history? The session will be removed and a new one will be created next time you open chat for this job.',
    )
    if (!ok) return
    await deleteSession.mutateAsync(sessionId)
    onClose()
  }

  const open = !!jobId

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="chat-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm"
          />
          <motion.aside
            key="chat-drawer"
            initial={{ x: '100%' }}
            animate={{ x: 0 }}
            exit={{ x: '100%' }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="fixed right-0 top-0 bottom-0 z-50 w-full max-w-lg glass-strong border-l border-border flex flex-col"
            aria-label="Job chat"
            role="dialog"
          >
            <ChatHeader
              session={session}
              onClose={onClose}
              onViewJob={onOpenJob}
              onClearHistory={session ? handleClearHistory : undefined}
            />

            {/* Body states */}
            {!hasKey && !aiKeyLoading ? (
              <MissingApiKeyState onGoToSettings={() => navigate('/settings#api-key')} />
            ) : sessionError ? (
              <SessionErrorState err={sessionError} onDismiss={onClose} />
            ) : !sessionId ? (
              <div className="flex-1 flex items-center justify-center">
                <Loader2 className="w-5 h-5 text-muted-foreground animate-spin" />
              </div>
            ) : (
              <>
                {messages.length === 0 && !messagesQuery.isLoading ? (
                  <div className="flex-1 overflow-y-auto">
                    <ChatEmptyState
                      jobTitle={session?.job_title}
                      company={session?.company}
                      disabled={send.isPending}
                      onPromptSelect={(p) => {
                        inputRef.current?.setValue(p)
                        inputRef.current?.focus()
                      }}
                    />
                  </div>
                ) : (
                  <ChatMessageList
                    messages={messages}
                    isLoadingInitial={messagesQuery.isLoading}
                    hasMore={!!messagesQuery.hasNextPage}
                    isLoadingMore={messagesQuery.isFetchingNextPage}
                    onLoadMore={() => messagesQuery.fetchNextPage()}
                    onRetry={handleRetry}
                    sendTick={sendTick}
                  />
                )}

                <ChatInput
                  ref={inputRef}
                  onSend={handleSend}
                  isSending={send.isPending}
                  disabled={!sessionId}
                />
              </>
            )}
          </motion.aside>
        </>
      )}
    </AnimatePresence>
  )
}

function MissingApiKeyState({ onGoToSettings }: { onGoToSettings: () => void }) {
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-border flex items-center justify-center mb-4">
        <KeyRound className="w-7 h-7 text-amber-500" />
      </div>
      <h3 className="text-base font-semibold text-foreground font-heading mb-1">
        OpenRouter key required
      </h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-5">
        Chat runs on your own OpenRouter key. Add yours in Settings to start chatting about this
        role.
      </p>
      <button
        type="button"
        onClick={onGoToSettings}
        className="btn-tf animate-btn-shine px-4 py-2 text-sm min-h-0"
      >
        Add API Key
      </button>
    </div>
  )
}

function SessionErrorState({ err, onDismiss }: { err: ApiError; onDismiss: () => void }) {
  const isJobNotReady = err.code === 'JOB_NOT_READY'
  const isApiKey = err.code === 'API_KEY_REQUIRED'
  return (
    <div className="flex-1 flex flex-col items-center justify-center text-center px-6">
      <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-border flex items-center justify-center mb-4">
        <AlertTriangle className="w-7 h-7 text-red-500" />
      </div>
      <h3 className="text-base font-semibold text-foreground font-heading mb-1">
        {isJobNotReady
          ? 'Alignment not ready yet'
          : isApiKey
            ? 'OpenRouter key required'
            : 'Couldn\'t start chat'}
      </h3>
      <p className="text-xs text-muted-foreground max-w-xs mb-5">
        {isJobNotReady
          ? 'Chat opens after the job\'s match analysis completes. Try again in a moment.'
          : err.message || 'An unexpected error occurred.'}
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="btn-tf-secondary animate-btn-shine px-4 py-2 text-sm min-h-0"
      >
        Close
      </button>
    </div>
  )
}
