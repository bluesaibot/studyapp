export const MEDIA_SCHEME = 'studyapp-media'

export function mediaUrl(courseId: number, path: string): string {
  // A fixed host, because browsers read a bare number there as an IP address.
  return `${MEDIA_SCHEME}://course/${courseId}/${path.split('/').map(encodeURIComponent).join('/')}`
}
