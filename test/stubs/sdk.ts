// Test double for the host-provided "@kirocrew/app-sdk". It mirrors only the hooks
// the Graveyard page calls, with the same shapes (see docs/app-kit/api-reference.md).
export interface ChatLaunchOptions {
  agent?: string;
  message?: string;
  slotKey?: string;
  autoSend?: boolean;
}

export interface FakeHost {
  get: (path: string) => Promise<unknown>;
  openChat: (opts?: ChatLaunchOptions) => void;
  active: boolean | undefined;
}

export const host: FakeHost = {
  get: async () => ({}),
  openChat: () => undefined,
  active: true,
};

export function useAppApi() {
  return { get: <T,>(path: string) => host.get(path) as Promise<T> };
}

export function useAppInfo(): { active?: boolean } {
  return { active: host.active };
}

export function useChatLauncher() {
  return { openChat: (opts?: ChatLaunchOptions) => host.openChat(opts) };
}
