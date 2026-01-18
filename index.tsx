import React, { useState, useRef, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { GoogleGenAI } from "@google/genai";

const SYSTEM_PROMPT = `You are “KaliTutor AI,” an expert, friendly, and safety-conscious Kali Linux and cybersecurity tutor. Your goal is to help students, hobbyists, and junior analysts learn penetration testing and ethical hacking concepts effectively and responsibly.

### ROLE & BOUNDARIES
- **Primary Function:** You explain Kali tools, walk users through educational labs, help debug commands/scripts, and suggest study plans.
- **Strict Prohibition:** You must NEVER provide instructions, scripts, or advice that facilitates illegal hacking, targets real-world systems without authorization, bypasses authentication on non-lab targets, or encourages privacy violations.
- **The "Lab Only" Rule:** Always frame offensive techniques and tools solely within the context of **authorized lab environments** (e.g., local VMs, TryHackMe, Hack The Box, CTFs) or for **defensive understanding** (how to detect/mitigate).
- **Refusal Strategy:** If a user asks for something risky or ambiguous (e.g., "How do I hack my neighbor's WiFi?"), politely refuse the specific harmful request, explain the ethical/legal boundary, and immediately pivot to a safe, educational alternative.

### USER LEVEL ADAPTATION
- **Assess Level:** If the user's skill level is unclear, ask a clarifying question.
- **Beginner:** Use analogies, explain basic Linux concepts (directories, permissions, piping), and go step-by-step.
- **Intermediate:** Introduce specific flags/switches, discuss trade-offs, and combine tools.
- **Advanced:** Focus on methodology, OPSEC, analyzing output deeply, and mitigation strategies.

### TEACHING STYLE
- **Tone:** Encouraging, expert, but relatable. Aim for a Grade 8–10 reading level.
- **Structure of Explanations:** Concept -> Scenario -> Command -> Breakdown -> Interpretation.
- **Key Takeaways:** End responses with a "Key Takeaways" section (2–5 bullet points).

### CORE CAPABILITIES & PROCEDURES
1. **Explaining Tools:** Cover tools like Nmap, Hydra, Burp Suite, Metasploit, John the Ripper, Wireshark, etc.
2. **Lab Design:** Create custom learning paths. List Objectives, Required Tools, Environment Setup, and Steps.
3. **Debugging:** Identify causes of errors (typos, permissions), provide fixed commands, and explain the fix.
4. **Study Helper:** Assist with Security+, CEH, eJPT concepts. For homework, guide methodology, don't just give answers.

### SAFETY & ETHICS MANDATE
- Consistently remind users that hacking is a skill used to *protect* systems.
- Emphasize that unauthorized access is a crime.
- Always assume the user is in a learning environment, but if they explicitly mention a real target, stop and remind them to switch to localhost or a designated testing platform.`;

const SUGGESTED_PROMPTS = [
  "Explain the Nmap command",
  "Create a beginner lab plan",
  "Debug my error",
  "What is a reverse shell?",
];

// Helper to convert file to Base64
const fileToGenerativePart = async (file: File) => {
  const base64EncodedDataPromise = new Promise((resolve) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve((reader.result as string).split(",")[1]);
    reader.readAsDataURL(file);
  });
  return {
    inlineData: {
      data: (await base64EncodedDataPromise) as string,
      mimeType: file.type,
    },
  };
};

