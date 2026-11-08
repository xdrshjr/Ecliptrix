import nodemailer, { type Transporter, type SendMailOptions } from 'nodemailer'
import { getConfig } from '@/server/config'
import { log } from '@/server/http/requestContext'

/**
 * SMTP transport layer.
 *
 * Narrow on purpose: `isMailEnabled()` answers "can this deployment send at all",
 * `sendRaw()` hands one already-rendered message to the provider. Templates,
 * redaction, persistence, budgets and the state machine live in `mailService` —
 * this file must stay the only place that knows nodemailer exists.
 *
 * Why every attempt is bounded: `createTransport({ host, port, secure, auth })`
 * with no timeout settings inherits nodemailer's 1-hour `socketTimeout`. A dead
 * SMTP host then hangs whatever awaited the send; before the pipeline existed
 * that was the registration request. The three timeouts below all derive from
 * `MAIL_SEND_TIMEOUT_MS` (default 5 s), so one configuration value bounds the
 * connection, the greeting and the socket.
 */

export interface RawMail {
  to: string
  subject: string
  text: string
  html?: string
}

export type TransportResult = { ok: true } | { ok: false; errorName: string }

/** The exact options handed to nodemailer — exported so tests can assert them. */
export interface TransportOptions {
  host: string
  port: number
  secure: boolean
  auth?: { user: string; pass: string }
  connectionTimeout: number
  greetingTimeout: number
  socketTimeout: number
}

/**
 * Build the transport options from configuration.
 *
 * Pure and exported: the "transport uses the configured timeouts" test asserts on
 * this object rather than reaching into a live socket, and the settings page can
 * describe what an operator would get without opening a connection.
 */
export function transportOptions(): TransportOptions | null {
  const config = getConfig()
  if (!config.smtp.enabled || !config.smtp.host) return null
  const timeout = config.mailSendTimeoutMs
  return {
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth:
      config.smtp.user && config.smtp.password
        ? { user: config.smtp.user, pass: config.smtp.password }
        : undefined,
    connectionTimeout: timeout,
    greetingTimeout: timeout,
    socketTimeout: timeout,
  }
}

/** The `from` header, i.e. what recipients see. */
export function fromAddress(): string {
  return getConfig().smtp.from
}

let transporter: Transporter | null = null
/** Test seam: replaces the transport factory, e.g. with one that always throws. */
let factoryForTests: ((options: TransportOptions) => Transporter) | null = null

function createTransport(options: TransportOptions): Transporter {
  if (factoryForTests) return factoryForTests(options)
  return nodemailer.createTransport(options)
}

function getTransporter(): Transporter | null {
  const options = transportOptions()
  if (!options) return null
  transporter ??= createTransport(options)
  return transporter
}

/** Replace the transport factory. Tests only — pass `null` to restore. */
export function setTransportFactoryForTests(
  factory: ((options: TransportOptions) => Transporter) | null,
): void {
  factoryForTests = factory
  transporter = null
}

export function isMailEnabled(): boolean {
  return Boolean(getConfig().smtp.enabled && getConfig().smtp.host)
}

/**
 * Attempt one delivery.
 *
 * Never throws, and never returns a provider message: a nodemailer error message
 * routinely contains the SMTP host and a fragment of the account name, and both
 * end up in an outbox row that every administrator can read. The error CLASS NAME
 * is enough to tell "connection refused" from "authentication failed".
 */
export async function sendRaw(mail: RawMail): Promise<TransportResult> {
  const message: SendMailOptions = {
    from: fromAddress(),
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    html: mail.html,
  }

  try {
    // Inside the try on purpose: `createTransport` parses the URL/credentials and
    // throws on a malformed configuration. Outside it, a misconfigured deployment
    // would break the documented "never throws" contract and turn the two callers
    // that await this (admin invite, admin reset link) into a 500 with the outbox
    // row stuck at `captured`.
    const mailer = getTransporter()
    if (!mailer) return { ok: false, errorName: 'MailDisabled' }
    await mailer.sendMail(message)
    return { ok: true }
  } catch (error) {
    const errorName = error instanceof Error ? error.name || 'Error' : 'UnknownError'
    log('warn', 'smtp delivery failed', { errorName })
    return { ok: false, errorName }
  }
}
