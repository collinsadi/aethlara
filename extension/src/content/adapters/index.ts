import { detectAts } from '../detect'
import { ashbyAdapter } from './ashby'
import { genericAdapter } from './generic'
import { greenhouseAdapter } from './greenhouse'
import { leverAdapter } from './lever'
import type { Adapter } from './types'

export type { Adapter } from './types'
export { genericAdapter }

/**
 * Adapter for the page we are on. The current URL decides (the application's
 * `ats` hint can point at an ATS whose form is embedded on another site, in
 * which case the generic adapter finds and opens it).
 */
export function adapterFor(url: string): Adapter {
  switch (detectAts(url)) {
    case 'greenhouse':
      return greenhouseAdapter
    case 'lever':
      return leverAdapter
    case 'ashby':
      return ashbyAdapter
    default:
      return genericAdapter
  }
}