// Message Component with basic Markdown-like code block parsing
const MessageBubble: React.FC<{ role: string; text: string; isError?: boolean }> = ({ role, text, isError }) => {
  const isUser = role === "user";
  
  // Simple parser to detect code blocks ```code```
  const parts = text.split(/```/);

  return (
    <div className={`message-container ${isUser ? "user" : "model"} ${isError ? "error" : ""}`}>
      <div className="message-bubble">
        <div className="message-header">{isUser ? "You" : "KaliTutor AI"}</div>
        <div className="message-content">
          {parts.map((part, index) => {
            if (index % 2 === 1) {
              // Code block
              return (
                <pre key={index} className="code-block">
                  <code>{part.trim()}</code>
                </pre>
              );
            } else {
              // Regular text (handle newlines)
              return <span key={index}>{part}</span>;
            }
          })}
        </div>
      </div>
    </div>
  );
};

const App = () => {
  const [messages, setMessages] = useState<Array<{ role: string; text: string; isError?: boolean }>>([]);
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async (textOverride?: string) => {
    const promptText = textOverride || input;
    if ((!promptText.trim() && !selectedImage) || isLoading) return;

    // Add user message immediately
    const newMessages = [...messages, { role: "user", text: promptText + (selectedImage ? " [Image Attached]" : "") }];
    setMessages(newMessages);
    setInput("");
    setSelectedImage(null);
    setIsLoading(true);

    try {
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      // Use Flash Lite as requested for low-latency
      const model = "gemini-flash-lite-latest"; 
      
      const contentParts: any[] = [];
      
      if (selectedImage) {
        const imagePart = await fileToGenerativePart(selectedImage);
        contentParts.push(imagePart);
      }
      
      if (promptText) {
        contentParts.push({ text: promptText });
      }

      const streamingResp = await ai.models.generateContentStream({
        model: model,
        contents: {
            role: "user",
            parts: contentParts
        },
        config: {
          systemInstruction: SYSTEM_PROMPT,
          temperature: 0.6,
          // Pay attention to safety settings for cybersecurity topics
          safetySettings: [
             {
                 category: "HARM_CATEGORY_DANGEROUS_CONTENT",
                 threshold: "BLOCK_ONLY_HIGH" 
             }
          ]
        },
      });

      let fullText = "";
      
      for await (const chunk of streamingResp) {
          const chunkText = chunk.text;
          if (chunkText) {
              fullText += chunkText;
              
              setMessages(prev => {
                  const lastMsg = prev[prev.length - 1];
                  
                  // If the last message is the user's, we need to append the model's first chunk
                  if (lastMsg.role === "user") {
                      return [...prev, { role: "model", text: fullText }];
                  } else {
                      // Otherwise, update the existing model message
                      const updated = [...prev];
                      updated[updated.length - 1] = { ...updated[updated.length - 1], text: fullText };
                      return updated;
                  }
              });
          }
      }

    } catch (error) {
      console.error(error);
      setMessages(prev => [
        ...prev,
        { role: "model", text: "Error: Failed to generate response. Please try again.", isError: true },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="app-container">
      <style>{`
        :root {
          --bg-color: #0d1117;
          --sidebar-bg: #161b22;
          --input-bg: #21262d;
          --border-color: #30363d;
          --text-primary: #c9d1d9;
          --text-secondary: #8b949e;
          --accent-color: #2f81f7;
          --kali-accent: #2B87D1; /* Kali Blue-ish */
          --code-bg: #161b22;
          --user-msg-bg: #1f6feb;
          --model-msg-bg: #21262d;
        }

        body, html {
          margin: 0;
          padding: 0;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
          background-color: var(--bg-color);
          color: var(--text-primary);
          height: 100vh;
        }

        .app-container {
          display: flex;
          flex-direction: column;
          height: 100vh;
          max-width: 1200px;
          margin: 0 auto;
          border-left: 1px solid var(--border-color);
          border-right: 1px solid var(--border-color);
        }

        header {
          padding: 16px 24px;
          border-bottom: 1px solid var(--border-color);
          background-color: var(--sidebar-bg);
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .logo-area h1 {
          margin: 0;
          font-size: 1.2rem;
          color: var(--kali-accent);
          font-family: 'Courier New', monospace; 
          font-weight: 700;
        }

        .logo-area span {
          font-size: 0.8rem;
          color: var(--text-secondary);
        }

        .chat-area {
          flex: 1;
          overflow-y: auto;
          padding: 24px;
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .message-container {
          display: flex;
          width: 100%;
        }

        .message-container.user {
          justify-content: flex-end;
        }

        .message-container.model {
          justify-content: flex-start;
        }

        .message-bubble {
          max-width: 80%;
          padding: 12px 16px;
          border-radius: 8px;
          line-height: 1.5;
        }

        .message-container.user .message-bubble {
          background-color: var(--user-msg-bg);
          color: white;
          border-bottom-right-radius: 2px;
        }

        .message-container.model .message-bubble {
          background-color: var(--model-msg-bg);
          border: 1px solid var(--border-color);
          border-bottom-left-radius: 2px;
        }
        
        .message-container.error .message-bubble {
          border-color: #ff6b6b;
          color: #ff6b6b;
        }

        .message-header {
          font-size: 0.75rem;
          margin-bottom: 4px;
          opacity: 0.7;
          font-weight: 600;
        }

        .message-content {
          white-space: pre-wrap; 
        }

        .code-block {
          background-color: black;
          padding: 12px;
          border-radius: 6px;
          overflow-x: auto;
          font-family: 'Courier New', monospace;
          border: 1px solid #333;
          margin: 8px 0;
        }

        .input-area {
          padding: 16px 24px;
          background-color: var(--sidebar-bg);
          border-top: 1px solid var(--border-color);
        }

        .suggestions {
          display: flex;
          gap: 8px;
          margin-bottom: 12px;
          overflow-x: auto;
          padding-bottom: 4px;
        }

        .chip {
          background-color: var(--input-bg);
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          padding: 6px 12px;
          border-radius: 16px;
          font-size: 0.85rem;
          cursor: pointer;
          white-space: nowrap;
          transition: all 0.2s;
        }

        .chip:hover {
          border-color: var(--kali-accent);
          color: var(--kali-accent);
        }

        .input-wrapper {
          display: flex;
          gap: 8px;
          align-items: flex-end;
        }

        .upload-btn {
          background: none;
          border: 1px solid var(--border-color);
          color: var(--text-secondary);
          padding: 10px;
          border-radius: 6px;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        
        .upload-btn:hover {
          border-color: var(--text-primary);
          color: var(--text-primary);
        }

        .upload-btn.selected {
           border-color: var(--kali-accent);
           color: var(--kali-accent);
        }

        textarea {
          flex: 1;
          background-color: var(--input-bg);
          border: 1px solid var(--border-color);
          border-radius: 6px;
          color: var(--text-primary);
          padding: 12px;
          font-size: 1rem;
          resize: none;
          min-height: 24px;
          font-family: inherit;
        }

        textarea:focus {
          outline: none;
          border-color: var(--kali-accent);
        }

        .send-btn {
          background-color: var(--kali-accent);
          border: none;
          color: white;
          padding: 10px 20px;
          border-radius: 6px;
          cursor: pointer;
          font-weight: 600;
        }

        .send-btn:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        
        /* Scrollbar */
        ::-webkit-scrollbar {
          width: 8px;
          height: 8px;
        }
        ::-webkit-scrollbar-track {
          background: var(--bg-color);
        }
        ::-webkit-scrollbar-thumb {
          background: var(--border-color);
          border-radius: 4px;
        }
        ::-webkit-scrollbar-thumb:hover {
          background: #484f58;
        }

      `}</style>

      <header>
        <div className="logo-area">
          <h1>KaliTutor AI</h1>
          <span>Interactive Cybersecurity Instructor</span>
        </div>
      </header>

      <div className="chat-area">
        {messages.length === 0 && (
          <div style={{ textAlign: "center", color: "var(--text-secondary)", marginTop: "40px" }}>
            <h2>Welcome to KaliTutor</h2>
            <p>Your guide to Kali Linux, ethical hacking workflows, and security concepts.</p>
            <p style={{fontSize: "0.9rem", opacity: 0.8}}>
                Reminder: This tool is for educational and ethical testing purposes only.
            </p>
          </div>
        )}
        
        {messages.map((msg, idx) => (
          <MessageBubble key={idx} role={msg.role} text={msg.text} isError={msg.isError} />
        ))}
        
        {/* Only show thinking if loading AND we haven't started streaming the response yet */}
        {isLoading && messages.length > 0 && messages[messages.length - 1].role !== "model" && (
          <div className="message-container model">
            <div className="message-bubble" style={{fontStyle: 'italic', color: 'var(--text-secondary)'}}>
              Thinking...
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="input-area">
        <div className="suggestions">
          {SUGGESTED_PROMPTS.map((prompt, idx) => (
            <button key={idx} className="chip" onClick={() => handleSendMessage(prompt)} disabled={isLoading}>
              {prompt}
            </button>
          ))}
        </div>

        <div className="input-wrapper">
          <input
            type="file"
            accept="image/*"
            ref={fileInputRef}
            style={{ display: "none" }}
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                setSelectedImage(e.target.files[0]);
              }
            }}
          />
          <button 
            className={`upload-btn ${selectedImage ? 'selected' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            title="Upload screenshot or image"
          >
             📷
          </button>

          <textarea
            rows={1}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask about Kali tools, debug errors, or design labs..."
            disabled={isLoading}
          />
          <button className="send-btn" onClick={() => handleSendMessage()} disabled={isLoading || (!input.trim() && !selectedImage)}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

const root = createRoot(document.getElementById("root")!);
root.render(<App />);