import { ImageResponse } from 'next/og'

/**
 * Social card, generated from code.
 *
 * No bundled font and no text node on purpose: `ImageResponse` needs a font file
 * to render text, and fetching one from the network at render time would make the
 * card depend on an external host (and fail offline). The composition below is
 * pure layout over the brand tokens, so it renders identically everywhere.
 */
export const alt = 'Ecliptrix'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const FIELDS = Array.from({ length: 34 }, (_, index) => index)

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          background: '#050506',
          padding: 72,
          position: 'relative',
        }}
      >
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            backgroundImage:
              'radial-gradient(circle at 18% 8%, rgba(62,207,142,0.22), transparent 42%), radial-gradient(circle at 88% 92%, rgba(94,106,210,0.20), transparent 46%)',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: 56,
              height: 56,
              borderRadius: 14,
              background: '#3ecf8e',
            }}
          >
            <div style={{ display: 'flex', width: 22, height: 22, borderRadius: 6, background: '#050506' }} />
          </div>
          <div style={{ display: 'flex', width: 220, height: 20, borderRadius: 6, background: '#1d1d22' }} />
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <div style={{ display: 'flex', width: 760, height: 46, borderRadius: 8, background: '#e6e6e9' }} />
          <div style={{ display: 'flex', width: 540, height: 46, borderRadius: 8, background: '#e6e6e9' }} />
          <div style={{ display: 'flex', width: 620, height: 18, borderRadius: 6, background: '#2a2a31' }} />
        </div>

        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 120 }}>
          {FIELDS.map((index) => (
            <div
              key={index}
              style={{
                display: 'flex',
                width: 24,
                height: 24 + ((index * 17) % 76),
                borderRadius: 4,
                background: index % 5 === 0 ? '#3ecf8e' : '#22222a',
              }}
            />
          ))}
        </div>
      </div>
    ),
    size,
  )
}
