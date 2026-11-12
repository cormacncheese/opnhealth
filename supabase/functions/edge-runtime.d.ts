// Minimal declarations for the Edge runtime globals, so the functions can be
// type-checked with tsc alongside the rest of the repository.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): unknown;
};
