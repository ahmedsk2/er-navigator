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
type RecognitionErrorEvent = { error?: string }
type Recognition = {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult: ((event: RecognitionEvent) => void) | null
  onend: (() => void) | null
  onerror: ((event: RecognitionErrorEvent) => void) | null
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
 * single space between, and never past the field's own cap — every caller passes its box's zod
 * cap from validation.ts, because a save that the microphone made too long would be refused.
 */
export function appendDictated(current: string, text: string, max?: number): string {
  const addition = text.trim()
  if (!addition) return current
  const base = current.replace(/\s+$/, '')
  const merged = base ? `${base} ${addition}` : addition
  return max == null ? merged : merged.slice(0, max)
}

const BLOCKED_LINE =
  'The browser has blocked the microphone for this site. Allow it in the site settings, or type instead.'

/**
 * The one line a failed session leaves under its row, by the recogniser's error code. A blocked
 * microphone used to be silent: the button flipped to "Stop dictating" and straight back, and a
 * nurse who had once refused the prompt was left tapping it. The codes that name something she
 * can act on get a line; "aborted" (the page stopping its own session) and any code not listed
 * here get none, because a line that explains nothing is worse than no line.
 *
 * "network" says the speech service could not be reached, not that the phone is offline: a
 * Chromium build without Google's speech service (Playwright's own, some forks) fails every
 * session with it on a working connection, and "needs a network connection" sent the nurse to
 * check a wifi that was fine.
 */
export function dictationErrorLine(code: string | undefined): string | null {
  switch (code) {
    case 'not-allowed':
    case 'service-not-allowed':
      return BLOCKED_LINE
    case 'audio-capture':
      return 'No microphone was found on this device.'
    case 'network':
      return 'Dictation could not reach the speech service. Check the connection, or type instead.'
    case 'no-speech':
      return 'Nothing was heard. Tap the microphone and speak again.'
    default:
      return null
  }
}

export function DictationButton({
  onText,
  onStatus,
  disabled,
  className = '',
}: {
  /** Called with each final transcript. The caller merges it into the value it owns. */
  onText: (text: string) => void
  /**
   * Called with the line to show when a session fails (`dictationErrorLine`), and with null when
   * a new session starts or words arrive. `DictationRow` owns the line, so every box gets it.
   */
  onStatus?: (line: string | null) => void
  disabled?: boolean
  className?: string
}) {
  const supported = useSyncExternalStore(noSubscribe, supportedOnClient, supportedOnServer)
  const [listening, setListening] = useState(false)
  const recognition = useRef<Recognition | null>(null)

  // The callbacks the recogniser will use, kept current without re-creating the recogniser: the
  // editor hands a new closure on every keystroke, and re-binding a live recogniser to it would
  // end the session mid-sentence.
  /**
   * The last session started, which `stop()` does not clear. `recognition` is the one listening
   * now; this is the one whose news the row is still waiting for.
   */
  const latest = useRef<Recognition | null>(null)
  const sink = useRef(onText)
  const report = useRef(onStatus)
  useEffect(() => {
    sink.current = onText
    report.current = onStatus
  }, [onText, onStatus])

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
      if (text.trim()) {
        report.current?.(null)
        sink.current(text)
      }
    }
    // A denied permission, a lost network (the recogniser is a server call in Chrome) and a
    // silence timeout all land here or in `onend`. Either way the button goes back to idle
    // rather than sitting pressed over a microphone that stopped listening minutes ago, and an
    // error says why in the line under the row.
    //
    // Only the current session may turn the button back, though. `stop()` lets go of it at once,
    // but its own error and end arrive later, and a quick second tap has started another session
    // by then: an ending that did not check whose it was turned the button back to "Dictate" over
    // a microphone that was still listening. Its error line is held to a looser rule: it is said
    // unless a newer session has started, because a session the nurse stopped herself that then
    // fails to reach the speech service hands back no words, and that is when she needs to know
    // why. `onresult` is not held to either: the words a stopped session hands back were spoken
    // before the tap, and belong in the box.
    session.onend = () => {
      if (recognition.current !== session) return
      recognition.current = null
      setListening(false)
    }
    session.onerror = (event) => {
      if (latest.current !== session) return
      if (recognition.current === session) {
        recognition.current = null
        setListening(false)
      }
      report.current?.(dictationErrorLine(event.error))
    }
    recognition.current = session
    latest.current = session
    setListening(true)
    report.current?.(null)
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
 *
 * The row owns the line a failed session leaves, under the control and announced as a status, so
 * every box with a microphone says why it stopped. The wrapper is `flex-1` for the one box that
 * sits in a flex row of its own ("What changed?", beside Add): sized by its content, it left that
 * box at the input's default width and would have widened it when the line appeared.
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
  const [status, setStatus] = useState<string | null>(null)
  return (
    <div className="min-w-0 flex-1">
      <div className="flex items-start gap-1.5">
        <div className="min-w-0 flex-1">{children}</div>
        <DictationButton onText={onText} onStatus={setStatus} disabled={disabled} />
      </div>
      {status ? (
        <p role="status" data-dictate-status className="mt-1.5 text-caption text-band-h4-ink">
          {status}
        </p>
      ) : null}
    </div>
  )
}
