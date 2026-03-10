import { useEffect, useState, useRef } from 'react'
import { Backpack } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext'

const EXTENSION_ID = import.meta.env.VITE_CHROME_EXTENSION_ID

function sendToExtension(data) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(EXTENSION_ID, data, (response) => {
        if (chrome.runtime.lastError) {
          resolve(false)
        } else {
          resolve(response?.success === true)
        }
      })
    } catch {
      resolve(false)
    }
  })
}

export default function ExtensionAuth() {
  const { user, loading, loginWithGoogle } = useAuth()
  const navigate = useNavigate()
  const [status, setStatus] = useState('waiting')
  const tried = useRef(false)

  useEffect(() => {
    if (!user || tried.current) return
    tried.current = true

    async function connect() {
      setStatus('sending')
      const token = await user.getIdToken()

      const ok = await sendToExtension({
        type: 'BACKPACK_AUTH',
        token,
        refreshToken: user.refreshToken,
        userId: user.uid,
        displayName: user.displayName,
        photo: user.photoURL,
        config: {
          apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
          authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
          projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
          storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
          messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
          appId: import.meta.env.VITE_FIREBASE_APP_ID,
        },
      })

      if (ok) {
        setStatus('done')
        // Redirect to main app after a brief moment
        setTimeout(() => navigate('/'), 1500)
      } else {
        setStatus('error')
      }
    }

    connect()
  }, [user, navigate])

  function retry() {
    tried.current = false
    setStatus('waiting')
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center relative">
        <div className="dot-grid absolute inset-0 pointer-events-none" />
        <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin relative z-10" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center relative">
        <div className="dot-grid absolute inset-0 pointer-events-none" />
        <div className="w-full max-w-xs text-center relative z-10">
          <div className="w-14 h-14 bg-primary rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Backpack size={26} className="text-primary-content" />
          </div>
          <h1 className="text-xl font-bold text-copy mb-1.5">Connect Extension</h1>
          <p className="text-[13px] text-copy-lighter mb-5">
            Sign in to connect the Backpack extension
          </p>
          <button
            onClick={loginWithGoogle}
            className="w-full max-w-xs mx-auto flex items-center justify-center gap-3 px-4 py-3 rounded-xl text-[13px] font-semibold text-copy hover:bg-background transition-colors cursor-pointer bg-foreground border border-border"
          >
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4"/>
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
            </svg>
            Sign in with Google
          </button>
        </div>
      </div>
    )
  }

  // Error state — stays on page with retry
  if (status === 'error') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center relative">
        <div className="dot-grid absolute inset-0 pointer-events-none" />
        <div className="w-full max-w-xs text-center relative z-10">
          <div className="w-14 h-14 bg-error/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <Backpack size={26} className="text-error" />
          </div>
          <h1 className="text-xl font-bold text-copy mb-1.5">Connection Failed</h1>
          <p className="text-[13px] text-copy-lighter mb-4">
            Make sure the Backpack extension is installed and enabled.
          </p>
          <button
            onClick={retry}
            className="inline-flex items-center gap-1.5 bg-primary text-primary-content px-3.5 py-2 rounded-lg text-[13px] font-semibold hover:bg-primary-light transition-colors cursor-pointer border-none"
          >
            Try Again
          </button>
        </div>
      </div>
    )
  }

  // Connecting / success — show spinner then redirect
  return (
    <div className="min-h-screen bg-background flex items-center justify-center relative">
      <div className="dot-grid absolute inset-0 pointer-events-none" />
      <div className="w-full max-w-xs text-center relative z-10">
        <div className="w-14 h-14 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto mb-5">
          {status === 'done' ? (
            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-primary">
              <polyline points="20 6 9 17 4 12"/>
            </svg>
          ) : (
            <div className="w-5 h-5 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          )}
        </div>
        <h1 className="text-xl font-bold text-copy mb-1.5">
          {status === 'done' ? 'Extension Connected!' : 'Connecting...'}
        </h1>
        <p className="text-[13px] text-copy-lighter">
          {status === 'done'
            ? 'Taking you to your dashboard...'
            : 'Sending credentials to the extension'}
        </p>
      </div>
    </div>
  )
}
