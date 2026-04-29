declare module "probe-image-size" {
  interface ProbeResult {
    mime: string;
    width: number;
    height: number;
  }

  interface ProbeModule {
    sync(buffer: Buffer): ProbeResult | undefined;
  }

  const probe: ProbeModule;
  export default probe;
}
