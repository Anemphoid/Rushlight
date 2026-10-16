// The key provider for an encrypted call. LiveKit encrypts and decrypts every audio frame itself, in a worker;
// all this has to do is hand it the 32 bytes derived from the server key (crypto.js `deriveVoiceKey`) for each key
// epoch the computer holds. Everyone in the room holds the same keys, so it is a shared-key provider.
//
// Each epoch goes in its own slot of LiveKit's ring of 16 (epoch mod 16): a frame says which slot made it, so
// when a new epoch starts, people on the new key and people not yet on it can still hear each other for the moment
// it takes the last one to pick it up. The slot set last is the one this computer sends with.
import { BaseKeyProvider, createKeyMaterialFromBuffer } from 'livekit-client'

export const KEY_SLOTS = 16
export const slotFor = (epoch) => epoch % KEY_SLOTS

export class VoiceKeyProvider extends BaseKeyProvider {
  constructor() {
    // A shared key: failing to open one person's audio must not mark the key bad, and nothing is ratcheted on its own.
    super({ sharedKey: true, ratchetWindowSize: 0, failureTolerance: -1 })
  }

  // keys: [{ epoch, bytes }]. They are loaded oldest first, so by default the newest is the one sent with; `sendWithEpoch`
  // names another loaded last instead (to keep sending with an older key while a new one spreads).
  async setEpochKeys(keys, sendWithEpoch = null) {
    const ordered = [...keys].sort((a, b) => a.epoch - b.epoch)
    if (sendWithEpoch !== null) {
      const i = ordered.findIndex((k) => k.epoch === sendWithEpoch)
      if (i >= 0) ordered.push(...ordered.splice(i, 1))
    }
    for (const { epoch, bytes } of ordered) {
      this.onSetEncryptionKey(await createKeyMaterialFromBuffer(bytes), undefined, slotFor(epoch))
    }
  }

  // The epoch this provider sends with (the slot last set), or null before any key.
  get sendingSlot() {
    return this.getKeys().length ? this.getLatestManuallySetKeyIndex() : null
  }
}
