import type { ApiType, MainTransport } from "./index";

declare global {
  interface Window {
    api: ApiType;
    mainTransport: MainTransport;
  }
}

export {};
