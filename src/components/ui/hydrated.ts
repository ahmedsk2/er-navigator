'use client'

import { useSyncExternalStore } from 'react'

const subscribe = (): (() => void) => () => {}
const onClient = (): boolean => true
const onServer = (): boolean => false

/**
 * False while the server renders and during the first client render, true afterwards.
 *
 * Every `datetime-local` value is formatted in the *browser's* zone, which the server cannot
 * know. Rendering those inputs empty until the component has hydrated is what keeps the two
 * renders identical — without it a UTC server and an Asia/Riyadh phone disagree by three hours
 * and React either warns or, worse, keeps the server's wrong time on screen.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, onClient, onServer)
}
