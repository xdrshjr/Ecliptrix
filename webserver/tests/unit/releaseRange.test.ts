import { describe, expect, it } from 'vitest'
import {
  contentRangeHeader,
  parseByteRange,
  unsatisfiedRangeHeader,
} from '@/server/services/releaseRange'

/**
 * The `Range` boundary table (analysis R-6(b)).
 *
 * `webserver/` had no Range implementation before the installer endpoint, and
 * every row below is a real request shape: a download manager resuming with
 * `0-1023`, then `N-2048-`, then `-500`, then an out-of-date offset after the file
 * was replaced. Getting one wrong is either a corrupt installer or a 500.
 */

const SIZE = 4096

describe('parseByteRange', () => {
  it('treats a missing header as a full response', () => {
    expect(parseByteRange(null, SIZE)).toEqual({ kind: 'full' })
    expect(parseByteRange(undefined, SIZE)).toEqual({ kind: 'full' })
    expect(parseByteRange('', SIZE)).toEqual({ kind: 'full' })
  })

  it('parses a prefix range and keeps the length of the slice', () => {
    expect(parseByteRange('bytes=0-1023', SIZE)).toEqual({ kind: 'partial', start: 0, end: 1023 })
  })

  it('parses an open-ended range up to the last byte', () => {
    expect(parseByteRange('bytes=2048-', SIZE)).toEqual({
      kind: 'partial',
      start: 2048,
      end: SIZE - 1,
    })
  })

  it('parses a suffix range into the last n bytes', () => {
    expect(parseByteRange('bytes=-500', SIZE)).toEqual({
      kind: 'partial',
      start: SIZE - 500,
      end: SIZE - 1,
    })
  })

  it('clamps a suffix longer than the file to the whole file', () => {
    expect(parseByteRange('bytes=-999999', SIZE)).toEqual({ kind: 'partial', start: 0, end: SIZE - 1 })
  })

  it('clamps an end beyond the file instead of failing', () => {
    expect(parseByteRange('bytes=4000-999999', SIZE)).toEqual({
      kind: 'partial',
      start: 4000,
      end: SIZE - 1,
    })
  })

  // 416, not an empty 206 and not a 500: the RFC says so, and a downloader retrying
  // an offset past the end must be told to restart rather than left hanging.
  it('marks a start at or past the end as unsatisfiable', () => {
    expect(parseByteRange(`bytes=${SIZE}-`, SIZE)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange(`bytes=${SIZE + 10}-${SIZE + 20}`, SIZE)).toEqual({ kind: 'unsatisfiable' })
    expect(parseByteRange('bytes=-0', SIZE)).toEqual({ kind: 'unsatisfiable' })
  })

  // Multi-range would need multipart/byteranges; ignoring the header is legal and
  // is what every other server does in practice.
  it('ignores a multi-range request', () => {
    expect(parseByteRange('bytes=0-1,5-6', SIZE)).toEqual({ kind: 'full' })
  })

  it('ignores a malformed range header rather than answering 400', () => {
    for (const header of ['bytes=abc', 'bytes=', 'items=0-10', 'bytes=5-1', 'bytes=1-2-3']) {
      expect(parseByteRange(header, SIZE), header).toEqual({ kind: 'full' })
    }
  })

  it('tolerates whitespace and upper case', () => {
    expect(parseByteRange('Bytes = 0-9', SIZE)).toEqual({ kind: 'partial', start: 0, end: 9 })
  })

  it('reports unsatisfiable for an empty representation', () => {
    expect(parseByteRange('bytes=0-0', 0)).toEqual({ kind: 'unsatisfiable' })
  })
})

describe('range headers', () => {
  it('builds Content-Range for a partial response', () => {
    expect(contentRangeHeader(0, 1023, SIZE)).toBe('bytes 0-1023/4096')
  })

  it('builds the star form for a 416', () => {
    expect(unsatisfiedRangeHeader(SIZE)).toBe('bytes */4096')
  })
})
