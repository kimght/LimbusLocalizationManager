export class SoundManager<Assets extends Record<string, string>> {
  public assets: Assets;
  public volume: number = 0.5;

  private audioContext: AudioContext;
  private audioBuffers: Record<keyof Assets, AudioBuffer>;
  private masterGainNode: GainNode;

  constructor(assets: Assets, volume: number = 0.5) {
    this.assets = assets;
    this.volume = volume;

    this.audioContext = new AudioContext();
    this.masterGainNode = this.audioContext.createGain();
    this.masterGainNode.gain.value = volume;
    this.masterGainNode.connect(this.audioContext.destination);

    this.audioBuffers = {} as Record<keyof Assets, AudioBuffer>;
  }

  public async preload(): Promise<void> {
    await Promise.all(
      Object.entries(this.assets).map(async ([key, value]) => {
        const response = await fetch(value);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer =
          await this.audioContext.decodeAudioData(arrayBuffer);

        this.audioBuffers[key as keyof Assets] = audioBuffer;
      })
    );
  }

  public setVolume(volume: number) {
    this.volume = volume;
    this.masterGainNode.gain.value = volume;
  }

  public play(
    assetId: keyof Assets,
    options: Partial<{
      playbackRate: number;
      volume: number;
    }> = {}
  ) {
    const buffer = this.audioBuffers[assetId];

    if (!buffer) {
      throw new Error(`Audio buffer not found for assetId: ${String(assetId)}`);
    }

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = options.playbackRate ?? 1;

    let gainNode: GainNode = this.masterGainNode;
    if (options.volume !== undefined) {
      gainNode = this.audioContext.createGain();
      gainNode.gain.value = options.volume;
      gainNode.connect(this.masterGainNode);
    }

    source.connect(gainNode);
    source.start(0);

    return source;
  }
}
