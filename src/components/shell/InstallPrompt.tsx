'use client'

/**
 * The install banner on the board (Phase 7, locked plan section 8 item 10).
 *
 * Two browsers, two behaviours:
 *  - Chrome and Edge on Android fire `beforeinstallprompt`. The event is kept, the banner offers
 *    "Install", and the tap calls `prompt()` — a browser requirement: it must happen inside a
 *    user gesture, which is why the event cannot simply be prompted on arrival.
 *  - iOS Safari fires nothing and has no API. It gets one line telling the nurse where the
 *    control actually is (Share, then "Add to Home Screen"), shown only when the page is in a
 *    Safari tab rather than an already-installed window.
 *
 * Dismissal is remembered in localStorage. That is allowed here and only here: the locked plan
 * section 9 forbids localStorage for CASE data, and this is a UI preference about a banner —
 * nothing about a patient touches it. The key is versioned so a future change can ask again.
 *
 * Every browser-only fact (is it installed, was it dismissed, is this Safari) is read through
 * `useSyncExternalStore` rather than in an effect: the server and the first client render must
 * agree, and setting state from an effect body is what causes the cascading render React now
 * warns about. It renders nothing on a desktop browser with no install event, on a device where
 * it was dismissed, and inside the installed app.
 */
import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

const DISMISSED_KEY = 'ern.installBanner.dismissed.v1'

/** The half of `BeforeInstallPromptEvent` this component uses; TypeScript's DOM lib has none. */
type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

/** Nothing to subscribe to: these facts do not change while the page is open. */
const noSubscribe = (): (() => void) => () => {}

function alreadyDismissed(): boolean {
  try {
    return window.localStorage.getItem(DISMISSED_KEY) === '1'
  } catch {
    // Private mode, or storage blocked by policy: show the banner rather than crash the board.
    return false
  }
}

function remember(): void {
  try {
    window.localStorage.setItem(DISMISSED_KEY, '1')
  } catch {
    // Nothing to do: it will be offered again next time, which is the harmless failure.
  }
}

/** Standalone means it is already installed, so there is nothing to offer. */
function isInstalled(): boolean {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    // iOS Safari's own flag, which predates display-mode and is still what it sets.
    (window.navigator as Navigator & { standalone?: boolean }).standalone === true
  )
}

function isIosSafari(): boolean {
  const ua = window.navigator.userAgent
  const ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/.test(ua) && window.navigator.maxTouchPoints > 1)
  // Chrome and Firefox on iOS are Safari underneath but do not offer Add to Home Screen.
  return ios && /safari/i.test(ua) && !/crios|fxios|edgios/i.test(ua)
}

const suppressedOnClient = (): boolean => isInstalled() || alreadyDismissed()
/** The server, and the first client render: never offer anything, so the two renders match. */
const suppressedOnServer = (): boolean => true
const iosOnServer = (): boolean => false

export function InstallPrompt() {
  const [event, setEvent] = useState<InstallEvent | null>(null)
  const [dismissed, setDismissed] = useState(false)
  const suppressed = useSyncExternalStore(noSubscribe, suppressedOnClient, suppressedOnServer)
  const iosSafari = useSyncExternalStore(noSubscribe, isIosSafari, iosOnServer)

  useEffect(() => {
    const onBeforeInstall = (e: Event): void => {
      // Keeping the event is the whole point; without this the browser shows its own mini-bar
      // and the nurse has to find it. preventDefault() is what hands us the moment.
      e.preventDefault()
      setEvent(e as InstallEvent)
    }
    const onInstalled = (): void => setEvent(null)
    window.addEventListener('beforeinstallprompt', onBeforeInstall)
    window.addEventListener('appinstalled', onInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', onBeforeInstall)
      window.removeEventListener('appinstalled', onInstalled)
    }
  }, [])

  const dismiss = useCallback((): void => {
    remember()
    setEvent(null)
    setDismissed(true)
  }, [])

  const install = useCallback(async (): Promise<void> => {
    if (!event) return
    await event.prompt()
    await event.userChoice
    // Either way the browser will not offer this event again, so the banner is done.
    remember()
    setEvent(null)
    setDismissed(true)
  }, [event])

  if (suppressed || dismissed) return null
  if (!event && !iosSafari) return null

  return (
    <section
      data-install-banner={event ? 'prompt' : 'ios'}
      aria-label="Install ER Navigator"
      className="no-print mx-4 mt-3 mb-2.5 flex items-start gap-3 rounded-card border border-accent bg-accent-soft p-3"
    >
      <div className="min-w-0 flex-1">
        <p className="text-section">Add ER Navigator to this phone</p>
        {event ? (
          <p className="mt-1 text-caption text-ink-2">
            It opens full screen from the home screen, like an app. Nothing is stored on the phone.
          </p>
        ) : (
          <p className="mt-1 text-caption text-ink-2">
            In Safari, tap Share, then “Add to Home Screen”. Nothing is stored on the phone.
          </p>
        )}
        {event ? (
          <button
            type="button"
            onClick={() => void install()}
            className="mt-2 min-h-11 rounded-button bg-accent px-4 text-body font-semibold text-white"
          >
            Install
          </button>
        ) : null}
      </div>
      {/* The label starts with the visible words: an accessible name that does not contain the
          text on the button is a WCAG 2.5.3 failure, and axe flags it. */}
      <button
        type="button"
        onClick={dismiss}
        aria-label="Not now — dismiss the install suggestion"
        className="min-h-11 min-w-11 shrink-0 rounded-button border border-line bg-panel px-3 text-body font-semibold text-ink"
      >
        Not now
      </button>
    </section>
  )
}
