declare module 'bwip-js' {
  export interface ToBufferOptions {
    bcid: string;
    text: string;
    scale?: number;
    height?: number;
    includetext?: boolean;
  }

  export function toBuffer(options: ToBufferOptions): Promise<Buffer>;
}
