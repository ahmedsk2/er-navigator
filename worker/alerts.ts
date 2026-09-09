/**
 * The threshold alerts worker (locked plan section 6, Phase 6 spec).
 *
 * Its own process, its own container, no inbound traffic: every `ALERT_INTERVAL_MINUTES` it scans
 * the OPEN cases, records an Alert for each threshold newly crossed, appends the system user's
 * "Reached {t}h threshold" update, writes the `alert.fire` audit row, and emails the active
 * supervisors and admins from 6 h up. Everything that decides anything lives in
 * `src/lib/alerts/*` behind ports, so the rule is unit tested with an injected clock and a fake
 * mailer; this file is the plumbing: environment, loop, overlap protection, heartbeat, signals.
 *
 * esbuild bundles it to `dist/worker.js` in the Docker build stage and the runner image runs
 * `node worker.js`. There is no TypeScript and no package manager at runtime.
 *
 * Two ways to run it by hand:
 *   node worker.js               the loop
 *   node worker.js --test <to>   one message to that address, prints the SMTP response
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { runAlertCycle, type Logger } from '../src/lib/alerts/cycle'
import { parseRecipientMap } from '../src/lib/alerts/email'
import { readSmtpConfig, smtpMailer } from '../src/lib/alerts/smtp'
import { prismaAlertStore, requireSystemUserId } from '../src/lib/alerts/store'
import { SYSTEM_USERNAME } from '../src/lib/auth/system-user'
import { prisma } from '../src/lib/db'

const DEFAULT_INTERVAL_MINUTES = 5
const DEFAULT_HEARTBEAT_FILE = '/tmp/heartbeat'

const logger: Logger = {
  info: (message, detail) => console.log(message, detail === undefined ? '' : detail),
  warn: (message, detail) => console.warn(message, detail === undefined ? '' : detail),
  error: (message, detail) => console.error(message, detail === undefined ? '' : detail),
}

type Config = {
  intervalMs: number
  heartbeatFile: string
  appUrl: string
}

function readConfig(env: NodeJS.ProcessEnv): Config {
  const minutes = Number(env.ALERT_INTERVAL_MINUTES ?? DEFAULT_INTERVAL_MINUTES)
  return {
    intervalMs: (Number.isFinite(minutes) && minutes > 0 ? minutes : DEFAULT_INTERVAL_MINUTES) * 60_000,
    heartbeatFile: env.ALERT_HEARTBEAT_FILE?.trim() || DEFAULT_HEARTBEAT_FILE,
    appUrl: env.APP_URL?.trim() || 'https://nav.towardpcc.com',
  }
}

/** Touched at the end of every cycle; the container healthcheck reads its mtime. */
function heartbeat(file: string): void {
  try {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, `${new Date().toISOString()}\n`)
  } catch (error) {
    logger.warn('[alerts] could not write the heartbeat file', { file, error: String(error) })
  }
}

// --- --test -----------------------------------------------------------------------------------

async function sendTestMessage(to: string): Promise<number> {
  const smtp = readSmtpConfig(process.env)
  if (!smtp) {
    logger.error('[alerts] --test needs SMTP_HOST; it is empty, so nothing was sent.')
    return 1
  }
  const mailer = smtpMailer(smtp)
  const stamp = new Date().toISOString()
  try {
    const result = await mailer.send({
      to: [to],
      subject: 'ER Navigator: SMTP test',
      text: `Test message from the ER Navigator alerts worker at ${stamp}. Nothing is wrong.`,
      html: `<p>Test message from the ER Navigator alerts worker at ${stamp}. Nothing is wrong.</p>`,
    })
    console.log('[alerts] SMTP response:', result.response)
    console.log('[alerts] message id:', result.messageId)
    console.log('[alerts] accepted:', result.accepted.join(', ') || '(none)')
    console.log('[alerts] rejected:', result.rejected.join(', ') || '(none)')
    console.log(
      '[alerts] check the received headers for dkim=pass and dmarc=pass before enabling alerts.',
    )
    return result.accepted.length > 0 ? 0 : 1
  } catch (error) {
    logger.error('[alerts] test message failed', String(error))
    return 1
  }
}

// --- the loop ---------------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const testFlag = args.indexOf('--test')
  if (testFlag !== -1) {
    const to = args[testFlag + 1]
    if (!to) {
      logger.error('[alerts] usage: node worker.js --test <address>')
      process.exitCode = 1
      return
    }
    process.exitCode = await sendTestMessage(to)
    await prisma.$disconnect()
    return
  }

  const config = readConfig(process.env)
  const smtp = readSmtpConfig(process.env)
  const mailer = smtp ? smtpMailer(smtp) : null
  const directory = parseRecipientMap(process.env.ALERT_EMAIL_MAP)
  const systemUserId = await requireSystemUserId(SYSTEM_USERNAME)
  const store = prismaAlertStore(systemUserId)

  logger.info('[alerts] worker started', {
    intervalMinutes: config.intervalMs / 60_000,
    email: mailer ? `smtp ${smtp?.host}:${smtp?.port}` : 'log only (SMTP_HOST empty)',
    directoryEntries: directory.size,
  })

  let running = false
  let stopping = false

  const cycle = async (): Promise<void> => {
    if (running || stopping) return
    running = true
    try {
      const summary = await runAlertCycle({
        store,
        mailer,
        addressOf: (username) => directory.get(username) ?? null,
        logger,
        now: new Date(),
        appUrl: config.appUrl,
      })
      logger.info('[alerts] cycle done', summary)
    } catch (error) {
      // One bad cycle must never take the worker down: it runs again on the next tick.
      logger.error('[alerts] cycle failed', String(error))
    } finally {
      heartbeat(config.heartbeatFile)
      running = false
    }
  }

  await cycle()
  const timer = setInterval(() => void cycle(), config.intervalMs)

  const stop = (signal: string): void => {
    logger.info(`[alerts] ${signal} received, stopping`)
    stopping = true
    clearInterval(timer)
    void prisma.$disconnect().finally(() => process.exit(0))
  }
  process.on('SIGTERM', () => stop('SIGTERM'))
  process.on('SIGINT', () => stop('SIGINT'))
}

void main().catch(async (error) => {
  logger.error('[alerts] worker could not start', String(error))
  await prisma.$disconnect().catch(() => undefined)
  process.exit(1)
})
