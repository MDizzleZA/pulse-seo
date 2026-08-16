import type { PulseApi } from '../../preload/index';

declare global {
  interface Window {
    pulse: PulseApi;
  }
}

export {};
