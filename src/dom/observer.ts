/**
 * ThreadMax — MutationObserver Wrapper
 * Safe, debounced, batchable observer with pause/resume and modal-aware gating.
 */

export interface ObserverConfig {
  /** Debounce delay in ms before firing callback */
  debounceMs: number;
  /** Max mutations to batch before forced flush */
  maxBatchSize: number;
  /** Callback when mutations are processed */
  onMutations: (mutations: MutationRecord[]) => void;
  /** Optional filter: return true to process this mutation */
  filter?: (mutation: MutationRecord) => boolean;
  /** Optional: pause observer when this returns true (e.g., modal open) */
  pauseWhen?: () => boolean;
}

interface ScheduledWork {
  mutations: MutationRecord[];
  timer: ReturnType<typeof setTimeout>;
}

export class MutationWatcher {
  private observer: MutationObserver | null = null;
  private config: ObserverConfig;
  private scheduled: ScheduledWork | null = null;
  private isPaused = false;
  private isDestroyed = false;

  constructor(config: ObserverConfig) {
    const { debounceMs = 250, maxBatchSize = 100, filter = () => true, pauseWhen = () => false, onMutations } = config;
    this.config = { debounceMs, maxBatchSize, filter, pauseWhen, onMutations };
  }

  /** Start observing the target node */
  observe(target: Node = document.body, options: MutationObserverInit = { childList: true, subtree: true }): void {
    if (this.observer) return;

    this.observer = new MutationObserver((mutations) => this.onMutations(mutations));
    this.observer.observe(target, options);
  }

  /** Stop observing and clear pending work */
  disconnect(): void {
    if (this.scheduled) {
      clearTimeout(this.scheduled.timer);
      this.scheduled = null;
    }
    this.observer?.disconnect();
    this.observer = null;
  }

  /** Fully destroy — cannot be reused after this */
  destroy(): void {
    this.disconnect();
    this.isDestroyed = true;
  }

  /** Pause mutation processing (e.g., during live capture modal) */
  pause(): void {
    this.isPaused = true;
  }

  /** Resume mutation processing */
  resume(): void {
    this.isPaused = false;
    // If we have pending work and auto-pause condition cleared, flush
    if (this.scheduled && !this.config.pauseWhen?.()) {
      this.flush();
    }
  }

  /** Check if currently paused */
  get paused(): boolean {
    return this.isPaused || (this.config.pauseWhen?.() ?? false);
  }

  /** Update config at runtime */
  setConfig(partial: Partial<ObserverConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  private onMutations(mutations: MutationRecord[]): void {
    if (this.isDestroyed) return;

    // Check pause condition (modal open, live capture, etc.)
    if (this.config.pauseWhen?.()) {
      return; // Drop mutations while paused
    }

    // Filter mutations
    const relevant = mutations.filter(m => this.config.filter?.(m) ?? true);
    if (relevant.length === 0) return;

    // Batch: accumulate or flush if at max
    if (this.scheduled) {
      this.scheduled.mutations.push(...relevant);
      if (this.scheduled.mutations.length >= this.config.maxBatchSize) {
        this.flush();
      }
      return;
    }

    // Schedule debounced flush
    this.scheduled = {
      mutations: relevant,
      timer: setTimeout(() => this.flush(), this.config.debounceMs),
    };
  }

  private flush(): void {
    if (!this.scheduled || this.isDestroyed) return;
    if (this.config.pauseWhen?.()) {
      // Still paused — reschedule
      this.scheduled.timer = setTimeout(() => this.flush(), this.config.debounceMs);
      return;
    }

    const { mutations } = this.scheduled;
    this.scheduled = null;

    try {
      this.config.onMutations(mutations);
    } catch (err) {
      console.error('[ThreadMax] MutationWatcher callback error:', err);
      // Exponential backoff on error
      setTimeout(() => {
        if (!this.isDestroyed && !this.config.pauseWhen?.()) {
          this.config.onMutations(mutations);
        }
      }, 1000);
    }
  }
}

/** Factory for the standard feed scan watcher */
export function createFeedScanWatcher(
  onScan: () => void,
  options: {
    debounceMs?: number;
    pauseWhen?: () => boolean;
  } = {}
): MutationWatcher {
  return new MutationWatcher({
    debounceMs: options.debounceMs ?? 250,
    maxBatchSize: 50,
    pauseWhen: options.pauseWhen,
    filter: (m) => m.type === 'childList' && m.addedNodes.length > 0,
    onMutations: () => onScan(),
  });
}

/** Factory for modal-aware watcher (e.g., auditor live capture) */
export function createModalWatcher(
  onChange: (mutations: MutationRecord[]) => void,
  options: {
    debounceMs?: number;
    pauseWhen?: () => boolean;
  } = {}
): MutationWatcher {
  return new MutationWatcher({
    debounceMs: options.debounceMs ?? 150,
    maxBatchSize: 200,
    pauseWhen: options.pauseWhen,
    filter: (m) => m.type === 'childList' || m.type === 'attributes',
    onMutations: onChange,
  });
}