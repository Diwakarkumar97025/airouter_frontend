import React, { useState, useRef, useEffect } from 'react'
import './App.css'
import googleIcon from './assets/icons/google.png'
import deepseekIcon from './assets/icons/deepseek.svg'
import ollamaIcon from './assets/icons/openai.png'
import metaIcon from './assets/icons/meta.png'
import anthropicIcon from './assets/icons/anthropic.png'
import Plot from "react-plotly.js"


// CONFIGURABLE API URL
const API_BASE_URL = 'http://localhost:8000'

// ===== TOKEN MANAGEMENT =====
// Token storage keys
const TOKEN_STORAGE_KEY = 'auth_tokens'
const LEGACY_ACCESS_TOKEN_KEY = 'access_token'
const LEGACY_SESSION_ID_KEY = 'session_id'

// Save tokens to localStorage
const saveTokens = (response) => {
  const tokens = {
    access_token: response.access_token,
    refresh_token: response.refresh_token || '',
    session_id: response.session_id,
    expires_at: Date.now() + ((response.expires_in || 1800) * 1000),
    refresh_expires_at: Date.now() + ((response.refresh_expires_in || 1209600) * 1000)
  }
  localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens))
  
  // Also store legacy keys for backward compatibility
  localStorage.setItem(LEGACY_ACCESS_TOKEN_KEY, tokens.access_token)
  localStorage.setItem(LEGACY_SESSION_ID_KEY, tokens.session_id)
}

// Get tokens from localStorage
const getTokens = () => {
  const stored = localStorage.getItem(TOKEN_STORAGE_KEY)
  if (stored) {
    try {
      const tokens = JSON.parse(stored)
      // Check if refresh token is still valid
      if (Date.now() < tokens.refresh_expires_at) {
        return tokens
      } else {
        // Refresh token expired, clear tokens
        clearTokens()
        return null
      }
    } catch (e) {
      console.error('Error parsing tokens:', e)
      return null
    }
  }
  
  // Fallback to legacy storage
  const legacyToken = localStorage.getItem(LEGACY_ACCESS_TOKEN_KEY)
  const legacySession = localStorage.getItem(LEGACY_SESSION_ID_KEY)
  if (legacyToken && legacySession) {
    // Migrate legacy tokens (assume they're still valid)
    const tokens = {
      access_token: legacyToken,
      refresh_token: '', // No refresh token in legacy
      session_id: legacySession,
      expires_at: Date.now() + (30 * 60 * 1000), // Assume 30 min
      refresh_expires_at: Date.now() + (14 * 24 * 60 * 60 * 1000) // Assume 14 days
    }
    saveTokens(tokens)
    return tokens
  }
  
  return null
}

// Clear all tokens
const clearTokens = () => {
  localStorage.removeItem(TOKEN_STORAGE_KEY)
  localStorage.removeItem(LEGACY_ACCESS_TOKEN_KEY)
  localStorage.removeItem(LEGACY_SESSION_ID_KEY)
}

// Get current access token
const getAccessToken = () => {
  const tokens = getTokens()
  return tokens?.access_token || null
}

// Check if access token is expired or about to expire (within 5 minutes)
const isAccessTokenExpired = () => {
  const tokens = getTokens()
  if (!tokens) return true
  const timeUntilExpiry = tokens.expires_at - Date.now()
  return timeUntilExpiry < (5 * 60 * 1000) // Less than 5 minutes
}

// Refresh access token
let refreshPromise = null

