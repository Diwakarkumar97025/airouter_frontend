import React, { useState, useRef, useEffect } from 'react'
import './App.css'

function App() {
  const [messages, setMessages] = useState([
    {
      id: 1,
      role: 'assistant',
      content: "Hi, I'm your AI assistant. Ask me anything!",
    },
  ])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const textareaRef = useRef(null)

  // Auto-resize textarea to fit content
  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      const scrollHeight = textarea.scrollHeight
      textarea.style.height = `${scrollHeight}px`
    }
  }, [input])

  const sendMessage = async (e) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: trimmed,
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
    setIsLoading(true)

    let assistantReply = ''
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: trimmed }),
      })

      if (!res.ok) throw new Error('Request failed')

      const data = await res.json()
      assistantReply =
        data?.reply ||
        data?.message ||
        "I'm here, but your backend didn't send a reply field."
    } catch (err) {
      // Fallback dummy response when there is no backend or it fails
      assistantReply =
        "This is a dummy response because the backend API endpoint isn't available yet.\n\n" +
        'You can connect your own `/api/chat` endpoint and return JSON like `{ reply: \"Hello\" }`.'
    } finally {
      setIsLoading(false)
    }

    setMessages((prev) => [
      ...prev,
      {
        id: Date.now() + 1,
        role: 'assistant',
        content: assistantReply,
      },
    ])
  }

  return (
    <div className="app-root">
      <aside className="sidebar">
        <div className="sidebar-header">
          <button className="new-chat-btn">+ New chat</button>
        </div>
        <div className="sidebar-section">
          <p className="sidebar-label">Recent</p>
          <button className="sidebar-item">Sample conversation</button>
          <button className="sidebar-item">Ask about your data</button>
          <button className="sidebar-item">Brainstorm ideas</button>
        </div>
        <div className="sidebar-footer">
          <button className="sidebar-footer-item">Settings</button>
          <button className="sidebar-footer-item">Profile</button>
        </div>
      </aside>

      <main className="chat-layout">
        <header className="chat-header">
          <div className="chat-title">LLM router Chat</div>
          <div className="chat-subtitle">ChatGPT-like interface demo</div>
        </header>

        <section className="chat-messages">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`chat-message ${
                m.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'
              }`}
            >
              <div className="avatar">
                {m.role === 'user' ? (
                  <span className="avatar-initial">U</span>
                ) : (
                  <span className="avatar-initial">AI</span>
                )}
              </div>
              <div className="chat-bubble">
                <div className="chat-bubble-content">
                  {m.content.split('\n').map((line, idx) => (
                    <p key={idx}>{line}</p>
                  ))}
                </div>
              </div>
            </div>
          ))}

          {isLoading && (
            <div className="chat-message chat-message-assistant">
              <div className="avatar">
                <span className="avatar-initial">AI</span>
              </div>
              <div className="chat-bubble">
                <div className="typing-indicator">
                  <span />
                  <span />
                  <span />
                </div>
              </div>
            </div>
          )}
        </section>

        <footer className="chat-input-wrapper">
          <form className="chat-input-form" onSubmit={sendMessage}>
            <textarea
              ref={textareaRef}
              className="chat-input"
              placeholder="Send a message..."
              rows={1}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  sendMessage(e)
                }
              }}
            />
            <button
              type="submit"
              className="send-btn"
              disabled={!input.trim() || isLoading}
            >
              ➤
            </button>
          </form>
          <p className="chat-input-helper">
           LLm Router may produce inaccurate information about people, places, or
            facts.
          </p>
        </footer>
      </main>
    </div>
  )
}

export default App
