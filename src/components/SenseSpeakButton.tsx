import { Icon } from './Icon'
import { pronounce } from '../lib/pronounce'
import { speak } from '../lib/tts'
import type { SenseVoice } from '../lib/sensePronounce'

/**
 * The speaker on a single sense of a heteronym.
 *
 * Never decides whether a button is warranted — it renders the voice it is
 * handed, and senseVoices in lib/sensePronounce.ts is the only thing that
 * hands one out. On all but two of the library's 523 words it is never
 * rendered at all.
 *
 * The 合成 tag is not decoration, and it is text rather than a colour or a
 * second icon on purpose. One of the two buttons on a heteronym is a person
 * reading the word; the other is a speech synthesizer reading a respelling
 * somebody typed. How far to trust what you just heard differs between them,
 * and the learner is the one who has to make that call.
 *
 * stopPropagation is load-bearing rather than defensive: on the back of a
 * review card the entire Card is a click-to-flip target (Review.tsx), so
 * without it, tapping a pronunciation flips the card away from the meaning
 * you were reading.
 */
export function SenseSpeakButton({ voice, headword, pos }: {
  voice: SenseVoice
  headword: string
  pos: string
}) {
  const synth = voice.kind === 'synth'
  return (
    <button
      type="button"
      className="sense-speak"
      aria-label={`朗读 ${headword} 的 ${pos} 读音${synth ? '(合成语音)' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        if (synth) speak(voice.text)
        else pronounce(voice.text)
      }}
    >
      <Icon name="speak" size={16} />
      {synth && <span className="sense-speak__tag">合成</span>}
    </button>
  )
}
