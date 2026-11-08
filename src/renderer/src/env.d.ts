/// <reference types="vite/client" />
import type { StudyApi } from '../../shared/api'

declare global {
  interface Window {
    api: StudyApi
  }
}
