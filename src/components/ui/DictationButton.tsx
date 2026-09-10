'use client'

/**
 * The in-app microphone (Phase 10, Ahmed's first request of 10 September).
 *
 * A navigator typing "Family travelling from Dammam to collect the patient" on a phone at 03:00
 * is the slowest thing this app asks anyone to do. Chrome and Edge on Android expose the Web
 * Speech API, so where it exists the free-text boxes get a 44 px microphone beside them; where it
 * does not — every iPhone, because Safari does not offer the API to web apps — nothing renders
 * and the nurse uses the keyboard's own microphone, which is already there.
 *
 * Three things this deliberately does NOT do:
 *
 *  - It never blocks typing. The recogniser writes into the same value the keyboard writes into,
 *    through `onText`, and the caller decides how to merge (`appendDictated`, a space between).
 *  - It never asks for the microphone until the nurse taps it. `start()` is what triggers the
 *    browser's own permission prompt, and that is a user gesture by construction.
 *  - It keeps nothing. There is no recording, no upload and no transcript beyond the words that
 *    land in the box the nurse can see and edit — which matters, because these boxes are exactly
 *    where the plan's "MRN only, no names" rule applies and `phiWarnings` still reads the result.
 *
 * Whether the API exists is a browser-only fact, read through `useSyncExternalStore` with a
 * server snapshot of "absent" so the server's HTML and the first client render agree — the
 * `InstallPrompt` pattern, and for the same reason: setting state from an effect body to discover
 * a browser capability is what makes React warn about a cascading render.
 *
 * `next.config.ts` sends `Permissions-Policy: microphone=(self)`: the app's own origin may
 * listen, no third party can, and `frame-ancestors 'none'` means there is no third party in the
 * document to begin with.
 */
import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { Mic, MicOff } from '@/src/components/icons'

// --- the half of the Web Speech API this component uses ----------------------------------------
//
// TypeScript's DOM lib does not declare `SpeechRecognition` (it is not on the standards track),
// so the shape is written out here rather than cast to `any`. Only the members below are touched.

type RecognitionAlternative = { transcript: string }
type RecognitionResult = { isFinal: boolean; length: number; 0?: RecognitionAlternative }
type RecognitionResultList = { length: number; [index: number]: RecognitionResult }
type RecognitionEvent = { resultIndex: number; results: RecognitionResultList }
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: (() => void) | null
  start: () => void
  stop: () => void
  abort: () => void
}
type RecognitionCtor = new () => Recognition

/** Chromium ships it prefixed to this day; the unprefixed name is what the spec draft calls it. */
function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor
    webkitSpeechRecognition?: RecognitionCtor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Nothing to subscribe to: a browser does not grow the API while the page is open. */
const noSubscribe = (): (() => void) => () => {}
const supportedOnClient = (): boolean => recognitionCtor() !== null
/** The server, and the first client render: never offer it, so the two renders match exactly. */
const supportedOnServer = (): boolean => false

/**
 * The merge rule, in one place: dictated words are appended to what is already in the box, with a
 * single space between, and never past the field's own cap (the working diagnosis is 80
 * characters by zod, and a save that the microphone made too long would be refused).
 */
export function appendDictated(current: string, text: string, max?: number): string {
  const addition = text.trim()
  if (!addition) return current
  const base = current.replace(/\s+$/, '')
  const merged = base ? `${base} ${addition}` : addition
  return max == null ? merged : merged.slice(0, max)
}

export function DictationButton({
  onText,
  disabled,
  className = '',
}: {
  /** Called with each final transcript. The caller merges it into the value it owns. */
  onText: (text: string) => void
  disabled?: boolean
  className?: string
}) {
  const supported = useSyncExternalStore(noSubscribe, supportedOnClient, supportedOnServer)
  const [listening, setListening] = useState(false)
  const recognition = useRef<Recognition | null>(null)

  // The callback the recogniser will use, kept current without re-creating the recogniser: the
  // editor hands a new closure on every keystroke, and re-binding a live recogniser to it would
  // end the session mid-sentence.
  const sink = useRef(onText)
  useEffect(() => {
    sink.current = onText
  }, [onText])

  // Leaving the page, or the field being disabled underneath it, must stop the microphone.
  useEffect(
    () => () => {
      recognition.current?.abort()
      recognition.current = null
    },
    [],
  )

  const stop = useCallback((): void => {
    recognition.current?.stop()
    recognition.current = null
    setListening(false)
  }, [])

  const start = useCallback((): void => {
    const Ctor = recognitionCtor()
    if (!Ctor) return
    const session = new Ctor()
    session.lang = navigator.language || 'en-US'
    // Continuous, final results only: a nurse dictating a reason speaks in phrases with pauses in
    // them, and interim results would write the same words two and three times over.
    session.continuous = true
    session.interimResults = false
    session.onresult = (event) => {
      let text = ''
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const result = event.results[i]
        if (result?.isFinal) text += result[0]?.transcript ?? ''
      }
      if (text.trim()) sink.current(text)
    }
    // A denied permission, a lost network (the recogniser is a server call in Chrome) and a
    // silence timeout all land here or in `onend`. Either way the button goes back to idle
    // rather than sitting pressed over a microphone that stopped listening minutes ago.
    session.onend = () => {
      recognition.current = null
      setListening(false)
    }
    session.onerror = () => {
      recognition.current = null
      setListening(false)
    }
    recognition.current = session
    setListening(true)
    session.start()
  }, [])

  useEffect(() => {
    if (disabled && recognition.current) stop()
  }, [disabled, stop])

  if (!supported) return null

  return (
    <button
      type="button"
      data-dictate={listening ? 'listening' : 'idle'}
      aria-label={listening ? 'Stop dictating' : 'Dictate'}
      aria-pressed={listening}
      disabled={disabled}
      onClick={() => (listening ? stop() : start())}
      className={`inline-flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-button border disabled:opacity-60 ${
        listening ? 'border-accent bg-accent-soft text-accent-ink' : 'border-line bg-panel text-ink-2'
      } ${className}`}
    >
      {listening ? <MicOff size={20} /> : <Mic size={20} />}
    </button>
  )
}

/**
 * A free-text control with the microphone beside it. A flex row rather than a button floating
 * over the input: where the API is absent the button renders nothing and the control keeps the
 * whole width, with no reserved gap for a control that will never appear.
 */
export function DictationRow({
  onText,
  disabled,
  children,
}: {
  onText: (text: string) => void
  disabled?: boolean
  children: ReactNode
}) {
  return (
    <div className="flex items-start gap-1.5">
      <div className="min-w-0 flex-1">{children}</div>
      <DictationButton onText={onText} disabled={disabled} />
    </div>
  )
}