const refreshAccessToken = async () => {
  // Prevent concurrent refresh attempts
  if (refreshPromise) {
    return refreshPromise
  }
  
  const tokens = getTokens()
  if (!tokens || !tokens.refresh_token) {
    clearTokens()
    return null
  }
  
  // Check if refresh token is expired
  if (Date.now() >= tokens.refresh_expires_at) {
    clearTokens()
    return null
  }
  
  refreshPromise = fetch(`${API_BASE_URL}/api/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      session_id: tokens.session_id,
      refresh_token: tokens.refresh_token
    })
  })
    .then(async (res) => {
      if (!res.ok) {
        if (res.status === 401) {
          // Refresh token expired or invalid
          clearTokens()
          return null
        }
        throw new Error(`Refresh failed: ${res.status}`)
      }
      const data = await res.json()
      saveTokens(data)
      return getTokens()
    })
    .catch((error) => {
      console.error('Token refresh error:', error)
      clearTokens()
      return null
    })
    .finally(() => {
      refreshPromise = null
    })
  
  return refreshPromise
}

// Fetch wrapper with automatic token refresh
const authenticatedFetch = async (url, options = {}) => {
  // Get current access token
  let token = getAccessToken()
  
  // Check if token is expired or about to expire
  if (!token || isAccessTokenExpired()) {
    // Try to refresh
    const refreshedTokens = await refreshAccessToken()
    if (refreshedTokens) {
      token = refreshedTokens.access_token
    } else {
      // Refresh failed, return 401 response
      return new Response(JSON.stringify({ detail: 'Authentication required' }), {
        status: 401,
        statusText: 'Unauthorized',
        headers: { 'Content-Type': 'application/json' }
      })
    }
  }
  
  // Add authorization header
  const headers = new Headers(options.headers || {})
  headers.set('Authorization', `Bearer ${token}`)
  
  // Make the request
  let response = await fetch(url, {
    ...options,
    headers
  })
  
  // If 401, try to refresh and retry once
  if (response.status === 401) {
    const refreshedTokens = await refreshAccessToken()
    if (refreshedTokens) {
      // Retry with new token (preserve signal if present)
      headers.set('Authorization', `Bearer ${refreshedTokens.access_token}`)
      response = await fetch(url, {
        ...options,
        headers,
        signal: options.signal // Preserve AbortController signal
      })
    } else {
      // Refresh failed, return 401
      return response
    }
  }
  
  return response
}

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
// Format text content: handle **bold** and bullet points
const formatTextContent = (text) => {
  if (!text) return text
  
  // Replace * **text** with bullet point (•) and keep **text** for rendering
  // Keep it inline with just one space, no line break
  let formatted = text.replace(/\*\s+\*\*([^*]+)\*\*/g, (match, boldText) => {
    return `• **${boldText}**`
  })
  
  // Don't change anything else - **text** will be handled in rendering
  return formatted
}

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

// Helper function to render bold text
const renderBoldText = (text) => {
  const boldRegex = /\*\*([^*]+)\*\*/g
  const parts = []
  let lastIndex = 0
  let match
  
  while ((match = boldRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.substring(lastIndex, match.index))
    }
    parts.push({ type: 'bold', text: match[1] })
    lastIndex = match.index + match[0].length
  }
  
  if (lastIndex < text.length) {
    parts.push(text.substring(lastIndex))
  }
  
  return parts.length > 0 ? (
    <>
      {parts.map((part, idx) => 
        typeof part === 'object' && part.type === 'bold' 
          ? <strong key={idx}>{part.text}</strong>
          : <span key={idx}>{part}</span>
      )}
    </>
  ) : text
}

// Helper function to render table
const renderTable = (rows, keyPrefix) => {
  if (rows.length === 0) return null
  
  // Check if second row is a separator (contains only dashes, colons, and pipes)
  const isSeparatorRow = (row) => {
    return row.every(cell => /^[\s\-:]+$/.test(cell))
  }
  
  let headerRow, dataRows
  if (rows.length > 1 && isSeparatorRow(rows[1])) {
    // Standard markdown table: header, separator, data
    headerRow = rows[0]
    dataRows = rows.slice(2)
  } else {
    // No separator row: first row is header, rest is data
    headerRow = rows[0]
    dataRows = rows.slice(1)
  }
  
  if (!headerRow || headerRow.length === 0) return null
  
  return (
    <table key={keyPrefix} className="message-table">
      <thead>
        <tr>
          {headerRow.map((cell, idx) => (
            <th key={idx}>{renderBoldText(cell)}</th>
          ))}
        </tr>
      </thead>
      {dataRows.length > 0 && (
        <tbody>
          {dataRows.map((row, rowIdx) => (
            <tr key={rowIdx}>
              {row.map((cell, cellIdx) => (
                <td key={cellIdx}>{renderBoldText(cell)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      )}
    </table>
  )
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
  const [settingsTab, setSettingsTab] = useState('overview')
  const [usageView, setUsageView] = useState('daily') // daily | all - moved to parent to persist
  const [analyticsData, setAnalyticsData] = useState([])
  const [user, setUser] = useState(null)
  const [error, setError] = useState(null)
  const [showPasswordReset, setShowPasswordReset] = useState(false)
  const [passwordResetStep, setPasswordResetStep] = useState('request') // 'request' | 'confirm' | 'success'
  const [passwordResetEmail, setPasswordResetEmail] = useState('')
  const [passwordResetToken, setPasswordResetToken] = useState('')
  const [passwordResetNewPassword, setPasswordResetNewPassword] = useState('')
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
  const [showPlanSelection, setShowPlanSelection] = useState(false)
  const [showBillingForm, setShowBillingForm] = useState(false)
  const [billingPeriod, setBillingPeriod] = useState('monthly')
  const [paymentIntent, setPaymentIntent] = useState(null)
  const [upgradeForm, setUpgradeForm] = useState({
    payment_method: 'stripe',
    card_number: '',
    expiry_date: '',
    cvv: '',
    billing_address: '',
    city: '',
    zip_code: '',
    country: 'US',
    upi_id: ''
  })
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('card') // 'card', 'apple_pay', 'upi'
  const [codeBlocksCache, setCodeBlocksCache] = useState({}) // message_id -> code_blocks
  const [usageSummary, setUsageSummary] = useState(null)
  const [showLimitWarning, setShowLimitWarning] = useState(false)
  const [limitWarningMessage, setLimitWarningMessage] = useState('')
  const [pendingConfirmation, setPendingConfirmation] = useState(null) // { confirmationId, message, chatInput }
  const [showConfirmationModal, setShowConfirmationModal] = useState(false)
  const [escalationInfo, setEscalationInfo] = useState({}) // messageId -> { currentLevel, maxLevel, model }
  const [monitoringUsage, setMonitoringUsage] = useState([])
  const [monitoringPerformance, setMonitoringPerformance] = useState([])
  const [monitoringCost, setMonitoringCost] = useState([])
  const [monitoringLoading, setMonitoringLoading] = useState(false)
  const [monitoringError, setMonitoringError] = useState(null)
  const [billingHistory, setBillingHistory] = useState([])
  const [billingHistoryCount, setBillingHistoryCount] = useState(0) // Total count from API
  const [showDownloadPrompt, setShowDownloadPrompt] = useState(false) // Show prompt when count > 100
  const [usageWarnings, setUsageWarnings] = useState([])
  const [statusBanner, setStatusBanner] = useState(null)
  const [statusSteps, setStatusSteps] = useState([]) // Array to accumulate all status steps
  // BYOK Plan - API Keys Management
  const [apiKeysStatus, setApiKeysStatus] = useState(null) // { gemini: boolean, openai: boolean, groq: boolean, anthropic: boolean }
  const [editingVendor, setEditingVendor] = useState(null) // 'gemini' | 'openai' | 'groq' | 'anthropic' | null
  const [apiKeyValues, setApiKeyValues] = useState({}) // { vendor: key_value }
  const [apiKeysLoading, setApiKeysLoading] = useState(false)
  const [apiKeysError, setApiKeysError] = useState(null)
  const [showManageSubscription, setShowManageSubscription] = useState(false)
  const [showUserMenu, setShowUserMenu] = useState(false)
  const [usageRange, setUsageRange] = useState('1d') // for all-usage view: '1d' | '7d' | 'custom'
  const [dateRange, setDateRange] = useState({ start: null, end: null }) // YYYY-MM-DD
  const [invoices, setInvoices] = useState([])
  const statusTimerRef = useRef(null)
  const thinkingMessageIdRef = useRef(null)
  
  const abortControllerRef = useRef(null)
  const textareaRef = useRef(null)
  const messagesEndRef = useRef(null)
  const chatMessagesRef = useRef(null)
  const settingsRef = useRef(null)
  const contextMenuRef = useRef(null)
  const userMenuRef = useRef(null)
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
    const tokens = getTokens()
    const savedSessionId = localStorage.getItem('current_session_id')
    const savedMode = localStorage.getItem('query_mode')
    
    if (savedMode) setQueryMode(savedMode)
    
    if (tokens && tokens.access_token) {
      // Check if access token needs refresh
      if (isAccessTokenExpired()) {
        // Proactively refresh token
        refreshAccessToken().then((refreshedTokens) => {
          if (refreshedTokens && refreshedTokens.access_token) {
            fetchUserProfile(refreshedTokens.access_token).then(() => {
        if (savedSessionId) {
          setCurrentSessionId(savedSessionId)
          loadSession(savedSessionId)
        }
      })
          } else {
            // Refresh failed, show login
            clearTokens()
            setShowAuthModal(true)
          }
        })
      } else {
        // Token is still valid
        fetchUserProfile(tokens.access_token).then(() => {
          if (savedSessionId) {
            setCurrentSessionId(savedSessionId)
            loadSession(savedSessionId)
          }
        })
      }
      
      // Setup proactive token refresh
      setupProactiveTokenRefresh()
    } else {
      setShowAuthModal(true)
    }
  }, [])
  
  // Proactive token refresh - refresh before expiry
  const setupProactiveTokenRefresh = () => {
    const tokens = getTokens()
    if (!tokens) return
    
    const timeUntilExpiry = tokens.expires_at - Date.now()
    const refreshTime = timeUntilExpiry - (5 * 60 * 1000) // Refresh 5 minutes before expiry
    
    if (refreshTime > 0) {
      setTimeout(async () => {
        try {
          const refreshedTokens = await refreshAccessToken()
          if (refreshedTokens) {
            // Schedule next refresh
            setupProactiveTokenRefresh()
          }
        } catch (error) {
          console.error('Proactive token refresh failed:', error)
          // Will be handled by 401 interceptor on next request
        }
      }, refreshTime)
    }
  }

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
      if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
        setShowUserMenu(false)
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

  // Fetch billing info when settings opens to check for BYOK plan
  useEffect(() => {
    if (showSettings) {
      fetchBillingInfo() // Always fetch to ensure we have latest plan info
    }
  }, [showSettings])

  // NO automatic polling - only check title when user clicks on a session

  const fetchUserProfile = async (token) => {
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/me`)
      
      if (res.status === 401) {
        // Token refresh failed or no valid tokens
        clearTokens()
        setShowSessionExpired(true)
        setIsAuthenticated(false)
        setShowAuthModal(true)
        return
      }
      
      if (res.ok) {
        const userData = await res.json()
        setUser(userData)
        setIsAuthenticated(true)
        setShowAuthModal(false)
        const currentToken = getAccessToken()
        if (currentToken) {
          await loadSessions(userData.id, currentToken)
          loadUserProfile(currentToken)
          // Fetch billing info and usage on login
          await fetchBillingInfo()
        }
      } else {
        throw new Error('Invalid token')
      }
    } catch (err) {
      console.error('Auth check failed:', err)
      clearTokens()
      setShowAuthModal(true)
      setIsAuthenticated(false)
    }
  }

  const loadUserProfile = async (token) => {
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/user/profile`)
      
      if (res.status === 401) {
        // Token refresh failed
        clearTokens()
        setShowSessionExpired(true)
        setIsAuthenticated(false)
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
      const res = await authenticatedFetch(`${API_BASE_URL}/api/users/${userId}/sessions`)
      
      if (res.status === 401) {
        clearTokens()
        setShowSessionExpired(true)
        setIsAuthenticated(false)
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
          
          const statusMessages = msg.status_messages || []
          
          return {
            id: dbId,
          role: msg.role,
            content: msg.content,
            code_blocks: cachedCodeBlocks || msg.code_blocks || [],
            status_messages: statusMessages,
            models_tried: msg.models_tried || [],
            domain: msg.domain,
            risk_score: msg.risk_score,
            adequacy_score: msg.adequacy_score,
            is_region_red: msg.is_region_red,
            model_used: msg.model_used
          }
        })
        
        const latestAssistant = formattedMessages.slice().reverse().find(m => m.role === 'assistant')
        if (latestAssistant && latestAssistant.status_messages && latestAssistant.status_messages.length > 0) {
          const hasEscalation = latestAssistant.status_messages.some(s => s.toLowerCase().includes('stronger'))
          if (hasEscalation) {
            const modelList = (latestAssistant.models_tried || []).map(m => typeof m === 'string' ? m : (m.model || 'default model'))
            setStatusBanner({
              type: 'escalation',
              messages: latestAssistant.status_messages.filter(s => s.toLowerCase().includes('stronger')),
              models: modelList
            })
          } else {
            setStatusBanner(null)
          }
        } else {
          setStatusBanner(null)
        }
        
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
      
      // Remove thinking message if it exists and replace with cancellation message
      if (thinkingMessageIdRef.current) {
        setMessages((prev) => prev.map(msg => 
          msg.id === thinkingMessageIdRef.current 
            ? { ...msg, isThinking: false, content: 'Request cancelled by user.' }
            : msg
        ))
        thinkingMessageIdRef.current = null
      } else {
      setMessages((prev) => [
        ...prev,
        {
          id: Date.now() + 1,
          role: 'assistant',
          content: 'Request cancelled by user.'
        }
      ])
      }
      
      setStatusBanner(null)
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current)
      }
    }
  }

  // Handle SSE events
  const handleSSEEvent = (event, requestBody) => {
    console.log('[SSE Event Received]', event) // Debug: Log all SSE events
    switch (event.type) {
      case 'status':
        // Update thinking message in real-time
        const statusMessage = event.message
        const modelName = event.model_name || null
        console.log('[Status Event]', { statusMessage, modelName, thinkingMessageId: thinkingMessageIdRef.current }) // Debug
        
        if (thinkingMessageIdRef.current) {
          // Update the thinking message with the current status step immediately
          setMessages((prev) => prev.map(msg => 
            msg.id === thinkingMessageIdRef.current 
              ? { ...msg, thinkingStatus: statusMessage }
              : msg
          ))
          
          // Skip "thinking" and "thinking longer" messages - they're not part of Chain-of-Thought
          if (statusMessage === 'thinking' || statusMessage === 'thinking longer') {
            // Don't clear banner for these, just update thinking status
            return
          }
          
          // Add status step to accumulated list and update banner
          setStatusSteps((prev) => {
            const newStep = {
              message: statusMessage,
              modelName: modelName,
              timestamp: Date.now()
            }
            console.log('[Adding Status Step]', newStep, 'Previous steps:', prev.length) // Debug
            // Avoid duplicates (same message and model)
            const exists = prev.some(s => 
              s.message === statusMessage && 
              (s.modelName === modelName || (!s.modelName && !modelName))
            )
            if (!exists) {
              const updatedSteps = [...prev, newStep]
              console.log('[Updated Steps]', updatedSteps) // Debug
              
              // Update status banner with all accumulated steps
              const allMessages = updatedSteps.map(s => s.message)
              const allModels = updatedSteps.filter(s => s.modelName).map(s => s.modelName)
              
              // Determine banner type
              let bannerType = 'info'
              if (statusMessage === 'trying stronger model' || statusMessage.includes('stronger') || statusMessage.includes('Trying stronger')) {
                bannerType = 'escalation'
              }
              
              const bannerData = { 
                type: bannerType, 
                messages: allMessages,
                models: [...new Set(allModels)], // Remove duplicates
                steps: updatedSteps // Store full step data for Chain-of-Thought display
              }
              console.log('[Setting Status Banner]', bannerData) // Debug
              setStatusBanner(bannerData)
              
              return updatedSteps
            }
            console.log('[Duplicate Step Skipped]', statusMessage) // Debug
            return prev
          })
        }
        break

      case 'complete':
        // Process final response
        processCompleteResponse(event.result, requestBody)
        // Clear status steps and banner after a short delay to show final state
        setTimeout(() => {
          setStatusSteps([])
          setStatusBanner(null)
        }, 2000)
        break

      case 'error':
        // Show error - replace thinking message with error
        console.error('SSE Error:', event.error)
        if (thinkingMessageIdRef.current) {
          setMessages((prev) => prev.map(msg => 
            msg.id === thinkingMessageIdRef.current 
              ? { ...msg, isThinking: false, content: `Error: ${event.error}` }
              : msg
          ))
          thinkingMessageIdRef.current = null
        } else {
          setMessages((prev) => [
            ...prev,
            {
              id: Date.now() + 1,
              role: 'assistant',
              content: `Error: ${event.error}`
            }
          ])
        }
        setIsLoading(false)
        setStatusBanner(null)
        if (statusTimerRef.current) {
          clearTimeout(statusTimerRef.current)
        }
        break
    }
  }

  // Process complete response from SSE
  const processCompleteResponse = async (data, requestBody) => {
    // Store code_blocks in cache using message_id from response
    if (data.message_id && data.code_blocks && data.code_blocks.length > 0) {
      setCodeBlocksCache(prev => ({
        ...prev,
        [data.message_id]: data.code_blocks
      }))
    }
    
    // Update status banner from orchestrator status messages (only show escalation, not thinking)
    if (data.status_messages && data.status_messages.length > 0) {
      const hasEscalation = data.status_messages.some(s => s.toLowerCase().includes('stronger'))
      if (hasEscalation) {
        const modelList = (data.models_tried || []).map(m => typeof m === 'string' ? m : (m.model || 'default model'))
        setStatusBanner({
          type: 'escalation',
          messages: data.status_messages.filter(s => s.toLowerCase().includes('stronger')),
          models: modelList
        })
      } else {
        setStatusBanner(null)
      }
    } else {
      setStatusBanner(null)
    }
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current)
    }
    
    // Capture escalation info if present
    if (data.message_id && (data.models_tried || data.model_used)) {
      setEscalationInfo(prev => ({
        ...prev,
        [data.message_id]: {
          currentLevel: (data.models_tried && data.models_tried.length > 0) ? data.models_tried.length - 1 : 0,
          maxLevel: billingInfo?.max_code_escalations !== null ? billingInfo?.max_code_escalations : (billingInfo?.max_web_search_escalation_level !== undefined ? billingInfo?.max_web_search_escalation_level : null),
          model: (data.models_tried && data.models_tried.length > 0)
            ? (typeof data.models_tried[data.models_tried.length - 1] === 'string'
              ? data.models_tried[data.models_tried.length - 1]
              : (data.models_tried[data.models_tried.length - 1].model || 'default model'))
            : (data.model_used || 'default model')
        }
      }))
    }
    
    // Store escalation info if provided
    if (data.message_id && data.escalation_level !== undefined) {
      setEscalationInfo(prev => ({
        ...prev,
        [data.message_id]: {
          currentLevel: data.escalation_level,
          maxLevel: billingInfo?.max_code_escalations !== null ? billingInfo?.max_code_escalations : (billingInfo?.max_web_search_escalation_level !== undefined ? billingInfo?.max_web_search_escalation_level : null),
          model: data.model_used || 'Unknown'
        }
      }))
    }
    
    // Refresh usage after successful request
    await fetchUsageSummary()
    
    // Clear thinking message ref - it will be replaced by actual message from loadSession
    thinkingMessageIdRef.current = null
    
    // Reload session to get updated messages
    await loadSession(currentSessionId)
    
    setIsLoading(false)
    if (statusTimerRef.current) {
      clearTimeout(statusTimerRef.current)
    }
  }

  // Read SSE stream
  const readSSEStream = async (response, requestBody) => {
    const reader = response.body?.getReader()
    const decoder = new TextDecoder()
    
    if (!reader) {
      throw new Error('No response body reader available')
    }

    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        
        if (done) {
          break
        }

        // Decode chunk
        buffer += decoder.decode(value, { stream: true })
        
        // Process complete SSE messages (lines ending with \n\n)
        const lines = buffer.split('\n\n')
        buffer = lines.pop() || '' // Keep incomplete line in buffer

        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const jsonStr = line.substring(6) // Remove 'data: ' prefix
            console.log('[SSE Raw Data]', jsonStr) // Debug: Log raw SSE data
            try {
              const event = JSON.parse(jsonStr)
              console.log('[SSE Parsed Event]', event) // Debug: Log parsed event
              handleSSEEvent(event, requestBody)
            } catch (e) {
              console.error('Failed to parse SSE event:', e, jsonStr)
              // If parsing fails, it might be a raw error message from backend
              // Try to handle it as an error event
              if (jsonStr && jsonStr.trim()) {
                handleSSEEvent({
                  type: 'error',
                  error: jsonStr.includes('Error') || jsonStr.includes('error') 
                    ? jsonStr 
                    : `Backend error: ${jsonStr}`
                }, requestBody)
              }
            }
          } else if (line.trim() && !line.startsWith('event:') && !line.startsWith('id:')) {
            // Handle non-SSE formatted error messages
            console.error('SSE received non-formatted message:', line)
            if (line.includes('Error') || line.includes('error') || line.includes('__format__')) {
              handleSSEEvent({
                type: 'error',
                error: line.trim()
              }, requestBody)
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') {
        console.error('SSE stream error:', err)
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
      reader.releaseLock()
      setIsLoading(false)
      // Don't clear status banner immediately - let it show until complete
      // setStatusBanner(null)
      thinkingMessageIdRef.current = null
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current)
      }
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

    // Check limits before sending
    const limitCheck = checkLimit(queryMode)
    if (!limitCheck.allowed) {
      setError(limitCheck.error)
      setShowLimitWarning(true)
      setLimitWarningMessage(limitCheck.error)
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
    
    // Create placeholder thinking message
    const thinkingMessageId = Date.now() + 1
    thinkingMessageIdRef.current = thinkingMessageId
    const thinkingMessage = {
      id: thinkingMessageId,
      role: 'assistant',
      content: '',
      isThinking: true,
      thinkingStatus: 'thinking'
    }
    setMessages((prev) => [...prev, thinkingMessage])
    
    // Reset status steps for new request
    setStatusSteps([])
    // Show initial status banner immediately
    setStatusBanner({ 
      type: 'info', 
      messages: ['Initializing...'], 
      models: [],
      steps: []
    })
    console.log('[New Request]', 'Initialized status banner') // Debug
    // Clear any previous status
    if (statusTimerRef.current) clearTimeout(statusTimerRef.current)
    statusTimerRef.current = setTimeout(() => {
      // Update thinking message to "thinking longer"
      setMessages((prev) => prev.map(msg => 
        msg.id === thinkingMessageId 
          ? { ...msg, thinkingStatus: 'thinking longer' }
          : msg
      ))
    }, 20000)

    abortControllerRef.current = new AbortController()

    try {
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
      
      // Enable SSE streaming for real-time status updates
      requestBody.stream_status = true
      
      console.log('[Sending Message]', 'Payload:', requestBody, 'Stream Status:', requestBody.stream_status)
      
      // Use authenticatedFetch with AbortController support
      const token = getAccessToken()
      if (!token) {
        clearTokens()
        setShowSessionExpired(true)
        setIsLoading(false)
        abortControllerRef.current = null
        return
      }
      
      const res = await authenticatedFetch(`${API_BASE_URL}/api/chat/message`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(requestBody),
        signal: abortControllerRef.current.signal
      })

      if (res.status === 401) {
        // Token refresh failed
        clearTokens()
        setShowSessionExpired(true)
        setIsAuthenticated(false)
        setIsLoading(false)
        abortControllerRef.current = null
        return
      }

      // Check for limit error response
      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}))
        if (errorData.error && errorData.limit_type) {
          setError(errorData.error)
          setShowLimitWarning(true)
          setLimitWarningMessage(errorData.error)
          setIsLoading(false)
          abortControllerRef.current = null
          return
        }
        // Check for internet confirmation required
        if (errorData.requires_confirmation) {
          setPendingConfirmation({
            confirmationId: errorData.confirmation_id,
            message: errorData.message,
            chatInput: requestBody
          })
          setShowConfirmationModal(true)
          setIsLoading(false)
          abortControllerRef.current = null
          return
        }
        throw new Error('Request failed')
      }

      // Check if response is SSE stream
      const contentType = res.headers.get('content-type') || ''
      console.log('[Response Content-Type]', contentType) // Debug
      if (contentType.includes('text/event-stream')) {
        console.log('[SSE Stream Detected]', 'Starting to read SSE stream') // Debug
        // Handle SSE streaming
        await readSSEStream(res, requestBody)
        return
      } else {
        console.log('[Non-SSE Response]', 'Content-Type:', contentType) // Debug
      }

      // Fallback: regular JSON response
      const data = await res.json()
      
      // Remove thinking message if it exists (will be replaced by actual message from loadSession)
      if (thinkingMessageIdRef.current) {
        setMessages((prev) => prev.filter(msg => msg.id !== thinkingMessageIdRef.current))
        thinkingMessageIdRef.current = null
      }
      
      // Store code_blocks in cache using message_id from response
      if (data.message_id && data.code_blocks && data.code_blocks.length > 0) {
        setCodeBlocksCache(prev => ({
          ...prev,
          [data.message_id]: data.code_blocks
        }))
      }
      
      // Update status banner from orchestrator status messages (only show escalation, not thinking)
        if (data.status_messages && data.status_messages.length > 0) {
          const hasEscalation = data.status_messages.some(s => s.toLowerCase().includes('stronger'))
          if (hasEscalation) {
            const modelList = (data.models_tried || []).map(m => typeof m === 'string' ? m : (m.model || 'default model'))
            setStatusBanner({
              type: 'escalation',
              messages: data.status_messages.filter(s => s.toLowerCase().includes('stronger')),
              models: modelList
            })
          } else {
            setStatusBanner(null)
          }
        } else {
          setStatusBanner(null)
        }
        if (statusTimerRef.current) {
          clearTimeout(statusTimerRef.current)
        }
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current)
      }
      
      // Capture escalation info if present
      if (data.message_id && (data.models_tried || data.model_used)) {
        setEscalationInfo(prev => ({
          ...prev,
          [data.message_id]: {
            currentLevel: (data.models_tried && data.models_tried.length > 0) ? data.models_tried.length - 1 : 0,
            maxLevel: billingInfo?.max_code_escalations !== null ? billingInfo?.max_code_escalations : (billingInfo?.max_web_search_escalation_level !== undefined ? billingInfo?.max_web_search_escalation_level : null),
            model: (data.models_tried && data.models_tried.length > 0)
              ? (typeof data.models_tried[data.models_tried.length - 1] === 'string'
                ? data.models_tried[data.models_tried.length - 1]
                : (data.models_tried[data.models_tried.length - 1].model || 'default model'))
              : (data.model_used || 'default model')
          }
        }))
      }
      
      // Store escalation info if provided
      if (data.message_id && data.escalation_level !== undefined) {
        setEscalationInfo(prev => ({
          ...prev,
          [data.message_id]: {
            currentLevel: data.escalation_level,
            maxLevel: billingInfo?.max_code_escalations !== null ? billingInfo?.max_code_escalations : (billingInfo?.max_web_search_escalation_level !== undefined ? billingInfo?.max_web_search_escalation_level : null),
            model: data.model_used || 'Unknown'
          }
        }))
      }
      
      // Refresh usage after successful request
      await fetchUsageSummary()
      
      // Reload session to get updated messages
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

  const fetchBillingInfo = async () => {
    try {
      const planRes = await authenticatedFetch(`${API_BASE_URL}/api/billing/plan`)
      if (planRes.status === 401) {
        clearTokens()
        setShowSessionExpired(true)
        setIsAuthenticated(false)
        return
      }
      if (planRes.ok) {
        const planData = await planRes.json()
        setBillingInfo(planData)
        // If user is on BYOK plan, fetch API keys status
        if (planData.plan_tier === 'byok') {
          fetchAPIKeysStatus()
        }
      }
      
      const plansRes = await authenticatedFetch(`${API_BASE_URL}/api/billing/plans`)
      if (plansRes.status === 401) {
        clearTokens()
        setShowSessionExpired(true)
        setIsAuthenticated(false)
        return
      }
      if (plansRes.ok) {
        const plansData = await plansRes.json()
        setSubscriptionPlans(plansData || [])
      }
      
      // Also fetch usage summary
      await fetchUsageSummary()
      // Refresh billing history/invoices for current range
      await fetchBillingHistory()
      await fetchInvoices()
    } catch (err) {
      console.error('Failed to fetch billing info:', err)
    }
  }

  const [monitoringUsagePlot, setMonitoringUsagePlot] = useState(null)
  const [monitoringPerformancePlot, setMonitoringPerformancePlot] = useState(null)
  const [monitoringCostPlot, setMonitoringCostPlot] = useState(null)
  const [monitoringCostComparisonPlot, setMonitoringCostComparisonPlot] = useState(null)
  const [monitoringTokenUsagePlot, setMonitoringTokenUsagePlot] = useState(null)
  const [monitoringVendorSavingsPlot, setMonitoringVendorSavingsPlot] = useState(null)

  const fetchMonitoringData = async () => {
    try {
      setMonitoringLoading(true)
      setMonitoringError(null)
  
      const [usage, perf, cost, costComparison, tokenUsage, vendorSavings] = await Promise.all([
        authenticatedFetch(`${API_BASE_URL}/api/analytics/models/plots/usage`),
        authenticatedFetch(`${API_BASE_URL}/api/analytics/models/plots/performance`),
        authenticatedFetch(`${API_BASE_URL}/api/analytics/models/plots/cost-vs-success`),
        authenticatedFetch(`${API_BASE_URL}/api/analytics/models/plots/cost-comparison`),
        authenticatedFetch(`${API_BASE_URL}/api/analytics/models/plots/token-usage`),
        authenticatedFetch(`${API_BASE_URL}/api/analytics/models/plots/vendor-savings-gantt`)
      ])
  
      if (usage.ok) setMonitoringUsagePlot(await usage.json())
      if (perf.ok) setMonitoringPerformancePlot(await perf.json())
      if (cost.ok) setMonitoringCostPlot(await cost.json())
      if (costComparison.ok) setMonitoringCostComparisonPlot(await costComparison.json())
      if (tokenUsage.ok) setMonitoringTokenUsagePlot(await tokenUsage.json())
      if (vendorSavings.ok) setMonitoringVendorSavingsPlot(await vendorSavings.json())
    } catch (err) {
      setMonitoringError("Failed to load monitoring charts")
    } finally {
      setMonitoringLoading(false)
    }
  }

  const fetchUsageSummary = async () => {
    const token = localStorage.getItem('access_token')
    try {
      const res = await fetch(`${API_BASE_URL}/api/billing/usage`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.status === 401) {
        setShowSessionExpired(true)
        return
      }
      if (res.ok) {
        const data = await res.json()
        setUsageSummary(data)
      // Get warning banners (~80% threshold)
        fetchUsageWarnings()
        return data
      }
    } catch (err) {
      console.error('Failed to fetch usage summary:', err)
    }
    return null
  }

  const fetchUsageWarnings = async () => {
    const token = localStorage.getItem('access_token')
    try {
      const res = await fetch(`${API_BASE_URL}/api/billing/usage/warnings`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        setUsageWarnings(data || [])
      }
    } catch (err) {
      console.error('Failed to fetch usage warnings:', err)
    }
  }

  // BYOK Plan - API Keys Management
  const SUPPORTED_VENDORS = [
    {
      id: 'gemini',
      name: 'Gemini',
      description: 'Google\'s AI model with web search capabilities',
      icon: '🤖',
      documentationUrl: 'https://ai.google.dev/docs'
    },
    {
      id: 'openai',
      name: 'OpenAI',
      description: 'GPT models including GPT-4, GPT-3.5',
      icon: '🧠',
      documentationUrl: 'https://platform.openai.com/docs'
    },
    {
      id: 'groq',
      name: 'Groq',
      description: 'Fast inference with Llama models',
      icon: '⚡',
      documentationUrl: 'https://console.groq.com/docs'
    },
    {
      id: 'anthropic',
      name: 'Anthropic',
      description: 'Claude models for advanced reasoning',
      icon: '🎯',
      documentationUrl: 'https://docs.anthropic.com'
    }
  ]

  const fetchAPIKeysStatus = async () => {
    setApiKeysLoading(true)
    setApiKeysError(null)
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/settings/api-keys`)
      
      if (res.status === 403) {
        setApiKeysError('API key management is only available for BYOK plan users')
        setApiKeysStatus(null)
        return
      }
      
      if (res.status === 401) {
        clearTokens()
        setShowSessionExpired(true)
        setIsAuthenticated(false)
        return
      }
      
      if (res.ok) {
        const data = await res.json()
        setApiKeysStatus(data)
      } else {
        throw new Error('Failed to load API keys status')
      }
    } catch (err) {
      console.error('Failed to fetch API keys status:', err)
      setApiKeysError(err.message || 'Failed to load API keys status')
    } finally {
      setApiKeysLoading(false)
    }
  }

  const saveAPIKey = async (vendor) => {
    const apiKey = apiKeyValues[vendor]?.trim()
    if (!apiKey) {
      alert('Please enter an API key')
      return
    }

    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/settings/api-keys`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          vendor,
          api_key: apiKey
        })
      })

      if (res.status === 401) {
        clearTokens()
        setShowSessionExpired(true)
        setIsAuthenticated(false)
        return
      }

      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.detail || 'Failed to save API key')
      }

      // Clear the input and reload status
      setApiKeyValues({ ...apiKeyValues, [vendor]: '' })
      setEditingVendor(null)
      await fetchAPIKeysStatus()
      alert('API key saved successfully')
    } catch (err) {
      alert(err.message || 'Failed to save API key')
    }
  }

  const deleteAPIKey = async (vendor) => {
    if (!confirm(`Are you sure you want to delete the API key for ${SUPPORTED_VENDORS.find(v => v.id === vendor)?.name || vendor}?`)) {
      return
    }

    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/settings/api-keys/${vendor}`, {
        method: 'DELETE'
      })

      if (res.status === 401) {
        clearTokens()
        setShowSessionExpired(true)
        setIsAuthenticated(false)
        return
      }

      if (!res.ok) {
        throw new Error('Failed to delete API key')
      }

      await fetchAPIKeysStatus()
      alert('API key deleted successfully')
    } catch (err) {
      alert(err.message || 'Failed to delete API key')
    }
  }

  const fetchBillingHistory = async (range = dateRange) => {
    const token = localStorage.getItem('access_token')
    try {
      const params = new URLSearchParams()
      if (range.start) params.append('start_date', range.start)
      if (range.end) params.append('end_date', range.end)
      params.append('limit', '100')
      const res = await fetch(`${API_BASE_URL}/api/billing/history?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        const totalCount = data?.count || (data?.records?.length || 0)
        setBillingHistoryCount(totalCount)
        
        // If count > 100, limit to 50 rows and show download prompt
        if (totalCount > 100) {
          const limitedRecords = (data?.records || []).slice(0, 50)
          setBillingHistory(limitedRecords)
          setShowDownloadPrompt(true)
        } else {
          setBillingHistory(data?.records || [])
          setShowDownloadPrompt(false)
        }
      }
    } catch (err) {
      console.error('Failed to fetch billing history:', err)
    }
  }

  const fetchInvoices = async (range = dateRange) => {
    const token = localStorage.getItem('access_token')
    try {
      const params = new URLSearchParams()
      if (range.start) params.append('start_date', range.start)
      if (range.end) params.append('end_date', range.end)
      const res = await fetch(`${API_BASE_URL}/api/billing/user/invoices?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      })
      if (res.ok) {
        const data = await res.json()
        const inv = Array.isArray(data?.invoices) ? data.invoices : (Array.isArray(data) ? data : [])
        setInvoices(inv)
      }
    } catch (err) {
      console.error('Failed to fetch invoices:', err)
    }
  }

  const exportCSV = async (range = dateRange) => {
    const token = localStorage.getItem('access_token')
    try {
      const params = new URLSearchParams()
      if (range.start) params.append('start_date', range.start)
      if (range.end) params.append('end_date', range.end)
      
      const response = await fetch(`${API_BASE_URL}/api/billing/usage/export?${params.toString()}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      
      if (response.ok) {
        const blob = await response.blob()
        const url = window.URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        a.download = `usage_export_${new Date().toISOString().split('T')[0]}.csv`
        document.body.appendChild(a)
        a.click()
        window.URL.revokeObjectURL(url)
        document.body.removeChild(a)
      } else {
        console.error('Failed to export CSV:', response.statusText)
        alert('Failed to export CSV. Please try again.')
      }
    } catch (err) {
      console.error('Failed to export CSV:', err)
      alert('Failed to export CSV. Please try again.')
    }
  }

  const checkLimit = (mode) => {
    if (!billingInfo || !usageSummary) return { allowed: true }
    
    const modeKey = mode === 'web_search' ? 'web_search' : mode
    const dailyLimit = billingInfo[`max_${modeKey}_per_day`]
    const monthlyLimit = billingInfo[`max_${modeKey}_per_month`]
    const dailyUsage = usageSummary[modeKey]?.daily || 0
    const monthlyUsage = usageSummary[modeKey]?.monthly || 0
    
    // Check daily limit
    if (dailyLimit !== null && dailyUsage >= dailyLimit) {
      return {
        allowed: false,
        error: `Daily ${modeKey} limit reached (${dailyLimit} requests/day)`,
        limitType: 'daily',
        currentUsage: dailyUsage,
        limit: dailyLimit
      }
    }
    
    // Check monthly limit
    if (monthlyLimit !== null && monthlyUsage >= monthlyLimit) {
      return {
        allowed: false,
        error: `Monthly ${modeKey} limit reached (${monthlyLimit} requests/month)`,
        limitType: 'monthly',
        currentUsage: monthlyUsage,
        limit: monthlyLimit
      }
    }
    
    // Check warning threshold (80%)
    if (dailyLimit !== null && dailyUsage >= dailyLimit * 0.8) {
      setShowLimitWarning(true)
      setLimitWarningMessage(`You've used ${dailyUsage} of ${dailyLimit} ${modeKey} requests today. Upgrade to Pro for unlimited requests.`)
    }
    
    return { allowed: true }
  }

  const confirmInternetCall = async (confirmationId, confirmed, chatInput) => {
    const token = localStorage.getItem('access_token')
    try {
      const res = await fetch(`${API_BASE_URL}/api/chat/confirm`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          confirmation_id: confirmationId,
          confirmed: confirmed,
          chat_input: chatInput
        })
      })
      
      if (res.status === 401) {
        setShowSessionExpired(true)
        return null
      }
      
      if (res.ok) {
        const data = await res.json()
        return data
      } else {
        const error = await res.json()
        throw new Error(error.detail || 'Confirmation failed')
      }
    } catch (err) {
      console.error('Failed to confirm internet call:', err)
      return null
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

  // Cancel subscription handler
  const handleCancelSubscription = async () => {
    if (!confirm('Are you sure you want to cancel your subscription? Your subscription will remain active until the end of the current billing period.')) return
    
    try {
      const res = await authenticatedFetch(`${API_BASE_URL}/api/billing/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: 'User requested cancellation' })
      })
      
      if (res.status === 401) {
        clearTokens()
        setShowSessionExpired(true)
        setIsAuthenticated(false)
        return
      }
      
      if (res.ok) {
        const data = await res.json()
        alert(data.message || 'Subscription cancelled successfully. Your subscription will remain active until the end of the current billing period.')
        await fetchBillingInfo()
        setShowManageSubscription(false)
      } else {
        const error = await res.json()
        alert(`Cancellation failed: ${error.detail || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Failed to cancel subscription:', err)
      alert('Failed to cancel subscription. Please try again.')
    }
  }

  // Handler for upgrading directly from Overview page - opens payment form
  const handleUpgradeFromOverview = async (plan) => {
    setSelectedPlanForUpgrade(plan)
    
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

  // Shared handler for selecting a plan (used by plan selection modal)
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

  // Shared handler for completing upgrade (used by billing form)
  const handleUpgradeSubmit = async (e) => {
    e.preventDefault()
    if (!selectedPlanForUpgrade) return
    
    // Map selected payment method to backend format
    let paymentMethod = 'stripe'
    if (selectedPaymentMethod === 'apple_pay') {
      paymentMethod = 'apple_pay'
    } else if (selectedPaymentMethod === 'upi') {
      paymentMethod = 'upi'
    } else {
      paymentMethod = 'stripe' // card
    }
    
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
          payment_method: paymentMethod
        })
      })
      
      if (res.ok) {
        const data = await res.json()
        alert('Subscription upgraded successfully!')
        setShowBillingForm(false)
        setShowPlanSelection(false)
        setSelectedPlanForUpgrade(null)
        setPaymentIntent(null)
        setSelectedPaymentMethod('card')
        setUpgradeForm({
          payment_method: 'stripe',
          card_number: '',
          expiry_date: '',
          cvv: '',
          billing_address: '',
          city: '',
          zip_code: '',
          country: 'US',
          upi_id: ''
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

  const handleLogout = async () => {
    const tokens = getTokens()
    if (tokens?.session_id) {
      try {
        await fetch(`${API_BASE_URL}/api/logout?session_id=${tokens.session_id}`, { method: 'POST' })
      } catch (err) {
        console.error('Logout error:', err)
      }
    }
    
    // Clear all tokens
    clearTokens()
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
    
    // Check escalation limits
    const escalationInfoForMsg = escalationInfo[messageId]
    if (escalationInfoForMsg && escalationInfoForMsg.maxLevel !== null) {
      if (escalationInfoForMsg.currentLevel >= escalationInfoForMsg.maxLevel) {
        setError(`Maximum escalations reached for your plan (${escalationInfoForMsg.maxLevel + 1}). Upgrade to continue.`)
        setShowLimitWarning(true)
        setLimitWarningMessage(`Maximum escalations reached for your plan. Upgrade to continue.`)
        return
      }
    }
    
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
        
        // Update status banner from orchestrator status messages
        if (data.status_messages && data.status_messages.length > 0) {
          const hasEscalation = data.status_messages.some(s => s.toLowerCase().includes('stronger'))
          const modelList = (data.models_tried || []).map(m => typeof m === 'string' ? m : (m.model || 'default model'))
          setStatusBanner({
            type: hasEscalation ? 'escalation' : 'info',
            messages: data.status_messages,
            models: modelList
          })
        } else {
      setStatusBanner(null)
      if (statusTimerRef.current) {
        clearTimeout(statusTimerRef.current)
      }
        }
        
        // Update escalation info
        if (data.escalation_level !== undefined) {
          setEscalationInfo(prev => ({
            ...prev,
            [messageId]: {
              currentLevel: data.escalation_level,
              maxLevel: billingInfo?.max_code_escalations !== null ? billingInfo?.max_code_escalations : (billingInfo?.max_web_search_escalation_level !== undefined ? billingInfo?.max_web_search_escalation_level : null),
              model: data.model_used || 'Unknown'
            }
          }))
        }
        
        // Store code_blocks if provided
        if (data.message_id && data.code_blocks && data.code_blocks.length > 0) {
          setCodeBlocksCache(prev => ({
            ...prev,
            [data.message_id]: data.code_blocks
          }))
        }
        
        // Refresh usage after regeneration
        await fetchUsageSummary()
        
        // Reload the full session to get all messages from backend
        await loadSession(currentSessionId)
        
        // Reset the regenerating state after reload
        setMessageActions(prev => ({ ...prev, [messageId]: 'regenerated' }))
      } else {
        const errorData = await res.json().catch(() => ({}))
        if (errorData.error && errorData.limit_type) {
          setError(errorData.error)
          setShowLimitWarning(true)
          setLimitWarningMessage(errorData.error)
        }
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
          // Save tokens with expiry information
          saveTokens(data)
          fetchUserProfile(data.access_token)
        })
        .catch(err => {
          setError(err.message || 'Network error')
        })
      }
    }
    
    return (
      <div className="modal-overlay">
        <div className="modal-content">
          <h2>{authMode === 'login' ? 'Login to LLM Router' : 'Create Account'}</h2>
          {error && (
            <div className={`error-message ${error.includes('created') ? 'success' : ''}`}>
              {error}
              {authMode === 'login' && !error.includes('created') && (
                <div style={{ marginTop: '10px', textAlign: 'center' }}>
                  <a 
                    href="#" 
                    onClick={(e) => {
                      e.preventDefault()
                      setShowPasswordReset(true)
                      setError(null)
                    }}
                    style={{ color: '#007bff', textDecoration: 'underline', fontSize: '14px' }}
                  >
                    Forgot Password? Reset it here
                  </a>
                </div>
              )}
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

  const PasswordResetModal = () => {
    const emailInputRef = useRef(null)
    const tokenInputRef = useRef(null)
    const newPasswordInputRef = useRef(null)
    const confirmPasswordInputRef = useRef(null)
    const [resetError, setResetError] = useState(null)
    const [resetSuccess, setResetSuccess] = useState(null)

    const handleRequestReset = async (e) => {
      e.preventDefault()
      setResetError(null)
      setResetSuccess(null)
      
      const email = emailInputRef.current?.value || ''
      if (!email) {
        setResetError('Please enter your email address')
        return
      }

      try {
        const res = await fetch(`${API_BASE_URL}/api/password/reset/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email })
        })

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}))
          throw new Error(errorData.detail || 'Failed to send reset email')
        }

        setPasswordResetEmail(email)
        setPasswordResetStep('confirm')
        setResetSuccess('Password reset email sent! Please check your inbox for the reset token.')
      } catch (err) {
        setResetError(err.message || 'Network error')
      }
    }

    const handleConfirmReset = async (e) => {
      e.preventDefault()
      setResetError(null)
      setResetSuccess(null)

      const token = tokenInputRef.current?.value || ''
      const newPassword = newPasswordInputRef.current?.value || ''
      const confirmPassword = confirmPasswordInputRef.current?.value || ''

      if (!token || !newPassword || !confirmPassword) {
        setResetError('Please fill in all fields')
        return
      }

      if (newPassword !== confirmPassword) {
        setResetError('Passwords do not match')
        return
      }

      if (newPassword.length < 6) {
        setResetError('Password must be at least 6 characters long')
        return
      }

      try {
        const res = await fetch(`${API_BASE_URL}/api/password/reset/confirm`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: passwordResetEmail,
            token: token,
            new_password: newPassword
          })
        })

        if (!res.ok) {
          const errorData = await res.json().catch(() => ({}))
          throw new Error(errorData.detail || 'Failed to reset password')
        }

        setPasswordResetStep('success')
        setResetSuccess('Password reset successful! You can now login with your new password.')
      } catch (err) {
        setResetError(err.message || 'Network error')
      }
    }

    const handleClose = () => {
      setShowPasswordReset(false)
      setPasswordResetStep('request')
      setPasswordResetEmail('')
      setPasswordResetToken('')
      setPasswordResetNewPassword('')
      setResetError(null)
      setResetSuccess(null)
    }

    return (
      <div className="modal-overlay">
        <div className="modal-content">
          <h2>Reset Password</h2>
          
          {passwordResetStep === 'request' && (
            <>
              <p style={{ marginBottom: '20px', textAlign: 'center', color: '#666' }}>
                Enter your email address and we'll send you a password reset token.
              </p>
              {resetError && (
                <div className="error-message">{resetError}</div>
              )}
              {resetSuccess && (
                <div className="error-message success">{resetSuccess}</div>
              )}
              <form onSubmit={handleRequestReset}>
                <input 
                  ref={emailInputRef} 
                  type="email" 
                  placeholder="Email" 
                  defaultValue={passwordResetEmail}
                  required 
                />
                <button type="submit" className="auth-btn">
                  Send OTP
                </button>
              </form>
              <button 
                className="auth-switch-btn"
                onClick={handleClose}
              >
                Back to Login
              </button>
            </>
          )}

          {passwordResetStep === 'confirm' && (
            <>
              <p style={{ marginBottom: '20px', textAlign: 'center', color: '#666' }}>
                Enter the token sent to your email and your new password.
              </p>
              {resetError && (
                <div className="error-message">{resetError}</div>
              )}
              {resetSuccess && (
                <div className="error-message success">{resetSuccess}</div>
              )}
              <form onSubmit={handleConfirmReset}>
                <input 
                  ref={tokenInputRef} 
                  type="text" 
                  placeholder="Enter OTP here" 
                  required 
                />
                <input 
                  ref={newPasswordInputRef} 
                  type="password" 
                  placeholder="New Password" 
                  required 
                  minLength={6}
                />
                <input 
                  ref={confirmPasswordInputRef} 
                  type="password" 
                  placeholder="Confirm New Password" 
                  required 
                  minLength={6}
                />
                <button type="submit" className="auth-btn">
                  Reset Password
                </button>
              </form>
              <button 
                className="auth-switch-btn"
                onClick={() => {
                  setPasswordResetStep('request')
                  setResetError(null)
                  setResetSuccess(null)
                }}
              >
                Back
              </button>
            </>
          )}

          {passwordResetStep === 'success' && (
            <>
              <p style={{ marginBottom: '20px', textAlign: 'center', color: '#666' }}>
                Password reset done successfully, you can return to login page.
              </p>
              <button 
                className="auth-btn"
                onClick={() => {
                  handleClose()
                  setAuthMode('login')
                  setError('Password reset successful! Please login with your new password.')
                }}
              >
                Go to Login
              </button>
            </>
          )}
        </div>
      </div>
    )
  }

  const SettingsPage = () => {
    const maxRequests = Math.max(...analyticsData.map(d => d.request_number || 0), 1)
    const yAxisMax = Math.ceil(maxRequests / 10) * 10 || 10
    
    return (
      <div className="settings-page" ref={settingsRef}>
        <div className="settings-header">
          <h2>Settings</h2>
          <button className="close-btn" onClick={() => setShowSettings(false)}>✕</button>
        </div>
        <div className="settings-content">
          <div className="settings-sidebar">
            <button 
              className={`settings-tab ${settingsTab === 'overview' ? 'active' : ''}`}
              onClick={() => setSettingsTab('overview')}
            >
              Overview
            </button>
            <button 
              className={`settings-tab ${settingsTab === 'usage' ? 'active' : ''}`}
              onClick={() => { setSettingsTab('usage'); fetchUsageSummary(); fetchBillingHistory(); }}
            >
              Usage
            </button>
            <button 
              className={`settings-tab ${settingsTab === 'billing' ? 'active' : ''}`}
              onClick={() => { 
                setSettingsTab('billing')
                fetchBillingInfo()
                fetchBillingHistory()
              }}
            >
              Billing & Invoices
            </button>
            <button
              className={`settings-tab ${settingsTab === 'monitoring' ? 'active' : ''}`}
              onClick={() => {
                setSettingsTab('monitoring')
                fetchMonitoringData()
              }}
            >
              Monitoring
            </button>
            {/* Show API Keys only for BYOK plan users */}
            {billingInfo && billingInfo.plan_tier === 'byok' && (
              <button 
                className={`settings-tab ${settingsTab === 'api-keys' ? 'active' : ''}`}
                onClick={() => { 
                  setSettingsTab('api-keys')
                  fetchAPIKeysStatus()
                }}
              >
                API Keys
              </button>
            )}
          </div>
          <div className="settings-body">
            {settingsTab === 'overview' ? (
              <div className="overview-section">
            <div className="overview-hero">
              <div className="hero-avatar">
                {(userProfile?.first_name?.[0] || 'U').toUpperCase()}
                  </div>
              <div className="hero-text">
                <div className="hero-name">{`${userProfile?.first_name || ''} ${userProfile?.last_name || ''}`.trim() || 'User'}</div>
                <div className="hero-meta">
                  <span>{billingInfo?.plan_name || 'Free'}</span>
                  <span className="dot-sep">•</span>
                  <span>{userProfile?.email || '—'}</span>
                  </div>
                </div>
                </div>
            <div className="plan-card-stack full-width">
              <h3>Available Plans</h3>
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
                {(subscriptionPlans || []).map(plan => {
                  const isBYOK = plan.plan_tier === 'byok'
                  return (
                    <div key={plan.id} className={`plan-selection-card compact ${isBYOK ? 'byok-plan' : ''}`}>
                      <div className="plan-selection-header">
                        <h4>{plan.plan_name}</h4>
                        <span className="plan-tier-badge">{plan.plan_tier}</span>
                </div>
                      {isBYOK && (
                        <div className="byok-badge">
                          <span>🔑 Bring Your Own Key</span>
                </div>
                      )}
                      <div className="plan-price-large">
                        ${billingPeriod === 'monthly' ? plan.price_monthly : plan.price_yearly}
                        <span>/{billingPeriod === 'monthly' ? 'mo' : 'yr'}</span>
                </div>
                      <ul className="plan-features-list">
                        {plan.features.slice(0, 3).map((feature, idx) => (
                          <li key={idx}>{feature}</li>
                        ))}
                      </ul>
                      {isBYOK && (
                        <div className="byok-info">
                          <p>
                            Use your own API keys for Gemini, OpenAI, Groq, and Anthropic.
                            You pay for your own API usage.
                          </p>
              </div>
                      )}
                      <button 
                        className="select-plan-modal-btn"
                        onClick={() => handleUpgradeFromOverview(plan)}
                      >
                        Upgrade to {plan.plan_name}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
              </div>
            ) : settingsTab === 'monitoring' ? (
              <div className="monitoring-section">
                <h3>Routing Monitoring</h3>
                {monitoringLoading && (
                  <div className="loading">Loading analytics…</div>
                )}
                {monitoringError && (
                  <div className="error-message">{monitoringError}</div>
                )}
                {!monitoringLoading && !monitoringError && (
                  <>
                    <div className="monitoring-charts-grid">
                      {monitoringUsagePlot && (
                        <div className="monitoring-chart-card">
                          <h4>Model Usage</h4>
                          <Plot
                            data={monitoringUsagePlot.data || []}
                            layout={monitoringUsagePlot.layout || {}}
                            style={{ width: '100%', height: '400px' }}
                          />
                        </div>
                      )}
                      
                      {monitoringPerformancePlot && (
                        <div className="monitoring-chart-card">
                          <h4>Average Latency</h4>
                          <Plot
                            data={monitoringPerformancePlot.data || []}
                            layout={monitoringPerformancePlot.layout || {}}
                            style={{ width: '100%', height: '400px' }}
                          />
                        </div>
                      )}
                      
                      {monitoringCostPlot && (
                        <div className="monitoring-chart-card">
                          <h4>Cost vs Success Rate</h4>
                          <Plot
                            data={monitoringCostPlot.data || []}
                            layout={monitoringCostPlot.layout || {}}
                            style={{ width: '100%', height: '400px' }}
                          />
                        </div>
                      )}
                      
                      {monitoringTokenUsagePlot && (
                        <div className="monitoring-chart-card">
                          <h4>Token Usage by Model</h4>
                          <Plot
                            data={monitoringTokenUsagePlot.data || []}
                            layout={monitoringTokenUsagePlot.layout || {}}
                            style={{ width: '100%', height: '400px' }}
                          />
                        </div>
                      )}
                      
                      {monitoringCostComparisonPlot && (
                        <div className="monitoring-chart-card">
                          <h4>Cost Comparison: Actual vs Alternatives</h4>
                          <Plot
                            data={monitoringCostComparisonPlot.data || []}
                            layout={monitoringCostComparisonPlot.layout || {}}
                            style={{ width: '100%', height: '400px' }}
                          />
                        </div>
                      )}
                      
                      {monitoringVendorSavingsPlot && (
                        <div className="monitoring-chart-card">
                          <h4>Vendor Cost Savings (Gantt Chart)</h4>
                          <p className="chart-description">Shows actual cost vs what it would have cost with alternative vendors. Green = actual cost, Orange/Red = alternative cost.</p>
                          <Plot
                            data={monitoringVendorSavingsPlot.data || []}
                            layout={monitoringVendorSavingsPlot.layout || {}}
                            style={{ width: '100%', height: '600px' }}
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}
              </div>
            ) : settingsTab === 'usage' ? (
              <UsageDashboard 
                billingHistory={billingHistory} 
                usageWarnings={usageWarnings}
                usageView={usageView}
                setUsageView={setUsageView}
                showDownloadPrompt={showDownloadPrompt}
                billingHistoryCount={billingHistoryCount}
                dateRange={dateRange}
                exportCSV={exportCSV}
                fetchBillingHistory={fetchBillingHistory}
              />
            ) : settingsTab === 'billing' ? (
              <BillingSection />
            ) : settingsTab === 'api-keys' ? (
              <div className="api-keys-settings-panel">
                {apiKeysLoading ? (
                  <div className="loading">Loading API keys status...</div>
                ) : apiKeysError ? (
                  <div className="error">{apiKeysError}</div>
                ) : (
                  <>
                    {/* Header */}
                    <h2 className="api-keys-header">Manage Your API keys</h2>
                    
                    {/* Vendor Cards with Numbering */}
                    <div className="api-keys-vendor-list">
                      {SUPPORTED_VENDORS.map((vendor, index) => {
                        const isConfigured = apiKeysStatus?.[vendor.id] || false
                        const isEditing = editingVendor === vendor.id

                          return (
                          <div key={vendor.id} className="api-keys-vendor-card">
                            <div className="vendor-number">{index + 1}</div>
                            <div className="vendor-content">
                              <div className="vendor-header-row">
                                <h3 className="vendor-name">{vendor.name}</h3>
                                {isConfigured && (
                                  <span className="vendor-status-badge configured">
                                    ✓ Configured
                                  </span>
                                )}
                              </div>
                              <p className="vendor-description-text">{vendor.description}</p>
                              
                              {vendor.documentationUrl && (
                                <a
                                  href={vendor.documentationUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="vendor-docs-link"
                                >
                                  View Documentation →
                                </a>
                              )}

                              {isEditing ? (
                                <div className="vendor-input-section">
                                  <input
                                    type="password"
                                    placeholder={`Enter ${vendor.name} API key`}
                                    value={apiKeyValues[vendor.id] || ''}
                                    onChange={(e) =>
                                      setApiKeyValues({ ...apiKeyValues, [vendor.id]: e.target.value })
                                    }
                                    className="vendor-api-key-input"
                                    autoFocus
                                  />
                                  <div className="vendor-action-buttons">
                                    <button
                                      onClick={() => saveAPIKey(vendor.id)}
                                      className="vendor-btn-primary"
                                    >
                                      Save
                                    </button>
                                    <button
                                      onClick={() => {
                                        setEditingVendor(null)
                                        setApiKeyValues({ ...apiKeyValues, [vendor.id]: '' })
                                      }}
                                      className="vendor-btn-secondary"
                                    >
                                      Cancel
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="vendor-action-buttons">
                                  <button
                                    onClick={() => setEditingVendor(vendor.id)}
                                    className="vendor-btn-primary"
                                  >
                                    {isConfigured ? 'Update Key' : 'Add Key'}
                                  </button>
                                  {isConfigured && (
                                    <button
                                      onClick={() => deleteAPIKey(vendor.id)}
                                      className="vendor-btn-danger"
                                    >
                                      Delete
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                            </div>
                          )
                        })}
                      </div>

                    {/* Info Box */}
                    <div className="api-keys-info-box">
                      <h4>ℹ️ Important Notes:</h4>
                      <ul>
                        <li>Your API keys are encrypted and stored securely</li>
                        <li>Only vendors with configured keys will be used for routing</li>
                        <li>If no keys are configured, only local models will be available</li>
                        <li>You are responsible for your own API usage costs</li>
                      </ul>
                    </div>
                  </>
                )}
              </div>
            ) : null}
          </div>
        </div>
        
        {/* Plan Selection Modal - Only for selecting new plans */}
        {showPlanSelection && !selectedPlanForUpgrade && (
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
        
        {/* Billing Form Modal - Cursor Style */}
        {showBillingForm && selectedPlanForUpgrade && (
          <div className="modal-overlay cursor-checkout-overlay" onClick={() => setShowBillingForm(false)}>
            <div className="cursor-checkout-modal" onClick={(e) => e.stopPropagation()}>
              <button className="cursor-checkout-close" onClick={() => setShowBillingForm(false)}>✕</button>
              
              {/* Left Panel - Subscription Summary */}
              <div className="cursor-checkout-left">
                <div className="cursor-checkout-summary">
                  <h2>Subscribe to {selectedPlanForUpgrade.plan_name}</h2>
                  <div className="cursor-checkout-price">
                    ${billingPeriod === 'monthly' ? selectedPlanForUpgrade.price_monthly : selectedPlanForUpgrade.price_yearly}
                    <span> per {billingPeriod === 'monthly' ? 'month' : 'year'}</span>
                  </div>
                  
                  <div className="cursor-plan-card">
                    <div className="cursor-plan-logo">⚡</div>
                    <div className="cursor-plan-info">
                      <div className="cursor-plan-name">{selectedPlanForUpgrade.plan_name}</div>
                      <div className="cursor-plan-desc">
                        {selectedPlanForUpgrade.features.slice(0, 2).join(', ')} and more...
                        <br />
                        Billed {billingPeriod === 'monthly' ? 'monthly' : 'yearly'}.
                      </div>
                    </div>
                  </div>
                  
                  <div className="cursor-cost-breakdown">
                    <div className="cursor-cost-row">
                      <span>Subtotal</span>
                      <span>${billingPeriod === 'monthly' ? selectedPlanForUpgrade.price_monthly : selectedPlanForUpgrade.price_yearly}</span>
                    </div>
                    <div className="cursor-cost-row">
                      <span>Tax <span className="cursor-info-icon" title="Enter address to calculate">ℹ️</span></span>
                      <span className="cursor-tax-placeholder">Enter address to calculate</span>
                    </div>
                    <div className="cursor-cost-row cursor-total">
                      <span>Total due today</span>
                      <span>${billingPeriod === 'monthly' ? selectedPlanForUpgrade.price_monthly : selectedPlanForUpgrade.price_yearly}</span>
                    </div>
                  </div>
                </div>
              </div>
              
              {/* Right Panel - Payment Form */}
              <div className="cursor-checkout-right">
                <form onSubmit={handleUpgradeSubmit} className="cursor-payment-form">
                  {/* Apple Pay Button */}
                  <button 
                    type="button" 
                    className="cursor-apple-pay-btn" 
                    onClick={() => {
                      setSelectedPaymentMethod('apple_pay')
                      // In production, this would trigger Apple Pay flow
                      // For now, it just sets the payment method
                    }}
                  >
                    <span className="apple-pay-icon">🍎</span>
                    Pay
                  </button>
                  
                  <div className="cursor-separator">
                    <span>OR</span>
                  </div>
                  
                  {/* Email Field */}
                  <div className="cursor-form-field">
                    <label>Email</label>
                    <input 
                      type="email" 
                      value={userProfile?.email || ''}
                      readOnly
                      className="cursor-email-input"
                    />
                  </div>
                  
                  {/* Payment Method Selection */}
                  <div className="cursor-payment-methods">
                    <div className="cursor-payment-method-label">Payment method</div>
                    
                    {/* Card Option */}
                    <label className="cursor-payment-option">
                      <input 
                        type="radio" 
                        name="payment_method" 
                        value="card"
                        checked={selectedPaymentMethod === 'card'}
                        onChange={() => setSelectedPaymentMethod('card')}
                      />
                      <span className="cursor-payment-option-label">Card</span>
                      <div className="cursor-card-logos">
                        <span>Visa</span>
                        <span>Mastercard</span>
                        <span>Amex</span>
                        <span>Discover</span>
                      </div>
                    </label>
                    
                    {/* UPI Option */}
                    <label className="cursor-payment-option">
                      <input 
                        type="radio" 
                        name="payment_method" 
                        value="upi"
                        checked={selectedPaymentMethod === 'upi'}
                        onChange={() => setSelectedPaymentMethod('upi')}
                      />
                      <span className="cursor-payment-option-label">UPI</span>
                      <div className="cursor-upi-logo">🇮🇳</div>
                    </label>
                  </div>
                  
                  {/* Card Payment Fields */}
                  {selectedPaymentMethod === 'card' && (
                    <>
                      <div className="cursor-form-field">
                        <label>Card number</label>
                        <input 
                          type="text" 
                          placeholder="1234 5678 9012 3456"
                          value={upgradeForm.card_number}
                          onChange={(e) => setUpgradeForm({...upgradeForm, card_number: e.target.value})}
                          required={selectedPaymentMethod === 'card'}
                        />
                      </div>
                      <div className="cursor-form-row">
                        <div className="cursor-form-field">
                          <label>Expiry date</label>
                          <input 
                            type="text" 
                            placeholder="MM/YY"
                            value={upgradeForm.expiry_date}
                            onChange={(e) => setUpgradeForm({...upgradeForm, expiry_date: e.target.value})}
                            required={selectedPaymentMethod === 'card'}
                          />
                        </div>
                        <div className="cursor-form-field">
                          <label>CVV</label>
                          <input 
                            type="text" 
                            placeholder="123"
                            value={upgradeForm.cvv}
                            onChange={(e) => setUpgradeForm({...upgradeForm, cvv: e.target.value})}
                            required={selectedPaymentMethod === 'card'}
                          />
                        </div>
                      </div>
                      <div className="cursor-form-field">
                        <label>Billing address</label>
                        <input 
                          type="text" 
                          placeholder="Street address"
                          value={upgradeForm.billing_address}
                          onChange={(e) => setUpgradeForm({...upgradeForm, billing_address: e.target.value})}
                          required={selectedPaymentMethod === 'card'}
                        />
                      </div>
                      <div className="cursor-form-row">
                        <div className="cursor-form-field">
                          <label>City</label>
                          <input 
                            type="text" 
                            value={upgradeForm.city}
                            onChange={(e) => setUpgradeForm({...upgradeForm, city: e.target.value})}
                            required={selectedPaymentMethod === 'card'}
                          />
                        </div>
                        <div className="cursor-form-field">
                          <label>ZIP code</label>
                          <input 
                            type="text" 
                            value={upgradeForm.zip_code}
                            onChange={(e) => setUpgradeForm({...upgradeForm, zip_code: e.target.value})}
                            required={selectedPaymentMethod === 'card'}
                          />
                        </div>
                      </div>
                      <div className="cursor-form-field">
                        <label>Country</label>
                        <input 
                          type="text" 
                          value={upgradeForm.country}
                          onChange={(e) => setUpgradeForm({...upgradeForm, country: e.target.value})}
                          required={selectedPaymentMethod === 'card'}
                        />
                      </div>
                    </>
                  )}
                  
                  {/* UPI Payment Fields */}
                  {selectedPaymentMethod === 'upi' && (
                    <div className="cursor-form-field">
                      <label>UPI ID</label>
                      <input 
                        type="text" 
                        placeholder="yourname@paytm or yourname@upi"
                        value={upgradeForm.upi_id}
                        onChange={(e) => setUpgradeForm({...upgradeForm, upi_id: e.target.value})}
                        required
                      />
                      <div className="cursor-upi-hint">Enter your UPI ID (e.g., yourname@paytm, yourname@phonepe)</div>
                    </div>
                  )}
                  
                  {/* Save Information Checkbox */}
                  <label className="cursor-save-info">
                    <input type="checkbox" defaultChecked />
                    <span>Save my information for faster checkout</span>
                  </label>
                  <div className="cursor-save-info-desc">Pay securely and everywhere Link is accepted.</div>
                  
                  {/* Submit Button */}
                  <button type="submit" className="cursor-pay-btn">
                    Pay and subscribe
                  </button>
                  
                  <div className="cursor-authorization-text">
                    By subscribing, you authorize us to charge you according to the terms until you cancel.
                  </div>
                  
                  <div className="cursor-footer">
                    <span>Powered by stripe</span>
                    <div className="cursor-footer-links">
                      <a href="#">Terms</a>
                      <a href="#">Privacy</a>
                    </div>
                  </div>
                </form>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  const UsageDashboard = ({ billingHistory = [], usageWarnings = [], usageView, setUsageView, showDownloadPrompt, billingHistoryCount, dateRange, exportCSV, fetchBillingHistory }) => {
    const [showCustomCalendar, setShowCustomCalendar] = useState(false)
    const [customDateSelection, setCustomDateSelection] = useState({ start: null, end: null, selecting: 'start' }) // 'start' | 'end'
    const [calendarMonth, setCalendarMonth] = useState(new Date()) // Current month for calendar navigation
    const calendarModalRef = useRef(null)
    if (!usageSummary || !billingInfo) {
                            return (
        <div className="usage-dashboard">
          <h3>Usage Dashboard</h3>
          <p className="loading-text">Loading usage data...</p>
        </div>
      )
    }

    const renderUsageCard = (mode, label) => {
      const modeData = usageSummary[mode] || {}
      const dailyLimit = billingInfo[`max_${mode}_per_day`]
      const monthlyLimit = billingInfo[`max_${mode}_per_month`]
      const dailyUsage = modeData.daily || 0
      const monthlyUsage = modeData.monthly || 0
      const dailyPercent = dailyLimit ? (dailyUsage / dailyLimit) * 100 : 0
      const monthlyPercent = monthlyLimit ? (monthlyUsage / monthlyLimit) * 100 : 0

      return (
        <div className="usage-card" key={mode}>
          <h4>{label}</h4>
          <div className="usage-stats">
            <div className="usage-item">
              <div className="usage-label">Daily: {dailyUsage} / {dailyLimit === null ? 'Unlimited' : dailyLimit} requests</div>
              {dailyLimit !== null && (
                <div className="usage-progress">
                  <div className="usage-progress-bar" style={{ width: `${Math.min(dailyPercent, 100)}%` }}></div>
                </div>
              )}
              <div className="usage-percent">{dailyLimit !== null ? `${Math.round(dailyPercent)}%` : 'Unlimited'}</div>
            </div>
            <div className="usage-item">
              <div className="usage-label">Monthly: {monthlyUsage} / {monthlyLimit === null ? 'Unlimited' : monthlyLimit} requests</div>
              {monthlyLimit !== null && (
                <div className="usage-progress">
                  <div className="usage-progress-bar" style={{ width: `${Math.min(monthlyPercent, 100)}%` }}></div>
                </div>
              )}
              <div className="usage-percent">{monthlyLimit !== null ? `${Math.round(monthlyPercent)}%` : 'Unlimited'}</div>
            </div>
            <div className="usage-reset">Resets daily at midnight</div>
          </div>
        </div>
      )
    }

    return (
      <div className="usage-dashboard">
        <div className="usage-dashboard-header">
          <h3>Usage Dashboard</h3>
          <button className="upgrade-btn-small" onClick={() => { setSettingsTab('overview'); fetchBillingInfo(); }}>
            Upgrade Plan
          </button>
        </div>
        <div className="usage-view-toggle">
          <button className={usageView === 'daily' ? 'active' : ''} onClick={() => setUsageView('daily')}>Daily</button>
          <button className={usageView === 'all' ? 'active' : ''} onClick={() => setUsageView('all')}>All usage</button>
        </div>
        {usageView === 'all' && (
          <div className="usage-view-toggle">
            <div className="usage-range-toggle">
              <button
                type="button"
                className={usageRange === '1d' ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setUsageView('all') // Ensure we stay on 'all' view
                  const today = new Date()
                  const yesterday = new Date(today)
                  yesterday.setDate(today.getDate() - 1)
                  const startDate = yesterday.toISOString().slice(0, 10)
                  setUsageRange('1d')
                  setDateRange({ start: startDate, end: null })
                  fetchBillingHistory({ start: startDate, end: null })
                }}
              >
                1d
              </button>
              <button
                type="button"
                className={usageRange === '7d' ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setUsageView('all') // Ensure we stay on 'all' view
                  const today = new Date()
                  const sevenDaysAgo = new Date(today)
                  sevenDaysAgo.setDate(today.getDate() - 7)
                  const startDate = sevenDaysAgo.toISOString().slice(0, 10)
                  setUsageRange('7d')
                  setDateRange({ start: startDate, end: null })
                  fetchBillingHistory({ start: startDate, end: null })
                }}
              >
                7d
              </button>
              <button
                type="button"
                className={usageRange === 'custom' ? 'active' : ''}
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setUsageView('all') // Ensure we stay on 'all' view
                  
                  // Initialize calendar with existing date range if available
                  if (dateRange.start) {
                    setCalendarMonth(new Date(dateRange.start))
                    setCustomDateSelection({ 
                      start: dateRange.start, 
                      end: dateRange.end || null, 
                      selecting: dateRange.end ? 'end' : 'start' 
                    })
                  } else {
                    setCalendarMonth(new Date())
                    setCustomDateSelection({ start: null, end: null, selecting: 'start' })
                  }
                  
                  // Set both states to ensure calendar opens
                  setUsageRange('custom')
                  setShowCustomCalendar(true)
                }}
              >
                Custom
              </button>
            </div>
            <div className="usage-export">
              <button 
                type="button"
                className="export-btn" 
                onClick={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  exportCSV(dateRange)
                }}
              >
                Export CSV
              </button>
              {usageRange === 'custom' && dateRange.start && dateRange.end && (
                <button 
                  type="button"
                  className="export-btn" 
                  onClick={(e) => {
                    e.preventDefault()
                    e.stopPropagation()
                    setUsageView('all') // Ensure we stay on 'all' view
                    fetchBillingHistory(dateRange)
                  }}
                >
                  Apply
                </button>
              )}
            </div>
          </div>
        )}
        
        {/* Custom Date Picker Calendar */}
        {showCustomCalendar && (() => {
          const year = calendarMonth.getFullYear()
          const month = calendarMonth.getMonth()
          const firstDay = new Date(year, month, 1)
          const lastDay = new Date(year, month + 1, 0)
          const daysInMonth = lastDay.getDate()
          const startingDayOfWeek = firstDay.getDay()
          
          const monthNames = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
          const dayNames = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
          
          const handleDateClick = (day) => {
            const selectedDate = new Date(year, month, day)
            const dateStr = selectedDate.toISOString().slice(0, 10)
            
            if (!customDateSelection.start) {
              // First click - set start date
              const newSelection = { start: dateStr, end: null, selecting: 'end' }
              setCustomDateSelection(newSelection)
              // Don't update dateRange yet - only update on Apply
            } else if (!customDateSelection.end) {
              // Second click - set end date
              // If end date is before start date, swap them
              if (dateStr < customDateSelection.start) {
                const newSelection = { start: dateStr, end: customDateSelection.start, selecting: 'end' }
                setCustomDateSelection(newSelection)
                // Don't update dateRange yet - only update on Apply
              } else {
                const newSelection = { ...customDateSelection, end: dateStr, selecting: 'end' }
                setCustomDateSelection(newSelection)
                // Don't update dateRange yet - only update on Apply
              }
            } else {
              // Both dates selected - allow re-selecting start date
              const newSelection = { start: dateStr, end: null, selecting: 'end' }
              setCustomDateSelection(newSelection)
              // Don't update dateRange yet - only update on Apply
            }
            // Calendar stays open - don't close it
          }
          
          const isDateInRange = (day) => {
            if (!customDateSelection.start) return false
            const dateStr = new Date(year, month, day).toISOString().slice(0, 10)
            if (customDateSelection.end) {
              return dateStr >= customDateSelection.start && dateStr <= customDateSelection.end
            }
            return dateStr === customDateSelection.start
          }
          
          const isStartDate = (day) => {
            if (!customDateSelection.start) return false
            const dateStr = new Date(year, month, day).toISOString().slice(0, 10)
            return dateStr === customDateSelection.start
          }
          
          const isEndDate = (day) => {
            if (!customDateSelection.end) return false
            const dateStr = new Date(year, month, day).toISOString().slice(0, 10)
            return dateStr === customDateSelection.end
          }
          
          const navigateMonth = (direction) => {
            setCalendarMonth(new Date(year, month + direction, 1))
          }
          
          return (
            <div 
              className="custom-calendar-overlay"
              onMouseDown={(e) => {
                // Only allow closing via buttons, not by clicking overlay
                e.stopPropagation()
              }}
              onClick={(e) => {
                // Only allow closing via buttons, not by clicking overlay
                e.stopPropagation()
              }}
            >
              <div 
                ref={calendarModalRef}
                className="custom-calendar-modal"
                onClick={(e) => {
                  // Prevent any clicks inside modal from bubbling up to overlay
                  e.stopPropagation()
                }}
                onMouseDown={(e) => {
                  e.stopPropagation()
                }}
              >
                <div className="custom-calendar-header">
                  <h3>Select Date Range</h3>
                  <button 
                    className="custom-calendar-close" 
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setShowCustomCalendar(false)
                    }}
                  >
                    ✕
                  </button>
                              </div>
                <div className="custom-calendar-instruction">
                  {!customDateSelection.start
                    ? 'Click a date to set start date'
                    : !customDateSelection.end
                    ? `Start: ${new Date(customDateSelection.start).toLocaleDateString()}. Click a date to set end date (optional), then click Apply`
                    : `Range: ${new Date(customDateSelection.start).toLocaleDateString()} - ${new Date(customDateSelection.end).toLocaleDateString()}. Click Apply to confirm.`}
                </div>
                <div 
                  className="calendar-wrapper"
                  onClick={(e) => e.stopPropagation()}
                  onMouseDown={(e) => e.stopPropagation()}
                >
                  <div className="calendar-header-nav">
                    <button 
                      type="button"
                      className="calendar-nav-btn"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        navigateMonth(-1)
                      }}
                    >
                      ←
                    </button>
                    <h4 className="calendar-month-year">{monthNames[month]} {year}</h4>
                    <button 
                      type="button"
                      className="calendar-nav-btn"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        navigateMonth(1)
                      }}
                    >
                      →
                    </button>
                  </div>
                  <div 
                    className="calendar-grid"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                  >
                    {dayNames.map(day => (
                      <div key={day} className="calendar-day-header">{day}</div>
                    ))}
                    {Array.from({ length: startingDayOfWeek }).map((_, i) => (
                      <div key={`empty-${i}`} className="calendar-day empty"></div>
                    ))}
                    {Array.from({ length: daysInMonth }).map((_, i) => {
                      const day = i + 1
                      const dateStr = new Date(year, month, day).toISOString().slice(0, 10)
                      const today = new Date().toISOString().slice(0, 10)
                      const isToday = dateStr === today
                      const inRange = isDateInRange(day)
                      const isStart = isStartDate(day)
                      const isEnd = isEndDate(day)
                      
                      return (
                        <button
                          key={day}
                          type="button"
                          className={`calendar-day ${inRange ? 'in-range' : ''} ${isStart ? 'start-date' : ''} ${isEnd ? 'end-date' : ''} ${isToday ? 'today' : ''}`}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            handleDateClick(day)
                          }}
                          onMouseDown={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                          }}
                        >
                          {day}
                        </button>
                            )
                          })}
                        </div>
                      </div>
                {customDateSelection.start && (
                  <div className="custom-calendar-selected">
                    <div>Start: {new Date(customDateSelection.start).toLocaleDateString()}</div>
                    {customDateSelection.end && (
                      <div>End: {new Date(customDateSelection.end).toLocaleDateString()}</div>
                    )}
                    </div>
                )}
                <div className="custom-calendar-actions">
                  {(customDateSelection.start || customDateSelection.end) && (
                    <button 
                      type="button"
                      className="custom-calendar-btn custom-calendar-btn-clear"
                      onClick={(e) => {
                        e.preventDefault()
                        e.stopPropagation()
                        setCustomDateSelection({ start: null, end: null, selecting: 'start' })
                        setDateRange({ start: null, end: null })
                      }}
                    >
                      Clear
                    </button>
                  )}
                  <button 
                    type="button"
                    className="custom-calendar-btn custom-calendar-btn-secondary"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setShowCustomCalendar(false)
                      // Don't reset selection on cancel - keep it for next time
                    }}
                  >
                    Cancel
                  </button>
                  <button 
                    type="button"
                    className="custom-calendar-btn custom-calendar-btn-primary"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      if (customDateSelection.start) {
                        setUsageView('all') // Ensure we stay on 'all' view
                        const selectedRange = { 
                          start: customDateSelection.start, 
                          end: customDateSelection.end || null 
                        }
                        setDateRange(selectedRange)
                        setShowCustomCalendar(false)
                        fetchBillingHistory(selectedRange)
                      }
                    }}
                    disabled={!customDateSelection.start}
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          )
        })()}
        {usageWarnings && usageWarnings.length > 0 && (
          <div className="usage-warnings">
            {usageWarnings.map((w, idx) => (
              <div key={idx} className="usage-warning-card">
                <span className="warning-icon">⚠️</span>
                <div>
                  <div className="warning-title">{w.title || 'Limit warning'}</div>
                  <div className="warning-text">{w.message || ''}</div>
                </div>
              </div>
            ))}
                  </div>
                )}
        {usageView === 'daily' ? (
          <div className="usage-cards">
            {renderUsageCard('normal', 'Normal Mode')}
            {renderUsageCard('code', 'Code Mode')}
            {renderUsageCard('web_search', 'Web Search Mode')}
          </div>
        ) : (
          <div className="usage-table">
            <div className="usage-table-header">
              <h4>Billing history</h4>
              <span className="usage-table-subtitle">Filtered by date range</span>
            </div>
            {showDownloadPrompt && (
              <div className="usage-download-prompt">
                <div className="download-prompt-content">
                  <span className="download-prompt-icon">📥</span>
                  <div className="download-prompt-text">
                    <strong>Large dataset detected</strong>
                    <span>Showing 50 of {billingHistoryCount} records. Download CSV to view all usage metrics.</span>
                  </div>
                  <button 
                    className="download-prompt-btn"
                    onClick={(e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      exportCSV(dateRange)
                    }}
                  >
                    Download CSV
                  </button>
                </div>
              </div>
            )}
            <div className="usage-table-grid">
              <div className="usage-table-row usage-table-head">
                <span>Date</span>
                <span>Model</span>
                <span>Tokens</span>
                <span>Cost</span>
          </div>
              {(billingHistory || []).map(record => (
                <div key={record.id || record.created_at} className="usage-table-row">
                  <span>{record.created_at ? new Date(record.created_at).toLocaleString() : '-'}</span>
                  <span>{record.model_name || 'default'}</span>
                  <span>{`${record.input_tokens || 0} in / ${record.output_tokens || 0} out`}</span>
                  <span>${(record.cost_usd || 0).toFixed(2)}</span>
        </div>
              ))}
              {(billingHistory || []).length === 0 && (
                <div className="usage-empty">No usage records yet.</div>
              )}
            </div>
          </div>
        )}
      </div>
    )
  }

  const ConfirmationModal = () => {
    if (!showConfirmationModal || !pendingConfirmation) return null

    const handleConfirm = async () => {
      setIsLoading(true)
      const result = await confirmInternetCall(
        pendingConfirmation.confirmationId,
        true,
        pendingConfirmation.chatInput
      )
      
      if (result) {
        // Store code_blocks if provided
        if (result.message_id && result.code_blocks && result.code_blocks.length > 0) {
          setCodeBlocksCache(prev => ({
            ...prev,
            [result.message_id]: result.code_blocks
          }))
        }
        
        // Store escalation info if provided
        if (result.message_id && result.escalation_level !== undefined) {
          setEscalationInfo(prev => ({
            ...prev,
            [result.message_id]: {
              currentLevel: result.escalation_level,
              maxLevel: billingInfo?.max_code_escalations !== null ? billingInfo?.max_code_escalations : (billingInfo?.max_web_search_escalation_level !== undefined ? billingInfo?.max_web_search_escalation_level : null),
              model: result.model_used || 'Unknown'
            }
          }))
        }
        
        // Refresh usage
        await fetchUsageSummary()
        
        // Reload session
        await loadSession(currentSessionId)
      }
      
      setShowConfirmationModal(false)
      setPendingConfirmation(null)
      setIsLoading(false)
    }

    const handleCancel = () => {
      setShowConfirmationModal(false)
      setPendingConfirmation(null)
      setIsLoading(false)
    }

    return (
      <div className="modal-overlay">
        <div className="modal-content confirmation-modal">
          <h2>Internet Call Required</h2>
          <p>{pendingConfirmation.message}</p>
          <div className="confirmation-actions">
            <button className="btn-secondary" onClick={handleCancel}>Cancel</button>
            <button className="btn-primary" onClick={handleConfirm}>Proceed with Internet</button>
          </div>
        </div>
      </div>
    )
  }

  const ManageSubscription = () => {
    const [showDetails, setShowDetails] = useState(false)
    const [showEditPayment, setShowEditPayment] = useState(false)
    const [showEditBilling, setShowEditBilling] = useState(false)
    const [subscriptionDetails, setSubscriptionDetails] = useState(null)
    const [loadingSubscription, setLoadingSubscription] = useState(true)
    const [paymentMethod, setPaymentMethod] = useState({
      card_number: '',
      expiry_date: '',
      cvv: '',
      cardholder_name: ''
    })
    const [billingInfoForm, setBillingInfoForm] = useState({
      name: '',
      email: '',
      address: '',
      city: '',
      zip_code: '',
      country: ''
    })
    const [savingPayment, setSavingPayment] = useState(false)
    const [savingBilling, setSavingBilling] = useState(false)
    
    // Fetch subscription details from API when modal opens
    const loadSubscriptionDetails = async () => {
      try {
        setLoadingSubscription(true)
        const res = await authenticatedFetch(`${API_BASE_URL}/api/billing/subscription/details`)
        
        if (res.status === 401) {
          clearTokens()
          setShowSessionExpired(true)
          setIsAuthenticated(false)
          return
        }
        
        if (res.ok) {
          const data = await res.json()
          setSubscriptionDetails(data)
          
          // Map payment_method from API response
          if (data.payment_method) {
            setPaymentMethod({
              card_number: data.payment_method.card_last4 ? `•••• •••• •••• ${data.payment_method.card_last4}` : '',
              expiry_date: data.payment_method.card_expiry || '',
              cvv: '',
              cardholder_name: ''
            })
          }
          
          // Map billing_info from API response
          if (data.billing_info) {
            setBillingInfoForm({
              name: data.billing_info.name || '',
              email: data.billing_info.email || '',
              address: data.billing_info.billing_address || '',
              city: data.billing_info.billing_city || '',
              zip_code: data.billing_info.billing_zip || '',
              country: data.billing_info.billing_country || ''
            })
          }
        } else {
          console.error('Failed to load subscription details')
        }
      } catch (err) {
        console.error('Failed to load subscription details:', err)
      } finally {
        setLoadingSubscription(false)
      }
    }
    
    // Fetch subscription details when modal opens
    useEffect(() => {
      if (showManageSubscription) {
        loadSubscriptionDetails()
      }
    }, [showManageSubscription])
    
    
    // Save payment method
    const savePaymentMethod = async () => {
      if (!paymentMethod.card_number || !paymentMethod.expiry_date || !paymentMethod.cvv) {
        alert('Please fill in all payment method fields')
        return
      }
      
      setSavingPayment(true)
      try {
        const res = await authenticatedFetch(`${API_BASE_URL}/api/user/payment-method`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(paymentMethod)
        })
        
        if (res.status === 401) {
          clearTokens()
          setShowSessionExpired(true)
          setIsAuthenticated(false)
          return
        }
        
      if (res.ok) {
        alert('Payment method saved successfully')
        setShowEditPayment(false)
        await loadSubscriptionDetails() // Reload subscription details
      } else {
          const error = await res.json()
          alert(`Failed to save payment method: ${error.detail || 'Unknown error'}`)
        }
      } catch (err) {
        console.error('Failed to save payment method:', err)
        alert('Failed to save payment method. Please try again.')
      } finally {
        setSavingPayment(false)
      }
    }
    
    // Save billing information
    const saveBillingInfo = async () => {
      if (!billingInfoForm.name || !billingInfoForm.email || !billingInfoForm.address) {
        alert('Please fill in all required billing information fields')
        return
      }
      
      setSavingBilling(true)
      try {
        // Split name into first and last name
        const nameParts = billingInfoForm.name.trim().split(' ')
        const firstName = nameParts[0] || ''
        const lastName = nameParts.slice(1).join(' ') || ''
        
        const res = await authenticatedFetch(`${API_BASE_URL}/api/user/profile`, {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            first_name: firstName,
            last_name: lastName,
            email: billingInfoForm.email,
            billing_address: billingInfoForm.address,
            city: billingInfoForm.city,
            zip_code: billingInfoForm.zip_code,
            country: billingInfoForm.country
          })
        })
        
        if (res.status === 401) {
          clearTokens()
          setShowSessionExpired(true)
          setIsAuthenticated(false)
          return
        }
        
        if (res.ok) {
          alert('Billing information saved successfully')
          setShowEditBilling(false)
          await loadSubscriptionDetails() // Reload subscription details
        } else {
          const error = await res.json()
          alert(`Failed to save billing information: ${error.detail || 'Unknown error'}`)
        }
      } catch (err) {
        console.error('Failed to save billing information:', err)
        alert('Failed to save billing information. Please try again.')
      } finally {
        setSavingBilling(false)
      }
    }
    
    // Format dates
    const formatDate = (dateString) => {
      if (!dateString) return ''
      return new Date(dateString).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    }
    
    // Handle cancel subscription - reload details after cancellation
    const handleCancel = async () => {
      if (!confirm('Are you sure you want to cancel your subscription? Your subscription will remain active until the end of the current billing period.')) return
      
      try {
        const res = await authenticatedFetch(`${API_BASE_URL}/api/billing/cancel`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ reason: 'User requested cancellation' })
        })
        
        if (res.status === 401) {
          clearTokens()
          setShowSessionExpired(true)
          setIsAuthenticated(false)
          return
        }
        
        if (res.ok) {
          const data = await res.json()
          alert(data.message || 'Subscription cancelled successfully. Your subscription will remain active until the end of the current billing period.')
          await loadSubscriptionDetails() // Reload subscription details
          await fetchBillingInfo() // Also update billing info in parent
        } else {
          const error = await res.json()
          alert(`Cancellation failed: ${error.detail || 'Unknown error'}`)
        }
      } catch (err) {
        console.error('Failed to cancel subscription:', err)
        alert('Failed to cancel subscription. Please try again.')
      }
    }
    
    if (loadingSubscription) {
      return (
        <div className="manage-subscription-modal">
          <div className="manage-subscription-content">
            <div className="loading">Loading subscription details...</div>
          </div>
        </div>
      )
    }
    
    if (!subscriptionDetails) {
      return (
        <div className="manage-subscription-modal">
          <div className="manage-subscription-content">
            <div className="error">Failed to load subscription details</div>
          </div>
        </div>
      )
    }
    
    // Check if trial
    const isTrial = subscriptionDetails.status === 'pending' || subscriptionDetails.status === 'trial'
    const trialEndDate = subscriptionDetails.end_date ? formatDate(subscriptionDetails.end_date) : ''
    
    return (
      <div className="manage-subscription-modal">
        <div className="manage-subscription-content">
          {/* Current Subscription Section */}
          <div className="manage-subscription-section">
            <div className="section-header-row">
              <h3>CURRENT SUBSCRIPTION</h3>
              <button 
                className="cancel-subscription-btn"
                onClick={handleCancel}
                disabled={subscriptionDetails.plan_tier === 'free'}
              >
                Cancel subscription
              </button>
            </div>
            
            {isTrial && trialEndDate && (
              <div className="trial-badge">
                Trial ends {trialEndDate}
              </div>
            )}
            
            <div className="subscription-info">
              <div className="subscription-name">{subscriptionDetails.plan_name || 'No active subscription'}</div>
              <div className="subscription-price">
                ${subscriptionDetails.plan_tier === 'byok' ? '0.00' : (subscriptionDetails.price_monthly || 0).toFixed(2)} per month
              </div>
              {subscriptionDetails.end_date && subscriptionDetails.auto_renew && (
                <div className="subscription-auto-renew">
                  After your free trial ends on {formatDate(subscriptionDetails.end_date)}, this service will continue automatically.
                </div>
              )}
            </div>
            
            {subscriptionDetails.payment_method && subscriptionDetails.payment_method.card_last4 && (
              <div className="payment-method-preview">
                <div className="card-icon">💳</div>
                <div className="card-info">
                  <span>
                    {subscriptionDetails.payment_method.card_type || 'Card'} •••• {subscriptionDetails.payment_method.card_last4}
                  </span>
                  {subscriptionDetails.payment_method.card_expiry && (
                    <span className="expiry-text">Expires {subscriptionDetails.payment_method.card_expiry}</span>
                  )}
                  <button 
                    className="edit-icon-btn"
                    onClick={() => setShowEditPayment(true)}
                    title="Edit payment method"
                  >
                    ✏️
                  </button>
                </div>
              </div>
            )}
            
            <button 
              className="view-details-btn"
              onClick={() => setShowDetails(!showDetails)}
            >
              View details {showDetails ? '▲' : '▼'}
            </button>
            
            {showDetails && (
              <div className="subscription-details">
                <div className="detail-row">
                  <span>Plan:</span>
                  <span>{subscriptionDetails.plan_name || 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span>Status:</span>
                  <span>{subscriptionDetails.status || 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span>Start Date:</span>
                  <span>{subscriptionDetails.start_date ? formatDate(subscriptionDetails.start_date) : 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span>End Date:</span>
                  <span>{subscriptionDetails.end_date ? formatDate(subscriptionDetails.end_date) : 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span>Cancelled At:</span>
                  <span>{subscriptionDetails.cancelled_at ? formatDate(subscriptionDetails.cancelled_at) : 'N/A'}</span>
                </div>
                <div className="detail-row">
                  <span>Auto Renew:</span>
                  <span>{subscriptionDetails.auto_renew ? 'Yes' : 'No'}</span>
                </div>
                <div className="detail-row">
                  <span>Is Subscribed:</span>
                  <span>{subscriptionDetails.is_subscribed ? 'Yes' : 'No'}</span>
                </div>
              </div>
            )}
          </div>
          
          {/* Payment Method Section */}
          <div className="manage-subscription-section">
            <h3>PAYMENT METHOD</h3>
            {showEditPayment ? (
              <div className="edit-form">
                <div className="form-group">
                  <label>Card Number</label>
                  <input
                    type="text"
                    placeholder="1234 5678 9012 3456"
                    value={paymentMethod.card_number}
                    onChange={(e) => {
                      const value = e.target.value.replace(/\s/g, '').replace(/\D/g, '')
                      const formatted = value.match(/.{1,4}/g)?.join(' ') || value
                      setPaymentMethod({ ...paymentMethod, card_number: formatted })
                    }}
                    maxLength="19"
                    className="form-input"
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Expiry Date (MM/YY)</label>
                    <input
                      type="text"
                      placeholder="11/29"
                      value={paymentMethod.expiry_date}
                      onChange={(e) => {
                        let value = e.target.value.replace(/\D/g, '')
                        if (value.length >= 2) {
                          value = value.slice(0, 2) + '/' + value.slice(2, 4)
                        }
                        setPaymentMethod({ ...paymentMethod, expiry_date: value })
                      }}
                      maxLength="5"
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label>CVV</label>
                    <input
                      type="password"
                      placeholder="123"
                      value={paymentMethod.cvv}
                      onChange={(e) => {
                        const value = e.target.value.replace(/\D/g, '').slice(0, 4)
                        setPaymentMethod({ ...paymentMethod, cvv: value })
                      }}
                      maxLength="4"
                      className="form-input"
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Cardholder Name</label>
                  <input
                    type="text"
                    placeholder="John Doe"
                    value={paymentMethod.cardholder_name}
                    onChange={(e) => setPaymentMethod({ ...paymentMethod, cardholder_name: e.target.value })}
                    className="form-input"
                  />
                </div>
                <div className="form-actions">
                  <button
                    onClick={savePaymentMethod}
                    className="btn-primary"
                    disabled={savingPayment}
                  >
                    {savingPayment ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setShowEditPayment(false)
                      // Reset to original values from subscriptionDetails
                      if (subscriptionDetails.payment_method && subscriptionDetails.payment_method.card_last4) {
                        setPaymentMethod({
                          card_number: `•••• •••• •••• ${subscriptionDetails.payment_method.card_last4}`,
                          expiry_date: subscriptionDetails.payment_method.card_expiry || '',
                          cvv: '',
                          cardholder_name: ''
                        })
                      } else {
                        setPaymentMethod({
                          card_number: '',
                          expiry_date: '',
                          cvv: '',
                          cardholder_name: ''
                        })
                      }
                    }}
                    className="btn-secondary"
                    disabled={savingPayment}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {subscriptionDetails.payment_method && subscriptionDetails.payment_method.card_last4 ? (
                  <>
                    <div className="payment-method-info">
                      <div className="card-icon">💳</div>
                      <div className="payment-details">
                        <span>
                          {subscriptionDetails.payment_method.card_type || 'Card'} •••• {subscriptionDetails.payment_method.card_last4}
                        </span>
                        {subscriptionDetails.payment_method.card_expiry && (
                          <span className="expiry-date">
                            Expires {subscriptionDetails.payment_method.card_expiry}
                          </span>
                        )}
                      </div>
                      <button className="more-options-btn">⋯</button>
                    </div>
                    <button 
                      className="add-payment-method-btn"
                      onClick={() => setShowEditPayment(true)}
                    >
                      ✏️ Edit payment method
                    </button>
                  </>
                ) : (
                  <button 
                    className="add-payment-method-btn"
                    onClick={() => setShowEditPayment(true)}
                  >
                    + Add payment method
                  </button>
                )}
              </>
            )}
          </div>
          
          {/* Billing Information Section */}
          <div className="manage-subscription-section">
            <h3>BILLING INFORMATION</h3>
            {showEditBilling ? (
              <div className="edit-form">
                <div className="form-group">
                  <label>Full Name</label>
                  <input
                    type="text"
                    placeholder="John Doe"
                    value={billingInfoForm.name}
                    onChange={(e) => setBillingInfoForm({ ...billingInfoForm, name: e.target.value })}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>Email</label>
                  <input
                    type="email"
                    placeholder="john@example.com"
                    value={billingInfoForm.email}
                    onChange={(e) => setBillingInfoForm({ ...billingInfoForm, email: e.target.value })}
                    className="form-input"
                  />
                </div>
                <div className="form-group">
                  <label>Billing Address</label>
                  <input
                    type="text"
                    placeholder="Some street, Some city, Some country"
                    value={billingInfoForm.address}
                    onChange={(e) => setBillingInfoForm({ ...billingInfoForm, address: e.target.value })}
                    className="form-input"
                  />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>City</label>
                    <input
                      type="text"
                      placeholder="Some city"
                      value={billingInfoForm.city}
                      onChange={(e) => setBillingInfoForm({ ...billingInfoForm, city: e.target.value })}
                      className="form-input"
                    />
                  </div>
                  <div className="form-group">
                    <label>Zip Code</label>
                    <input
                      type="text"
                      placeholder="Some zip code"
                      value={billingInfoForm.zip_code}
                      onChange={(e) => setBillingInfoForm({ ...billingInfoForm, zip_code: e.target.value })}
                      className="form-input"
                    />
                  </div>
                </div>
                <div className="form-group">
                  <label>Country</label>
                  <input
                    type="text"
                    placeholder="Some country"
                    value={billingInfoForm.country}
                    onChange={(e) => setBillingInfoForm({ ...billingInfoForm, country: e.target.value })}
                    className="form-input"
                  />
                </div>
                <div className="form-actions">
                  <button
                    onClick={saveBillingInfo}
                    className="btn-primary"
                    disabled={savingBilling}
                  >
                    {savingBilling ? 'Saving...' : 'Save'}
                  </button>
                  <button
                    onClick={() => {
                      setShowEditBilling(false)
                      // Reset to original values from subscriptionDetails
                      if (subscriptionDetails.billing_info) {
                        setBillingInfoForm({
                          name: subscriptionDetails.billing_info.name || '',
                          email: subscriptionDetails.billing_info.email || '',
                          address: subscriptionDetails.billing_info.billing_address || '',
                          city: subscriptionDetails.billing_info.billing_city || '',
                          zip_code: subscriptionDetails.billing_info.billing_zip || '',
                          country: subscriptionDetails.billing_info.billing_country || ''
                        })
                      }
                    }}
                    className="btn-secondary"
                    disabled={savingBilling}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <>
                {subscriptionDetails.billing_info ? (
                  <>
                    <div className="billing-info-details">
                      {subscriptionDetails.billing_info.name && (
                        <div className="billing-info-row">
                          <span className="billing-label">Name:</span>
                          <span className="billing-value">{subscriptionDetails.billing_info.name}</span>
                        </div>
                      )}
                      {subscriptionDetails.billing_info.email && (
                        <div className="billing-info-row">
                          <span className="billing-label">Email:</span>
                          <span className="billing-value">{subscriptionDetails.billing_info.email}</span>
                        </div>
                      )}
                      {subscriptionDetails.billing_info.billing_address && (
                        <div className="billing-info-row">
                          <span className="billing-label">Billing address:</span>
                          <span className="billing-value">
                            {[
                              subscriptionDetails.billing_info.billing_address,
                              subscriptionDetails.billing_info.billing_city,
                              subscriptionDetails.billing_info.billing_zip,
                              subscriptionDetails.billing_info.billing_country
                            ].filter(Boolean).join(', ')}
                          </span>
                        </div>
                      )}
                    </div>
                    <button 
                      className="update-info-btn"
                      onClick={() => setShowEditBilling(true)}
                    >
                      ✏️ Update information
                    </button>
                  </>
                ) : (
                  <div className="billing-info-details">
                    <div className="billing-info-row">
                      <span className="billing-label">No billing information on file</span>
                    </div>
                    <button 
                      className="update-info-btn"
                      onClick={() => setShowEditBilling(true)}
                    >
                      ✏️ Add billing information
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    )
  }

  const BillingSection = () => {
    // Use App-level states and handlers for upgrade modals
    // handleCancelSubscription is now at App level
    
    const totalCost = (billingHistory || []).reduce((sum, r) => sum + (r.cost_usd || 0), 0)

    return (
      <>
        <div className="billing-section">
          <div className="billing-header">
            <div>
              <h3>Billing & Invoices</h3>
              <div className="billing-cycle">
                {billingInfo?.start_date ? `${new Date(billingInfo.start_date).toLocaleDateString()} - ${billingInfo?.end_date ? new Date(billingInfo.end_date).toLocaleDateString() : ''}` : 'Current cycle'}
              </div>
            </div>
            <button className="manage-subscription-btn" onClick={() => setShowManageSubscription(true)}>
              Manage subscription
            </button>
          </div>

          <div className="on-demand-usage-card">
            <div className="odu-left">
              <div className="odu-title">On-Demand Usage</div>
              <div className="odu-period">
                {billingInfo?.start_date ? `${new Date(billingInfo.start_date).toLocaleDateString()} - ${billingInfo?.end_date ? new Date(billingInfo.end_date).toLocaleDateString() : ''}` : 'Current cycle'}
              </div>
              <div className="odu-total">${totalCost.toFixed(2)}</div>
            </div>
            <div className="odu-right">
              <div className="odu-row odu-head">
                <span>Type</span><span>Tokens</span><span>Cost</span><span>Qty</span><span>Total</span>
              </div>
              <div className="odu-row">
                <span>Requests</span><span>—</span><span>—</span><span>—</span><span>${totalCost.toFixed(2)}</span>
              </div>
            </div>
          </div>

          <div className="billing-history">
            <div className="billing-history-header">
              <h4>Invoices</h4>
              {billingInfo && (
                <div className="current-plan-inline">
                  <div>{billingInfo.plan_name || 'Current plan'} ({billingInfo.plan_tier || ''})</div>
                  <div className="current-plan-status">{billingInfo.status || 'active'}</div>
                  <div className="current-plan-dates">
                    {billingInfo.start_date && `Start: ${new Date(billingInfo.start_date).toLocaleDateString()}`} {billingInfo.end_date && ` • End: ${new Date(billingInfo.end_date).toLocaleDateString()}`}
                  </div>
                </div>
              )}
            </div>
            <div className="billing-history-table">
              <div className="billing-row billing-head">
                <span>Date</span>
                <span>Description</span>
                <span>Status</span>
                <span>Amount</span>
                <span>Invoice</span>
              </div>
              {(billingHistory || []).map(rec => (
                <div key={rec.id || rec.invoice_id || rec.created_at} className="billing-row">
                  <span>{rec.created_at ? new Date(rec.created_at).toLocaleDateString() : '-'}</span>
                  <span>{rec.description || rec.model_name || 'Invoice'}</span>
                  <span>{rec.status || 'Paid'}</span>
                  <span>${(rec.amount_usd || rec.cost_usd || 0).toFixed(2)}</span>
                  <span>
                    {rec.invoice_url ? (
                      <a className="invoice-view-btn" href={rec.invoice_url} target="_blank" rel="noreferrer">View</a>
                    ) : (
                      <button className="invoice-view-btn" disabled>View</button>
                    )}
                  </span>
                </div>
              ))}
              {(billingHistory || []).length === 0 && (
                <div className="billing-empty">No invoices yet.</div>
              )}
            </div>
          </div>
        </div>
      </>
    )
  }

  if (!isAuthenticated) {
    if (showPasswordReset) {
      return <PasswordResetModal />
    }
    return showSessionExpired ? <SessionExpiredModal /> : <AuthModal />
  }

  return (
    <div className="app-root">
      <aside className="sidebar">
        {showSettings ? (
          <div className="settings-nav">
            <div className="settings-nav-header">
              <div className="settings-nav-name">{`${userProfile?.first_name || ''} ${userProfile?.last_name || ''}`.trim() || 'User'}</div>
              <div className="settings-nav-email">{userProfile?.email || ''}</div>
            </div>
            <div className="settings-nav-items">
              <button
                className={`settings-nav-item ${settingsTab === 'overview' ? 'active' : ''}`}
                onClick={() => setSettingsTab('overview')}
              >
                Overview
              </button>
              <button
                className={`settings-nav-item ${settingsTab === 'usage' ? 'active' : ''}`}
                onClick={() => { setSettingsTab('usage'); fetchUsageSummary(); fetchBillingHistory(); }}
              >
                Usage
              </button>
              <button
                className={`settings-nav-item ${settingsTab === 'billing' ? 'active' : ''}`}
                onClick={() => { setSettingsTab('billing'); fetchBillingInfo(); fetchBillingHistory(); }}
              >
                Billing & Invoices
              </button>
            </div>
          </div>
        ) : (
          <>
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
              <button className="sidebar-footer-item" onClick={() => { setSettingsTab('overview'); setShowSettings(true); fetchBillingInfo(); fetchUsageSummary(); fetchBillingHistory(); }}>
            ⚙️ Settings
          </button>
        </div>
          </>
        )}
      </aside>

      <main className="chat-layout">
        <header className="chat-header">
          <div className="header-left">
            <div className="chat-title">LLM Router Chat</div>
            <div className="chat-subtitle">AI-powered conversation interface</div>
          </div>
          <div className="header-right">
            <button
              className="user-avatar-btn"
              onClick={() => setShowUserMenu((v) => !v)}
              title={userProfile?.email || 'User'}
            >
              {(userProfile?.first_name?.[0] || 'D').toUpperCase()}{(userProfile?.last_name?.[0] || 'K').toUpperCase()}
            </button>
            {showUserMenu && (
              <div className="user-menu-pop" ref={userMenuRef}>
                <div className="user-menu-name">{`${userProfile?.first_name || ''} ${userProfile?.last_name || ''}`.trim() || 'User'}</div>
                <div className="user-menu-email">{userProfile?.email || '—'}</div>
                <button className="logout-small-btn" onClick={handleLogout}>Logout</button>
              </div>
            )}
          </div>
        </header>

        <section className="chat-messages" ref={chatMessagesRef}>
          {statusBanner && statusBanner.type === 'escalation' && (
            <div className="status-banner status-banner-stronger">
              <div className="status-banner-title">
                Trying a stronger model...
              </div>
              <div className="status-banner-body">
                {(statusBanner.messages || []).map((msg, idx) => (
                  <span key={idx} className="status-chip">{msg}</span>
                ))}
                {statusBanner.models && statusBanner.models.length > 0 && (
                  <div className="models-tried">
                    {statusBanner.models.map((mName, idx) => (
                      <span key={mName + idx} className="model-chip">
                        {idx === 0 ? 'Default model' : 'Stronger model'}: {mName}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
          {showLimitWarning && (
            <div className="limit-warning-banner">
              <span className="warning-icon">⚠️</span>
              <span className="warning-message">{limitWarningMessage}</span>
              <div className="warning-actions">
                <button className="btn-small btn-primary" onClick={() => { setShowSettings(true); setSettingsTab('billing'); fetchBillingInfo(); }}>
                  Upgrade
                </button>
                <button className="btn-small btn-secondary" onClick={() => setShowLimitWarning(false)}>
                  Dismiss
                </button>
              </div>
            </div>
          )}
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
                      {m.isThinking ? (
                        <>
                          <div className="thinking-indicator">
                            {m.thinkingStatus ? (
                              <div className="current-step">
                                {m.thinkingStatus}
                              </div>
                            ) : (
                              <>
                                <span className="thinking-text">Thinking</span>
                                <span className="thinking-dots">
                                  <span className="dot"></span>
                                  <span className="dot"></span>
                                  <span className="dot"></span>
                                </span>
                              </>
                            )}
                          </div>
                          {/* Chain-of-Thought banner underneath thinking */}
                          {statusBanner && statusBanner.type === 'info' && statusBanner.steps && statusBanner.steps.length > 0 && (
                            <div className="chain-of-thought-inline">
                              <div className="chain-flow">
                                {statusBanner.steps.map((step, idx) => {
                                  let stepText = step.message
                                  
                                  // Check for NOT ALLOWED first (before ALLOWED, since "NOT ALLOWED" contains "ALLOWED")
                                  if (step.message.includes('NOT ALLOWED')) {
                                    // Use the exact message from backend (already includes ❌ and description)
                                    stepText = step.message
                                  } else if (step.message.includes('ORCHESTRATOR ANALYSIS')) {
                                    stepText = '🔍 ORCHESTRATOR ANALYSIS'
                                  } else if (step.message.includes('Classifying')) {
                                    stepText = 'Stage 1 - Prompt Classification: Classifying the prompt'
                                  } else if (step.message.includes('Safety') || step.message.includes('🛡️')) {
                                    stepText = '🛡️ Safety Classification'
                                  } else if (step.message.includes('RISK')) {
                                    stepText = 'RISK CALCULATION'
                                  } else if (step.message.includes('ALLOWED')) {
                                    // Only show ALLOWED if it's actually allowed (not NOT ALLOWED)
                                    stepText = step.message // Use backend message directly
                                  } else if (step.message.includes('Finding')) {
                                    stepText = 'Stage 3 - Smart Routing: Finding the best model'
                                  } else if (step.message.startsWith('Using model:') || step.modelName) {
                                    const modelName = step.modelName || step.message.replace('Using model: ', '') || 'model'
                                    stepText = `Stage 4 - Model Selection: 🧑‍💻 ${modelName} → 🔥 Prompt Optimized → 💯 Continue`
                                  } else if (step.message.includes('Sharing')) {
                                    stepText = 'Stage 5 - Response Generation: Sharing the output'
                                  }
                                  
                                  return (
                                    <span key={idx} className="chain-step-inline">
                                      {idx > 0 && <span className="chain-arrow"> → </span>}
                                      <span className="chain-step-text">{stepText}</span>
                                    </span>
                                  )
                                })}
                              </div>
                            </div>
                          )}
                        </>
                      ) : (() => {
                        // Check if message has code_blocks (from API response)
                        const codeBlocks = m.code_blocks || []
                        const parts = parseMessageContent(m.content, codeBlocks)
                        
                        return parts.map((part, partIdx) => {
                          if (part.type === 'code') {
                            return <CodeBlock key={partIdx} code={part.code} language={part.language} />
                          } else {
                            // Format the content first
                            const formattedContent = formatTextContent(part.content)
                            
                            return (
                              <div key={partIdx} className="message-text-content">
                                {(() => {
                                  const lines = formattedContent.split('\n')
                                  const elements = []
                                  let inTable = false
                                  let tableRows = []
                                  
                                  lines.forEach((line, lineIdx) => {
                                    if (!line.trim()) {
                                      if (inTable) {
                                        // End table
                                        elements.push(renderTable(tableRows, lineIdx))
                                        tableRows = []
                                        inTable = false
                                      }
                                      elements.push(<br key={lineIdx} />)
                                      return
                                    }
                                    
                                    // Check for table row
                                    if (line.trim().startsWith('|') && line.trim().endsWith('|')) {
                                      if (!inTable) {
                                        inTable = true
                                      }
                                      const cells = line.split('|').map(c => c.trim()).filter(c => c)
                                      tableRows.push(cells)
                                      return
                                    } else if (inTable) {
                                      // End table
                                      elements.push(renderTable(tableRows, lineIdx))
                                      tableRows = []
                                      inTable = false
                                    }
                                    
                                    // Check for headers
                                    const h3Match = line.match(/^###\s+(.+)$/)
                                    if (h3Match) {
                                      elements.push(<h3 key={lineIdx} className="message-h3">{renderBoldText(h3Match[1])}</h3>)
                                      return
                                    }
                                    
                                    const h2Match = line.match(/^##\s+(.+)$/)
                                    if (h2Match) {
                                      elements.push(<h2 key={lineIdx} className="message-h2">{renderBoldText(h2Match[1])}</h2>)
                                      return
                                    }
                                    
                                    const h1Match = line.match(/^#\s+(.+)$/)
                                    if (h1Match) {
                                      elements.push(<h1 key={lineIdx} className="message-h1">{renderBoldText(h1Match[1])}</h1>)
                                      return
                                    }
                                    
                                    // Check if line contains bullet point pattern: • **text** or * text
                                    const bulletMatch = line.match(/•\s*\*\*([^*]+)\*\*(.*)$/)
                                    if (bulletMatch) {
                                      const beforeBullet = line.substring(0, line.indexOf('•')).trim()
                                      elements.push(
                                        <p key={lineIdx} className="message-bullet-point">
                                          {beforeBullet && <span>{beforeBullet} </span>}
                                          <span className="bullet">•</span>
                                          <strong>{bulletMatch[1]}</strong>
                                          {bulletMatch[2] && <span>{renderBoldText(bulletMatch[2])}</span>}
                                        </p>
                                      )
                                      return
                                    }
                                    
                                    // Check for regular bullet point: * text
                                    const regularBulletMatch = line.match(/^\*\s+(.+)$/)
                                    if (regularBulletMatch) {
                                      elements.push(
                                        <p key={lineIdx} className="message-bullet-point">
                                          <span className="bullet">•</span>
                                          <span>{renderBoldText(regularBulletMatch[1])}</span>
                                        </p>
                                      )
                                      return
                                    }
                                    
                                    // Regular paragraph with bold support
                                    elements.push(
                                      <p key={lineIdx}>
                                        {renderBoldText(line)}
                                      </p>
                                    )
                                  })
                                  
                                  // Close any remaining table
                                  if (inTable && tableRows.length > 0) {
                                    elements.push(renderTable(tableRows, lines.length))
                                  }
                                  
                                  return elements
                                })()}
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
                  {m.status_messages && m.status_messages.length > 0 && (
                    <div className="status-chips">
                      {m.status_messages.map((msg, sIdx) => (
                        <span key={sIdx} className="status-chip">{msg}</span>
                      ))}
                    </div>
                  )}
                  {m.model_used === 'policy_refusal' && (
                    <div className="safety-notice">
                      <div className="safety-title">Response blocked for safety</div>
                      <div className="safety-meta">
                        {m.domain && <span>Domain: {m.domain}</span>}
                        {m.risk_score !== undefined && <span>Risk: {m.risk_score}</span>}
                        {m.adequacy_score !== undefined && <span>Adequacy: {m.adequacy_score}</span>}
                        {m.is_region_red ? <span className="region-red">Region: Red</span> : null}
                      </div>
                    </div>
                  )}
                  {(m.models_tried && m.models_tried.length > 0) || m.model_used ? (
                    <div className="model-info">
                      <span className="model-chip">Default model: {m.models_tried && m.models_tried.length > 0 ? (typeof m.models_tried[0] === 'string' ? m.models_tried[0] : (m.models_tried[0].model || 'default model')) : (m.model_used || 'default model')}</span>
                      {m.models_tried && m.models_tried.length > 1 && (
                        <span className="model-chip stronger">Stronger model: {typeof m.models_tried[m.models_tried.length - 1] === 'string' ? m.models_tried[m.models_tried.length - 1] : (m.models_tried[m.models_tried.length - 1].model || 'default model')}</span>
                      )}
                    </div>
                  ) : null}
                        <button 
                      className={`action-btn ${messageActions[m.id] === 'regenerating' ? 'regenerating' : ''}`}
                      onMouseDown={(e) => e.preventDefault()}
                      disabled={messageActions[m.id] === 'regenerating' || isLoading}
                          onClick={() => {
                        if (messageActions[m.id] !== 'regenerating' && !isLoading) {
                          // Find the user message that prompted this assistant response
                          // Look backwards from current message to find the preceding user message
                          let prevUserMsg = null
                          for (let i = idx - 1; i >= 0; i--) {
                            if (messages[i].role === 'user') {
                              prevUserMsg = messages[i]
                              break
                            }
                          }
                          if (prevUserMsg) {
                              handleRegenerateResponse(m.id, prevUserMsg.content)
                          } else {
                            console.error('Could not find user message for regeneration')
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

      {showSettings && <SettingsPage />}
      <ConfirmationModal />
      
      {/* Manage Subscription Modal */}
      {showManageSubscription && (
        <div className="modal-overlay manage-subscription-overlay" onClick={() => setShowManageSubscription(false)}>
          <div className="manage-subscription-modal-wrapper" onClick={(e) => e.stopPropagation()}>
            <div className="manage-subscription-header">
              <h2>Manage Subscription</h2>
              <button className="close-btn" onClick={() => setShowManageSubscription(false)}>✕</button>
            </div>
            <ManageSubscription />
          </div>
        </div>
      )}
    </div>
  )
}

export default App
