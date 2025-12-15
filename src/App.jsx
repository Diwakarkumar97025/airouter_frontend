import React, { useState, useRef, useEffect } from 'react'
import './App.css'
import googleIcon from './assets/icons/google.png'
import deepseekIcon from './assets/icons/deepseek.svg'
import ollamaIcon from './assets/icons/openai.png'
import metaIcon from './assets/icons/meta.png'
import anthropicIcon from './assets/icons/anthropic.png'

// CONFIGURABLE API URL
const API_BASE_URL = 'http://localhost:8000'

// Add this helper function before the App component
const CodeBlock = ({ code, language }) => {
  const [copied, setCopied] = useState(false)
  
  const copyToClipboard = () => {
    navigator.clipboard.writeText(code)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  
  return (
    <div className="code-block-container">
      <div className="code-block-header">
        <span className="code-language">{language || 'code'}</span>
        <button className="copy-code-btn" onClick={copyToClipboard}>
          {copied ? '✓ Copied' : 'Copy'}
        </button>
      </div>
      <pre className="code-block-content">
        <code>{code}</code>
      </pre>
    </div>
  )
}

// Add this function to parse messages with code blocks
const parseMessageContent = (content, codeBlocks = []) => {
  if (!codeBlocks || codeBlocks.length === 0) {
    // Fallback: Try to parse markdown code blocks from content if no API code_blocks
    const markdownCodeBlockRegex = /```(\w+)?\n?([\s\S]*?)```/g
    const parts = []
    let lastIndex = 0
    let match
    let foundCodeBlock = false
    
    while ((match = markdownCodeBlockRegex.exec(content)) !== null) {
      foundCodeBlock = true
      const language = match[1] || 'code'
      const code = match[2].trim()
      const matchStart = match.index
      const matchEnd = match.index + match[0].length
      
      // Add text before code block
      if (matchStart > lastIndex) {
        const textContent = content.substring(lastIndex, matchStart).trim()
        if (textContent) {
          parts.push({ type: 'text', content: textContent })
        }
      }
      
      // Add code block
      parts.push({
        type: 'code',
        code: code,
        language: language
      })
      
      lastIndex = matchEnd
    }
    
    // Add remaining text
    if (lastIndex < content.length) {
      const textContent = content.substring(lastIndex).trim()
      if (textContent) {
        parts.push({ type: 'text', content: textContent })
      }
    }
    
    return foundCodeBlock && parts.length > 0 ? parts : [{ type: 'text', content }]
  }
  
  // Use code_blocks from API - works for ALL languages generically
  const sortedBlocks = [...codeBlocks].sort((a, b) => (a.start_pos || 0) - (b.start_pos || 0))
  const parts = []
  let lastIndex = 0
  
  sortedBlocks.forEach((block) => {
    const startPos = block.start_pos || 0
    const endPos = block.end_pos || content.length
    
    // Add text before code block
    if (startPos > lastIndex) {
      const textContent = content.substring(lastIndex, startPos).trim()
      // Remove markdown code block markers if present
      const cleanedText = textContent.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim()
      if (cleanedText) {
        parts.push({ type: 'text', content: cleanedText })
      }
    }
    
    // Add code block - works for ANY language (sql, python, javascript, etc.)
    if (block.code) {
      parts.push({
        type: 'code',
        code: block.code,
        language: block.language || block.raw_language || 'code' // Generic - works for all languages
      })
    }
    
    lastIndex = endPos
  })
  
  // Add remaining text after last code block
  if (lastIndex < content.length) {
    const textContent = content.substring(lastIndex).trim()
    // Remove markdown code block markers if present
    const cleanedText = textContent.replace(/```[\w]*\n?/g, '').replace(/```/g, '').trim()
    if (cleanedText) {
      parts.push({ type: 'text', content: cleanedText })
    }
  }
  
  return parts.length > 0 ? parts : [{ type: 'text', content }]
}

function App() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [showAuthModal, setShowAuthModal] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const [currentSessionId, setCurrentSessionId] = useState(null)
  const [sessions, setSessions] = useState([])
  const [showSettings, setShowSettings] = useState(false)
  const [settingsTab, setSettingsTab] = useState('profile')
  const [analyticsData, setAnalyticsData] = useState([])
  const [user, setUser] = useState(null)
  const [error, setError] = useState(null)
  const [showContextMenu, setShowContextMenu] = useState(null)
  const [renamingSession, setRenamingSession] = useState(null)
  const [renameValue, setRenameValue] = useState('')
  const [showSessionExpired, setShowSessionExpired] = useState(false)
  const [userProfile, setUserProfile] = useState(null)
  const [queryMode, setQueryMode] = useState('normal')
  const [messageActions, setMessageActions] = useState({}) // Track actions per message
  const [regenerateCounts, setRegenerateCounts] = useState({}) // Track regenerate count per message
  const [lastModelUsed, setLastModelUsed] = useState({}) // Track last model used per message
  const [billingInfo, setBillingInfo] = useState(null)
  const [subscriptionPlans, setSubscriptionPlans] = useState([])
  const [showUpgradeModal, setShowUpgradeModal] = useState(false)
  const [selectedPlanForUpgrade, setSelectedPlanForUpgrade] = useState(null)
  const [codeBlocksCache, setCodeBlocksCache] = useState({}) // message_id -> code_blocks
  
  const abortControllerRef = useRef(null)
  const textareaRef = useRef(null)
  const messagesEndRef = useRef(null)
  const chatMessagesRef = useRef(null)
  const settingsRef = useRef(null)
  const contextMenuRef = useRef(null)
  const titlePollInterval = useRef(null)
  // const sessionPollIntervals = useRef({}) // Track polling for multiple sessions

  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [messages, isLoading])

  useEffect(() => {
    const textarea = textareaRef.current
    if (textarea) {
      textarea.style.height = 'auto'
      const scrollHeight = textarea.scrollHeight
      textarea.style.height = `${Math.min(scrollHeight, 200)}px`
    }
  }, [input])

  useEffect(() => {
    const token = localStorage.getItem('access_token')
    const savedSessionId = localStorage.getItem('current_session_id')
    const savedMode = localStorage.getItem('query_mode')
    
    if (savedMode) setQueryMode(savedMode)
    
    if (token) {
      fetchUserProfile(token).then(() => {
        if (savedSessionId) {
          setCurrentSessionId(savedSessionId)
          loadSession(savedSessionId)
        }
      })
    } else {
      setShowAuthModal(true)
    }
  }, [])

  useEffect(() => {
    if (currentSessionId) {
      localStorage.setItem('current_session_id', currentSessionId)
    }
  }, [currentSessionId])

  useEffect(() => {
    localStorage.setItem('query_mode', queryMode)
  }, [queryMode])

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (settingsRef.current && !settingsRef.current.contains(event.target)) {
        setShowSettings(false)
      }
      if (contextMenuRef.current && !contextMenuRef.current.contains(event.target)) {
        setShowContextMenu(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  useEffect(() => {
    return () => {
      if (titlePollInterval.current) {
        clearInterval(titlePollInterval.current)
      }
    }
  }, [])

  // NO automatic polling - only check title when user clicks on a session

  const fetchUserProfile = async (token) => {
    try {
      const res = await fetch(`${API_BASE_URL}/me`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.status === 401) {
        setShowSessionExpired(true)
        return
      }
      
      if (res.ok) {
        const userData = await res.json()
        setUser(userData)
        setIsAuthenticated(true)
        setShowAuthModal(false)
        await loadSessions(userData.id, token)
        loadUserProfile(token)
      } else {
        throw new Error('Invalid token')
      }
    } catch (err) {
      console.error('Auth check failed:', err)
      localStorage.removeItem('access_token')
      localStorage.removeItem('session_id')
      setShowAuthModal(true)
    }
  }

  const loadUserProfile = async (token) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/user/profile`, {
        headers: { 'Authorization': `Bearer ${token || localStorage.getItem('access_token')}` }
      })
      
      if (res.status === 401) {
        setShowSessionExpired(true)
        return
      }
      
      if (res.ok) {
        const data = await res.json()
        setUserProfile(data)
      }
    } catch (err) {
      console.error('Failed to load profile:', err)
    }
  }

  const loadSessions = async (userId, token) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${userId}/sessions`, {
        headers: { 'Authorization': `Bearer ${token || localStorage.getItem('access_token')}` }
      })
      
      if (res.status === 401) {
        setShowSessionExpired(true)
        return
      }
      
      if (res.ok) {
        const data = await res.json()
        // API returns sessions with 'title' field, map it to both 'title' and 'summary' for compatibility
        const sessionsWithTitle = (data || []).map(session => ({
          ...session,
          summary: session.title || session.summary, // Use title from API, fallback to summary if exists
          title: session.title || session.summary
        }))
        setSessions(sessionsWithTitle)
        return sessionsWithTitle
      }
    } catch (err) {
      console.error('Failed to load sessions:', err)
    }
    return []
  }

  const createNewChat = async () => {
    const token = localStorage.getItem('access_token')
    try {
      const res = await fetch(`${API_BASE_URL}/api/chat/new`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.status === 401) {
        setShowSessionExpired(false)
        return
      }
      
      if (res.ok) {
        const data = await res.json()
        setCurrentSessionId(data.session_id)
        setMessages([{
          id: Date.now(),
          role: 'assistant',
          content: "Hi, I'm your AI assistant. Ask me anything!"
        }])
        await loadSessions(user.id, token)
        // REMOVE: startTitlePolling(data.session_id)
      }
    } catch (err) {
      console.error('Failed to create new chat:', err)
    }
  }

  // const startTitlePolling = (sessionId) => {
  //   if (titlePollInterval.current) {
  //     clearInterval(titlePollInterval.current)
  //   }

  //   let pollCount = 0
  //   const maxPolls = 2 // Reduced from 20 to 10

  //   console.log('Starting title polling for session:', sessionId)

  //   titlePollInterval.current = setInterval(async () => {
  //     pollCount++
      
  //     if (pollCount > maxPolls) {
  //       console.log('Max polls reached, stopping')
  //       clearInterval(titlePollInterval.current)
  //       return
  //     }

  //     try {
  //       const token = localStorage.getItem('access_token')
  //       const sessionsData = await loadSessions(user.id, token)
        
  //       if (sessionsData) {
  //         const session = sessionsData.find(s => s.session_id === sessionId)
          
  //         console.log(`Poll ${pollCount}: Current title is "${session?.summary}"`)
          
  //         if (session && session.summary && session.summary !== 'New conversation') {
  //           console.log('Title updated! Stopping poll.')
  //           clearInterval(titlePollInterval.current)
  //         }
  //       }
  //     } catch (err) {
  //       console.error('Polling error:', err)
  //     }
  //   }, 1000) // Changed from 500ms to 1000ms to reduce requests
  // }

  // Remove startSessionTitlePolling function completely
  // We don't need continuous polling

  const loadSession = async (sessionId) => {
    const token = localStorage.getItem('access_token')
    try {
      const res = await fetch(`${API_BASE_URL}/api/sessions/${sessionId}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.status === 401) {
        setShowSessionExpired(true)
        return
      }
      
      if (res.ok) {
        const responseData = await res.json()
        setCurrentSessionId(sessionId)
        
        // Extract messages from response
        let messages = []
        
        if (Array.isArray(responseData)) {
          messages = responseData
        } else if (responseData.content) {
          messages = [{
            id: responseData.id,
            role: responseData.role || 'assistant',
            content: responseData.content,
            code_blocks: responseData.code_blocks || []
          }]
        } else if (responseData.messages && Array.isArray(responseData.messages)) {
          messages = responseData.messages
        } else {
          messages = Array.isArray(responseData) ? responseData : []
        }
        
        // Format messages and merge code_blocks from cache
        const formattedMessages = messages.map(msg => {
          const dbId = msg.id
          
          if (!dbId) {
            console.warn('Message missing database ID:', msg)
          }
          
          // Merge code_blocks from cache if available (from message response)
          const cachedCodeBlocks = codeBlocksCache[dbId]
          
          return {
            id: dbId,
            role: msg.role,
            content: msg.content,
            code_blocks: cachedCodeBlocks || msg.code_blocks || []
          }
        })
        
        setMessages(formattedMessages)
      }
    } catch (err) {
      console.error('Failed to load session:', err)
    }
  }

  const cancelRequest = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
      abortControllerRef.current = null
      setIsLoading(false)
      
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          content: 'Request cancelled by user.'
        }
      ])
    }
  }

  const sendMessage = async (e) => {
    e.preventDefault()
    const trimmed = input.trim()
    if (!trimmed || isLoading) return

    if (!currentSessionId) {
      await createNewChat()
      setTimeout(() => setInput(trimmed), 500)
      return
    }

    const userMessage = {
      id: Date.now(),
      role: 'user',
      content: trimmed
    }

    setMessages((prev) => [...prev, userMessage])
    setInput('')
    if (textareaRef.current) textareaRef.current.style.height = 'auto'
    setIsLoading(true)

    abortControllerRef.current = new AbortController()

    try {
      const token = localStorage.getItem('access_token')
      
      let requestBody = {
        query: trimmed,
        session_id: currentSessionId
      }

      if (queryMode === 'web_search') {
        requestBody.mode = 'web_search'
        requestBody.handler = 'web_search'
      } else if (queryMode === 'code') {
        requestBody.model = 'codellama:7b'
        requestBody.mode = 'code'
        requestBody.handler = 'call_ollama'
      } else {
        requestBody.model = 'mistral:7b'
        requestBody.mode = 'normal'
        requestBody.handler = 'call_ollama'
      }
      
      console.log('Sending message with payload:', requestBody)
      
      const res = await fetch(`${API_BASE_URL}/api/chat/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal
      })

      if (res.status === 401) {
        setShowSessionExpired(true)
        setIsLoading(false)
        abortControllerRef.current = null
        return
      }

      if (!res.ok) throw new Error('Request failed')

      const data = await res.json()
      
      // Store code_blocks in cache using message_id from response
      if (data.message_id && data.code_blocks && data.code_blocks.length > 0) {
        setCodeBlocksCache(prev => ({
          ...prev,
          [data.message_id]: data.code_blocks
        }))
      }
      
      // Reload the full session to get all messages from backend
      await loadSession(currentSessionId)
      
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('Chat error:', err)
        setMessages((prev) => [
          ...prev,
          {
            id: Date.now() + 1,
            role: 'assistant',
            content: 'Sorry, there was an error processing your message.'
          }
        ])
      }
    } finally {
      setIsLoading(false)
      abortControllerRef.current = null
    }
  }

  const updateChatTitle = async (sessionId, title) => {
    const token = localStorage.getItem('access_token')
    try {
      const url = `${API_BASE_URL}/api/chat/update_title?session_id=${encodeURIComponent(sessionId)}&new_title=${encodeURIComponent(title)}`
      
      console.log('Updating title with URL:', url)
      
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      console.log('Update title response status:', res.status)
      
      if (res.status === 401) {
        setShowSessionExpired(true)
        return false
      }
      
      if (res.ok) {
        const responseData = await res.json()
        console.log('Update title success:', responseData)
        // Reload sessions to update the UI
        if (user && user.id) {
          await loadSessions(user.id, token)
        }
        return true
      } else {
        const errorText = await res.text()
        console.error('Update title failed. Status:', res.status, 'Response:', errorText)
        return false
      }
    } catch (err) {
      console.error('Failed to update title:', err)
      return false
    }
  }

  const deleteSession = async (sessionId) => {
    const token = localStorage.getItem('access_token')
    try {
      const res = await fetch(`${API_BASE_URL}/api/delete_chat_session?session_id=${sessionId}`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.status === 401) {
        setShowSessionExpired(true)
        return
      }
      
      if (res.ok) {
        if (currentSessionId === sessionId) {
          setCurrentSessionId(null)
          setMessages([])
          localStorage.removeItem('current_session_id')
        }
        await loadSessions(user.id, token)
      }
      setShowContextMenu(null)
    } catch (err) {
      console.error('Failed to delete session:', err)
    }
  }

  const renameSession = async (sessionId, newTitle) => {
    if (!newTitle.trim()) {
      setRenamingSession(null)
      setRenameValue('')
      return
    }
    
    // This is the ONLY POST call for title update - when user clicks Rename
    const token = localStorage.getItem('access_token')
    const updated = await updateChatTitle(sessionId, newTitle)
    
    if (updated && user) {
      // Reload sessions to get updated title from API
      await loadSessions(user.id, token)
    }
    
    setRenamingSession(null)
    setRenameValue('')
    setShowContextMenu(null)
  }

  const fetchAnalytics = async () => {
    const token = localStorage.getItem('access_token')
    try {
      const res = await fetch(`${API_BASE_URL}/api/user/model_usage`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.status === 401) {
        setShowSessionExpired(true)
        return
      }
      
      if (res.ok) {
        const data = await res.json()
        setAnalyticsData(data || [])
      }
    } catch (err) {
      console.error('Failed to fetch analytics:', err)
    }
  }

  const handleUpgrade = async () => {
    const token = localStorage.getItem('access_token')
    try {
      const res = await fetch(`${API_BASE_URL}/api/user/subscription`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      })
      
      if (res.ok) {
        alert('Upgrade successful!')
        loadUserProfile(token)
      }
    } catch (err) {
      console.error('Failed to upgrade:', err)
    }
  }

  const handleLogout = async () => {
    const sessionId = localStorage.getItem('session_id')
    if (sessionId) {
      try {
        await fetch(`${API_BASE_URL}/api/logout?session_id=${sessionId}`, { method: 'POST' })
      } catch (err) {
        console.error('Logout error:', err)
      }
    }
    
    localStorage.removeItem('access_token')
    localStorage.removeItem('session_id')
    localStorage.removeItem('current_session_id')
    localStorage.removeItem('query_mode')
    
    setIsAuthenticated(false)
    setShowAuthModal(true)
    setMessages([])
    setSessions([])
    setCurrentSessionId(null)
    setUser(null)
    setShowSettings(false)
    setQueryMode('normal')
  }

  const handleRegenerateResponse = async (messageId, originalQuery) => {
    if (isLoading) return
    
    // Get current regenerate count for this message
    const currentCount = regenerateCounts[messageId] || 0
    const newCount = currentCount + 1
    const lastModel = lastModelUsed[messageId] || null
    
    setMessageActions(prev => ({ ...prev, [messageId]: 'regenerating' }))
    
    try {
      const token = localStorage.getItem('access_token')
      
      let requestBody = {
        query: originalQuery,
        session_id: currentSessionId,
        regenerate_count: newCount,
        last_model_used: lastModel
      }

      if (queryMode === 'web_search') {
        requestBody.mode = 'web_search'
        requestBody.handler = 'web_search'
      } else if (queryMode === 'code') {
        requestBody.model = 'codellama:7b'
        requestBody.mode = 'code'
        requestBody.handler = 'call_ollama'
      } else {
        requestBody.model = 'mistral:7b'
        requestBody.mode = 'normal'
        requestBody.handler = 'call_ollama'
      }
      
      console.log('Regenerating with payload:', requestBody)
      
      const res = await fetch(`${API_BASE_URL}/api/chat/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(requestBody)
      })

      if (res.status === 401) {
        setShowSessionExpired(true)
        setIsLoading(false)
        return
      }

      if (res.ok) {
        const data = await res.json()
        
        // Update regenerate count and last model used
        setRegenerateCounts(prev => ({ ...prev, [messageId]: newCount }))
        if (data.model_used) {
          setLastModelUsed(prev => ({ ...prev, [messageId]: data.model_used }))
        }
        
        // Reload the full session to get all messages from backend
        await loadSession(currentSessionId)
        
        // Reset the regenerating state after reload
        setMessageActions(prev => ({ ...prev, [messageId]: 'regenerated' }))
      } else {
        setMessageActions(prev => ({ ...prev, [messageId]: 'error' }))
      }
    } catch (err) {
      console.error('Regenerate error:', err)
      setMessageActions(prev => ({ ...prev, [messageId]: 'error' }))
    }
  }

  const handleThumbsUp = async (messageId, sessionId) => {
    setMessageActions(prev => ({ ...prev, [messageId]: 'liked' }))
    
    // Fire and forget - send feedback to backend
    const token = localStorage.getItem('access_token')
    try {
      // messageId should be the database ID from the API response
      // Validate it's a valid integer (database ID)
      let messageIdInt
      
      if (typeof messageId === 'number') {
        // If it's a number, check if it's a reasonable database ID (not a timestamp)
        // Database IDs are typically small integers, timestamps are large numbers
        if (messageId > 1000000000000) {
          // This looks like a timestamp (Date.now()), not a database ID
          console.error('Invalid message_id: appears to be a timestamp, not database ID:', messageId)
          return
        }
        messageIdInt = Math.floor(messageId)
      } else if (typeof messageId === 'string') {
        messageIdInt = parseInt(messageId, 10)
      } else {
        messageIdInt = parseInt(String(messageId), 10)
      }
      
      // Ensure it's a valid integer and reasonable database ID
      if (isNaN(messageIdInt) || messageIdInt <= 0 || messageIdInt > 1000000000000) {
        console.error('Invalid message_id for feedback:', messageId, 'Expected database ID')
        return
      }
      
      await fetch(`${API_BASE_URL}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message_id: messageIdInt,
          session_id: sessionId || currentSessionId,
          feedback_type: 'like'
        })
      })
    } catch (err) {
      console.error('Failed to send feedback:', err)
      // Don't revert UI - fire and forget
    }
  }

  const handleThumbsDown = async (messageId, sessionId) => {
    setMessageActions(prev => ({ ...prev, [messageId]: 'disliked' }))
    
    // Fire and forget - send feedback to backend
    const token = localStorage.getItem('access_token')
    try {
      // messageId should be the database ID from the API response
      let messageIdInt
      
      if (typeof messageId === 'number') {
        // Check if it's a reasonable database ID (not a timestamp)
        if (messageId > 1000000000000) {
          console.error('Invalid message_id: appears to be a timestamp, not database ID:', messageId)
          return
        }
        messageIdInt = Math.floor(messageId)
      } else if (typeof messageId === 'string') {
        messageIdInt = parseInt(messageId, 10)
      } else {
        messageIdInt = parseInt(String(messageId), 10)
      }
      
      // Ensure it's a valid integer and reasonable database ID
      if (isNaN(messageIdInt) || messageIdInt <= 0 || messageIdInt > 1000000000000) {
        console.error('Invalid message_id for feedback:', messageId, 'Expected database ID')
        return
      }
      
      await fetch(`${API_BASE_URL}/api/feedback`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          message_id: messageIdInt,
          session_id: sessionId || currentSessionId,
          feedback_type: 'dislike'
        })
      })
    } catch (err) {
      console.error('Failed to send feedback:', err)
      // Don't revert UI - fire and forget
    }
  }

  const handleSessionExpiredClose = () => {
    setShowSessionExpired(false)
    handleLogout()
  }

  const AuthModal = () => {
    const emailRef = useRef(null)
    const usernameRef = useRef(null)
    const firstNameRef = useRef(null)
    const lastNameRef = useRef(null)
    const passwordRef = useRef(null)
    
    const handleFormSubmit = (e) => {
      e.preventDefault()
      
      const formData = {
        email: emailRef.current?.value || '',
        username: usernameRef.current?.value || '',
        first_name: firstNameRef.current?.value || '',
        last_name: lastNameRef.current?.value || '',
        password: passwordRef.current?.value || ''
      }
      
      if (authMode === 'signup') {
        fetch(`${API_BASE_URL}/api/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(formData)
        })
        .then(res => {
          if (!res.ok) {
            return res.json().then(err => { throw new Error(err.detail || 'Signup failed') })
          }
          setAuthMode('login')
          setError('Account created! Please login.')
          if (passwordRef.current) passwordRef.current.value = ''
        })
        .catch(err => setError(err.message || 'Network error'))
      } else {
        fetch(`${API_BASE_URL}/api/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: formData.email,
            password: formData.password
          })
        })
        .then(res => {
          if (!res.ok) {
            return res.json().then(err => { throw new Error(err.detail || 'Login failed') })
          }
          return res.json()
        })
        .then(data => {
          localStorage.setItem('access_token', data.access_token)
          localStorage.setItem('session_id', data.session_id)
          fetchUserProfile(data.access_token)
        })
        .catch(err => setError(err.message || 'Network error'))
      }
    }
    
    return (
      <div className="modal-overlay">
        <div className="modal-content">
          <h2>{authMode === 'login' ? 'Login to LLM Router' : 'Create Account'}</h2>
          {error && (
            <div className={`error-message ${error.includes('created') ? 'success' : ''}`}>
              {error}
            </div>
          )}
          <form onSubmit={handleFormSubmit}>
            <input ref={emailRef} type="email" placeholder="Email" defaultValue="" required />
            {authMode === 'signup' && (
              <>
                <input ref={usernameRef} type="text" placeholder="Username" defaultValue="" required />
                <input ref={firstNameRef} type="text" placeholder="First Name" defaultValue="" required />
                <input ref={lastNameRef} type="text" placeholder="Last Name" defaultValue="" required />
              </>
            )}
            <input ref={passwordRef} type="password" placeholder="Password" defaultValue="" required />
            <button type="submit" className="auth-btn">
              {authMode === 'login' ? 'Login' : 'Sign Up'}
            </button>
          </form>
          <button 
            className="auth-switch-btn"
            onClick={() => {
              setAuthMode(authMode === 'login' ? 'signup' : 'login')
              setError(null)
            }}
          >
            {authMode === 'login' ? 'Need an account? Sign up' : 'Have an account? Login'}
          </button>
        </div>
      </div>
    )
  }

  const SessionExpiredModal = () => (
    <div className="modal-overlay">
      <div className="modal-content">
        <h2>Session Expired</h2>
        <p style={{ marginBottom: '20px', textAlign: 'center' }}>
          Your session has expired. Please login again to continue.
        </p>
        <button className="auth-btn" onClick={handleSessionExpiredClose}>OK</button>
      </div>
    </div>
  )

  const SettingsModal = () => {
    const maxRequests = Math.max(...analyticsData.map(d => d.request_number || 0), 1)
    const yAxisMax = Math.ceil(maxRequests / 10) * 10 || 10
    
    return (
      <div className="settings-modal" ref={settingsRef}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={() => setShowSettings(false)}>✕</button>
        </div>
        <div className="settings-content">
          <div className="settings-sidebar">
            <button 
              className={`settings-tab ${settingsTab === 'profile' ? 'active' : ''}`}
              onClick={() => setSettingsTab('profile')}
            >
              Profile
            </button>
            <button 
              className={`settings-tab ${settingsTab === 'analytics' ? 'active' : ''}`}
              onClick={() => { setSettingsTab('analytics'); fetchAnalytics(); }}
            >
              Analytics
            </button>
            <button 
              className={`settings-tab ${settingsTab === 'billing' ? 'active' : ''}`}
              onClick={() => { setSettingsTab('billing'); fetchBillingInfo(); }}
            >
              Billing & Subscription
            </button>
          </div>
          <div className="settings-body">
            {settingsTab === 'profile' ? (
              <div className="profile-section">
                <div className="profile-header-section">
                  <div className="profile-avatar">
                    {userProfile?.first_name?.[0] || 'U'}
                  </div>
                  <div className="profile-plan">
                    <span className="plan-badge">{userProfile?.plan || 'Free'} Plan</span>
                    {userProfile?.plan !== 'Premium' && (
                      <button className="upgrade-btn" onClick={handleUpgrade}>Upgrade</button>
                    )}
                  </div>
                </div>
                
                <h3>Profile Information</h3>
                <div className="profile-field">
                  <label>First Name</label>
                  <input type="text" value={userProfile?.first_name || ''} disabled />
                </div>
                <div className="profile-field">
                  <label>Last Name</label>
                  <input type="text" value={userProfile?.last_name || ''} disabled />
                </div>
                <div className="profile-field">
                  <label>Designation</label>
                  <input type="text" value={userProfile?.designation || ''} disabled />
                </div>
                <div className="profile-field">
                  <label>Organization</label>
                  <input type="text" value={userProfile?.organization || ''} disabled />
                </div>
                <div className="profile-field">
                  <label>Email</label>
                  <input type="text" value={userProfile?.email || ''} disabled />
                </div>
                <button className="logout-btn" onClick={handleLogout}>Logout</button>
              </div>
            ) : settingsTab === 'analytics' ? (
              <div className="analytics-section">
                <h3>Model Usage Analytics</h3>
                {analyticsData.length === 0 ? (
                  <p className="no-data">No analytics data available yet</p>
                ) : (
                  <div className="excel-chart-container">
                    <div className="excel-chart-title">Model Request Count</div>
                    <div className="excel-chart-body">
                      <div className="excel-y-axis">
                        {Array.from({length: 11}, (_, i) => {
                          const value = Math.round((yAxisMax / 10) * (10 - i))
                          return (
                            <div key={i} className="excel-y-tick">
                              <span className="excel-y-label">{value}</span>
                              <span className="excel-y-line"></span>
                            </div>
                          )
                        })}
                      </div>
                      <div className="excel-chart-area">
                        <div className="excel-grid">
                          {Array.from({length: 11}, (_, i) => (
                            <div key={i} className="excel-grid-line"></div>
                          ))}
                        </div>
                        <div className="excel-bars">
                          {analyticsData.map((item, idx) => {
                            const barHeight = yAxisMax > 0 ? ((item.request_number || 0) / yAxisMax) * 100 : 0
                            
                            return (
                              <div key={idx} className="excel-bar-col">
                                <div 
                                  className="excel-bar"
                                  style={{ height: `${barHeight}%` }}
                                  title={`${item.model_name}: ${item.request_number || 0} requests`}
                                ></div>
                                <div className="excel-x-label">{item.model_name}</div>
                              </div>
                            )
                          })}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ) : settingsTab === 'billing' ? (
              <BillingSection />
            ) : null}
          </div>
        </div>
      </div>
    )
  }

  const BillingSection = () => {
    const [selectedPlan, setSelectedPlan] = useState(null)
    const [billingPeriod, setBillingPeriod] = useState('monthly')
    const [showPlanSelection, setShowPlanSelection] = useState(false)
    const [showBillingForm, setShowBillingForm] = useState(false)
    const [selectedPlanForUpgrade, setSelectedPlanForUpgrade] = useState(null)
    const [paymentIntent, setPaymentIntent] = useState(null)
    const [upgradeForm, setUpgradeForm] = useState({
      payment_method: 'stripe',
      card_number: '',
      expiry_date: '',
      cvv: '',
      billing_address: '',
      city: '',
      zip_code: '',
      country: 'US'
    })
    
    const handleUpgradeClick = () => {
      setShowPlanSelection(true)
    }
    
    const handlePlanSelect = async (plan) => {
      setSelectedPlanForUpgrade(plan)
      setShowPlanSelection(false)
      
      // Create payment intent
      const token = localStorage.getItem('access_token')
      try {
        const res = await fetch(`${API_BASE_URL}/api/billing/payment-intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            plan_id: plan.id,
            billing_period: billingPeriod,
            payment_method: 'stripe'
          })
        })
        
        if (res.ok) {
          const data = await res.json()
          setPaymentIntent(data)
          setShowBillingForm(true)
        } else {
          const error = await res.json()
          alert(`Failed to create payment intent: ${error.detail || 'Unknown error'}`)
        }
      } catch (err) {
        console.error('Failed to create payment intent:', err)
        alert('Failed to create payment intent. Please try again.')
      }
    }
    
    const handleUpgrade = async (e) => {
      e.preventDefault()
      const token = localStorage.getItem('access_token')
      try {
        const res = await fetch(`${API_BASE_URL}/api/billing/upgrade`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
          },
          body: JSON.stringify({
            plan_id: selectedPlanForUpgrade.id,
            billing_period: billingPeriod,
            payment_method: upgradeForm.payment_method
          })
        })
        
        if (res.ok) {
          const data = await res.json()
          alert('Subscription upgraded successfully!')
          setShowBillingForm(false)
          setShowPlanSelection(false)
          setSelectedPlanForUpgrade(null)
          setPaymentIntent(null)
          setUpgradeForm({
            payment_method: 'stripe',
            card_number: '',
            expiry_date: '',
            cvv: '',
            billing_address: '',
            city: '',
            zip_code: '',
            country: 'US'
          })
          fetchBillingInfo()
        } else {
          const error = await res.json()
          alert(`Upgrade failed: ${error.detail || 'Unknown error'}`)
        }
      } catch (err) {
        console.error('Failed to upgrade:', err)
        alert('Failed to upgrade subscription. Please try again.')
      }
    }
    
    const handleCancel = async () => {
      if (!confirm('Are you sure you want to cancel your subscription?')) return
      
      const token = localStorage.getItem('access_token')
      try {
        const res = await fetch(`${API_BASE_URL}/api/billing/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`          },
          body: JSON.stringify({ reason: 'User requested cancellation' })
        })
        
        if (res.ok) {
          const data = await res.json()
          alert(data.message || 'Subscription cancelled successfully')
          fetchBillingInfo()
        } else {
          const error = await res.json()
          alert(`Cancellation failed: ${error.detail || 'Unknown error'}`)
        }
      } catch (err) {
        console.error('Failed to cancel subscription:', err)
        alert('Failed to cancel subscription. Please try again.')
      }
    }
    
    return (
      <>
        <div className="billing-section">
          <h3>Billing & Subscription</h3>
          
          {/* Current Plan */}
          <div className="current-plan-card">
            <h4>Current Plan</h4>
            <div className="plan-info">
              <div className="plan-name">{billingInfo?.plan_name || 'Free'}</div>
              <div className="plan-tier">{billingInfo?.plan_tier || 'free'}</div>
              <div className="plan-status">
                Status: <span className={`status-badge ${billingInfo?.status || 'active'}`}>
                  {billingInfo?.status || 'active'}
                </span>
              </div>
              {billingInfo?.is_subscribed && (
                <div className="plan-dates">
                  {billingInfo?.start_date && (
                    <div>Started: {new Date(billingInfo.start_date).toLocaleDateString()}</div>
                  )}
                  {billingInfo?.end_date && (
                    <div>Renews: {new Date(billingInfo.end_date).toLocaleDateString()}</div>
                  )}
                </div>
              )}
              {billingInfo?.is_subscribed && billingInfo?.status === 'active' && (
                <button className="cancel-subscription-btn" onClick={handleCancel}>
                  Cancel Subscription
                </button>
              )}
              {(!billingInfo?.is_subscribed || billingInfo?.plan_tier === 'free') && (
                <button className="upgrade-subscription-btn" onClick={handleUpgradeClick}>
                  Upgrade Plan
                </button>
              )}
            </div>
          </div>
          
          {/* Available Plans */}
          <div className="available-plans">
            <h4>Available Plans</h4>
            <div className="billing-period-toggle">
              <button 
                className={billingPeriod === 'monthly' ? 'active' : ''}
                onClick={() => setBillingPeriod('monthly')}
              >
                Monthly
              </button>
              <button 
                className={billingPeriod === 'yearly' ? 'active' : ''}
                onClick={() => setBillingPeriod('yearly')}
              >
                Yearly
              </button>
            </div>
            <div className="plans-grid">
              {subscriptionPlans.map((plan) => (
                <div key={plan.id} className={`plan-card ${billingInfo?.plan_tier === plan.plan_tier ? 'current' : ''}`}>
                  <div className="plan-header">
                    <h5>{plan.plan_name}</h5>
                    <div className="plan-price">
                      ${billingPeriod === 'monthly' ? plan.price_monthly : plan.price_yearly}
                      <span className="price-period">/{billingPeriod === 'monthly' ? 'mo' : 'yr'}</span>
                    </div>
                  </div>
                  <ul className="plan-features">
                    {plan.features.map((feature, idx) => (
                      <li key={idx}>{feature}</li>
                    ))}
                  </ul>
                  {plan.max_requests_per_month && (
                    <div className="plan-limits">
                      {plan.max_requests_per_month} requests/month
                    </div>
                  )}
                  {billingInfo?.plan_tier !== plan.plan_tier && (
                    <button 
                      className="select-plan-btn"
                      onClick={() => handlePlanSelect(plan)}
                    >
                      {billingInfo?.is_subscribed ? 'Switch Plan' : 'Select Plan'}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
        
        {/* Plan Selection Modal */}
        {showPlanSelection && (
          <div className="modal-overlay" onClick={() => setShowPlanSelection(false)}>
            <div className="plan-selection-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Select a Plan</h2>
                <button className="close-btn" onClick={() => setShowPlanSelection(false)}>✕</button>
              </div>
              <div className="plan-selection-content">
                <div className="billing-period-toggle">
                  <button 
                    className={billingPeriod === 'monthly' ? 'active' : ''}
                    onClick={() => setBillingPeriod('monthly')}
                  >
                    Monthly
                  </button>
                  <button 
                    className={billingPeriod === 'yearly' ? 'active' : ''}
                    onClick={() => setBillingPeriod('yearly')}
                  >
                    Yearly
                  </button>
                </div>
                <div className="plans-selection-grid">
                  {subscriptionPlans.map((plan) => (
                    <div key={plan.id} className="plan-selection-card">
                      <h3>{plan.plan_name}</h3>
                      <div className="plan-price-large">
                        ${billingPeriod === 'monthly' ? plan.price_monthly : plan.price_yearly}
                        <span>/{billingPeriod === 'monthly' ? 'mo' : 'yr'}</span>
                      </div>
                      <ul className="plan-features-list">
                        {plan.features.map((feature, idx) => (
                          <li key={idx}>{feature}</li>
                        ))}
                      </ul>
                      <button 
                        className="select-plan-modal-btn"
                        onClick={() => handlePlanSelect(plan)}
                      >
                        Select {plan.plan_name}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
        
        {/* Billing Form Modal */}
        {showBillingForm && selectedPlanForUpgrade && (
          <div className="modal-overlay" onClick={() => setShowBillingForm(false)}>
            <div className="upgrade-modal" onClick={(e) => e.stopPropagation()}>
              <div className="upgrade-modal-header">
                <h2>Complete Payment for {selectedPlanForUpgrade.plan_name}</h2>
                <button className="close-btn" onClick={() => setShowBillingForm(false)}>✕</button>
              </div>
              <form onSubmit={handleUpgrade} className="upgrade-form">
                <div className="form-section">
                  <h3>Payment Information</h3>
                  <div className="form-row">
                    <div className="form-field">
                      <label>Card Number</label>
                      <input 
                        type="text" 
                        placeholder="1234 5678 9012 3456"
                        value={upgradeForm.card_number}
                        onChange={(e) => setUpgradeForm({...upgradeForm, card_number: e.target.value})}
                        required
                      />
                    </div>
                  </div>
                  <div className="form-row">
                    <div className="form-field">
                      <label>Expiry Date</label>
                      <input 
                        type="text" 
                        placeholder="MM/YY"
                        value={upgradeForm.expiry_date}
                        onChange={(e) => setUpgradeForm({...upgradeForm, expiry_date: e.target.value})}
                        required
                      />
                    </div>
                    <div className="form-field">
                      <label>CVV</label>
                      <input 
                        type="text" 
                        placeholder="123"
                        value={upgradeForm.cvv}
                        onChange={(e) => setUpgradeForm({...upgradeForm, cvv: e.target.value})}
                        required
                      />
                    </div>
                  </div>
                </div>
                
                <div className="form-section">
                  <h3>Billing Address</h3>
                  <div className="form-field">
                    <label>Address</label>
                    <input 
                      type="text" 
                      value={upgradeForm.billing_address}
                      onChange={(e) => setUpgradeForm({...upgradeForm, billing_address: e.target.value})}
                      required
                    />
                  </div>
                  <div className="form-row">
                    <div className="form-field">
                      <label>City</label>
                      <input 
                        type="text" 
                        value={upgradeForm.city}
                        onChange={(e) => setUpgradeForm({...upgradeForm, city: e.target.value})}
                        required
                      />
                    </div>
                    <div className="form-field">
                      <label>ZIP Code</label>
                      <input 
                        type="text" 
                        value={upgradeForm.zip_code}
                        onChange={(e) => setUpgradeForm({...upgradeForm, zip_code: e.target.value})}
                        required
                      />
                    </div>
                  </div>
                  <div className="form-field">
                    <label>Country</label>
                    <input 
                      type="text" 
                      value={upgradeForm.country}
                      onChange={(e) => setUpgradeForm({...upgradeForm, country: e.target.value})}
                      required
                    />
                  </div>
                </div>
                
                <div className="upgrade-summary">
                  <div className="summary-row">
                    <span>Plan:</span>
                    <span>{selectedPlanForUpgrade.plan_name}</span>
                  </div>
                  <div className="summary-row">
                    <span>Billing Period:</span>
                    <span>{billingPeriod === 'monthly' ? 'Monthly' : 'Yearly'}</span>
                  </div>
                  <div className="summary-row total">
                    <span>Total:</span>
                    <span>${billingPeriod === 'monthly' ? selectedPlanForUpgrade.price_monthly : selectedPlanForUpgrade.price_yearly}</span>
                  </div>
                </div>
                
                <button type="submit" className="upgrade-submit-btn">
                  Complete Upgrade
                </button>
              </form>
            </div>
          </div>
        )}
      </>
    )
  }

  if (!isAuthenticated) {
    return showSessionExpired ? <SessionExpiredModal /> : <AuthModal />
  }

  return (
    <div className="app-root">
      <aside className="sidebar">
        <div className="sidebar-header">
          <button className="new-chat-btn" onClick={createNewChat}>+ New chat</button>
        </div>
        <div className="sidebar-section">
          <p className="sidebar-label">Recent</p>
          <div className="sidebar-sessions">
            {sessions.length === 0 ? (
              <p className="no-sessions">No conversations yet</p>
            ) : (
              sessions.map((session) => (
                <div key={session.session_id} className="session-item-wrapper">
                  {renamingSession === session.session_id ? (
                    <div className="rename-input-wrapper">
                      <input
                        type="text"
                        className="rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            renameSession(session.session_id, renameValue)
                          } else if (e.key === 'Escape') {
                            setRenamingSession(null)
                            setRenameValue('')
                          }
                        }}
                        onBlur={() => {
                          if (renameValue.trim()) {
                            renameSession(session.session_id, renameValue)
                          } else {
                            setRenamingSession(null)
                            setRenameValue('')
                          }
                        }}
                        autoFocus
                      />
                    </div>
                  ) : (
                    <>
                      <button 
                        className={`sidebar-item ${currentSessionId === session.session_id ? 'active' : ''}`}
                        onClick={() => loadSession(session.session_id)}
                      >
                        {session.title || session.summary || 'New conversation'}
                      </button>
                      <button 
                        className="session-menu-btn"
                        onClick={(e) => {
                          e.stopPropagation()
                          setShowContextMenu(showContextMenu === session.session_id ? null : session.session_id)
                        }}
                      >
                        ⋮
                      </button>
                      {showContextMenu === session.session_id && (
                        <div className="context-menu" ref={contextMenuRef}>
                          <button onClick={() => {
                            setRenamingSession(session.session_id)
                            setRenameValue(session.title || session.summary || 'New conversation')
                            setShowContextMenu(null)
                          }}>
                            Rename
                          </button>
                          <button onClick={() => deleteSession(session.session_id)}>
                            Delete
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
        <div className="sidebar-footer">
          <button className="sidebar-footer-item" onClick={() => setShowSettings(true)}>
            ⚙️ Settings
          </button>
        </div>
      </aside>

      <main className="chat-layout">
        <header className="chat-header">
          <div className="header-left">
            <div className="chat-title">LLM Router Chat</div>
            <div className="chat-subtitle">AI-powered conversation interface</div>
          </div>
        </header>

        <section className="chat-messages" ref={chatMessagesRef}>
          {messages.length === 0 ? (
            <div className="empty-state">
              <h3>Welcome to LLM Router! 👋</h3>
              <p>Start a conversation by typing a message below.</p>
              <div className="company-logos">
                <img src={googleIcon} alt="Google" className="vendor-icon" />
                <img src={deepseekIcon} alt="DeepSeek" className="vendor-icon" />
                <img src={ollamaIcon} alt="Ollama" className="vendor-icon" />
                <img src={metaIcon} alt="Meta" className="vendor-icon" />
                <img src={anthropicIcon} alt="Anthropic" className="vendor-icon" />
              </div>
            </div>
          ) : (
            messages.map((m, idx) => (
              <div key={m.id}>
                <div
                  className={`chat-message ${m.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}
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
                      {(() => {
                        // Check if message has code_blocks (from API response)
                        const codeBlocks = m.code_blocks || []
                        const parts = parseMessageContent(m.content, codeBlocks)
                        
                        return parts.map((part, partIdx) => {
                          if (part.type === 'code') {
                            return <CodeBlock key={partIdx} code={part.code} language={part.language} />
                          } else {
                            return (
                              <div key={partIdx}>
                                {part.content.split('\n').map((line, lineIdx) => (
                                  <p key={lineIdx}>{line || '\u00A0'}</p>
                                ))}
                              </div>
                            )
                          }
                        })
                      })()}
                    </div>
                  </div>
                </div>
                
                {m.role === 'assistant' && (
                  <div className="message-actions">
                    <button 
                      className={`action-btn ${messageActions[m.id] === 'regenerating' ? 'regenerating' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      disabled={messageActions[m.id] === 'regenerating' || isLoading}
                      onClick={() => {
                        if (messageActions[m.id] !== 'regenerating' && !isLoading) {
                          const prevUserMsg = messages[idx - 1]
                          if (prevUserMsg && prevUserMsg.role === 'user') {
                            handleRegenerateResponse(m.id, prevUserMsg.content)
                          }
                        }
                      }}
                      title="Regenerate response"
                    >
                      {messageActions[m.id] === 'regenerating' ? (
                        <>
                          <svg viewBox="0 0 24 24" fill="currentColor" className="action-icon spinning">
                            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
                          </svg>
                          Regenerating...
                        </>
                      ) : (
                        <>
                          <svg viewBox="0 0 24 24" fill="currentColor" className="action-icon">
                            <path d="M12 4V1L8 5l4 4V6c3.31 0 6 2.69 6 6 0 1.01-.25 1.97-.7 2.8l1.46 1.46C19.54 15.03 20 13.57 20 12c0-4.42-3.58-8-8-8zm0 14c-3.31 0-6-2.69-6-6 0-1.01.25-1.97.7-2.8L5.24 7.74C4.46 8.97 4 10.43 4 12c0 4.42 3.58 8 8 8v3l4-4-4-4v3z"/>
                          </svg>
                          Regenerate
                        </>
                      )}
                    </button>
                    
                    <button 
                      className={`action-btn ${messageActions[m.id] === 'liked' ? 'liked' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      disabled={messageActions[m.id] === 'regenerating' || isLoading}
                      onClick={() => {
                        if (messageActions[m.id] !== 'regenerating' && !isLoading) {
                          handleThumbsUp(m.id, currentSessionId)
                        }
                      }}
                      title="Good response"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="action-icon">
                        <path d="M1 21h4V9H1v12zm22-11c0-1.1-.9-2-2-2h-6.31l.95-4.57.03-.32c0-.41-.17-.79-.44-1.06L14.17 1 7.59 7.59C7.22 7.95 7 8.45 7 9v10c0 1.1.9 2 2 2h9c.83 0 1.54-.5 1.84-1.22l3.02-7.05c.09-.23.14-.47.14-.73v-2z"/>
                      </svg>
                      {messageActions[m.id] === 'liked' ? 'Liked' : 'Good'}
                    </button>
                    
                    <button 
                      className={`action-btn ${messageActions[m.id] === 'disliked' ? 'disliked' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      disabled={messageActions[m.id] === 'regenerating' || isLoading}
                      onClick={() => {
                        if (messageActions[m.id] !== 'regenerating' && !isLoading) {
                          handleThumbsDown(m.id, currentSessionId)
                        }
                      }}
                      title="Bad response"
                    >
                      <svg viewBox="0 0 24 24" fill="currentColor" className="action-icon">
                        <path d="M15 3H6c-.83 0-1.54.5-1.84 1.22l-3.02 7.05c-.09.23-.14.47-.14.73v2c0 1.1.9 2 2 2h6.31l-.95 4.57-.03.32c0 .41.17.79.44 1.06L9.83 23l6.59-6.59c.38-.38.59-.88.59-1.41V5c0-1.1-.9-2-2-2zm4 0v12h4V3h-4z"/>
                      </svg>
                      {messageActions[m.id] === 'disliked' ? 'Disliked' : 'Bad'}
                    </button>
                  </div>
                )}
              </div>
            ))
          )}

          {isLoading && (
            <div className="chat-message chat-message-assistant">
              <div className="avatar">
                <span className="avatar-initial">AI</span>
              </div>
              <div className="chat-bubble">
                <div className="typing-indicator">
                  <span /><span /><span />
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} />
        </section>

        <footer className="chat-input-wrapper">
          <div className="query-mode-toggle">
            <button 
              className={`mode-btn ${queryMode === 'normal' ? 'active' : ''}`}
              onClick={() => setQueryMode('normal')}
              title="Normal Query (mistral:7b)"
            >
              <svg className="mode-icon-svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm-1-13h2v6h-2zm0 8h2v2h-2z"/>
              </svg>
            </button>
            <button 
              className={`mode-btn ${queryMode === 'web_search' ? 'active' : ''}`}
              onClick={() => setQueryMode('web_search')}
              title="Web Search"
            >
              <svg className="mode-icon-svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/>
              </svg>
            </button>
            <button 
              className={`mode-btn ${queryMode === 'code' ? 'active' : ''}`}
              onClick={() => setQueryMode('code')}
              title="Code Assistant (codellama:7b)"
            >
              <svg className="mode-icon-svg" viewBox="0 0 24 24" fill="currentColor">
                <path d="M9.4 16.6L4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0l4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z"/>
              </svg>
            </button>
          </div>
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
            {isLoading ? (
              <button type="button" className="send-btn stop-btn" onClick={cancelRequest}>⏹</button>
            ) : (
              <button type="submit" className="send-btn" disabled={!input.trim()}>➤</button>
            )}
          </form>
          <p className="chat-input-helper">
            LLM Router may produce inaccurate information about people, places, or facts.
          </p>
        </footer>
      </main>

      {showSettings && <SettingsModal />}
      {showSessionExpired && <SessionExpiredModal />}
    </div>
  )
}

export default App
