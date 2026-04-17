import { motion } from "framer-motion";
import { Bot, User } from "lucide-react";
import type { ChatMessage } from "@/lib/types";
import Markdown from "react-markdown";
import { cn } from "@/lib/utils";

interface ChatBubbleProps {
  message: ChatMessage;
  index?: number;
}

export function ChatBubble({ message, index = 0 }: ChatBubbleProps) {
  const isAI = message.role === "ai";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10, x: isAI ? -10 : 10 }}
      animate={{ opacity: 1, y: 0, x: 0 }}
      transition={{
        duration: 0.4,
        delay: index * 0.05,
        ease: [0.22, 1, 0.36, 1],
      }}
      className={cn("flex gap-3", !isAI && "flex-row-reverse")}
    >
      <div
        className={cn(
          "w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-1 border border-border",
          isAI ? "bg-brand text-white" : "bg-muted text-muted-foreground"
        )}
      >
        {isAI ? (
          <Bot className="w-4 h-4" />
        ) : (
          <User className="w-4 h-4" />
        )}
      </div>

      <div className={cn("flex-1 max-w-[85%]", !isAI && "flex justify-end")}>
        <div
          className={cn(
            "rounded-2xl px-4 py-3 border",
            isAI
              ? "bg-card border-border text-foreground"
              : "bg-brand/10 border-brand/25"
          )}
        >
          {isAI ? (
            <div
              className="prose prose-sm max-w-none dark:prose-invert
              [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_h2]:mt-3 [&_h2]:mb-2
              [&_h3]:text-sm [&_h3]:font-semibold [&_h3]:text-foreground
              [&_p]:text-muted-foreground [&_p]:text-sm [&_p]:leading-relaxed
              [&_li]:text-muted-foreground [&_li]:text-sm
              [&_strong]:text-foreground
              [&_code]:text-brand [&_code]:bg-brand/10 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded
              [&_blockquote]:border-brand/30 [&_blockquote]:text-muted-foreground
              [&_hr]:border-border"
            >
              <Markdown>{message.content}</Markdown>
            </div>
          ) : (
            <p className="text-sm text-foreground leading-relaxed">
              {message.content}
            </p>
          )}
        </div>
        <p className="text-[10px] text-muted-foreground mt-1 px-2">
          {new Date(message.timestamp).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </p>
      </div>
    </motion.div>
  );
}

export function TypingIndicator() {
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      className="flex gap-3"
    >
      <div className="w-8 h-8 rounded-lg bg-brand text-white flex items-center justify-center shrink-0 border border-border">
        <Bot className="w-4 h-4" />
      </div>
      <div className="bg-card border border-border rounded-2xl px-4 py-3 flex items-center gap-1.5">
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-2 h-2 rounded-full bg-brand/70"
            animate={{ opacity: [0.3, 1, 0.3], scale: [0.8, 1, 0.8] }}
            transition={{
              duration: 1.2,
              repeat: Infinity,
              delay: i * 0.15,
            }}
          />
        ))}
      </div>
    </motion.div>
  );
}
