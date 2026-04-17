import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Send, Sparkles } from "lucide-react";
import { ChatBubble, TypingIndicator } from "./ChatBubble";
import type { ChatMessage } from "@/lib/types";
import { generateId, getRandomAIResponse } from "@/lib/mock-data";

interface ChatInterfaceProps {
  jobId: string;
  messages: ChatMessage[];
  onMessagesChange: (messages: ChatMessage[]) => void;
}

const quickActions = [
  "Analyze match",
  "Tailor resume",
  "Write cover letter",
  "Interview prep",
];

export function ChatInterface({
  jobId,
  messages,
  onMessagesChange,
}: ChatInterfaceProps) {
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, isTyping]);

  const sendMessage = (content: string) => {
    if (!content.trim()) return;

    const userMessage: ChatMessage = {
      id: generateId("msg"),
      jobId,
      role: "user",
      content: content.trim(),
      timestamp: new Date().toISOString(),
    };

    const updated = [...messages, userMessage];
    onMessagesChange(updated);
    setInput("");
    setIsTyping(true);

    setTimeout(() => {
      const aiMessage: ChatMessage = {
        id: generateId("msg"),
        jobId,
        role: "ai",
        content: getRandomAIResponse(),
        timestamp: new Date().toISOString(),
      };
      onMessagesChange([...updated, aiMessage]);
      setIsTyping(false);
    }, 1800);
  };

  return (
    <div className="flex flex-col h-full">
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto p-4 space-y-4 scroll-smooth"
      >
        {messages.length === 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex flex-col items-center justify-center h-full text-center py-16"
          >
            <div className="w-16 h-16 rounded-2xl bg-brand/10 border border-border flex items-center justify-center mb-4">
              <Sparkles className="w-8 h-8 text-brand" />
            </div>
            <h3 className="text-lg font-semibold text-foreground mb-2 font-heading">
              Start a conversation
            </h3>
            <p className="text-sm text-muted-foreground max-w-xs mb-6">
              Ask me to analyze the job, tailor your resume, write a cover
              letter, or prepare for interviews.
            </p>
            <div className="flex flex-wrap gap-2 justify-center">
              {quickActions.map((action) => (
                <motion.button
                  key={action}
                  type="button"
                  whileHover={{ scale: 1.03 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => sendMessage(action)}
                  className="btn-tf-secondary animate-btn-shine px-4 py-2 text-sm min-h-0 font-medium"
                >
                  {action}
                </motion.button>
              ))}
            </div>
          </motion.div>
        )}

        {messages.map((msg, i) => (
          <ChatBubble key={msg.id} message={msg} index={i} />
        ))}

        <AnimatePresence>{isTyping && <TypingIndicator />}</AnimatePresence>
      </div>

      <div className="p-4 border-t border-border bg-card/30">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            sendMessage(input);
          }}
          className="flex gap-2"
        >
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything about this job..."
            className="field-input flex-1 h-11 px-4 text-sm"
          />
          <motion.button
            whileHover={{ scale: 1.05 }}
            whileTap={{ scale: 0.95 }}
            type="submit"
            disabled={!input.trim() || isTyping}
            className="btn-tf animate-btn-shine size-11 min-h-0 p-0 shrink-0 disabled:opacity-40 disabled:pointer-events-none"
          >
            <Send className="w-4 h-4" />
          </motion.button>
        </form>
      </div>
    </div>
  );
}
