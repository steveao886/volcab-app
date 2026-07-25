export function speak(text: string): void {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'en-US'
  u.rate = 0.9
  const voice = window.speechSynthesis.getVoices().find(v => v.lang.startsWith('en'))
  if (voice) u.voice = voice
  window.speechSynthesis.speak(u)
}
