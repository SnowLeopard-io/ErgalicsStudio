// Type declarations for the native-esm.js test fixture (allowJs is off; this
// sibling declaration keeps tsc happy while vitest loads the real module).
export declare function setInitBehavior(options?: { failTimes?: number }): Promise<void>;
export declare function core_version(): string;
export declare function detect_file_kind(prefix: Uint8Array): number | undefined;
export declare function log(message: string): void;
export declare function __fixtureInitCalls(): number;
export default function init(): Promise<void>;
