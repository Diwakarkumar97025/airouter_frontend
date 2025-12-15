import React, { useState, useRef, useEffect } from 'react'
import './App.css'
import googleIcon from './assets/icons/google.png'
import deepseekIcon from './assets/icons/deepseek.svg'
import ollamaIcon from './assets/icons/openai.png'
import metaIcon from './assets/icons/meta.png'
import anthropicIcon from './assets/icons/anthropic.png'

// CONFIGURABLE API URL
const API_BASE_URL = 'http://localhost:8000'

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
        setSessions(data || [])
        return data
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
        
        // Extract title from the API response
        // Based on your API: { session_id, role, content, answered_by_model, title }
        let title = null
        let messages = []
        
        // Handle different response structures
        if (Array.isArray(responseData)) {
          // If response is array of messages
          messages = responseData
          // Check if first message has title
          if (responseData.length > 0 && responseData[0].title) {
            title = responseData[0].title
          }
        } else if (responseData.title) {
          // If response has title at root level (single message object)
          title = responseData.title
          // If it's a single message object, convert to array
          if (responseData.content) {
            messages = [{
              id: responseData.id || Date.now(),
              role: responseData.role || 'assistant',
              content: responseData.content
            }]
          } else {
            messages = responseData.messages || []
          }
        } else if (responseData.messages && Array.isArray(responseData.messages)) {
          // If response is object with messages array
          messages = responseData.messages
          title = responseData.title || responseData.summary
        } else {
          // Fallback: assume it's messages array
          messages = Array.isArray(responseData) ? responseData : []
        }
        
        // Check if current session title is "New conversation" and update if title exists
        const sessionInfo = sessions.find(s => s.session_id === sessionId)
        const currentTitle = sessionInfo?.summary || sessionInfo?.title || 'New conversation'
        
        // Only update if current title is "New conversation" and API has a different title
        if (currentTitle === 'New conversation' && 
            title && 
            title !== 'New conversation') {
          console.log('Updating title from API response:', title)
          const updated = await updateChatTitle(sessionId, title)
          if (updated) {
            // Reload sessions to update the UI immediately
            await loadSessions(user.id, token)
          }
        }
        
        // Format messages for display
        const formattedMessages = messages.map(msg => ({
          id: msg.id || Date.now() + Math.random(),
          role: msg.role,
          content: msg.content
        }))
        
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
      
      // Check if title was returned and update
      if (data.title) {
        console.log('Received title from response:', data.title)
        const updated = await updateChatTitle(currentSessionId, data.title)
        if (updated) {
          console.log('Title updated successfully, stopping any polling')
          if (titlePollInterval.current) {
            clearInterval(titlePollInterval.current)
          }
        }
      }
      
      // Reload the full session to get all messages from backend
      await loadSession(currentSessionId)
      
      // Reload sessions list to update sidebar
      await loadSessions(user.id, token)
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
    
    await updateChatTitle(sessionId, newTitle)
    setRenamingSession(null)
    setRenameValue('')
    setShowContextMenu(null)
  }

  const fetchAnalytics = async () => {
    const token = localStorage.getItem('access_token')
    try {
      const res = await fetch(`${API_BASE_URL}/api/model_requests`, {
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

  const handleThumbsUp = (messageId) => {
    setMessageActions(prev => ({ ...prev, [messageId]: 'liked' }))
    console.log('Message liked:', messageId)
  }

  const handleThumbsDown = (messageId) => {
    setMessageActions(prev => ({ ...prev, [messageId]: 'disliked' }))
    console.log('Message disliked:', messageId)
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
    const maxRequests = Math.max(...analyticsData.map(d => d.request_count || 0), 1)
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
            ) : (
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
                            const barHeight = yAxisMax > 0 ? (item.request_count / yAxisMax) * 100 : 0
                            
                            return (
                              <div key={idx} className="excel-bar-col">
                                <div 
                                  className="excel-bar"
                                  style={{ height: `${barHeight}%` }}
                                  title={`${item.model_name}: ${item.request_count} requests`}
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
            )}
          </div>
        </div>
      </div>
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
                        {session.summary || 'New conversation'}
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
                            setRenameValue(session.summary || 'New conversation')
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
                      {m.content.split('\n').map((line, idx) => (
                        <p key={idx}>{line || '\u00A0'}</p>
                      ))}
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
                          handleThumbsUp(m.id)
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
                          handleThumbsDown(m.id)
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